use crate::{
    database::Database,
    error::CommandError,
    system::{self, AppInfo},
};
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    system::app_info()
}

#[derive(Serialize)]
pub struct HealthStatus {
    ready: bool,
    database: &'static str,
}

#[tauri::command]
pub async fn health_check(database: State<'_, Database>) -> Result<HealthStatus, CommandError> {
    Ok(HealthStatus {
        ready: database.health().await?,
        database: "ready",
    })
}
