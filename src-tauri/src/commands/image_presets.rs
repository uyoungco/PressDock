use crate::{
    cms::CmsService,
    database::{Database, image_presets::ChannelImagePresets},
    error::CommandError,
};
use tauri::State;

#[tauri::command]
pub async fn list_channel_image_presets(
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<Vec<ChannelImagePresets>, CommandError> {
    let generation = cms.authorize().await?;
    let result = database.list_channel_image_presets().await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}

#[tauri::command]
pub async fn save_channel_image_presets(
    request: ChannelImagePresets,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<ChannelImagePresets, CommandError> {
    let generation = cms.authorize().await?;
    let result = database.save_channel_image_presets(request).await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}
