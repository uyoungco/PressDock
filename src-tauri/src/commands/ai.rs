use crate::{ai::*, cms::CmsService, database::Database, error::CommandError};
use tauri::State;

#[tauri::command]
pub async fn ai_load_settings(
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<AiSettings, CommandError> {
    let generation = cms.authorize().await?;
    let _lock = ai.operations.lock().await;
    let result = database.ai_settings().await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}

#[tauri::command]
pub async fn ai_save_provider(
    request: SaveProviderRequest,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<(), CommandError> {
    let generation = cms.authorize().await?;
    ai.save_provider(&database, request).await?;
    cms.ensure_generation(generation).await?;
    Ok(())
}

#[tauri::command]
pub async fn ai_save_model(
    request: AiModelConfig,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<(), CommandError> {
    let generation = cms.authorize().await?;
    let _lock = ai.operations.lock().await;
    cms.ensure_generation(generation).await?;
    database.ai_save_model(&request).await?;
    cms.ensure_generation(generation).await?;
    Ok(())
}

#[tauri::command]
pub async fn ai_save_template(
    request: PromptTemplate,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<(), CommandError> {
    let generation = cms.authorize().await?;
    let _lock = ai.operations.lock().await;
    cms.ensure_generation(generation).await?;
    database.ai_save_template(&request).await?;
    cms.ensure_generation(generation).await?;
    Ok(())
}

#[tauri::command]
pub async fn ai_delete_config(
    kind: String,
    id: String,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<(), CommandError> {
    let generation = cms.authorize().await?;
    ai.delete_config(&database, &kind, &id).await?;
    cms.ensure_generation(generation).await?;
    Ok(())
}

#[tauri::command]
pub async fn ai_list_models(
    job_id: String,
    provider_id: String,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<Vec<String>, CommandError> {
    let generation = cms.authorize().await?;
    let result = ai
        .run(&job_id, ai.list_models(&database, &provider_id))
        .await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}

#[tauri::command]
pub async fn ai_test_model(
    job_id: String,
    model_config_id: String,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<bool, CommandError> {
    let generation = cms.authorize().await?;
    ai.run(&job_id, async {
        let model = database
            .ai_settings()
            .await?
            .models
            .into_iter()
            .find(|m| m.id == model_config_id)
            .ok_or_else(|| AiError::invalid("请先保存模型配置"))?;
        ai.generate_text(
            &database,
            &model,
            "你是连接测试助手。",
            "请仅回复：连接正常",
        )
        .await?;
        Ok(())
    })
    .await?;
    cms.ensure_generation(generation).await?;
    Ok(true)
}

#[tauri::command]
pub async fn ai_suggest_titles(
    request: TitleSuggestionRequest,
    database: State<'_, Database>,
    ai: State<'_, AiService>,
    cms: State<'_, CmsService>,
) -> Result<TitleSuggestionResult, CommandError> {
    let generation = cms.authorize().await?;
    let id = request.job_id.clone();
    let result = ai.run(&id, ai.suggest_titles(&database, request)).await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}

#[tauri::command]
pub fn ai_cancel(job_id: String, ai: State<'_, AiService>) {
    ai.cancel(&job_id);
}
