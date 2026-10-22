//! CMS 原生业务边界。当前没有真实服务地址或认证协议。
//! 后续实现通过 Rust 持有凭据、进行网络访问，并通过任务 ID / Channel 报告进度。

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmsConnection {
    pub adapter_id: String,
    pub display_name: String,
    pub credential_reference: String,
}
