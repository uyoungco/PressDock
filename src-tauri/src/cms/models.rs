use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmsUser {
    pub user_id: i64,
    pub nickname: String,
    #[serde(default, rename(deserialize = "role", serialize = "roles"))]
    pub roles: Vec<String>,
    #[serde(default)]
    pub perms: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub user: CmsUser,
    pub persistent: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Credential {
    pub access_token: String,
    pub token_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoutResult {
    pub remote_succeeded: bool,
    pub credentials_cleared: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteImage {
    pub mime_type: String,
    pub byte_size: usize,
    pub data_base64: String,
}

#[derive(Serialize)]
pub struct ChannelGroup {
    pub channel: String,
    pub subchannels: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct ChannelRecord {
    #[serde(rename = "Channel")]
    pub channel: Option<String>,
    #[serde(rename = "SubChannel")]
    pub subchannel: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteRecord {
    #[serde(alias = "Id")]
    pub id: i64,
    #[serde(alias = "ArticleId")]
    pub article_id: Option<i64>,
    #[serde(alias = "Channel")]
    pub channel: Option<String>,
    #[serde(alias = "SubChannel")]
    pub sub_channel: Option<String>,
    #[serde(alias = "Title")]
    pub title: Option<String>,
    #[serde(alias = "SmallText")]
    pub small_text: Option<String>,
    #[serde(alias = "Writer")]
    pub writer: Option<String>,
    #[serde(alias = "TitlePic")]
    pub title_pic: Option<String>,
    #[serde(alias = "TitlePic2")]
    pub title_pic2: Option<String>,
    #[serde(alias = "Host")]
    pub host: Option<String>,
    #[serde(alias = "Url")]
    pub url: Option<String>,
    #[serde(alias = "LandUrl")]
    pub land_url: Option<String>,
    #[serde(alias = "PublishDate")]
    pub publish_date: Option<String>,
    #[serde(alias = "Order")]
    pub order: Option<i64>,
    #[serde(alias = "CreatedAt")]
    pub created_at: Option<String>,
    #[serde(alias = "UpdatedAt")]
    pub updated_at: Option<String>,
    #[serde(alias = "DeletedAt")]
    pub deleted_at: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteInput {
    pub channel: String,
    pub sub_channel: Option<String>,
    pub publish_date: Option<String>,
    pub url: Option<String>,
    pub title: String,
    pub title_pic: String,
    pub title_pic2: Option<String>,
    pub small_text: Option<String>,
    pub writer: Option<String>,
}

#[derive(Serialize)]
pub struct MutationResult {
    pub succeeded: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadImage {
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Serialize)]
pub struct UploadedImage {
    pub url: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PromoteQuery {
    pub channel: String,
    pub subchannel: String,
    pub publishdate: String,
    pub current: u32,
    pub pagesize: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotePage {
    pub data: Vec<PromoteRecord>,
    pub total: u64,
    pub page_size: u32,
    pub current: u32,
}

#[derive(Deserialize)]
pub(super) struct ChannelPage {
    pub data: Vec<ChannelRecord>,
    pub total: u64,
}

// 页面类别只在原生边界映射为审核状态，IPC 不接受任意审核动作。
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum ArticleView {
    #[serde(rename = "quality")]
    Quality,
    #[serde(rename = "review-1")]
    First,
    #[serde(rename = "review-2")]
    Second,
    #[serde(rename = "review-3")]
    Third,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArticleQuery {
    pub view: ArticleView,
    pub id: Option<i64>,
    pub classid: Option<i64>,
    pub title: String,
    pub start: String,
    pub end: String,
    pub author: String,
    pub editor: bool,
    pub nubia: bool,
    pub current: u32,
    pub pagesize: u32,
}

fn article_tags<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    use serde::de::Error;
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(Vec::new()),
        serde_json::Value::String(text) if text.is_empty() => Ok(Vec::new()),
        serde_json::Value::String(text) => serde_json::from_str(&text).map_err(D::Error::custom),
        value => serde_json::from_value(value).map_err(D::Error::custom),
    }
}

fn article_news_time<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    use serde::de::Error;
    // 列表返回日期字符串，详情返回秒级整数；仅在该字段统一为 IPC 的可空字符串。
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(value) => Ok(Some(value)),
        serde_json::Value::Number(value) if value.is_i64() || value.is_u64() => {
            Ok(Some(value.to_string()))
        }
        _ => Err(D::Error::custom("NewsTime 必须是字符串、整数或 null")),
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmsArticleRow {
    // 列表原始行用于文章转素材，保留当前 UI 未展示的后台字段。
    #[serde(default)]
    pub snapshot: serde_json::Map<String, serde_json::Value>,
    #[serde(alias = "Id")]
    pub id: i64,
    #[serde(alias = "ClassId")]
    pub class_id: i64,
    #[serde(alias = "ClassName")]
    pub class_name: Option<String>,
    #[serde(alias = "Title")]
    pub title: Option<String>,
    #[serde(alias = "TitlePic")]
    pub title_pic: Option<String>,
    #[serde(alias = "TitlePic2")]
    pub title_pic2: Option<String>,
    #[serde(alias = "TitlePic3")]
    pub title_pic3: Option<String>,
    #[serde(alias = "Writer")]
    pub writer: Option<String>,
    #[serde(alias = "SmallText")]
    pub small_text: Option<String>,
    #[serde(alias = "SourceUrl")]
    pub source_url: Option<String>,
    #[serde(default, alias = "NewsTime", deserialize_with = "article_news_time")]
    pub news_time: Option<String>,
    #[serde(alias = "Pages")]
    pub pages: Option<u32>,
    #[serde(default, alias = "Tags", deserialize_with = "article_tags")]
    pub tags: Vec<String>,
    #[serde(default, alias = "NTags", deserialize_with = "article_tags")]
    pub n_tags: Vec<String>,
    #[serde(default)]
    pub comment_recommand: String,
    #[serde(default)]
    pub comment_promote: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmsArticlePage {
    pub data: Vec<CmsArticleRow>,
    pub total: u64,
    pub current: u32,
    pub page_size: u32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmsArticleDetail {
    #[serde(flatten)]
    pub row: CmsArticleRow,
    #[serde(alias = "NewsText")]
    pub news_text: String,
    #[serde(alias = "Status")]
    pub status: i32,
    #[serde(alias = "UpdatedAt")]
    pub updated_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct ArticleClass {
    #[serde(alias = "Id")]
    pub id: i64,
    #[serde(alias = "Name")]
    pub name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArticleUpdate {
    pub id: i64,
    pub title: String,
    pub class_id: i64,
    pub class_name: String,
    pub title_pic: String,
    pub title_pic2: String,
    pub title_pic3: String,
    pub tags: Vec<String>,
    pub small_text: String,
    pub writer: String,
    pub source_url: String,
    pub news_text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArticlePromoteInput {
    pub article: CmsArticleRow,
    pub input: PromoteInput,
}
