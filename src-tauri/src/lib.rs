pub mod ai;
pub mod cms;
mod commands;
mod database;
mod error;
mod imaging;
mod system;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Arc::new(imaging::ImageJobs::default()))
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            let database = tauri::async_runtime::block_on(async {
                tokio::fs::create_dir_all(&directory).await?;
                database::Database::open(&directory.join("pressdock.db")).await
            })?;
            app.manage(database);
            app.manage(cms::CmsService::new(&directory)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::health_check,
            commands::list_articles,
            commands::get_article,
            commands::save_draft,
            commands::create_demo_article,
            commands::cms_login,
            commands::cms_restore_session,
            commands::cms_logout,
            commands::cms_list_promote_channels,
            commands::cms_list_promote_data,
            commands::cms_load_promote_image,
            commands::cms_get_promote_data,
            commands::cms_create_promote_data,
            commands::cms_update_promote_data,
            commands::cms_delete_promote_data,
            commands::cms_save_promote_order,
            commands::cms_upload_promote_image,
            commands::open_external_link,
            commands::image_inspect,
            commands::image_process,
            commands::image_cancel,
            commands::image_export,
            commands::list_channel_image_presets,
            commands::save_channel_image_presets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
