fn main() {
    println!("cargo:rerun-if-changed=migrations");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "harvest_set_developer_mode",
                "harvest_open_devtools",
                "harvest_load_settings",
                "harvest_save_settings",
                "harvest_list_jobs",
                "harvest_enqueue",
                "harvest_bridge_status",
                "harvest_install_userscript",
                "harvest_job_action",
                "harvest_select_source_tab",
                "ai_load_settings",
                "ai_save_provider",
                "ai_save_model",
                "ai_save_template",
                "ai_delete_config",
                "ai_list_models",
                "ai_test_model",
                "ai_suggest_titles",
                "ai_suggest_pagination",
                "ai_cancel",
                "get_app_info",
                "health_check",
                "list_articles",
                "create_demo_article",
                "cms_list_articles",
                "cms_list_article_classes",
                "cms_get_article",
                "cms_update_article",
                "cms_add_article_to_promote",
                "cms_login",
                "cms_restore_session",
                "cms_logout",
                "cms_list_promote_channels",
                "cms_list_promote_data",
                "cms_load_promote_image",
                "cms_get_promote_data",
                "cms_create_promote_data",
                "cms_update_promote_data",
                "cms_delete_promote_data",
                "cms_save_promote_order",
                "cms_upload_promote_image",
                "open_external_link",
                "image_inspect",
                "image_process",
                "image_cancel",
                "image_export",
                "list_channel_image_presets",
                "save_channel_image_presets",
            ])),
    )
    .expect("failed to build Tauri application metadata");
    // 使用链接器嵌入清单，让应用及 Webview IPC 测试宿主都加载 Common Controls v6。
    // 不再通过仅链接 binary 的资源文件嵌入，避免测试缺少 TaskDialogIndirect 入口。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
}
