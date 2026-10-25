use super::{
    credentials::{AiVault, NativeAiVault},
    *,
};
use crate::database::Database;
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::watch;

struct Job {
    cancel: watch::Sender<bool>,
    created: Instant,
    running: bool,
}
pub struct AiService {
    client: Client,
    vault: Arc<dyn AiVault>,
    pub(crate) operations: tokio::sync::Mutex<()>,
    jobs: Mutex<HashMap<String, Job>>,
}

struct JobGuard<'a> {
    service: &'a AiService,
    id: String,
}
impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self.service.jobs.lock() {
            jobs.remove(&self.id);
        }
    }
}

fn cancelled() -> AiError {
    AiError::new("AI_CANCELLED", "AI 请求已取消")
}
fn network(error: reqwest::Error) -> AiError {
    if error.is_timeout() {
        AiError::new("AI_TIMEOUT", "AI 请求超时，请手动重试")
    } else {
        AiError::new("AI_NETWORK", "无法连接 AI 服务，请检查 API 地址和网络")
    }
}

impl AiService {
    pub fn new() -> Result<Self, reqwest::Error> {
        Self::with_vault(Arc::new(NativeAiVault))
    }
    pub(super) fn with_vault(vault: Arc<dyn AiVault>) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .retry(reqwest::retry::never())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(120))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            vault,
            operations: tokio::sync::Mutex::new(()),
            jobs: Mutex::new(HashMap::new()),
        })
    }

    pub fn cancel(&self, id: &str) {
        if uuid::Uuid::parse_str(id).is_err() {
            return;
        }
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.retain(|_, j| j.running || j.created.elapsed() < Duration::from_secs(60));
            if let Some(job) = jobs.get(id) {
                job.cancel.send_replace(true);
            } else if jobs.len() < 256 {
                let (cancel, _) = watch::channel(true);
                jobs.insert(
                    id.into(),
                    Job {
                        cancel,
                        created: Instant::now(),
                        running: false,
                    },
                );
            }
        }
    }

    pub async fn run<T>(
        &self,
        id: &str,
        work: impl Future<Output = Result<T, AiError>>,
    ) -> Result<T, AiError> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(AiError::invalid("无效的任务 ID"));
        }
        let mut rx = {
            let mut jobs = self
                .jobs
                .lock()
                .map_err(|_| AiError::new("AI_BUSY", "任务服务暂不可用"))?;
            jobs.retain(|_, j| j.running || j.created.elapsed() < Duration::from_secs(60));
            if let Some(job) = jobs.get(id) {
                if !job.running {
                    jobs.remove(id);
                    return Err(cancelled());
                }
                return Err(AiError::new("AI_BUSY", "该 AI 任务已在运行"));
            }
            if jobs.values().filter(|j| j.running).count() >= 4 {
                return Err(AiError::new("AI_BUSY", "AI 任务过多，请稍后重试"));
            }
            let (cancel, rx) = watch::channel(false);
            jobs.insert(
                id.into(),
                Job {
                    cancel,
                    created: Instant::now(),
                    running: true,
                },
            );
            rx
        };
        let _guard = JobGuard {
            service: self,
            id: id.into(),
        };
        tokio::select! { biased;
            _=rx.changed()=>Err(cancelled()),
            result=work=>result,
        }
    }

    async fn vault_save(&self, reference: String, secret: String) -> Result<(), AiError> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.save(&reference, &secret))
            .await
            .map_err(|_| AiError::new("AI_CREDENTIAL_STORE", "凭据保存失败"))?
    }
    async fn vault_clear(&self, reference: String) -> Result<(), AiError> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.clear(&reference))
            .await
            .map_err(|_| AiError::new("AI_CREDENTIAL_STORE", "凭据删除失败"))?
    }

    pub async fn save_provider(
        &self,
        db: &Database,
        r: SaveProviderRequest,
    ) -> Result<(), AiError> {
        r.validate()?;
        let _lock = self.operations.lock().await;
        if r.create_only
            && db
                .ai_settings()
                .await?
                .providers
                .iter()
                .any(|p| p.id == r.id)
        {
            return Err(AiError::invalid(
                "提供商标识已存在，请使用其他标识或编辑已有提供商",
            ));
        }
        let old = db.ai_credential_ref(&r.id).await?;
        let reference = if let Some(secret) = &r.api_key {
            let new = uuid::Uuid::new_v4().to_string();
            self.vault_save(new.clone(), secret.clone()).await?;
            Some(new)
        } else {
            old.clone()
        };
        if let Err(error) = db.ai_save_provider(&r, reference.as_deref()).await {
            if reference != old
                && let Some(new) = reference
            {
                let _ = self.vault_clear(new).await;
            }
            return Err(error);
        }
        if reference != old
            && let Some(old) = old
        {
            self.vault_clear(old).await?;
        }
        Ok(())
    }

    pub async fn delete_config(&self, db: &Database, kind: &str, id: &str) -> Result<(), AiError> {
        let _lock = self.operations.lock().await;
        let reference = if kind == "provider" {
            db.ai_credential_ref(id).await?
        } else {
            None
        };
        // 先检查数据库引用；被引用的提供商不会删除凭据。
        if kind == "provider" {
            let settings = db.ai_settings().await?;
            if settings.templates.iter().any(|t| {
                settings
                    .models
                    .iter()
                    .any(|m| m.provider_id == id && t.model_config_id.as_deref() == Some(&m.id))
            }) {
                return Err(AiError::new(
                    "AI_IN_USE",
                    "配置正被提示词模板引用，请先修改模板解除引用",
                ));
            }
            if let Some(reference) = reference {
                self.vault_clear(reference).await?;
            }
        }
        db.ai_delete_config(kind, id).await
    }

    async fn provider(
        &self,
        db: &Database,
        id: &str,
    ) -> Result<(AiProviderConfig, Option<String>), AiError> {
        let _lock = self.operations.lock().await;
        let provider = db
            .ai_settings()
            .await?
            .providers
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AiError::invalid("提供商不存在"))?;
        let secret = if let Some(reference) = db.ai_credential_ref(id).await? {
            let vault = self.vault.clone();
            Some(
                tokio::task::spawn_blocking(move || vault.load(&reference))
                    .await
                    .map_err(|_| AiError::new("AI_CREDENTIAL_STORE", "凭据读取失败"))??,
            )
        } else {
            None
        };
        Ok((provider, secret))
    }

    async fn request(
        &self,
        provider: &AiProviderConfig,
        secret: Option<&str>,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AiError> {
        let address = format!("{}/{path}", provider.base_url.trim_end_matches('/'));
        let mut request = self.client.request(method, address);
        if let Some(secret) = secret {
            request = request.bearer_auth(secret);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(network)?;
        let status = response.status();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(network)? {
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(AiError::new("AI_RESPONSE", "AI 响应超过 2 MiB"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            let code = serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| {
                v.pointer("/error/code")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
            return Err(match status {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                    AiError::new("AI_AUTH", "AI 密钥无效或无模型权限，请检查配置")
                }
                StatusCode::TOO_MANY_REQUESTS => {
                    AiError::new("AI_RATE_LIMIT", "AI 服务限流或额度不足，请稍后手动重试")
                }
                _ if matches!(
                    code.as_deref(),
                    Some(
                        "context_length_exceeded"
                            | "context_window_exceeded"
                            | "max_tokens_exceeded"
                    )
                ) =>
                {
                    AiError::new(
                        "AI_CONTEXT_LIMIT",
                        "内容超过模型上下文限制，请精简内容或更换模型",
                    )
                }
                _ => AiError::new(
                    "AI_HTTP",
                    format!(
                        "AI 服务返回 HTTP {}，请检查协议、模型和参数配置",
                        status.as_u16()
                    ),
                ),
            });
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| AiError::new("AI_RESPONSE", "AI 服务返回了无效 JSON"))
    }

    pub async fn list_models(
        &self,
        db: &Database,
        provider_id: &str,
    ) -> Result<Vec<String>, AiError> {
        let (provider, secret) = self.provider(db, provider_id).await?;
        let value = self
            .request(&provider, secret.as_deref(), Method::GET, "models", None)
            .await?;
        let entries = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| AiError::new("AI_RESPONSE", "模型列表格式无效，可手动填写模型 ID"))?;
        let mut ids = entries
            .iter()
            .filter_map(|m| m.get("id").and_then(Value::as_str))
            .filter(|id| !id.trim().is_empty() && id.chars().count() <= 200)
            .map(str::to_owned)
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    // 通用文本调用：模型、提供商及协议适配不依赖标题业务。
    pub async fn generate_text(
        &self,
        db: &Database,
        model: &AiModelConfig,
        system: &str,
        user: &str,
    ) -> Result<String, AiError> {
        let (provider, secret) = self.provider(db, &model.provider_id).await?;
        let (path, mut body) = match provider.protocol {
            Protocol::ChatCompletions => (
                "chat/completions",
                json!({"model":model.model_id,"messages":[{"role":provider.compatibility.system_role,"content":system},{"role":"user","content":user}],"stream":false}),
            ),
            Protocol::Responses => (
                "responses",
                json!({"model":model.model_id,"instructions":system,"input":user,"stream":false}),
            ),
        };
        if provider.compatibility.send_store {
            body["store"] = json!(false);
        }
        if let Some(tokens) = model.max_output_tokens {
            body[if provider.protocol == Protocol::Responses {
                "max_output_tokens"
            } else {
                &provider.compatibility.max_tokens_field
            }] = json!(tokens);
        }
        if let Some(effort) = &model.reasoning_effort {
            if provider.protocol == Protocol::Responses {
                body["reasoning"] = json!({"effort":effort});
            } else {
                body["reasoning_effort"] = json!(effort);
            }
        }
        let value = self
            .request(&provider, secret.as_deref(), Method::POST, path, Some(body))
            .await?;
        let output = match provider.protocol {
            Protocol::ChatCompletions => {
                if value
                    .pointer("/choices/0/finish_reason")
                    .and_then(Value::as_str)
                    == Some("length")
                {
                    return Err(AiError::new(
                        "AI_OUTPUT_LIMIT",
                        "输出达到 token 上限，请增加模型输出上限后重试",
                    ));
                }
                value
                    .pointer("/choices/0/message/content")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned()
            }
            Protocol::Responses => {
                if value
                    .get("status")
                    .and_then(Value::as_str)
                    .is_some_and(|s| s != "completed")
                {
                    return Err(AiError::new(
                        "AI_RESPONSE",
                        "模型未完成输出，请检查输出上限后重试",
                    ));
                }
                value
                    .get("output")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
                    .filter_map(|item| item.get("content").and_then(Value::as_array))
                    .flatten()
                    .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        };
        if output.trim().is_empty() {
            return Err(AiError::new(
                "AI_RESPONSE",
                "模型未返回可用文本，可能拒绝了本次请求",
            ));
        }
        Ok(output)
    }
}
