mod content;
mod layout;
mod models;
mod store;
mod webview;
pub(crate) mod worker;
pub use models::*;
pub use worker::{HarvestService, start};

pub struct HarvestError {
    pub code: &'static str,
    pub message: String,
    pub(crate) diagnostic: Option<crate::error::Diagnostic>,
}
impl HarvestError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            diagnostic: None,
        }
    }
    // 详细原因跨服务传递，只有开发者任务的事件出口会读取它。
    pub(crate) fn diagnosed(mut self, diagnostic: crate::error::Diagnostic) -> Self {
        self.diagnostic = Some(diagnostic);
        self
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("VALIDATION", message)
    }
}
impl std::fmt::Debug for HarvestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HarvestError")
            .field("code", &self.code)
            .finish()
    }
}
impl std::fmt::Display for HarvestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for HarvestError {}
impl From<sqlx::Error> for HarvestError {
    fn from(error: sqlx::Error) -> Self {
        Self::new("HARVEST_STORAGE", "采集记录保存失败，请检查磁盘空间或重试").diagnosed(
            crate::error::Diagnostic::error("storage", &error, serde_json::json!({})),
        )
    }
}
impl From<serde_json::Error> for HarvestError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("HARVEST_DATA", "采集数据格式无效").diagnosed(crate::error::Diagnostic::error(
            "json.parse",
            &error,
            serde_json::json!({"line":error.line(),"column":error.column()}),
        ))
    }
}
impl From<crate::cms::CmsError> for HarvestError {
    fn from(error: crate::cms::CmsError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            diagnostic: error.diagnostic,
        }
    }
}
impl From<crate::ai::AiError> for HarvestError {
    fn from(error: crate::ai::AiError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            diagnostic: error.diagnostic,
        }
    }
}
impl From<tauri::Error> for HarvestError {
    fn from(error: tauri::Error) -> Self {
        Self::new("HARVEST_WEBVIEW", "无法操作采集窗口，请重试或重新打开应用").diagnosed(
            crate::error::Diagnostic::error("webview", &error, serde_json::json!({})),
        )
    }
}

pub(crate) fn source_url(input: &str) -> Result<url::Url, HarvestError> {
    let mut url = url::Url::parse(input).map_err(|error| {
        HarvestError::invalid("请输入有效的 HTTP / HTTPS 文章链接").diagnosed(
            crate::error::Diagnostic::error(
                "source.url.parse",
                &error,
                serde_json::json!({"inputLength":input.len()}),
            ),
        )
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || !matches!(
            url.host_str(),
            Some("baijiahao.baidu.com" | "mbd.baidu.com")
        )
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || input.len() > 4096
    {
        return Err(HarvestError::invalid(
            "当前支持百家号和 mbd.baidu.com 的 HTTP / HTTPS 链接",
        ));
    }
    url.set_fragment(None);
    Ok(url)
}
