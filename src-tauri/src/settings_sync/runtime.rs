use super::{
    local::{LocalStore, Pending, SyncError, SyncResult},
    *,
};
use crate::{ai::AiService, cms::CmsService, database::Database};
use reqwest::{Client, redirect::Policy};
use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tauri::Manager;
use tokio::sync::{Mutex, Notify};
#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;

pub(crate) const ORIGIN: &str = "https://pressdock-settings.uyoung.co/api/v1/settings";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStatus {
    pub ready: bool,
    pub phase: &'static str,
    pub using_cache: bool,
    pub pending: u64,
    pub last_error: Option<String>,
    pub read_requests: u64,
    pub successful_reads: u64,
    pub write_requests: u64,
}
pub(crate) struct SettingsSync {
    pub local: LocalStore,
    pub gate: Mutex<()>,
    startup: Mutex<()>,
    upload: Mutex<()>,
    client: Client,
    origin: String,
    attempted: AtomicBool,
    succeeded: AtomicBool,
    using_cache: AtomicBool,
    restart_required: AtomicBool,
    last_error: Mutex<Option<SyncError>>,
    reads: AtomicU64,
    successes: AtomicU64,
    writes: AtomicU64,
    pub wake: Notify,
}
impl SettingsSync {
    pub(super) fn development() -> std::result::Result<Self, reqwest::Error> {
        let mut service = Self::new()?;
        service.origin = "https://pressdock-settings-dev.i9543.workers.dev/api/v1/settings".into();
        Ok(service)
    }
    #[cfg(all(test, target_os = "windows"))]
    pub(super) fn initialization_fault_probe() -> std::result::Result<Self, reqwest::Error> {
        let mut service = Self::new()?;
        service.origin =
            "https://pressdock-settings-init-qa-20261107.i9543.workers.dev/api/v1/settings".into();
        Ok(service)
    }
    pub fn new() -> std::result::Result<Self, reqwest::Error> {
        Ok(Self {
            local: LocalStore::default(),
            gate: Mutex::new(()),
            startup: Mutex::new(()),
            upload: Mutex::new(()),
            client: Client::builder()
                .user_agent(concat!("PressDock/", env!("CARGO_PKG_VERSION")))
                .retry(reqwest::retry::never())
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(25))
                .build()?,
            origin: ORIGIN.into(),
            attempted: AtomicBool::new(false),
            succeeded: AtomicBool::new(false),
            using_cache: AtomicBool::new(false),
            restart_required: AtomicBool::new(false),
            last_error: Mutex::new(None),
            reads: AtomicU64::new(0),
            successes: AtomicU64::new(0),
            writes: AtomicU64::new(0),
            wake: Notify::new(),
        })
    }
    async fn cached(db: &Database) -> SyncResult<bool> {
        Ok(sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM sync_state s JOIN sync_generations g ON g.id=s.active_generation WHERE g.secrets_ready=1)").fetch_one(&db.pool).await?)
    }
    pub async fn status(&self, db: &Database) -> SyncResult<SyncStatus> {
        if cfg!(feature = "android-demo") {
            return Ok(SyncStatus {
                ready: true,
                phase: "demo",
                using_cache: false,
                pending: 0,
                last_error: None,
                read_requests: 0,
                successful_reads: 0,
                write_requests: 0,
            });
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox")
            .fetch_one(&db.pool)
            .await?;
        let head: Option<(String, i64, Option<String>)> =
            sqlx::query_as("SELECT status,schema_version,last_error_code FROM sync_outbox ORDER BY sequence LIMIT 1")
                .fetch_optional(&db.pool)
                .await?;
        let ready = Self::cached(db).await?;
        let error = self.last_error.lock().await;
        let head_status = head.as_ref().map(|h| h.0.as_str());
        let last_error = error
            .as_ref()
            .map(|e| e.code)
            .or_else(|| head.as_ref().and_then(|h| h.2.as_deref()));
        let retry_protocol = head.as_ref().is_some_and(|h| {
            h.0 == "failedValidation" && h.1 == 2 && h.2.as_deref() == Some("UNSUPPORTED_VERSION")
        });
        let protocol_mismatch = retry_protocol
            || (head_status != Some("failedValidation")
                && last_error == Some("UNSUPPORTED_VERSION"));
        let phase = if self.restart_required.load(Ordering::SeqCst)
            || (!ready && self.succeeded.load(Ordering::SeqCst))
        {
            "restartRequired"
        } else if !self.attempted.load(Ordering::SeqCst) && head.is_none() {
            "idle"
        } else if head_status == Some("waitingAuth") || last_error == Some("AUTH_EXPIRED") {
            "waitingAuth"
        } else if protocol_mismatch {
            "protocolMismatch"
        } else if !ready {
            "blocked"
        } else if head_status == Some("failedValidation") {
            "failedValidation"
        } else if head_status == Some("uploading") {
            "uploading"
        } else if count > 0 {
            "pending"
        } else if self.using_cache.load(Ordering::SeqCst) {
            "cache"
        } else {
            "reported"
        };
        Ok(SyncStatus {
            ready,
            phase,
            using_cache: self.using_cache.load(Ordering::SeqCst),
            pending: count as u64,
            last_error: last_error.map(str::to_owned),
            read_requests: self.reads.load(Ordering::SeqCst),
            successful_reads: self.successes.load(Ordering::SeqCst),
            write_requests: self.writes.load(Ordering::SeqCst),
        })
    }
    pub async fn resolve_rejected(
        &self,
        db: &Database,
        ai: &AiService,
        cms: &CmsService,
    ) -> SyncResult<SyncStatus> {
        if cfg!(feature = "android-demo") {
            return Err(SyncError::new("RECOVERY_NOT_AVAILABLE", false));
        }
        let _startup = self.startup.lock().await;
        let _upload = self.upload.lock().await;
        let _ai = ai.operations.lock().await;
        let _gate = self.gate.lock().await;
        let (generation, _) = cms
            .settings_authorization()
            .await
            .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
        let _session = cms
            .settings_generation_guard(generation)
            .await
            .map_err(|_| SyncError::new("SESSION_CHANGED", false))?;
        self.local.archive_rejected(db).await?;
        self.restart_required.store(true, Ordering::SeqCst);
        *self.last_error.lock().await = None;
        self.status(db).await
    }
    pub(super) async fn request(
        &self,
        token: &str,
        route: &str,
        raw: Option<&[u8]>,
    ) -> SyncResult<Vec<u8>> {
        let request = if let Some(raw) = raw {
            self.client
                .post(format!("{}/{route}", self.origin))
                .header("Content-Type", "application/json")
                .body(raw.to_vec())
        } else {
            self.client.get(format!("{}/{route}", self.origin))
        };
        let mut response = request
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| {
                eprintln!("{}", json!({"check":"settings-sync-transport","timeout":error.is_timeout(),"connect":error.is_connect(),"request":error.is_request()}));
                SyncError::new("SYNC_NETWORK", true)
            })?;
        let status = response.status();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| SyncError::new("SYNC_NETWORK", true))?
        {
            if bytes.len() + chunk.len() > MAX_DOCUMENT_BYTES {
                return Err(SyncError::new("PAYLOAD_TOO_LARGE", false));
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            let code = serde_json::from_slice::<Value>(&bytes)
                .ok()
                .and_then(|v| v["error"]["code"].as_str().map(str::to_string));
            let code = match code.as_deref() {
                Some("AUTH_REQUIRED" | "AUTH_EXPIRED") => "AUTH_EXPIRED",
                Some("CMS_TIMEOUT") => "CMS_TIMEOUT",
                Some("CMS_UNAVAILABLE") => "CMS_UNAVAILABLE",
                Some("CMS_INVALID_RESPONSE") => "CMS_INVALID_RESPONSE",
                Some("CMS_FORBIDDEN") => "CMS_FORBIDDEN",
                Some("OPERATION_NOT_FOUND") => "OPERATION_NOT_FOUND",
                Some("NOT_INITIALIZED") => "NOT_INITIALIZED",
                Some("ALREADY_INITIALIZED") => "ALREADY_INITIALIZED",
                Some("UNSUPPORTED_VERSION") => "UNSUPPORTED_VERSION",
                Some("REFERENCE_NOT_FOUND") => "REFERENCE_NOT_FOUND",
                Some("ENTITY_NOT_FOUND") => "ENTITY_NOT_FOUND",
                Some("ENTITY_DELETED") => "ENTITY_DELETED",
                Some("DUPLICATE_ENTITY") => "DUPLICATE_ENTITY",
                Some("OPERATION_ID_REUSED") => "OPERATION_ID_REUSED",
                Some("SEQUENCE_STALE") => "SEQUENCE_STALE",
                Some("VALIDATION_FAILED") => "VALIDATION_FAILED",
                Some("SECRET_UNAVAILABLE") => "SECRET_UNAVAILABLE",
                _ => "SYNC_SERVER",
            };
            // 只记录固定错误码与 HTTP 状态，不输出响应正文、请求或认证信息。
            eprintln!(
                "settings-sync response status={} code={}",
                status.as_u16(),
                code
            );
            return Err(SyncError::new(
                code,
                status.is_server_error() || status.as_u16() == 429 || status.as_u16() == 408,
            ));
        }
        Ok(bytes)
    }
    pub async fn start(
        &self,
        db: &Database,
        ai: &AiService,
        cms: &CmsService,
        retry: bool,
    ) -> SyncResult<SyncStatus> {
        let _startup = self.startup.lock().await;
        let _upload = self.upload.lock().await;
        if self.restart_required.load(Ordering::SeqCst) {
            return self.status(db).await;
        }
        LocalStore::ensure_device(db).await?;
        sqlx::query("UPDATE sync_outbox SET status='queued',retry_at=NULL WHERE status IN ('waitingAuth','uploading')").execute(&db.pool).await?;
        {
            let mut error = self.last_error.lock().await;
            if error
                .as_ref()
                .is_some_and(|error| error.code == "AUTH_EXPIRED")
            {
                *error = None;
            }
        }
        if self.succeeded.load(Ordering::SeqCst)
            || (self.attempted.load(Ordering::SeqCst) && !retry)
        {
            self.wake.notify_one();
            return self.status(db).await;
        }
        if !self.attempted.load(Ordering::SeqCst) {
            let _ai = ai.operations.lock().await;
            let _gate = self.gate.lock().await;
            // 清理上一进程在凭据准备后尚未提交的引用。
            let _ = self.local.collect(db).await;
        }
        self.attempted.store(true, Ordering::SeqCst);
        let result = self.fetch_install(db, ai, cms, None).await;
        if let Err(e) = result {
            *self.last_error.lock().await = Some(e);
            self.using_cache.store(true, Ordering::SeqCst);
        } else {
            self.succeeded.store(true, Ordering::SeqCst);
            self.using_cache.store(false, Ordering::SeqCst);
            self.successes.fetch_add(1, Ordering::SeqCst);
            *self.last_error.lock().await = None;
        }
        self.wake.notify_one();
        self.status(db).await
    }
    pub async fn manual(
        &self,
        db: &Database,
        ai: &AiService,
        cms: &CmsService,
    ) -> SyncResult<SyncStatus> {
        let _startup = self.startup.lock().await;
        let _upload = self.upload.lock().await;
        let status = self.status(db).await?;
        if matches!(
            status.phase,
            "demo" | "restartRequired" | "waitingAuth" | "failedValidation"
        ) {
            return Ok(status);
        }
        let (generation, _) = cms
            .settings_authorization()
            .await
            .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
        LocalStore::ensure_device(db).await?;
        self.attempted.store(true, Ordering::SeqCst);
        if status.phase == "protocolMismatch" {
            // 只有成功读取、校验和安装 v2 云端后才解锁；检查回执先于本机覆盖。
            match self.fetch_install(db, ai, cms, Some(generation)).await {
                Ok(()) => {
                    let _gate = self.gate.lock().await;
                    let _session = cms
                        .settings_generation_guard(generation)
                        .await
                        .map_err(|_| SyncError::new("SESSION_CHANGED", false))?;
                    sqlx::query("UPDATE sync_outbox SET status='queued',retry_at=NULL,last_error_code=NULL WHERE schema_version=2 AND status='failedValidation' AND last_error_code='UNSUPPORTED_VERSION'")
                        .execute(&db.pool).await?;
                    self.succeeded.store(true, Ordering::SeqCst);
                    self.using_cache.store(false, Ordering::SeqCst);
                    self.successes.fetch_add(1, Ordering::SeqCst);
                    *self.last_error.lock().await = None;
                }
                Err(error) if error.code == "SESSION_CHANGED" => return Err(error),
                Err(error) => {
                    self.using_cache.store(true, Ordering::SeqCst);
                    *self.last_error.lock().await = Some(error);
                    return self.status(db).await;
                }
            }
        }
        sqlx::query("UPDATE sync_outbox SET retry_at=NULL WHERE status='queued'")
            .execute(&db.pool)
            .await?;
        while self.upload_one_locked(db, cms, Some(generation)).await? {}
        let status = self.status(db).await?;
        if matches!(
            status.phase,
            "waitingAuth" | "failedValidation" | "protocolMismatch"
        ) {
            return Ok(status);
        }
        let upload_error = if status.pending > 0 {
            self.last_error.lock().await.clone()
        } else {
            None
        };
        match self.fetch_install(db, ai, cms, Some(generation)).await {
            Ok(()) => {
                self.succeeded.store(true, Ordering::SeqCst);
                self.using_cache.store(false, Ordering::SeqCst);
                self.successes.fetch_add(1, Ordering::SeqCst);
                *self.last_error.lock().await = upload_error;
            }
            Err(error) if error.code == "SESSION_CHANGED" => return Err(error),
            Err(error) => {
                self.using_cache.store(true, Ordering::SeqCst);
                *self.last_error.lock().await = Some(error);
            }
        }
        self.wake.notify_one();
        self.status(db).await
    }
    async fn fetch_install(
        &self,
        db: &Database,
        ai: &AiService,
        cms: &CmsService,
        expected_generation: Option<u64>,
    ) -> SyncResult<()> {
        let (generation, token) = cms
            .settings_authorization()
            .await
            .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
        if expected_generation.is_some_and(|expected| expected != generation) {
            return Err(SyncError::new("SESSION_CHANGED", false));
        }
        self.reads.fetch_add(1, Ordering::SeqCst);
        let raw = self.request(&token, "bootstrap", None).await?;
        validate_document(&raw, DocumentKind::Bootstrap, None, &[])?;
        let boot: Bootstrap = serde_json::from_slice(&raw)?;
        // 先识别在旧进程已经提交而响应丢失的操作，防止 create/delete 重放两次。
        let _ai = ai.operations.lock().await;
        let _gate = self.gate.lock().await;
        let observed: i64 =
            sqlx::query_scalar("SELECT last_observed_revision FROM sync_state WHERE id=1")
                .fetch_one(&db.pool)
                .await?;
        if boot.snapshot.revision < observed as u64 {
            return Err(SyncError::new("STALE_SNAPSHOT", true));
        }
        for pending in self.local.pending(db).await? {
            match self.request(&token, "check", Some(&pending.raw)).await {
                Ok(raw) => {
                    let receipt = Self::receipt(&raw, &pending)?;
                    if receipt.revision <= boot.snapshot.revision {
                        let _session = cms
                            .settings_generation_guard(generation)
                            .await
                            .map_err(|_| SyncError::new("SESSION_CHANGED", false))?;
                        self.ack(db, &pending, &receipt).await?;
                    } else {
                        return Err(SyncError::new("STALE_SNAPSHOT", true));
                    }
                }
                Err(e) if e.code == "OPERATION_NOT_FOUND" => {}
                Err(e) => return Err(e),
            }
        }
        let _session = cms
            .settings_generation_guard(generation)
            .await
            .map_err(|_| SyncError::new("SESSION_CHANGED", false))?;
        self.local.install(db, boot).await
    }
    fn receipt(raw: &[u8], pending: &Pending) -> SyncResult<Receipt> {
        validate_document(raw, DocumentKind::Receipt, None, &[])?;
        let r: Receipt = serde_json::from_slice(raw)?;
        if r.operation_id != pending.operation_id
            || r.device_id != pending.device_id
            || r.sequence != pending.sequence
        {
            return Err(SyncError::new("INVALID_RECEIPT", false));
        }
        Ok(r)
    }
    async fn ack(&self, db: &Database, pending: &Pending, receipt: &Receipt) -> SyncResult<()> {
        let _credentials = LocalStore::credential_guard(db).await?;
        let mut tx = db.pool.begin().await?;
        let payload:Option<String>=sqlx::query_scalar("SELECT wire_body_payload_id FROM sync_outbox WHERE operation_id=? AND device_id=? AND sequence=?").bind(&pending.operation_id).bind(&pending.device_id).bind(pending.sequence as i64).fetch_optional(&mut *tx).await?.flatten();
        let mut key_ref = None;
        if let Some(payload) = payload {
            key_ref = sqlx::query_scalar::<_, String>(
                "SELECT credential_key_ref FROM sync_secure_payloads WHERE id=?",
            )
            .bind(&payload)
            .fetch_optional(&mut *tx)
            .await?;
            sqlx::query("DELETE FROM sync_outbox WHERE operation_id=?")
                .bind(&pending.operation_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM sync_secure_payloads WHERE id=?")
                .bind(&payload)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query(
            "UPDATE sync_state SET last_observed_revision=MAX(last_observed_revision,?) WHERE id=1",
        )
        .bind(receipt.revision as i64)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        if let Some(key) = key_ref {
            self.local.clear(&key).await;
        }
        Ok(())
    }
    pub async fn changed(&self) {
        self.wake.notify_one();
    }
    pub async fn upload_one(&self, db: &Database, cms: &CmsService) -> SyncResult<bool> {
        let Ok(_upload) = self.upload.try_lock() else {
            return Ok(false);
        };
        self.upload_one_locked(db, cms, None).await
    }
    async fn upload_one_locked(
        &self,
        db: &Database,
        cms: &CmsService,
        expected_generation: Option<u64>,
    ) -> SyncResult<bool> {
        if !self.attempted.load(Ordering::SeqCst) || !Self::cached(db).await? {
            return Ok(false);
        }
        if self
            .last_error
            .lock()
            .await
            .as_ref()
            .is_some_and(|e| e.code == "UNSUPPORTED_VERSION")
        {
            return Ok(false);
        }
        let pending = {
            let _gate = self.gate.lock().await;
            self.local.pending(db).await?.into_iter().next()
        };
        let Some(pending) = pending else {
            return Ok(false);
        };
        if matches!(pending.status.as_str(), "waitingAuth" | "failedValidation") {
            return Ok(false);
        }
        if pending
            .retry_at
            .as_ref()
            .is_some_and(|t| t > &chrono::Utc::now().to_rfc3339())
        {
            return Ok(false);
        }
        let (generation, token) = match cms.settings_authorization().await {
            Ok(v) => v,
            Err(_) => return Ok(false),
        };
        if expected_generation.is_some_and(|expected| expected != generation) {
            return Err(SyncError::new("SESSION_CHANGED", false));
        }
        sqlx::query("UPDATE sync_outbox SET status='uploading' WHERE operation_id=?")
            .bind(&pending.operation_id)
            .execute(&db.pool)
            .await?;
        self.writes.fetch_add(1, Ordering::SeqCst);
        let response = self
            .request(&token, "operations", Some(&pending.raw))
            .await
            .and_then(|raw| Self::receipt(&raw, &pending));
        let _gate = self.gate.lock().await;
        let _session = cms
            .settings_generation_guard(generation)
            .await
            .map_err(|_| SyncError::new("SESSION_CHANGED", false))?;
        match response {
            Ok(receipt) => {
                self.ack(db, &pending, &receipt).await?;
                *self.last_error.lock().await = None;
                Ok(true)
            }
            Err(error) => {
                let status = if error.code == "AUTH_EXPIRED" {
                    "waitingAuth"
                } else if error.retryable {
                    "queued"
                } else {
                    "failedValidation"
                };
                let seconds = 2_i64.pow((pending.attempts + 1).min(8) as u32).min(300);
                let retry_at =
                    (chrono::Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339();
                sqlx::query("UPDATE sync_outbox SET status=?,attempts=attempts+1,retry_at=?,last_error_code=? WHERE operation_id=?").bind(status).bind(retry_at).bind(error.code).bind(&pending.operation_id).execute(&db.pool).await?;
                *self.last_error.lock().await = Some(error);
                Ok(false)
            }
        }
    }
}
pub(crate) fn start_background(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let sync = app.state::<SettingsSync>();
            tokio::select! {_=sync.wake.notified()=>{},_=tokio::time::sleep(Duration::from_secs(5))=>{}}
            while matches!(
                sync.upload_one(&app.state::<Database>(), &app.state::<CmsService>())
                    .await,
                Ok(true)
            ) {}
        }
    });
}
