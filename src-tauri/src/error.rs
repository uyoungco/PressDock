use serde::Serialize;

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
