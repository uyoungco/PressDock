//! AI 服务扩展边界。此阶段不发送请求，也不保存任何 API Key。

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub provider_id: String,
    pub credential_reference: String,
}
