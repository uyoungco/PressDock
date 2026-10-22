use crate::{
    database::{
        Database,
        models::{Article, SaveDraftRequest},
    },
    error::CommandError,
};
use tauri::State;

#[tauri::command]
pub async fn list_articles(database: State<'_, Database>) -> Result<Vec<Article>, CommandError> {
    Ok(database.list_articles().await?)
}
#[tauri::command]
pub async fn get_article(
    id: String,
    database: State<'_, Database>,
) -> Result<Article, CommandError> {
    Ok(database.get_article(&id).await?)
}
#[tauri::command]
pub async fn save_draft(
    request: SaveDraftRequest,
    database: State<'_, Database>,
) -> Result<Article, CommandError> {
    Ok(database.save_draft(request).await?)
}
#[tauri::command]
pub async fn create_demo_article(
    url: String,
    database: State<'_, Database>,
) -> Result<Article, CommandError> {
    Ok(database.create_demo_article(&url).await?)
}
