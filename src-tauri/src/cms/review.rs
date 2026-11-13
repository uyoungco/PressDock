//! 审核只允许已调研的 accept/reject，单条与批量分别编码，不复用 edit。
use super::*;
use std::collections::HashSet;

#[cfg(test)]
#[path = "review_tests.rs"]
mod tests;

fn stale() -> CmsError {
    CmsError::new(
        "REVIEW_STALE",
        "文章已变化或不在当前审核级别，请刷新后重新审核",
    )
}

fn single_body(article: &CmsArticleDetail) -> Value {
    let row = &article.row;
    json!({"id":row.id,"newsText":article.news_text,"title":row.title,
        "classId":row.class_id,"className":row.class_name,"writer":row.writer,
        "titlePic":row.title_pic,"titlePic2":row.title_pic2,"titlePic3":row.title_pic3,
        "smallText":row.small_text,"sourceUrl":row.source_url})
}

fn stopped(code: &str) -> bool {
    matches!(
        code,
        "AUTH_EXPIRED" | "CMS_FORBIDDEN" | "SESSION_CHANGED" | "CMS_WRITE_UNCONFIRMED"
    )
}

fn result(
    row: &CmsArticleRow,
    status: ReviewStatus,
    code: Option<&str>,
    message: &str,
) -> ArticleReviewResult {
    ArticleReviewResult {
        id: row.id,
        title: row.title.clone(),
        status,
        code: code.map(str::to_owned),
        message: message.to_owned(),
    }
}

fn failure(row: &CmsArticleRow, error: &CmsError) -> ArticleReviewResult {
    // 读取接口可能返回服务器原始错误；审核摘要仅暴露固定说明，不回显正文或诊断。
    let message = match error.code {
        "AUTH_EXPIRED" => "登录已失效，请重新登录后刷新核对",
        "CMS_FORBIDDEN" => "当前账号无权审核文章",
        "SESSION_CHANGED" => "登录状态已变化，本篇未提交",
        "CMS_WRITE_UNCONFIRMED" => "结果未确认，请刷新核对；请勿直接重复提交",
        "REVIEW_STALE" => "文章已变化或不在当前审核级别，请刷新后重新预览",
        "CMS_NETWORK" => "无法重新读取文章，本篇未提交，请刷新后核对",
        "CMS_REMOTE" => "后台拒绝本次操作，请刷新核对文章及账号权限",
        _ => "后台数据无法确认，本篇未提交，请刷新后核对",
    };
    result(
        row,
        if error.code == "CMS_WRITE_UNCONFIRMED" {
            ReviewStatus::Unconfirmed
        } else {
            ReviewStatus::Failed
        },
        Some(error.code),
        message,
    )
}

impl CmsService {
    async fn review_identity(&self) -> Result<(u64, Credential), CmsError> {
        #[cfg(feature = "android-demo")]
        if self.demo.is_some() {
            return Err(CmsError::new(
                "DEMO_ONLY",
                "演示包不支持文章审核，已阻止真实请求",
            ));
        }
        let state = self.state.lock().await;
        let user = &state.session.as_ref().ok_or_else(CmsError::expired)?.user;
        if user.roles.iter().any(|role| role == "editor") {
            return Err(CmsError::new("CMS_FORBIDDEN", "当前账号不提供文章审核入口"));
        }
        Ok((
            state.generation,
            state.credential.clone().ok_or_else(CmsError::expired)?,
        ))
    }

