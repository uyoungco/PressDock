//! 指定电脑的一次性初始化工具。只输出数量和布尔验收结果。
use super::{
    local::{self, LocalStore, SyncError, SyncResult},
    runtime::SettingsSync,
    *,
};
use crate::{cms::CmsService, database::Database};
use sqlx::{
    Row,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::path::{Path, PathBuf};
#[path = "admin_edits.rs"]
mod edit_probe;
#[path = "admin_protocol_repair.rs"]
mod protocol_repair;
#[cfg(all(test, target_os = "windows"))]
#[path = "admin_tests.rs"]
mod tests;
#[path = "admin_verify.rs"]
mod verify;
async fn capture_initialization(
    local: &LocalStore,
    db: &Database,
) -> SyncResult<(Config, Vec<SecretValue>)> {
    let _credentials = LocalStore::credential_guard(db).await?;
    let config = local::export(db).await?;
    let mut secrets = Vec::with_capacity(config.providers.len());
    for p in &config.providers {
        let value = if let Some(reference) = db.ai_credential_ref(&p.id).await? {
            Some(local.load(&reference).await?)
        } else {
            None
        };
        secrets.push(SecretValue {
            provider_id: p.id.clone(),
            value,
        });
    }
    Ok((config, secrets))
}
fn db_path() -> std::result::Result<PathBuf, &'static str> {
    if let Some(path) = std::env::var_os("PRESSDOCK_SETTINGS_SYNC_DB") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(target_os = "windows")]
    {
        Ok(
            PathBuf::from(std::env::var_os("APPDATA").ok_or("无法定位应用数据目录")?)
                .join("com.example.pressdock/pressdock.db"),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("此初始化工具当前只用于指定 Windows 电脑")
    }
}
async fn backup(path: &Path) -> SyncResult<PathBuf> {
    let directory =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tools/settings-sync-backups");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| SyncError::new("BACKUP_FAILED", false))?;
    let target = directory.join(format!("before-sync-{}.db", uuid::Uuid::new_v4()));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
        .await?;
    sqlx::query("VACUUM INTO ?")
        .bind(
            target
                .to_str()
                .ok_or(SyncError::new("BACKUP_FAILED", false))?,
        )
        .execute(&pool)
        .await?;
    pool.close().await;
    Ok(target)
}
async fn initialize(db: &Database, sync: &SettingsSync, token: &str) -> SyncResult<()> {
    let environment = "production";
    if let Some(row) = sqlx::query(
        "SELECT wire_body_payload_id,receipt_json FROM sync_initialization WHERE environment=?",
    )
    .bind(environment)
    .fetch_optional(&db.pool)
    .await?
    {
        if row.try_get::<Option<String>, _>("receipt_json")?.is_some() {
            println!(
                "{}",
                json!({"check":"initialize-repeat","alreadyCompletedLocally":true,"uploaded":false})
            );
            return Ok(());
        }
    } else {
        match sync.request(token, "bootstrap", None).await {
            Ok(_) => {
                println!(
                    "{}",
                    json!({"check":"initialize-existing-cloud","uploaded":false,"overwritten":false})
                );
                return Ok(());
            }
            Err(e) if e.code == "NOT_INITIALIZED" => {}
            Err(e) => return Err(e),
        }
    }
    let raw=if let Some(payload)=sqlx::query_scalar::<_,String>("SELECT wire_body_payload_id FROM sync_initialization WHERE environment=? AND wire_body_payload_id IS NOT NULL").bind(environment).fetch_optional(&db.pool).await? {sync.local.unseal(db,&payload).await?}else {
        let (config,secrets)=capture_initialization(&sync.local,db).await?;
        sync.local.freeze_initialization(db,environment,config,secrets).await?
    };
    let init: Initialize = serde_json::from_slice(&raw)?;
    let receipt = sync.request(token, "initialize", Some(&raw)).await?;
    validate_document(&receipt, DocumentKind::Receipt, None, &[])?;
    let r: Receipt = serde_json::from_slice(&receipt)?;
    if r.operation_id != init.operation_id
        || r.device_id != init.device_id
        || r.sequence != init.sequence
    {
        return Err(SyncError::new("INVALID_RECEIPT", false));
    }
    let remote = sync.request(token, "bootstrap", None).await?;
    validate_document(&remote, DocumentKind::Bootstrap, None, &[])?;
    let remote: Bootstrap = serde_json::from_slice(&remote)?;
    let compared = remote.snapshot.revision == r.revision;
    if remote.snapshot.revision < r.revision
        || (compared
            && (serde_json::to_value(&remote.snapshot.config)?
                != serde_json::to_value(&init.config)?
                || serde_json::to_value(&remote.secrets)? != serde_json::to_value(&init.secrets)?))
    {
        return Err(SyncError::new("IMPORT_MISMATCH", false));
    }
    #[cfg(all(test, target_os = "windows"))]
    tests::after_cloud_commit_before_local_receipt(&r).await;
    let key_ref: String =
        sqlx::query_scalar("SELECT credential_key_ref FROM sync_secure_payloads WHERE id=?")
            .bind(&init.operation_id)
            .fetch_one(&db.pool)
            .await?;
    let mut tx = db.pool.begin().await?;
    sqlx::query("UPDATE sync_initialization SET wire_body_payload_id=NULL,receipt_json=? WHERE environment=?").bind(std::str::from_utf8(&receipt).map_err(|_|SyncError::new("INVALID_RECEIPT",false))?).bind(environment).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sync_secure_payloads WHERE id=?")
        .bind(&init.operation_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    sync.local.clear(&key_ref).await;
    println!(
        "{}",
        json!({"check":"initialize-production","passed":true,"revision":r.revision,"providers":init.config.providers.len(),"models":init.config.models.len(),"templates":init.config.templates.len(),"imagePresets":init.config.image_presets.len(),"keysPresent":init.secrets.iter().filter(|s|s.value.is_some()).count(),"configCompared":compared,"secretsComparedWithoutOutput":compared,"cloudAdvancedAfterInitialization":!compared})
    );
    Ok(())
}
async fn inspect(path: &Path) -> SyncResult<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
        .await?;
    let row=sqlx::query("SELECT (SELECT count(*) FROM ai_providers) AS providers,(SELECT count(*) FROM ai_models) AS models,(SELECT count(*) FROM ai_prompt_templates) AS templates,(SELECT count(*) FROM ai_providers WHERE credential_ref IS NOT NULL) AS keys_present,(SELECT count(*) FROM channel_image_presets) AS image_presets,(SELECT count(*) FROM source_articles) AS originals,(SELECT count(*) FROM drafts) AS drafts,(SELECT count(*) FROM harvest_jobs) AS jobs").fetch_one(&pool).await?;
    println!(
        "{}",
        json!({"check":"local-inventory","providers":row.try_get::<i64,_>("providers")?,"models":row.try_get::<i64,_>("models")?,"templates":row.try_get::<i64,_>("templates")?,"keysPresent":row.try_get::<i64,_>("keys_present")?,"imagePresets":row.try_get::<i64,_>("image_presets")?,"originals":row.try_get::<i64,_>("originals")?,"drafts":row.try_get::<i64,_>("drafts")?,"jobs":row.try_get::<i64,_>("jobs")?})
    );
    pool.close().await;
    Ok(())
}
/// 不接受任意云端地址或凭据参数，认证仅使用现有原生 CMS 会话。
pub async fn run(action: &str) -> std::result::Result<(), &'static str> {
    let path = db_path()?;
    let result: SyncResult<()> = async {
        if action == "repair-protocol" {
            if std::env::var_os("PRESSDOCK_SETTINGS_SYNC_DB").is_none() {
                return Err(SyncError::new("EXPLICIT_DATABASE_REQUIRED", false));
            }
            return protocol_repair::run(&path).await;
        }
        if action == "inspect" {
            return inspect(&path).await;
        }
        if matches!(
            action,
            "verify-fresh" | "verify-development" | "verify-download"
        ) {
            let cms = CmsService::new(path.parent().ok_or(SyncError::new("INVALID_PATH", false))?)
                .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
            cms.restore_session()
                .await
                .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
                .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
            let sync = if action == "verify-development" {
                SettingsSync::development()
            } else {
                SettingsSync::new()
            }
            .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
            return verify::run(
                sync,
                &cms,
                action == "verify-development",
                action == "verify-fresh",
            )
            .await;
        }
        if action != "initialize" {
            return Err(SyncError::new("UNKNOWN_ACTION", false));
        }
        backup(&path).await?;
        let db = Database::open(&path).await?;
        LocalStore::ensure_device(&db).await?;
        let cms = CmsService::new(path.parent().ok_or(SyncError::new("INVALID_PATH", false))?)
            .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
        cms.restore_session()
            .await
            .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
            .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
        let (_, token) = cms
            .settings_authorization()
            .await
            .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
        let sync = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
        initialize(&db, &sync, &token).await?;
        db.pool.close().await;
        Ok(())
    }
    .await;
    result.map_err(|e| {
        eprintln!(
            "{}",
            json!({"check":"settings-sync-admin","code":e.code,"retryable":e.retryable})
        );
        "全局配置工具执行失败，参见脱敏错误码"
    })
}
