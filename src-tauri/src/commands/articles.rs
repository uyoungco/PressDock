use crate::{
    cms::CmsService,
    database::{
        Database,
        models::{Article, SaveDraftRequest},
    },
    error::CommandError,
};
use tauri::State;

#[tauri::command]
pub async fn list_articles(
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<Vec<Article>, CommandError> {
    let generation = cms.authorize().await?;
    let articles = database.list_articles().await?;
    cms.ensure_generation(generation).await?;
    Ok(articles)
}
#[tauri::command]
pub async fn get_article(
    id: String,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<Article, CommandError> {
    let generation = cms.authorize().await?;
    let article = database.get_article(&id).await?;
    cms.ensure_generation(generation).await?;
    Ok(article)
}
#[tauri::command]
pub async fn save_draft(
    request: SaveDraftRequest,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<Article, CommandError> {
    let generation = cms.authorize().await?;
    let article = database.save_draft(request).await?;
    cms.ensure_generation(generation).await?;
    Ok(article)
}
#[tauri::command]
pub async fn create_demo_article(
    url: String,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<Article, CommandError> {
    let generation = cms.authorize().await?;
    let article = database.create_demo_article(&url).await?;
    cms.ensure_generation(generation).await?;
    Ok(article)
}
