use serde::Serialize;
use serde_json::{Value, json};

// 诊断只供采集 Console 使用，CommandError 始终只序列化简短的 code/message。
#[derive(Clone, Serialize)]
pub(crate) struct Diagnostic {
    pub operation: String,
    pub causes: Vec<String>,
    pub context: Value,
}
impl Diagnostic {
    pub fn sanitized(mut self) -> Self {
        for cause in &mut self.causes {
            if let Value::String(text) = redact(json!(cause), &[]) {
                *cause = text;
            }
        }
        self.context = redact(self.context, &[]);
        self
    }
    pub fn error(operation: &str, error: &dyn std::error::Error, context: Value) -> Self {
        let mut causes = vec![error.to_string()];
        let mut source = error.source();
        while let Some(error) = source {
            causes.push(error.to_string());
            source = error.source();
        }
        Self {
            operation: operation.into(),
            causes,
            context,
        }
    }
}

// 上游可能回显凭据：既屏蔽敏感 JSON 字段，也替换本次请求实际使用的秘密值。
pub(crate) fn redact(value: Value, secrets: &[&str]) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| {
                    let normalized = key.to_ascii_lowercase().replace(['_', '-'], "");
                    let value = if matches!(
                        normalized.as_str(),
                        "password"
                            | "passwd"
                            | "token"
                            | "accesstoken"
                            | "refreshtoken"
                            | "apikey"
                            | "authorization"
                            | "proxyauthorization"
                            | "cookie"
                            | "setcookie"
                    ) {
                        json!("[REDACTED]")
                    } else {
                        redact(value, secrets)
                    };
                    (key, value)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|value| redact(value, secrets))
                .collect(),
        ),
        Value::String(mut text) => {
            for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
                text = text.replace(secret, "[REDACTED]");
            }
            // 非 JSON 错误页也可能回显 Authorization 或 token=...，不能直接原样输出。
            static BEARER: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            static FIELDS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            static HEADERS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            // Cookie 含多个分号分隔值，必须整行屏蔽，不能仅删除第一段。
            text = HEADERS.get_or_init(|| regex::Regex::new(r"(?im)(\b(?:set-cookie|cookie|proxy-authorization|authorization)\s*:\s*)[^\r\n<]*").expect("固定正则"))
                .replace_all(&text, "${1}[REDACTED]").into_owned();
            text = BEARER
                .get_or_init(|| {
                    regex::Regex::new(r#"(?i)Bearer\s+[^\s"'<>,;]+"#).expect("固定正则")
                })
                .replace_all(&text, "Bearer [REDACTED]")
                .into_owned();
            text = FIELDS.get_or_init(|| regex::Regex::new(r#"(?i)(\b(?:password|passwd|access[_-]?token|refresh[_-]?token|token|api[_-]?key|cookie|authorization)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s<>&,;}]+)"#).expect("固定正则"))
                .replace_all(&text, "${1}[REDACTED]").into_owned();
            Value::String(text)
        }
        value => value,
    }
}

pub(crate) fn response_context(
    status: u16,
    bytes: &[u8],
    secret: Option<&str>,
    truncated: bool,
) -> Value {
    let body =
        serde_json::from_slice(bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(bytes)));
    redact(
        json!({"httpStatus":status,"responseBody":body,"responseTruncated":truncated,"capturedBytes":bytes.len()}),
        &secret.into_iter().collect::<Vec<_>>(),
    )
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库操作失败：{0}")]
    Database(#[from] sqlx::Error),
    #[error("数据库迁移失败：{0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("演示数据无效：{0}")]
    Data(#[from] serde_json::Error),
    #[error("{0}")]
    Validation(String),
    #[error("文章不存在")]
    NotFound,
}

#[derive(Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl From<crate::ai::AiError> for CommandError {
    fn from(error: crate::ai::AiError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}

impl From<crate::imaging::ImageError> for CommandError {
    fn from(error: crate::imaging::ImageError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}

impl From<crate::cms::CmsError> for CommandError {
    fn from(error: crate::cms::CmsError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        let (code, message) = match &error {
            AppError::Validation(message) => ("VALIDATION", message.clone()),
            AppError::NotFound => ("NOT_FOUND", error.to_string()),
            _ => {
                eprintln!("PressDock: {error}");
                (
                    "STORAGE_ERROR",
                    "本地存储操作失败，请检查磁盘空间或稍后重试".to_string(),
                )
            }
        };
        Self { code, message }
    }
}

// 采集错误只回传面向用户的信息，不包含来源正文、CMS 令牌或模型密钥。
impl From<crate::harvest::HarvestError> for CommandError {
    fn from(error: crate::harvest::HarvestError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}
