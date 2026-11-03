#[cfg(target_os = "android")]
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
#[cfg(target_os = "android")]
static ANDROID: std::sync::OnceLock<PluginHandle<tauri::Wry>> = std::sync::OnceLock::new();

// Kotlin 在插件注册时调用，早于 CMS 会话恢复及任何 HTTPS 请求。
#[cfg(target_os = "android")]
#[jni::jni_mangle("com.example.pressdock.PlatformPlugin")]
pub fn initializeTls<'caller>(
    mut env: jni::EnvUnowned<'caller>,
    _this: jni::objects::JObject<'caller>,
    context: jni::objects::JObject<'caller>,
) {
    use jni::errors::ThrowRuntimeExAndDefault;
    env.with_env(|env| rustls_platform_verifier::android::init_with_env(env, context))
        .resolve::<ThrowRuntimeExAndDefault>();
}

#[cfg(target_os = "android")]
pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("pressdock-platform")
        .setup(|_, api| {
            let handle = api.register_android_plugin("com.example.pressdock", "PlatformPlugin")?;
            let _ = ANDROID.set(handle);
            Ok(())
        })
        .build()
}

// 此插件不开放前端命令权限，秘密仅在 Rust 与原生平台之间传递。
#[cfg(target_os = "android")]
pub fn call<T: serde::de::DeserializeOwned>(
    command: &str,
    payload: serde_json::Value,
) -> Result<T, ()> {
    ANDROID
        .get()
        .ok_or(())?
        .run_mobile_plugin(command, payload)
        .map_err(|_| ())
}
