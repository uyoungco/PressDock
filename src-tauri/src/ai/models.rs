use super::AiError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    ChatCompletions,
    Responses,
}

impl Protocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ChatCompletions => "chatCompletions",
            Self::Responses => "responses",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Compatibility {
    pub max_tokens_field: String,
    pub system_role: String,
    pub send_store: bool,
}

impl Default for Compatibility {
    fn default() -> Self {
        Self {
            max_tokens_field: "max_completion_tokens".into(),
            system_role: "system".into(),
            send_store: true,
        }
    }
}

impl Compatibility {
    pub fn validate(&self) -> Result<(), AiError> {
        if !["max_completion_tokens", "max_tokens"].contains(&self.max_tokens_field.as_str())
            || !["system", "developer"].contains(&self.system_role.as_str())
        {
            return Err(AiError::invalid("无效的网关兼容配置"));
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderConfig {
    pub id: String,
    pub display_name: String,
    pub base_url: String,
    pub protocol: Protocol,
    pub has_api_key: bool,
    pub compatibility: Compatibility,
}

// 刻意不派生 Debug；密钥只在保存请求中跨 IPC，绝不回传。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProviderRequest {
    pub id: String,
    pub display_name: String,
    pub base_url: String,
    pub protocol: Protocol,
    pub api_key: Option<String>,
    #[serde(default)]
    pub compatibility: Compatibility,
    #[serde(default)]
    pub create_only: bool,
}

impl SaveProviderRequest {
    pub fn validate(&self) -> Result<(), AiError> {
        self.compatibility.validate()?;
        let bytes = self.id.as_bytes();
        if bytes.is_empty()
            || bytes.len() > 64
            || !bytes[0].is_ascii_lowercase()
            || !bytes
                .iter()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        {
            return Err(AiError::invalid(
                "提供商标识须以小写字母开头，只能包含小写字母、数字和连字符，最多 64 字符",
            ));
        }
        text(&self.display_name, 100, "提供商名称")?;
        if self.base_url.len() > 2048 {
            return Err(AiError::invalid("API 地址过长"));
        }
        let url = url::Url::parse(&self.base_url)
            .map_err(|_| AiError::invalid("请输入完整 API 基础地址"))?;
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if (url.scheme() != "https" && !(url.scheme() == "http" && local))
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(AiError::invalid(
                "API 地址须为 HTTPS（本机允许 HTTP），不能包含认证信息、查询参数或片段",
            ));
        }
        if self.api_key.as_ref().is_some_and(|v| {
            v.trim().is_empty() || v.len() > 8192 || v.chars().any(char::is_control)
        }) {
            return Err(AiError::invalid(
                "API 密钥不能为空、包含控制字符或超过 8192 字节",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiModelConfig {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub reasoning_effort: Option<String>,
}

impl AiModelConfig {
    pub fn validate(&self) -> Result<(), AiError> {
        text(&self.id, 100, "模型配置 ID")?;
        text(&self.provider_id, 64, "提供商标识")?;
        text(&self.model_id, 200, "模型 ID")?;
        text(&self.display_name, 100, "模型显示名称")?;
        if self.context_window == Some(0)
            || self.max_output_tokens == Some(0)
            || self
                .context_window
                .zip(self.max_output_tokens)
                .is_some_and(|(c, o)| o > c)
        {
            return Err(AiError::invalid(
                "token 上限须为正整数，输出上限不能超过上下文窗口",
            ));
        }
        if self
            .reasoning_effort
            .as_ref()
            .is_some_and(|v| !["low", "medium", "high"].contains(&v.as_str()))
        {
            return Err(AiError::invalid("无效的推理强度"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub model_config_id: Option<String>,
    pub candidate_count: u8,
    pub max_length: u16,
    pub is_default: bool,
}

impl PromptTemplate {
    pub fn validate(&self) -> Result<(), AiError> {
        text(&self.id, 100, "模板 ID")?;
        text(&self.name, 100, "模板名称")?;
        text(&self.user_prompt, 20_000, "用户提示词")?;
        if self.system_prompt.chars().count() > 20_000 {
            return Err(AiError::invalid("系统指令最多 20000 字符"));
        }
        rules(self.candidate_count, self.max_length)?;
        super::titles::validate_variables(&self.system_prompt)?;
        super::titles::validate_variables(&self.user_prompt)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub providers: Vec<AiProviderConfig>,
    pub models: Vec<AiModelConfig>,
    pub templates: Vec<PromptTemplate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleSuggestionRequest {
    pub job_id: String,
    pub template_id: String,
    pub title: String,
    pub content: String,
    pub model_config_id: Option<String>,
    pub candidate_count: Option<u8>,
    pub max_length: Option<u16>,
    pub requirements: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleSuggestionResult {
    pub job_id: String,
    pub template_id: String,
    pub model_config_id: String,
    pub candidates: Vec<String>,
    pub requested_count: u8,
}

pub fn text(value: &str, max: usize, name: &str) -> Result<(), AiError> {
    if value.trim().is_empty() || value.chars().count() > max {
        return Err(AiError::invalid(format!("{name}须为 1–{max} 字符")));
    }
    Ok(())
}

pub fn rules(count: u8, max_length: u16) -> Result<(), AiError> {
    if !(1..=10).contains(&count) || !(1..=200).contains(&max_length) {
        return Err(AiError::invalid("候选数量须为 1–10，最大字数须为 1–200"));
    }
    Ok(())
}
