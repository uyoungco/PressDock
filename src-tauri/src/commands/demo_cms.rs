//! 与正式 IPC 契约一致的演示处理器；所有数据操作委托给本机 DemoCms。
use crate::{cms::*, error::CommandError};
use tauri::State;

#[tauri::command]
pub async fn cms_login(
    request: LoginRequest,
    cms: State<'_, CmsService>,
    harvest: State<'_, crate::harvest::HarvestService>,
) -> Result<AuthSession, CommandError> {
    harvest.stop();
    Ok(cms.demo()?.login(request).await?)
}
#[tauri::command]
pub async fn cms_restore_session(
    cms: State<'_, CmsService>,
) -> Result<Option<AuthSession>, CommandError> {
    Ok(cms.demo()?.restore().await?)
}
#[tauri::command]
pub async fn cms_logout(
    cms: State<'_, CmsService>,
    harvest: State<'_, crate::harvest::HarvestService>,
    database: State<'_, crate::database::Database>,
    gate: State<'_, super::DraftGate>,
) -> Result<LogoutResult, CommandError> {
    let _guard = gate.0.lock().await;
    harvest.stop();
    let result = cms.demo()?.logout().await?;
    sqlx::query("DELETE FROM channel_edit_drafts")
        .execute(&database.pool)
        .await
        .map_err(|_| CmsError::new("DRAFT_STORAGE", "演示草稿清理失败"))?;
    Ok(result)
}
#[tauri::command]
pub async fn cms_list_promote_channels(
    cms: State<'_, CmsService>,
) -> Result<Vec<ChannelGroup>, CommandError> {
    Ok(cms.demo()?.channels().await?)
}
#[tauri::command]
pub async fn cms_list_promote_data(
    query: PromoteQuery,
    cms: State<'_, CmsService>,
) -> Result<PromotePage, CommandError> {
    Ok(cms.demo()?.list(query).await?)
}
#[tauri::command]
pub async fn cms_load_promote_image(
    url: String,
    cms: State<'_, CmsService>,
) -> Result<PromoteImage, CommandError> {
    Ok(cms.demo()?.image(url).await?)
}
#[tauri::command]
pub async fn cms_get_promote_data(
    id: i64,
    cms: State<'_, CmsService>,
) -> Result<PromoteRecord, CommandError> {
    Ok(cms.demo()?.get(id).await?)
}
#[tauri::command]
pub async fn cms_create_promote_data(
    input: PromoteInput,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.demo()?.create(input).await?)
}
#[tauri::command]
pub async fn cms_update_promote_data(
    record: PromoteRecord,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.demo()?.update(record).await?)
}
#[tauri::command]
pub async fn cms_delete_promote_data(
    id: i64,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.demo()?.remove(id).await?)
}
#[tauri::command]
pub async fn cms_save_promote_order(
    query: PromoteQuery,
    ids: Vec<i64>,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    Ok(cms.demo()?.order(query, ids).await?)
}
#[tauri::command]
pub async fn cms_upload_promote_image(
    file_name: String,
    mime_type: String,
    data_base64: String,
    cms: State<'_, CmsService>,
) -> Result<UploadedImage, CommandError> {
    Ok(cms
        .demo()?
        .upload(UploadImage {
            file_name,
            mime_type,
            data_base64,
        })
        .await?)
}

fn unsupported() -> CommandError {
    CmsError::new(
        "DEMO_ONLY",
        "演示版仅支持本机渠道素材和图片，不连接外部服务",
    )
    .into()
}

#[tauri::command]
pub async fn open_external_link(
    url: String,
    cms: State<'_, CmsService>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    let _ = (url, cms, app);
    Err(unsupported())
}
#[tauri::command]
pub async fn cms_list_articles(
    query: ArticleQuery,
    cms: State<'_, CmsService>,
) -> Result<CmsArticlePage, CommandError> {
    let _ = (query, cms);
    Err(unsupported())
}
#[tauri::command]
pub async fn cms_list_article_classes(
    cms: State<'_, CmsService>,
) -> Result<Vec<ArticleClass>, CommandError> {
    let _ = cms;
    Err(unsupported())
}
#[tauri::command]
pub async fn cms_get_article(
    id: i64,
    cms: State<'_, CmsService>,
) -> Result<CmsArticleDetail, CommandError> {
    let _ = (id, cms);
    Err(unsupported())
}
#[tauri::command]
pub async fn cms_update_article(
    request: ArticleUpdate,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    let _ = (request, cms);
    Err(unsupported())
}
#[tauri::command]
pub async fn cms_add_article_to_promote(
    request: ArticlePromoteInput,
    cms: State<'_, CmsService>,
) -> Result<MutationResult, CommandError> {
    let _ = (request, cms);
    Err(unsupported())
}
