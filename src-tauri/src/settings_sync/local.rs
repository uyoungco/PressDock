use super::*;
use crate::{
    ai::credentials::{AiVault, NativeAiVault},
    database::Database,
};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use sqlx::{Row, SqliteConnection};
use std::sync::Arc;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SyncError {
    pub code: &'static str,
    pub retryable: bool,
}
impl SyncError {
    pub fn new(code: &'static str, retryable: bool) -> Self {
        Self { code, retryable }
    }
}
impl From<sqlx::Error> for SyncError {
    fn from(_: sqlx::Error) -> Self {
        Self::new("SYNC_STORAGE", true)
    }
}
impl From<serde_json::Error> for SyncError {
    fn from(_: serde_json::Error) -> Self {
        Self::new("INVALID_DOCUMENT", false)
    }
}
impl From<ProtocolError> for SyncError {
    fn from(e: ProtocolError) -> Self {
        Self::new(e.code, false)
    }
}
impl From<crate::ai::AiError> for SyncError {
    fn from(_: crate::ai::AiError) -> Self {
        Self::new("SYNC_CREDENTIAL_STORE", true)
    }
}
impl From<crate::harvest::HarvestError> for SyncError {
    fn from(_: crate::harvest::HarvestError) -> Self {
        Self::new("SYNC_STORAGE", true)
    }
}
impl From<crate::error::AppError> for SyncError {
    fn from(_: crate::error::AppError) -> Self {
        Self::new("SYNC_STORAGE", true)
    }
}
pub(crate) type SyncResult<T> = std::result::Result<T, SyncError>;
pub(crate) struct LocalStore {
    pub vault: Arc<dyn AiVault>,
}
impl Default for LocalStore {
    fn default() -> Self {
        Self {
            vault: Arc::new(NativeAiVault),
        }
    }
}
pub(crate) struct Prepared {
    pub refs: HashMap<String, Option<String>>,
    created: Vec<String>,
}
pub(crate) struct Sealed {
    id: String,
    key_ref: String,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}
