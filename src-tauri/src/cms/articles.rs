//! 采集文章复用现有会话，但单独处理 Article 写入结果不确定的边界。
use super::*;
use crate::{
    error::{Diagnostic, redact, response_context},
    harvest::{FormattedArticle, RawArticle},
};

impl CmsService {
    pub(crate) async fn harvest_identity(&self) -> Result<(i64, u64), CmsError> {
        let state = self.state.lock().await;
        let session = state.session.as_ref().ok_or_else(CmsError::expired)?;
        Ok((session.user.user_id, state.generation))
    }
    async fn article_response(
        &self,
        request: RequestBuilder,
        generation: u64,
        path: &str,
        secret: &str,
    ) -> Result<Value, CmsError> {
        self.ensure_generation(generation).await?;
        let writing = path == "/api/Article";
        let uncertain = || {
            CmsError::new(
                "CMS_WRITE_UNCONFIRMED",
                "CMS 提交结果未确认，请先在后台核对，勿直接重复提交",
            )
        };
        let network = |error: reqwest::Error| {
            let result = if writing {
                uncertain()
            } else {
                CmsError::new("CMS_NETWORK", "无法连接 CMS，请重试")
            };
            result.diagnosed(Diagnostic::error(
                &format!("cms.{path}.send"),
                &error.without_url(),
                json!({}),
            ))
        };
        let mut response = request.send().await.map_err(network)?;
        let status = response.status();
        let mut bytes = Vec::new();
        loop {
            let chunk = response.chunk().await.map_err(|error| {
                let mut error = network(error);
                if let Some(diagnostic) = &mut error.diagnostic {
                    diagnostic.operation = format!("cms.{path}.read");
                    diagnostic.context =
                        response_context(status.as_u16(), &bytes, Some(secret), true);
                }
                error
            })?;
            let Some(chunk) = chunk else { break };
            if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                let received = bytes.len() + chunk.len();
                bytes.extend_from_slice(&chunk[..16 * 1024 * 1024 - bytes.len()]);
                return Err((if writing {
                    uncertain()
                } else {
                    CmsError::invalid()
                })
                .diagnosed(Diagnostic {
                    operation: format!("cms.{path}.read"),
                    causes: vec![format!("已收到至少 {received} 字节，响应读取上限为 16 MiB")],
                    context: response_context(status.as_u16(), &bytes, Some(secret), true),
                }));
            }
            bytes.extend_from_slice(&chunk);
        }
        let parsed = serde_json::from_slice::<Value>(&bytes);
        // 认证信息在请求边界脱敏，普通 CommandError 不会序列化本字段。
        let failure = |error: CmsError| {
            error.diagnosed(Diagnostic {
                operation: format!("cms.{path}.response"),
                causes: parsed
                    .as_ref()
                    .err()
                    .map(ToString::to_string)
                    .into_iter()
                    .collect(),
                context: response_context(status.as_u16(), &bytes, Some(secret), false),
            })
        };
        let value = parsed.as_ref().ok();
        let expired = status == StatusCode::UNAUTHORIZED
            || value.and_then(|v| v.get("code")).and_then(Value::as_str) == Some("A0230");
        if expired {
            let _guard = self.auth_operations.lock().await;
            self.ensure_generation(generation).await?;
            self.clear_memory().await;
            self.vault_clear().await;
            return Err(failure(CmsError::expired()));
        }
        self.ensure_generation(generation).await?;
        if status == StatusCode::FORBIDDEN {
            return Err(failure(CmsError::new(
                "CMS_FORBIDDEN",
                "当前账号无权添加文章",
            )));
        }
        if writing && (status.is_server_error() || value.is_none()) {
            return Err(failure(uncertain()));
        }
        if !status.is_success() {
            return Err(failure(CmsError::new(
                "CMS_REMOTE",
                "CMS 拒绝本次文章请求，请检查账号权限和文章数据",
            )));
        }
        let value = value.ok_or_else(|| failure(CmsError::invalid()))?;
        if value.get("msg").and_then(Value::as_str) != Some("succ") {
            return Err(failure(
                if value.get("msg").and_then(Value::as_str).is_some() {
                    CmsError::new("CMS_REMOTE", "CMS 未接受本次文章请求")
                } else if writing {
                    uncertain()
                } else {
                    CmsError::invalid()
                },
            ));
        }
        // 只将已校验响应交回业务层，不改变正常提交的成功/未知判定。
        Ok(parsed.expect("响应已校验"))
    }
    pub(crate) async fn harvest_format(
        &self,
        raw: &RawArticle,
        html: &str,
        expected: u64,
    ) -> Result<FormattedArticle, CmsError> {
        let (generation, credential) = self.snapshot().await?;
        if generation != expected {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化"));
        }
        let value = self
            .article_response(
                self.client
                    .post(self.endpoint("/api/Util/FormatContent"))
                    .bearer_auth(&credential.access_token)
                    .json(&json!({"content":html})),
                generation,
                "/api/Util/FormatContent",
                &credential.access_token,
            )
            .await?;
        let invalid = |field: &str| {
            CmsError::invalid().diagnosed(Diagnostic {
                operation: "cms.FormatContent.validation".into(),
                causes: vec![format!("字段 {field} 缺失、类型错误或为空")],
                context: redact(value.clone(), &[&credential.access_token]),
            })
        };
        Ok(FormattedArticle {
            title: raw.title.clone(),
            writer: raw.writer.clone(),
            source_url: raw.source_url.clone(),
            news_text: value
                .get("content")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| invalid("content"))?
                .into(),
            title_pic: value
                .get("titlePic")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("titlePic"))?
                .into(),
            small_text: value
                .get("smallText")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("smallText"))?
                .into(),
            class_id: 1,
            tags: Vec::new(),
        })
    }
    pub(crate) async fn harvest_classes(
        &self,
        expected: u64,
    ) -> Result<Vec<(i64, String)>, CmsError> {
        let (generation, credential) = self.snapshot().await?;
        if generation != expected {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化"));
        }
        let value = self
            .article_response(
                self.client
                    .get(self.endpoint("/api/ArticleClass"))
                    .bearer_auth(&credential.access_token)
                    .query(&[("current", 1), ("pagesize", 200)]),
                generation,
                "/api/ArticleClass",
                &credential.access_token,
            )
            .await?;
        let invalid = || {
            CmsError::invalid().diagnosed(Diagnostic {
                operation: "cms.ArticleClass.validation".into(),
                causes: vec!["分类列表缺失或没有有效的分类 ID/名称".into()],
                context: redact(value.clone(), &[&credential.access_token]),
            })
        };
        let rows = value
            .pointer("/data/records")
            .or_else(|| value.get("data"))
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        let classes = rows
            .iter()
            .filter_map(|row| {
                let id = row.get("Id").or_else(|| row.get("id"))?.as_i64()?;
                let name = row
                    .get("ClassName")
                    .or_else(|| row.get("Name"))
                    .or_else(|| row.get("className"))
                    .or_else(|| row.get("name"))?
                    .as_str()?
                    .trim();
                (id > 0 && !name.is_empty()).then(|| (id, name.to_owned()))
            })
            .collect::<Vec<_>>();
        if classes.is_empty() {
            return Err(invalid());
        }
        Ok(classes)
    }
    pub(crate) async fn harvest_submit(
        &self,
        article: &FormattedArticle,
        expected: u64,
    ) -> Result<Option<String>, CmsError> {
        let (generation, credential) = self.snapshot().await?;
        if generation != expected {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化"));
        }
        let value = self
            .article_response(
                self.client
                    .post(self.endpoint("/api/Article"))
                    .bearer_auth(&credential.access_token)
                    .json(&article.payload()),
                generation,
                "/api/Article",
                &credential.access_token,
            )
            .await?;
        Ok(value
            .pointer("/data/id")
            .or_else(|| value.pointer("/data/Id"))
            .or_else(|| value.get("id"))
            .or_else(|| value.get("Id"))
            .and_then(|id| match id {
                Value::String(text) if !text.is_empty() => Some(text.clone()),
                Value::Number(number) => Some(number.to_string()),
                _ => None,
            }))
    }
}
