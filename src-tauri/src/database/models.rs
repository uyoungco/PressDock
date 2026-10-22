use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceArticle {
    pub id: String,
    pub title: String,
    pub url: String,
    pub content: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Article {
    pub id: String,
    pub source: SourceArticle,
    pub title: String,
    pub content: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_demo: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveDraftRequest {
    pub id: String,
    pub title: String,
    pub content: String,
}

impl SaveDraftRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.is_empty() || self.id.len() > 100 {
            return Err(AppError::Validation("无效的文章 ID".into()));
        }
        if self.title.trim().is_empty() || self.title.chars().count() > 200 {
            return Err(AppError::Validation("标题须为 1–200 字".into()));
        }
        if self.content.len() > 4_000_000 {
            return Err(AppError::Validation("正文过长".into()));
        }
        Ok(())
    }
}