pub(crate) struct Pending {
    pub operation_id: String,
    pub device_id: String,
    pub sequence: u64,
    pub raw: Vec<u8>,
    pub status: String,
    pub attempts: i64,
    pub retry_at: Option<String>,
}
fn credential_error() -> SyncError {
    SyncError::new("SYNC_CREDENTIAL_STORE", true)
}
impl LocalStore {
    pub(super) async fn credential_guard(db: &Database) -> SyncResult<std::fs::File> {
        let rows = sqlx::query("PRAGMA database_list")
            .fetch_all(&db.pool)
            .await?;
        let path = rows
            .iter()
            .find(|row| row.get::<String, _>("name") == "main")
            .map(|row| row.get::<String, _>("file"))
            .filter(|path| !path.is_empty())
            .ok_or(SyncError::new("SYNC_STORAGE", true))?;
        let mut path = std::ffi::OsString::from(path);
        path.push(".settings-sync.lock");
        // 操作系统锁随进程退出释放；避免另一个进程回收正在准备的凭据。
        tokio::task::spawn_blocking(move || {
            let file = std::fs::File::options()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)?;
            file.lock()?;
            Ok::<_, std::io::Error>(file)
        })
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))
    }
    pub async fn load(&self, reference: &str) -> SyncResult<String> {
        let vault = self.vault.clone();
        let reference = reference.to_string();
        tokio::task::spawn_blocking(move || vault.load(&reference))
            .await
            .map_err(|_| credential_error())?
            .map_err(Into::into)
    }
    async fn save(&self, reference: &str, value: String) -> SyncResult<()> {
        let vault = self.vault.clone();
        let reference = reference.to_string();
        tokio::task::spawn_blocking(move || vault.save(&reference, &value))
            .await
            .map_err(|_| credential_error())?
            .map_err(Into::into)
    }
    pub async fn clear(&self, reference: &str) -> bool {
        let vault = self.vault.clone();
        let reference = reference.to_string();
        matches!(
            tokio::task::spawn_blocking(move || vault.clear(&reference)).await,
            Ok(Ok(()))
        )
    }
    pub async fn collect(&self, db: &Database) -> SyncResult<()> {
        let _credentials = Self::credential_guard(db).await?;
        self.collect_locked(db).await
    }
    async fn collect_locked(&self, db: &Database) -> SyncResult<()> {
        let refs:Vec<String>=sqlx::query_scalar("SELECT credential_ref FROM sync_credential_gc WHERE credential_ref NOT IN (SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_recovery_credentials UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT json_extract(options,'$.metadataSnapshot.credentialRef') FROM harvest_jobs WHERE json_extract(options,'$.metadataSnapshot.credentialRef') IS NOT NULL UNION SELECT json_extract(options,'$.paginationSnapshot.execution.credentialRef') FROM harvest_jobs WHERE json_extract(options,'$.paginationSnapshot.execution.credentialRef') IS NOT NULL)").fetch_all(&db.pool).await?;
        for reference in refs {
            if self.clear(&reference).await {
                sqlx::query("DELETE FROM sync_credential_gc WHERE credential_ref=?")
                    .bind(reference)
                    .execute(&db.pool)
                    .await?;
            }
        }
        Ok(())
    }
    pub async fn prepare(
        &self,
        db: &Database,
        config: &Config,
        secrets: &[SecretValue],
    ) -> SyncResult<Prepared> {
        let mut prepared = Prepared {
            refs: HashMap::new(),
            created: Vec::new(),
        };
        for p in &config.providers {
            if let Some(s) = secrets.iter().find(|s| s.provider_id == p.id) {
                if let Some(value) = &s.value {
                    let reference = format!("sync-secret-{}", uuid::Uuid::new_v4());
                    if let Err(error) =
                        sqlx::query("INSERT OR IGNORE INTO sync_credential_gc VALUES(?)")
                            .bind(&reference)
                            .execute(&db.pool)
                            .await
                    {
                        self.discard(&prepared).await;
                        return Err(error.into());
                    }
                    if let Err(e) = self.save(&reference, value.clone()).await {
                        self.discard(&prepared).await;
                        return Err(e);
                    }
                    // 只有读回成功才允许切换生效版本。
                    if self.load(&reference).await.as_deref() != Ok(value.as_str()) {
                        self.clear(&reference).await;
                        self.discard(&prepared).await;
                        return Err(credential_error());
                    }
                    prepared.created.push(reference.clone());
                    prepared.refs.insert(p.id.clone(), Some(reference));
                } else {
                    prepared.refs.insert(p.id.clone(), None);
                }
            } else {
                prepared
                    .refs
                    .insert(p.id.clone(), db.ai_credential_ref(&p.id).await?);
            }
        }
        Ok(prepared)
    }
    pub async fn discard(&self, prepared: &Prepared) {
        for r in &prepared.created {
            self.clear(r).await;
        }
    }
    pub(super) async fn freeze_initialization(
        &self,
        db: &Database,
        environment: &str,
        config: Config,
        secrets: Vec<SecretValue>,
    ) -> SyncResult<Vec<u8>> {
        let _credentials = Self::credential_guard(db).await?;
        Self::ensure_device(db).await?;
        let row =
            sqlx::query("SELECT device_id,last_allocated_sequence FROM sync_state WHERE id=1")
                .fetch_one(&db.pool)
                .await?;
        let sequence = row.try_get::<i64, _>("last_allocated_sequence")? + 1;
        let init = Initialize {
            schema_version: 1,
            operation_id: uuid::Uuid::new_v4().to_string(),
            device_id: row.try_get("device_id")?,
            sequence: sequence as u64,
            config,
            secrets,
        };
        let raw = serde_json::to_vec(&init)?;
        validate_document(&raw, DocumentKind::Initialize, None, &[])?;
        let sealed = self.seal(db, &init.operation_id, &raw).await?;
        let result: SyncResult<()> = async {
            let mut tx = db.pool.begin().await?;
            sqlx::query("INSERT INTO sync_secure_payloads VALUES(?,'request',1,?,?,?)")
                .bind(&sealed.id)
                .bind(&sealed.key_ref)
                .bind(&sealed.nonce)
                .bind(&sealed.ciphertext)
                .execute(&mut *tx)
                .await?;
            sqlx::query("INSERT INTO sync_initialization VALUES(?,?,?,NULL)")
                .bind(environment)
                .bind(&init.operation_id)
                .bind(&sealed.id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE sync_state SET last_allocated_sequence=? WHERE id=1")
                .bind(sequence)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            self.clear(&sealed.key_ref).await;
        }
        result?;
        Ok(raw)
    }
    async fn seal(&self, db: &Database, id: &str, raw: &[u8]) -> SyncResult<Sealed> {
        let key = Aes256Gcm::generate_key(OsRng);
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = Aes256Gcm::new(&key)
            .encrypt(
                &nonce,
                Payload {
                    msg: raw,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| credential_error())?;
        let key_ref = format!("sync-payload-{id}");
        sqlx::query("INSERT OR IGNORE INTO sync_credential_gc VALUES(?)")
            .bind(&key_ref)
            .execute(&db.pool)
            .await?;
        self.save(&key_ref, STANDARD.encode(key)).await?;
        Ok(Sealed {
            id: id.to_string(),
            key_ref,
            nonce: nonce.to_vec(),
            ciphertext,
        })
    }
    pub async fn unseal(&self, db: &Database, id: &str) -> SyncResult<Vec<u8>> {
        let row=sqlx::query("SELECT credential_key_ref,nonce,ciphertext FROM sync_secure_payloads WHERE id=? AND encryption_version=1").bind(id).fetch_one(&db.pool).await?;
        let key = STANDARD
            .decode(self.load(row.try_get("credential_key_ref")?).await?)
            .map_err(|_| credential_error())?;
        let nonce: Vec<u8> = row.try_get("nonce")?;
        let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
        if nonce.len() != 12 {
            return Err(credential_error());
        }
        Aes256Gcm::new_from_slice(&key)
            .map_err(|_| credential_error())?
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| credential_error())
    }
    pub async fn ensure_device(db: &Database) -> SyncResult<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO sync_state(id,device_id,last_allocated_sequence) VALUES(1,?,0)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .execute(&db.pool)
        .await?;
        Ok(())
    }
    pub async fn pending(&self, db: &Database) -> SyncResult<Vec<Pending>> {
        let rows=sqlx::query("SELECT operation_id,device_id,sequence,wire_body,wire_body_payload_id,status,attempts,retry_at FROM sync_outbox ORDER BY sequence").fetch_all(&db.pool).await?;
        let mut result = Vec::with_capacity(rows.len());
        for r in rows {
            let body: Option<String> = r.try_get("wire_body")?;
            let bytes = if let Some(body) = body {
                body.into_bytes()
            } else {
                self.unseal(db, r.try_get::<&str, _>("wire_body_payload_id")?)
                    .await?
            };
            result.push(Pending {
                operation_id: r.try_get("operation_id")?,
                device_id: r.try_get("device_id")?,
                sequence: r.try_get::<i64, _>("sequence")? as u64,
                raw: bytes,
                status: r.try_get("status")?,
                attempts: r.try_get("attempts")?,
                retry_at: r.try_get("retry_at")?,
            });
        }
        Ok(result)
    }
    pub async fn archive_rejected(&self, db: &Database) -> SyncResult<()> {
        let _credentials = Self::credential_guard(db).await?;
        // 调用方持有上传、AI 和配置锁；业务配置、队列、凭据引用一起保留。
        let config = export(db).await?;
        let mut tx = db.pool.begin().await?;
        let head: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT status,last_error_code FROM sync_outbox ORDER BY sequence LIMIT 1",
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some((status, reason)) = head else {
            return Err(SyncError::new("RECOVERY_NOT_AVAILABLE", false));
        };
        if status != "failedValidation" {
            return Err(SyncError::new("RECOVERY_NOT_AVAILABLE", false));
        }
        let batch = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO sync_recovery_batches VALUES(?,?,?,?)")
            .bind(&batch)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(reason.as_deref().unwrap_or("VALIDATION_FAILED"))
            .bind(serde_json::to_string(&config)?)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO sync_recovery_credentials SELECT ?,id,credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL")
            .bind(&batch).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sync_recovery_operations SELECT operation_id,?,device_id,sequence,schema_version,safe_plan_json,wire_body,wire_body_payload_id,status,attempts,last_error_code FROM sync_outbox")
            .bind(&batch).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM sync_outbox")
            .execute(&mut *tx)
            .await?;
        // 采用云端只能发生在下一进程冷启动；当前进程不再编辑或上传。
        sqlx::query(
            "UPDATE sync_state SET active_generation=NULL,pending_generation=NULL WHERE id=1",
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn enqueue(
        &self,
        db: &Database,
        changes: Vec<Change>,
        local: Option<&crate::harvest::Settings>,
    ) -> SyncResult<bool> {
        let _credentials = Self::credential_guard(db).await?;
        Self::ensure_device(db).await?;
        if changes.is_empty() {
            if let Some(local) = local {
                db.harvest_save_settings(local).await?;
            }
            return Ok(false);
        }
        let state=sqlx::query("SELECT device_id,last_allocated_sequence,active_generation,last_observed_revision FROM sync_state WHERE id=1").fetch_one(&db.pool).await?;
        if !cfg!(feature = "android-demo")
            && state
                .try_get::<Option<String>, _>("active_generation")?
                .is_none()
        {
            return Err(SyncError::new("SYNC_NOT_READY", false));
        }
        let sequence = state.try_get::<i64, _>("last_allocated_sequence")? + 1;
        let op = Operation {
            schema_version: 1,
            operation_id: uuid::Uuid::new_v4().to_string(),
            device_id: state.try_get("device_id")?,
            sequence: sequence as u64,
            changes,
        };
        let current = export(db).await?;
        let base = json!({"schemaVersion":1,"revision":state.try_get::<i64,_>("last_observed_revision")?.max(1),"config":current});
        let raw = serde_json::to_vec(&op)?;
        let next = validate_document(&raw, DocumentKind::Operation, Some(&base), &[])?;
        let config: Config = serde_json::from_value(next["config"].clone())?;
        if cfg!(feature = "android-demo") {
            if op
                .changes
                .iter()
                .any(|c| matches!(c, Change::SetSecret { .. }))
            {
                return Err(SyncError::new("DEMO_ONLY", false));
            }
            let refs = config
                .providers
                .iter()
                .map(|p| (p.id.clone(), None))
                .collect();
            let mut tx = db.pool.begin().await?;
            apply_business(&mut tx, &config, &refs, local).await?;
            tx.commit().await?;
            return Ok(false);
        }
        let secrets: Vec<SecretValue> = op
            .changes
            .iter()
            .filter_map(|c| match c {
                Change::SetSecret { provider_id, value } => Some(SecretValue {
                    provider_id: provider_id.clone(),
                    value: Some(value.clone()),
                }),
                Change::ClearSecret { provider_id } => Some(SecretValue {
                    provider_id: provider_id.clone(),
                    value: None,
                }),
                _ => None,
            })
            .collect();
        let prepared = self.prepare(db, &config, &secrets).await?;
        // 冻结原始字节，所有请求均加密持久化，safe_plan 只保留秘密操作的存在与位置。
        let sealed = match self.seal(db, &op.operation_id, &raw).await {
            Ok(s) => s,
            Err(e) => {
                self.discard(&prepared).await;
                return Err(e);
            }
        };
        let result = self
            .commit_edit(db, &config, &prepared, &op, &sealed, local)
            .await;
        if result.is_err() {
            self.discard(&prepared).await;
            self.clear(&sealed.key_ref).await;
        }
        result.map(|_| true)
    }
    async fn commit_edit(
        &self,
        db: &Database,
        config: &Config,
        prepared: &Prepared,
        op: &Operation,
        sealed: &Sealed,
        local: Option<&crate::harvest::Settings>,
    ) -> SyncResult<()> {
        let mut tx = db.pool.begin().await?;
        sqlx::query("INSERT OR IGNORE INTO sync_credential_gc SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL").execute(&mut *tx).await?;
        apply_business(&mut tx, config, &prepared.refs, local).await?;
        sqlx::query("INSERT INTO sync_secure_payloads VALUES(?,'request',1,?,?,?)")
            .bind(&sealed.id)
            .bind(&sealed.key_ref)
            .bind(&sealed.nonce)
            .bind(&sealed.ciphertext)
            .execute(&mut *tx)
            .await?;
        let mut safe = serde_json::to_value(op)?;
        for c in safe["changes"]
            .as_array_mut()
            .ok_or(SyncError::new("INVALID_DOCUMENT", false))?
        {
            if c["type"] == "setSecret" {
                c.as_object_mut().unwrap().remove("value");
            }
        }
        sqlx::query("INSERT INTO sync_outbox(operation_id,device_id,sequence,schema_version,safe_plan_json,wire_body_payload_id,status) VALUES(?,?,?,1,?,?,'queued')").bind(&op.operation_id).bind(&op.device_id).bind(op.sequence as i64).bind(serde_json::to_string(&safe)?).bind(&sealed.id).execute(&mut *tx).await?;
        sqlx::query("UPDATE sync_state SET last_allocated_sequence=? WHERE id=1 AND last_allocated_sequence<?").bind(op.sequence as i64).bind(op.sequence as i64).execute(&mut *tx).await?;
        tx.commit().await?;
        let _ = self.collect_locked(db).await;
        Ok(())
    }
    pub async fn install(&self, db: &Database, mut boot: Bootstrap) -> SyncResult<()> {
        let _credentials = Self::credential_guard(db).await?;
        let raw = serde_json::to_vec(&boot)?;
        validate_document(&raw, DocumentKind::Bootstrap, None, &[])?;
        let cloud = boot.snapshot.clone();
        let mut snapshot = serde_json::to_value(&boot.snapshot)?;
        for pending in self.pending(db).await? {
            snapshot =
                validate_document(&pending.raw, DocumentKind::Operation, Some(&snapshot), &[])?;
            let op: Operation = serde_json::from_slice(&pending.raw)?;
            for c in op.changes {
                match c {
                    Change::SetSecret { provider_id, value } => {
                        boot.secrets.retain(|s| s.provider_id != provider_id);
                        boot.secrets.push(SecretValue {
                            provider_id,
                            value: Some(value),
                        });
                    }
                    Change::ClearSecret { provider_id } => {
                        boot.secrets.retain(|s| s.provider_id != provider_id);
                        boot.secrets.push(SecretValue {
                            provider_id,
                            value: None,
                        });
                    }
                    _ => {}
                }
            }
        }
        let config: Config = serde_json::from_value(snapshot["config"].clone())?;
        boot.secrets
            .retain(|s| config.providers.iter().any(|p| p.id == s.provider_id));
        // 本机新增而尚未上报的提供商可以没有密钥；其余云端条目已由 bootstrap 全量验证。
        for p in &config.providers {
            if !boot.secrets.iter().any(|s| s.provider_id == p.id) {
                boot.secrets.push(SecretValue {
                    provider_id: p.id.clone(),
                    value: None,
                });
            }
        }
        let prepared = self.prepare(db, &config, &boot.secrets).await?;
        let generation = uuid::Uuid::new_v4().to_string();
        let result:SyncResult<()>=async {
            let mut tx=db.pool.begin().await?;
            sqlx::query("INSERT OR IGNORE INTO sync_credential_gc SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL").execute(&mut *tx).await?;
            apply_business(&mut tx,&config,&prepared.refs,None).await?;
            sqlx::query("INSERT INTO sync_generations(id,cloud_revision,config_json,secrets_ready) VALUES(?,?,?,1)").bind(&generation).bind(cloud.revision as i64).bind(serde_json::to_string(&cloud.config)?).execute(&mut *tx).await?;
            for (provider,reference) in &prepared.refs {sqlx::query("INSERT INTO sync_generation_secrets VALUES(?,?,?)").bind(&generation).bind(provider).bind(reference).execute(&mut *tx).await?;}
            sqlx::query("UPDATE sync_state SET active_generation=?,pending_generation=NULL,last_observed_revision=? WHERE id=1").bind(&generation).bind(cloud.revision as i64).execute(&mut *tx).await?;
            sqlx::query("DELETE FROM sync_generations WHERE id<>?").bind(&generation).execute(&mut *tx).await?;
            tx.commit().await?;Ok(())
        }.await;
        if result.is_err() {
            self.discard(&prepared).await;
        } else {
            let _ = self.collect_locked(db).await;
        }
        result
    }
}
pub(crate) async fn export(db: &Database) -> SyncResult<Config> {
    let ai = db.ai_settings().await?;
    let harvest = db.harvest_settings().await?;
    let mut image_presets = Vec::new();
    for group in db.list_channel_image_presets().await? {
        for (field, preset) in [
            ("titlePic", group.title_pic),
            ("titlePic2", group.title_pic2),
        ] {
            if preset.size.is_some() || preset.max_bytes.is_some() || preset.format.is_some() {
                image_presets.push(ImagePreset {
                    channel: group.channel.clone(),
                    sub_channel: group.sub_channel.clone(),
                    field: field.into(),
                    size: preset.size,
                    max_bytes: preset.max_bytes.map(|v| v as u32),
                    format: preset.format,
                });
            }
        }
    }
    let default = |purpose| {
        ai.templates
            .iter()
            .find(|t| t.is_default && t.purpose == purpose)
            .map(|t| t.id.clone())
    };
    let defaults = Defaults {
        title_template_id: default(crate::ai::TemplatePurpose::Title),
        pagination_template_id: default(crate::ai::TemplatePurpose::Pagination),
    };
    let config = Config {
        providers: ai
            .providers
            .into_iter()
            .map(|p| Provider {
                id: p.id,
                display_name: p.display_name,
                base_url: p.base_url,
                protocol: p.protocol,
                compatibility: p.compatibility,
            })
            .collect(),
        models: ai.models,
        templates: ai
            .templates
            .into_iter()
            .map(|t| Template {
                id: t.id,
                purpose: t.purpose,
                name: t.name,
                system_prompt: t.system_prompt,
                user_prompt: t.user_prompt,
                model_config_id: t.model_config_id,
                candidate_count: t.candidate_count,
                max_length: t.max_length,
                pagination_options: t.pagination_options,
            })
            .collect(),
        image_presets,
        defaults,
        harvest: HarvestRules {
            auto_classify: harvest.options.auto_classify,
            auto_tags: harvest.options.auto_tags,
            auto_summary: harvest.options.auto_summary,
            ai_auto_paginate: harvest.options.ai_auto_paginate,
            model_config_id: harvest.options.model_config_id,
        },
    };
    validate_snapshot(&json!({"schemaVersion":1,"revision":1,"config":config}))?;
    Ok(config)
}
pub(crate) async fn apply_business(
    conn: &mut SqliteConnection,
    config: &Config,
    refs: &HashMap<String, Option<String>>,
    local: Option<&crate::harvest::Settings>,
) -> SyncResult<()> {
    // 唯一一次事务切换；任务、素材、草稿表均不更新。
    sqlx::query("UPDATE harvest_settings SET model_config_id=NULL WHERE id=1")
        .execute(&mut *conn)
        .await?;
    for sql in [
        "DELETE FROM ai_prompt_templates",
        "DELETE FROM ai_models",
        "DELETE FROM ai_providers",
        "DELETE FROM channel_image_presets",
    ] {
        sqlx::query(sql).execute(&mut *conn).await?;
    }
    for p in &config.providers {
        sqlx::query("INSERT INTO ai_providers VALUES(?,?,?,?,?,?)")
            .bind(&p.id)
            .bind(&p.display_name)
            .bind(&p.base_url)
            .bind(p.protocol.as_str())
            .bind(refs.get(&p.id).and_then(|r| r.as_deref()))
            .bind(serde_json::to_string(&p.compatibility)?)
            .execute(&mut *conn)
            .await?;
    }
    for m in &config.models {
        sqlx::query("INSERT INTO ai_models VALUES(?,?,?,?,?,?,?)")
            .bind(&m.id)
            .bind(&m.provider_id)
            .bind(&m.model_id)
            .bind(&m.display_name)
            .bind(m.context_window)
            .bind(m.max_output_tokens)
            .bind(&m.reasoning_effort)
            .execute(&mut *conn)
            .await?;
    }
    for t in &config.templates {
        let default = if t.purpose == crate::ai::TemplatePurpose::Title {
            &config.defaults.title_template_id
        } else {
            &config.defaults.pagination_template_id
        };
        sqlx::query("INSERT INTO ai_prompt_templates(id,name,system_prompt,user_prompt,model_config_id,candidate_count,max_length,is_default,purpose,pagination_options) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(&t.id).bind(&t.name).bind(&t.system_prompt).bind(&t.user_prompt).bind(&t.model_config_id).bind(t.candidate_count).bind(t.max_length).bind(default.as_deref()==Some(t.id.as_str())).bind(t.purpose.as_str()).bind(t.pagination_options.as_ref().map(serde_json::to_string).transpose()?).execute(&mut *conn).await?;
    }
    for p in &config.image_presets {
        sqlx::query("INSERT INTO channel_image_presets VALUES(?,?,?,?)")
            .bind(&p.channel)
            .bind(&p.sub_channel)
            .bind(&p.field)
            .bind(serde_json::to_string(
                &json!({"size":p.size,"maxBytes":p.max_bytes,"format":p.format}),
            )?)
            .execute(&mut *conn)
            .await?;
    }
    let mut options: Value = if let Some(local) = local {
        serde_json::to_value(&local.options)?
    } else {
        let s: String = sqlx::query_scalar("SELECT options FROM harvest_settings WHERE id=1")
            .fetch_one(&mut *conn)
            .await?;
        serde_json::from_str(&s)?
    };
    let shared = serde_json::to_value(&config.harvest)?;
    for (k, v) in shared
        .as_object()
        .ok_or(SyncError::new("INVALID_DOCUMENT", false))?
    {
        options[k] = v.clone();
    }
    sqlx::query("UPDATE harvest_settings SET options=?,model_config_id=? WHERE id=1")
        .bind(serde_json::to_string(&options)?)
        .bind(&config.harvest.model_config_id)
        .execute(&mut *conn)
        .await?;
    if let Some(local) = local {
        sqlx::query("UPDATE harvest_settings SET retention_days=? WHERE id=1")
            .bind(local.retention_days)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// 基于表单打开时的基线生成字段修改；调用方仅将实际变化的字段交给此函数。
pub(crate) fn diff(old: &Config, new: &Config) -> SyncResult<Vec<Change>> {
    let old = serde_json::to_value(old)?;
    let new = serde_json::to_value(new)?;
    let mut changes = Vec::new();
    for (collection, entity) in [
        ("providers", "provider"),
        ("models", "model"),
        ("templates", "template"),
        ("imagePresets", "imagePreset"),
    ] {
        let before = old[collection]
            .as_array()
            .ok_or(SyncError::new("INVALID_DOCUMENT", false))?;
        let after = new[collection]
            .as_array()
            .ok_or(SyncError::new("INVALID_DOCUMENT", false))?;
        let target = |v: &Value| {
            if entity == "imagePreset" {
                json!({"entity":entity,"channel":v["channel"],"subChannel":v["subChannel"],"field":v["field"]})
            } else {
                json!({"entity":entity,"id":v["id"]})
            }
        };
        for a in before {
            if !after
                .iter()
                .any(|b| entity_key(entity, a) == entity_key(entity, b))
            {
                changes.push(Change::Delete { target: target(a) });
            }
        }
        for b in after {
            if let Some(a) = before
                .iter()
                .find(|a| entity_key(entity, a) == entity_key(entity, b))
            {
                for (field, value) in b
                    .as_object()
                    .ok_or(SyncError::new("INVALID_DOCUMENT", false))?
                {
                    if [
                        "id",
                        "providerId",
                        "purpose",
                        "channel",
                        "subChannel",
                        "field",
                    ]
                    .contains(&field.as_str())
                    {
                        continue;
                    }
                    if field == "compatibility" {
                        for (nested, v) in value
                            .as_object()
                            .ok_or(SyncError::new("INVALID_DOCUMENT", false))?
                        {
                            if a[field][nested] != *v {
                                changes.push(Change::Set {
                                    target: target(b),
                                    field: format!("compatibility.{nested}"),
                                    value: v.clone(),
                                });
                            }
                        }
                    } else if a[field] != *value {
                        changes.push(Change::Set {
                            target: target(b),
                            field: field.clone(),
                            value: value.clone(),
                        });
                    }
                }
            } else {
                changes.push(Change::Create {
                    entity: entity.into(),
                    value: b.clone(),
                });
            }
        }
    }
    for entity in ["defaults", "harvest"] {
        for (field, value) in new[entity]
            .as_object()
            .ok_or(SyncError::new("INVALID_DOCUMENT", false))?
        {
            if old[entity][field] != *value {
                changes.push(Change::Set {
                    target: json!({"entity":entity}),
                    field: field.clone(),
                    value: value.clone(),
                });
            }
        }
    }
    Ok(changes)
}
