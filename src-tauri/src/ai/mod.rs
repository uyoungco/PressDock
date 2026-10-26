mod client;
mod credentials;
pub mod models;
mod titles;

pub use client::AiService;
pub use models::*;

pub struct AiError {
    pub code: &'static str,
    pub message: String,
    pub(crate) diagnostic: Option<crate::error::Diagnostic>,
}

impl AiError {
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
        Self::new("AI_VALIDATION", message)
    }
}

// 不打印服务端正文、请求体、凭据库错误或带认证信息的请求地址。
impl std::fmt::Debug for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AiError").field("code", &self.code).finish()
    }
}

impl From<sqlx::Error> for AiError {
    fn from(error: sqlx::Error) -> Self {
        Self::new("AI_STORAGE", "AI 配置存储失败，请重试").diagnosed(
            crate::error::Diagnostic::error("ai.storage", &error, serde_json::json!({})),
        )
    }
}

#[cfg(test)]
mod tests;

pub(crate) use client::GenerationTask;
