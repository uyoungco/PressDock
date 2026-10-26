use crate::{
    cms::{
        AuthSession, ChannelGroup, CmsError, CmsService, LoginRequest, LogoutResult,
        MutationResult, PromoteImage, PromoteInput, PromotePage, PromoteQuery, PromoteRecord,
        UploadImage, UploadedImage,
    },
    error::CommandError,
};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn cms_login(
    request: LoginRequest,
    cms: State<'_, CmsService>,
    harvest: State<'_, crate::harvest::HarvestService>,
) -> Result<AuthSession, CommandError> {
    // 认证切换立即停止旧任务；新会话仅唤醒所属账号的持久队列。
    harvest.stop();
    let session = cms.login(request).await?;
    harvest.wake.notify_one();
    Ok(session)
}
#[tauri::command]
pub async fn cms_restore_session(
    cms: State<'_, CmsService>,
) -> Result<Option<AuthSession>, CommandError> {
    Ok(cms.restore_session().await?)
}
#[tauri::command]
pub async fn cms_logout(
    cms: State<'_, CmsService>,
    harvest: State<'_, crate::harvest::HarvestService>,
) -> Result<LogoutResult, CommandError> {
    harvest.stop();
    Ok(cms.logout().await)
}
#[tauri::command]
pub async fn cms_list_promote_channels(
    cms: State<'_, CmsService>,
) -> Result<Vec<ChannelGroup>, CommandError> {
    Ok(cms.list_channels().await?)
}
#[tauri::command]
pub async fn cms_list_promote_data(
    query: PromoteQuery,
    cms: State<'_, CmsService>,
) -> Result<PromotePage, CommandError> {
    Ok(cms.list_data(query).await?)
}

#[tauri::command]
pub async fn cms_load_promote_image(
    url: String,
    cms: State<'_, CmsService>,
) -> Result<PromoteImage, CommandError> {
    Ok(cms.load_image(url).await?)
}

#[tauri::command]
pub async fn cms_get_promote_data(
    id: i64,
    cms: State<'_, CmsService>,
) -> Result<PromoteRecord, CommandError> {
    Ok(cms.get_data(id).await?)
}
#[tauri::command]
pub async fn cms_create_promote_data(
    input: PromoteInput,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.create_data(input).await?)
}
#[tauri::command]
pub async fn cms_update_promote_data(
    record: PromoteRecord,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.update_data(record).await?)
}
#[tauri::command]
pub async fn cms_delete_promote_data(
    id: i64,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.delete_data(id).await?)
}
#[tauri::command]
pub async fn cms_save_promote_order(
    query: PromoteQuery,
    ids: Vec<i64>,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.save_order(query, ids).await?)
}
#[tauri::command]
pub async fn cms_upload_promote_image(
    file_name: String,
    mime_type: String,
    data_base64: String,
    cms: State<'_, CmsService>,
) -> Result<UploadedImage, CommandError> {
    Ok(cms
        .upload_image(UploadImage {
            file_name,
            mime_type,
            data_base64,
        })
        .await?)
}
#[tauri::command]
pub async fn open_external_link(
    url: String,
    cms: State<'_, CmsService>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    let generation = cms.authorize().await?;
    let url = CmsService::external_link(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| CmsError::new("OPEN_LINK", "无法打开系统浏览器，请复制链接后打开"))?;
    cms.ensure_generation(generation).await?;
    Ok(())
}