    async fn review_write(
        &self,
        id: i64,
        mut body: Value,
        decision: ReviewDecision,
        generation: u64,
        credential: &Credential,
    ) -> Result<(), CmsError> {
        body["action"] = serde_json::to_value(decision).map_err(|_| CmsError::invalid())?;
        // 审核不收集原因；保留原站字段，并忽略旧客户端可能带入的 comment。
        body["comment"] = json!("");
        self.ensure_generation(generation).await?;
        let unknown = || {
            CmsError::new(
                "CMS_WRITE_UNCONFIRMED",
                "结果未确认，请刷新核对；请勿直接重复提交",
            )
        };
        let mut response = self
            .client
            .put(self.endpoint(&format!("/api/Article/{id}")))
            .bearer_auth(&credential.access_token)
            .json(&body)
            .send()
            .await
            .map_err(|_| unknown())?;
        let status = response.status();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unknown())? {
            if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                return Err(unknown());
            }
            bytes.extend_from_slice(&chunk);
        }
        // 请求已经发出；此后会话变化也不能声称写入失败或撤销。
        self.ensure_generation(generation)
            .await
            .map_err(|_| unknown())?;
        let value = serde_json::from_slice::<Value>(&bytes).ok();
        if status == StatusCode::UNAUTHORIZED
            || value.as_ref().and_then(|v| v["code"].as_str()) == Some("A0230")
        {
            let _guard = self.auth_operations.lock().await;
            self.ensure_generation(generation)
                .await
                .map_err(|_| unknown())?;
            self.clear_memory().await;
            self.vault_clear().await;
            return Err(CmsError::expired());
        }
        if status == StatusCode::FORBIDDEN {
            return Err(CmsError::new("CMS_FORBIDDEN", "当前账号无权审核文章"));
        }
        if status.is_server_error() {
            return Err(unknown());
        }
        if !status.is_success() {
            return Err(CmsError::new(
                "CMS_REMOTE",
                "后台拒绝本次审核，请核对文章及账号权限",
            ));
        }
        let value = value.ok_or_else(unknown)?;
        if value
            .get("code")
            .is_some_and(|code| code != "200" && code != 200)
        {
            return Err(CmsError::new("CMS_REMOTE", "后台未接受本次审核"));
        }
        if value["msg"].as_str() != Some("succ") {
            return Err(unknown());
        }
        Ok(())
    }

    pub async fn review_article(
        &self,
        request: ArticleReviewInput,
    ) -> Result<ArticleReviewSummary, CmsError> {
        let _guard = self
            .review_operations
            .try_lock()
            .map_err(|_| CmsError::new("REVIEW_BUSY", "审核正在进行，请等待完成"))?;
        if request.article.row.id <= 0 || request.article.news_text.len() > 16 * 1024 * 1024 {
            return Err(CmsError::new("VALIDATION", "文章 ID 或正文大小无效"));
        }
        let (generation, credential) = self.review_identity().await?;
        let row = &request.article.row;
        let attempt = async {
            let value = self
                .get(
                    &format!("/api/Article/{}", row.id),
                    &Vec::<(&str, &str)>::new(),
                    generation,
                    &credential,
                )
                .await?;
            if value["msg"].as_str() != Some("succ") {
                return Err(CmsError::invalid());
            }
            let current: CmsArticleDetail =
                Self::decode(value.get("data").cloned().ok_or_else(CmsError::invalid)?)?;
            if current.row.id != row.id
                || current.status != request.view.status()
                || request.article.status != current.status
                || current.updated_at != request.article.updated_at
                || single_body(&current) != single_body(&request.article)
                || current.row.tags != row.tags
                || current.row.n_tags != row.n_tags
            {
                return Err(stale());
            }
            self.review_write(
                row.id,
                single_body(&current),
                request.decision,
                generation,
                &credential,
            )
            .await
        }
        .await;
        let item = match attempt {
            Ok(()) => result(
                row,
                ReviewStatus::Succeeded,
                None,
                if request.decision == ReviewDecision::Accept {
                    "审核通过"
                } else {
                    "已拒绝"
                },
            ),
            Err(error) => failure(row, &error),
        };
        Ok(ArticleReviewSummary {
            auth_expired: item.code.as_deref() == Some("AUTH_EXPIRED"),
            items: vec![item],
        })
    }

    pub async fn review_articles(
        &self,
        request: ArticlesReviewInput,
    ) -> Result<ArticleReviewSummary, CmsError> {
        let _guard = self
            .review_operations
            .try_lock()
            .map_err(|_| CmsError::new("REVIEW_BUSY", "审核正在进行，请等待完成"))?;
        let mut ids = HashSet::new();
        if request.articles.is_empty()
            || request.articles.len() > 500
            || request
                .articles
                .iter()
                .any(|row| row.id <= 0 || !ids.insert(row.id))
        {
            return Err(CmsError::new(
                "VALIDATION",
                "请选择当前页 1–500 篇不重复的文章",
            ));
        }
        let (generation, credential) = self.review_identity().await?;
        let mut summary = ArticleReviewSummary {
            items: Vec::new(),
            auth_expired: false,
        };
        let mut stop = false;
        for row in &request.articles {
            if stop {
                summary.items.push(result(
                    row,
                    ReviewStatus::NotAttempted,
                    None,
                    "批次已停止，本篇未提交",
                ));
                continue;
            }
            let attempt = async {
                self.ensure_generation(generation).await?;
                let page = self
                    .list_cms_articles(ArticleQuery {
                        view: request.view.article_view(),
                        id: Some(row.id),
                        classid: None,
                        title: String::new(),
                        start: String::new(),
                        end: String::new(),
                        author: String::new(),
                        editor: false,
                        nubia: false,
                        current: 1,
                        pagesize: 10,
                    })
                    .await?;
                self.ensure_generation(generation).await?;
                let current = page
                    .data
                    .first()
                    .filter(|current| page.data.len() == 1 && current.id == row.id)
                    .ok_or_else(stale)?;
                if serde_json::to_value(current).ok() != serde_json::to_value(row).ok() {
                    return Err(stale());
                }
                let mut body = json!({});
                // 仅编码调研确认过的列表字段，禁止透传正文、状态或未知扩展字段。
                for field in [
                    "Id",
                    "Title",
                    "ClassId",
                    "ClassName",
                    "TitlePic",
                    "SourceUrl",
                    "NewsTime",
                    "TitlePic2",
                    "TitlePic3",
                    "SmallText",
                    "Writer",
                    "Pages",
                ] {
                    if let Some(value) = current.snapshot.get(field) {
                        body[field] = value.clone();
                    }
                }
                body["Id"] = json!(current.id);
                body["Tags"] =
                    json!(serde_json::to_string(&current.tags).map_err(|_| CmsError::invalid())?);
                body["NTags"] =
                    json!(serde_json::to_string(&current.n_tags).map_err(|_| CmsError::invalid())?);
                body["commentRecommand"] = json!(current.comment_recommand);
                body["commentPromote"] = json!(current.comment_promote);
                self.review_write(row.id, body, request.decision, generation, &credential)
                    .await
            }
            .await;
            let item = match attempt {
                Ok(()) => result(
                    row,
                    ReviewStatus::Succeeded,
                    None,
                    if request.decision == ReviewDecision::Accept {
                        "审核通过"
                    } else {
                        "已拒绝"
                    },
                ),
                Err(error) => {
                    stop = stopped(error.code);
                    summary.auth_expired |= error.code == "AUTH_EXPIRED";
                    failure(row, &error)
                }
            };
            summary.items.push(item);
        }
        Ok(summary)
    }
}
