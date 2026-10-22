use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub platform: &'static str,
}
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "PressDock",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}
