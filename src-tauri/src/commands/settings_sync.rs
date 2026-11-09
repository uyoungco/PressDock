use crate::{
    ai::AiService,
    cms::CmsService,
    database::Database,
    error::CommandError,
    settings_sync::runtime::{SettingsSync, SyncStatus},
};
use tauri::State;
#[tauri::command]
pub async fn settings_sync_start(
    retry: bool,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
    sync: State<'_, SettingsSync>,
) -> Result<SyncStatus, CommandError> {
    cms.authorize().await?;
    #[cfg(feature = "android-demo")]
    {
        let _ = (retry, ai);
        let mut status = sync.status(&database).await?;
        status.ready = true;
        status.phase = "demo";
        return Ok(status);
    }
    #[cfg(not(feature = "android-demo"))]
    Ok(sync.start(&database, &ai, &cms, retry).await?)
}
#[tauri::command]
pub async fn settings_sync_resolve(
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
    sync: State<'_, SettingsSync>,
) -> Result<SyncStatus, CommandError> {
    cms.authorize().await?;
    Ok(sync.resolve_rejected(&database, &ai, &cms).await?)
}
#[tauri::command]
pub async fn settings_sync_status(
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
    sync: State<'_, SettingsSync>,
) -> Result<SyncStatus, CommandError> {
    cms.authorize().await?;
    Ok(sync.status(&database).await?)
}
#[tauri::command]
pub async fn settings_sync_wake(
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
    sync: State<'_, SettingsSync>,
) -> Result<(), CommandError> {
    cms.authorize().await?;
    sqlx::query("UPDATE sync_outbox SET retry_at=NULL WHERE status='queued'")
        .execute(&database.pool)
        .await
        .map_err(crate::settings_sync::local::SyncError::from)?;
    sync.wake.notify_one();
    Ok(())
}
