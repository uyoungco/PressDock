use super::Database;
use crate::ai::*;
use sqlx::Row;

impl Database {
    pub async fn ai_settings(&self) -> Result<AiSettings, AiError> {
        let rows = sqlx::query("SELECT * FROM ai_providers ORDER BY display_name,id")
            .fetch_all(&self.pool)
            .await?;
        let providers = rows
            .iter()
            .map(|r| {
                Ok(AiProviderConfig {
                    id: r.try_get("id")?,
                    display_name: r.try_get("display_name")?,
                    base_url: r.try_get("base_url")?,
                    protocol: match r.try_get::<&str, _>("protocol")? {
                        "chatCompletions" => Protocol::ChatCompletions,
                        "responses" => Protocol::Responses,
                        _ => return Err(AiError::new("AI_STORAGE", "无效的 AI 协议配置")),
                    },
                    has_api_key: r.try_get::<Option<String>, _>("credential_ref")?.is_some(),
                    compatibility: serde_json::from_str(r.try_get("compatibility")?)
                        .map_err(|_| AiError::new("AI_STORAGE", "无效的兼容配置"))?,
                })
            })
            .collect::<Result<Vec<_>, AiError>>()?;
        let rows = sqlx::query("SELECT * FROM ai_models ORDER BY display_name,id")
            .fetch_all(&self.pool)
            .await?;
        let models = rows
            .iter()
            .map(|r| {
                Ok(AiModelConfig {
                    id: r.try_get("id")?,
                    provider_id: r.try_get("provider_id")?,
                    model_id: r.try_get("model_id")?,
                    display_name: r.try_get("display_name")?,
                    context_window: r.try_get("context_window")?,
                    max_output_tokens: r.try_get("max_output_tokens")?,
                    reasoning_effort: r.try_get("reasoning_effort")?,
                })
            })
            .collect::<Result<Vec<_>, AiError>>()?;
        let rows =
            sqlx::query("SELECT * FROM ai_prompt_templates ORDER BY is_default DESC,name,id")
                .fetch_all(&self.pool)
                .await?;
        let templates = rows
            .iter()
            .map(|r| {
                Ok(PromptTemplate {
                    id: r.try_get("id")?,
                    name: r.try_get("name")?,
                    system_prompt: r.try_get("system_prompt")?,
                    user_prompt: r.try_get("user_prompt")?,
                    model_config_id: r.try_get("model_config_id")?,
                    candidate_count: r.try_get("candidate_count")?,
                    max_length: r.try_get("max_length")?,
                    is_default: r.try_get("is_default")?,
                })
            })
            .collect::<Result<Vec<_>, AiError>>()?;
        Ok(AiSettings {
            providers,
            models,
            templates,
        })
    }

    pub async fn ai_credential_ref(&self, id: &str) -> Result<Option<String>, AiError> {
        Ok(sqlx::query_scalar::<_, Option<String>>(
            "SELECT credential_ref FROM ai_providers WHERE id=?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .flatten())
    }

    pub async fn ai_save_provider(
        &self,
        r: &SaveProviderRequest,
        reference: Option<&str>,
    ) -> Result<(), AiError> {
        r.validate()?;
        sqlx::query("INSERT INTO ai_providers(id,display_name,base_url,protocol,credential_ref,compatibility) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,base_url=excluded.base_url,protocol=excluded.protocol,credential_ref=excluded.credential_ref,compatibility=excluded.compatibility")
            .bind(&r.id).bind(r.display_name.trim()).bind(r.base_url.trim_end_matches('/')).bind(r.protocol.as_str()).bind(reference)
            .bind(serde_json::to_string(&r.compatibility).map_err(|_|AiError::invalid("无效的兼容配置"))?)
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn ai_save_model(&self, r: &AiModelConfig) -> Result<(), AiError> {
        r.validate()?;
        let mut tx = self.pool.begin().await?;
        let old: Option<String> =
            sqlx::query_scalar("SELECT provider_id FROM ai_models WHERE id=?")
                .bind(&r.id)
                .fetch_optional(&mut *tx)
                .await?;
        if old.is_some_and(|v| v != r.provider_id) {
            return Err(AiError::invalid("已有模型不能更换所属提供商"));
        }
        if sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM ai_providers WHERE id=?")
            .bind(&r.provider_id)
            .fetch_one(&mut *tx)
            .await?
            == 0
        {
            return Err(AiError::invalid("提供商不存在，请先保存提供商"));
        }
        if sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM ai_models WHERE provider_id=? AND model_id=? AND id<>?",
        )
        .bind(&r.provider_id)
        .bind(&r.model_id)
        .bind(&r.id)
        .fetch_one(&mut *tx)
        .await?
            > 0
        {
            return Err(AiError::invalid("该提供商下已有相同模型 ID"));
        }
        sqlx::query("INSERT INTO ai_models VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET model_id=excluded.model_id,display_name=excluded.display_name,context_window=excluded.context_window,max_output_tokens=excluded.max_output_tokens,reasoning_effort=excluded.reasoning_effort")
            .bind(&r.id).bind(&r.provider_id).bind(&r.model_id).bind(r.display_name.trim()).bind(r.context_window).bind(r.max_output_tokens).bind(&r.reasoning_effort)
            .execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn ai_save_template(&self, r: &PromptTemplate) -> Result<(), AiError> {
        r.validate()?;
        let mut tx = self.pool.begin().await?;
        if let Some(id) = &r.model_config_id
            && sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM ai_models WHERE id=?")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?
                == 0
        {
            return Err(AiError::invalid("绑定模型不存在，请重新选择"));
        }
        if r.is_default {
            sqlx::query("UPDATE ai_prompt_templates SET is_default=0 WHERE is_default=1")
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("INSERT INTO ai_prompt_templates VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,system_prompt=excluded.system_prompt,user_prompt=excluded.user_prompt,model_config_id=excluded.model_config_id,candidate_count=excluded.candidate_count,max_length=excluded.max_length,is_default=excluded.is_default")
            .bind(&r.id).bind(r.name.trim()).bind(&r.system_prompt).bind(&r.user_prompt).bind(&r.model_config_id).bind(r.candidate_count).bind(r.max_length).bind(r.is_default)
            .execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn ai_delete_config(&self, kind: &str, id: &str) -> Result<(), AiError> {
        let mut tx = self.pool.begin().await?;
        let (sql, refs) = match kind {
            "provider" => ("DELETE FROM ai_providers WHERE id=?", sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM ai_prompt_templates t JOIN ai_models m ON t.model_config_id=m.id WHERE m.provider_id=?").bind(id).fetch_one(&mut *tx).await?),
            "model" => ("DELETE FROM ai_models WHERE id=?",sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM ai_prompt_templates WHERE model_config_id=?").bind(id).fetch_one(&mut *tx).await?),
            "template" => ("DELETE FROM ai_prompt_templates WHERE id=?",0),
            _ => return Err(AiError::invalid("无效的配置类型")),
        };
        if refs > 0 {
            return Err(AiError::new(
                "AI_IN_USE",
                "配置正被提示词模板引用，请先修改模板解除引用",
            ));
        }
        sqlx::query(sql).bind(id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
}
