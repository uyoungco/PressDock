pub mod ai;
pub mod cms;
mod commands;
mod database;
mod error;
mod harvest;
mod imaging;
mod system;
mod window_policy;
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
            // 先恢复不确定状态再按设置清理，禁止启动后重发上次未记账的 CMS 写入。
            tauri::async_runtime::block_on(database.harvest_recover())?;
            let cleanup_warning = tauri::async_runtime::block_on(database.harvest_cleanup())
                .err()
                .map(|error| error.message);
            let developer_mode = tauri::async_runtime::block_on(database.harvest_settings())?
                .options
                .developer_mode;
            app.manage(window_policy::WindowPolicy(
                std::sync::atomic::AtomicBool::new(developer_mode),
            ));
            app.manage(database);
            app.manage(ai::AiService::new()?);
            app.manage(cms::CmsService::new(&directory)?);
            app.manage(harvest::HarvestService::new(cleanup_warning));
            // 手动沿用 main 配置创建窗口，以便在任何页面脚本之前安装全局右键规则。
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .expect("主窗口配置");
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .initialization_script_for_all_frames(window_policy::script(developer_mode))
                .on_page_load(|window, _| window_policy::apply(&window))
                .build()?;
            harvest::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::harvest_set_developer_mode,
            commands::harvest_open_devtools,
            commands::harvest_load_settings,
            commands::harvest_save_settings,
            commands::harvest_list_jobs,
            commands::harvest_enqueue,
            commands::harvest_job_action,
            commands::ai_load_settings,
            commands::ai_save_provider,
            commands::ai_save_model,
            commands::ai_save_template,
            commands::ai_delete_config,
            commands::ai_list_models,
            commands::ai_test_model,
            commands::ai_suggest_titles,
            commands::ai_cancel,
            commands::get_app_info,
            commands::health_check,
            commands::list_articles,
            commands::create_demo_article,
            commands::cms_list_articles,
            commands::cms_list_article_classes,
            commands::cms_get_article,
            commands::cms_update_article,
            commands::cms_add_article_to_promote,
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
