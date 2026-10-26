use super::HarvestError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    // 旧配置及旧任务无此字段时仍按正常采集执行，模式只在入队时固定。
    #[serde(default)]
    pub developer_mode: bool,
    pub auto_classify: bool,
    pub auto_tags: bool,
    pub auto_summary: bool,
    pub auto_organize: bool,
    pub auto_paginate: bool,
    pub model_config_id: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    // 设置沿用前端扁平字段；flatten 两侧不使用不受支持的 deny_unknown_fields 组合。
    #[serde(flatten)]
    pub options: Options,
    pub retention_days: Option<u32>,
}
impl Settings {
    pub fn validate(&self) -> Result<(), HarvestError> {
        if self
            .retention_days
            .is_some_and(|days| days == 0 || days > 36500)
        {
            return Err(HarvestError::invalid(
                "历史保留天数须为 1–36500，留空永久保留",
            ));
        }
        if self
            .options
            .model_config_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 100)
        {
            return Err(HarvestError::invalid("无效的模型配置"));
        }
        Ok(())
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Queued,
    Running,
    WaitingUser,
    WaitingLogin,
    Succeeded,
    DebugCompleted,
    Failed,
    Cancelled,
    Interrupted,
    SubmissionUnknown,
}
impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::WaitingUser => "waitingUser",
            Self::WaitingLogin => "waitingLogin",
            Self::Succeeded => "succeeded",
            Self::DebugCompleted => "debugCompleted",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
            Self::SubmissionUnknown => "submissionUnknown",
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Collecting,
    Formatting,
    Metadata,
    Organizing,
    Paginating,
    Submitting,
}
impl Stage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Collecting => "collecting",
            Self::Formatting => "formatting",
            Self::Metadata => "metadata",
            Self::Organizing => "organizing",
            Self::Paginating => "paginating",
            Self::Submitting => "submitting",
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub developer_mode: bool,
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub collection_date: String,
    pub status: Status,
    pub stage: Option<Stage>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub attempts: i64,
    pub created_at: String,
    pub updated_at: String,
    pub cms_article_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobList {
    pub jobs: Vec<Job>,
    pub maintenance_warning: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnqueueRequest {
    pub id: String,
    pub url: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Resume,
    Show,
    Cancel,
    Retry,
    ConfirmSubmitted,
    ConfirmNotSubmitted,
    Delete,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawArticle {
    pub title: String,
    pub writer: String,
    pub source_url: String,
    pub news_html: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormattedArticle {
    pub title: String,
    pub writer: String,
    pub source_url: String,
    pub news_text: String,
    pub title_pic: String,
    pub small_text: String,
    pub class_id: i64,
    pub tags: Vec<String>,
}
impl FormattedArticle {
    // tags 只在 CMS 边界编码为 JSON 字符串，内部保持数组以复用独立字段校验。
    pub fn payload(&self) -> serde_json::Value {
        serde_json::json!({"title":self.title,"writer":self.writer,"sourceUrl":self.source_url,
            "newsText":self.news_text,"titlePic":self.title_pic,"smallText":self.small_text,
            "classId":self.class_id,"tags":serde_json::to_string(&self.tags).expect("字符串数组可序列化")})
    }
}
pub(crate) struct StoredJob {
    pub job: Job,
    pub user_id: i64,
    pub options: Options,
    pub raw: Option<RawArticle>,
    pub formatted: Option<FormattedArticle>,
    pub prepared: Option<FormattedArticle>,
}

// 仅发送采集业务数据，不携带网络认证头或凭据；只投递给可信主窗口。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugEvent {
    pub user_id: i64,
    pub job_id: String,
    pub attempt: i64,
    pub timestamp: String,
    pub step: String,
    pub kind: &'static str,
    pub data: serde_json::Value,
    pub diagnostic: Option<crate::error::Diagnostic>,
}
