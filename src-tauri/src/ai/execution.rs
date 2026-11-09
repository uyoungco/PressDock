//! 任务只固定非秘密配置和原生凭据引用，不把密钥复制到 SQLite 或普通 IPC。
use super::*;
use crate::database::Database;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExecutionSnapshot {
    pub model: AiModelConfig,
    pub provider: AiProviderConfig,
    pub credential_ref: Option<String>,
}
impl Database {
    pub(crate) async fn ai_execution_snapshot(
        &self,
        id: &str,
    ) -> Result<Option<ExecutionSnapshot>, AiError> {
        let settings = self.ai_settings().await?;
        let Some(model) = settings.models.into_iter().find(|m| m.id == id) else {
            return Ok(None);
        };
        let provider = settings
            .providers
            .into_iter()
            .find(|p| p.id == model.provider_id)
            .ok_or_else(|| AiError::invalid("模型提供商不存在"))?;
        let credential_ref = self.ai_credential_ref(&provider.id).await?;
        Ok(Some(ExecutionSnapshot {
            model,
            provider,
            credential_ref,
        }))
    }
}
