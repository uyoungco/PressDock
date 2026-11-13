//! 显式维护入口：调用前退出目标客户端，路径必须由操作者明确指定。
use super::*;

pub(super) async fn run(path: &Path) -> SyncResult<()> {
    let read = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
        .await?;
    let version: i64 =
        sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations WHERE success=1")
            .fetch_one(&read)
            .await?;
    if version < 14 {
        return Err(SyncError::new("CLIENT_UPGRADE_REQUIRED", false));
    }
    let runnable: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM harvest_jobs WHERE status IN ('queued','running','waitingUser','waitingLogin')").fetch_one(&read).await?;
    let legacy: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE schema_version<>2")
            .fetch_one(&read)
            .await?;
    if runnable != 0 || legacy != 0 {
        return Err(SyncError::new("REPAIR_NOT_AVAILABLE", false));
    }
    read.close().await;
    backup(path).await?;
    let db = Database::open(path).await?;
    let cms = CmsService::new(path.parent().ok_or(SyncError::new("INVALID_PATH", false))?)
        .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    cms.restore_session()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
        .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
    let ai = crate::ai::AiService::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let sync = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox")
        .fetch_one(&db.pool)
        .await?;
    sync.start(&db, &ai, &cms, false).await?;
    let result = sync.manual(&db, &ai, &cms).await?;
    if !result.ready
        || result.pending != 0
        || result.last_error.is_some()
        || result.successful_reads == 0
    {
        eprintln!(
            "{}",
            json!({"check":"protocol-repair-paused","phase":result.phase,"code":result.last_error,"pending":result.pending})
        );
        return Err(SyncError::new("REPAIR_INCOMPLETE", false));
    }
    let (_, token) = cms
        .settings_authorization()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
    let raw = sync.request(&token, "bootstrap", None).await?;
    validate_document(&raw, DocumentKind::Bootstrap, None, &[])?;
    let remote: Bootstrap = serde_json::from_slice(&raw)?;
    if serde_json::to_value(local::export(&db).await?)?
        != serde_json::to_value(remote.snapshot.config)?
    {
        return Err(SyncError::new("REPAIR_READBACK_MISMATCH", false));
    }
    println!(
        "{}",
        json!({"check":"native-protocol-repair","passed":true,"pendingBefore":pending,"pending":0,"schemaVersion":2,"revision":remote.snapshot.revision,"cloudReadbackMatches":true,"aiRequests":0,"cmsWrites":0})
    );
    db.pool.close().await;
    Ok(())
}
