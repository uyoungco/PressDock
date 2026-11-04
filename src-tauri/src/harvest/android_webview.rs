use super::source::{SNAPSHOT, Snapshot};
use super::*;
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::AppHandle;

pub(super) struct Source {
    id: String,
}

#[derive(Deserialize)]
struct Opened {
    id: String,
}

// 原生 WebView 不安装 Tauri bridge；仅 Rust 可以请求静态快照脚本。
async fn call<T: serde::de::DeserializeOwned + Send + 'static>(
    command: &'static str,
    payload: Value,
) -> Result<T, HarvestError> {
    tokio::time::timeout(
        std::time::Duration::from_secs(6),
        tokio::task::spawn_blocking(move || crate::platform::call(command, payload)),
    )
    .await
    .map_err(|_| HarvestError::new("HARVEST_WEBVIEW_TIMEOUT", "读取来源页面暂时超时"))?
    .map_err(|_| HarvestError::new("HARVEST_WEBVIEW", "来源页面操作失败"))?
    .map_err(|_| HarvestError::new("HARVEST_WEBVIEW_CLOSED", "来源页面不可用，请返回前台后重试"))
}

pub(super) async fn open(
    _app: &AppHandle,
    _context: &worker::Context,
) -> Result<Source, HarvestError> {
    let opened: Opened = call("harvestOpen", json!({})).await?;
    Ok(Source { id: opened.id })
}

pub(super) async fn navigate(source: &Source, url: &url::Url) -> Result<String, HarvestError> {
    let token = uuid::Uuid::new_v4().to_string();
    let _: Value = call(
        "harvestNavigate",
        json!({"id":source.id,"url":url.as_str(),"token":token}),
    )
    .await?;
    Ok(token)
}

pub(super) async fn snapshot(source: &Source) -> Result<Snapshot, HarvestError> {
    let value: Value = call("harvestSnapshot", json!({"id":source.id,"script":SNAPSHOT})).await?;
    let text = value
        .get("snapshot")
        .and_then(Value::as_str)
        .ok_or_else(|| HarvestError::new("HARVEST_WEBVIEW_DATA", "来源页面快照无效"))?;
    if text.len() > 10 * 1024 * 1024 {
        return Err(HarvestError::new(
            "HARVEST_PAGE_LIMIT",
            "来源页面超过 10 MiB 读取限制",
        ));
    }
    serde_json::from_str(text).map_err(Into::into)
}

pub(super) fn ensure_open(_app: &AppHandle, _source: &Source) -> Result<(), HarvestError> {
    if crate::platform::is_foreground() {
        Ok(())
    } else {
        Err(HarvestError::new(
            "HARVEST_BACKGROUND",
            "应用已退到后台，请返回后重试",
        ))
    }
}

pub(super) fn show(_app: &AppHandle) -> Result<(), HarvestError> {
    crate::platform::call::<Value>("harvestShow", json!({}))
        .map(|_| ())
        .map_err(|_| HarvestError::new("HARVEST_WEBVIEW_CLOSED", "来源页面已关闭，请重试"))
}

pub(super) fn release(_app: &AppHandle) {
    close();
}

pub(super) fn close() {
    // 原生操作派发到 UI 线程；先销毁旧会话，迟到的快照不能访问下一任务。
    let _ = crate::platform::call::<Value>("harvestClose", json!({}));
}

pub(super) fn hide(_source: &Source) {
    let _ = crate::platform::call::<Value>("harvestHide", json!({}));
}
