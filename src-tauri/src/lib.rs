pub mod ai;
pub mod cms;
mod commands;
mod database;
mod error;
mod system;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            let database = tauri::async_runtime::block_on(async {
                tokio::fs::create_dir_all(&directory).await?;
                database::Database::open(&directory.join("pressdock.db")).await
            })?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::health_check,
            commands::list_articles,
            commands::get_article,
            commands::save_draft,
            commands::create_demo_article
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
