fn main() {
    println!("cargo:rerun-if-changed=migrations");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_app_info",
            "health_check",
            "list_articles",
            "get_article",
            "save_draft",
            "create_demo_article",
        ]),
    ))
    .expect("failed to build Tauri application metadata");
}
