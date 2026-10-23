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
