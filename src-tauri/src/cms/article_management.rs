//! 后台文章查询与编辑；与采集创建分离，避免把更新误判成只读请求。
use super::*;
use std::collections::{HashMap, HashSet};

impl CmsService {
    async fn article_images(
        &self,
        rows: &[CmsArticleRow],
        generation: u64,
    ) -> Result<(), CmsError> {
        let mut state = self.state.lock().await;
        if state.generation != generation || state.session.is_none() {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化，请重试"));
        }
        for row in rows {
            for url in [&row.title_pic, &row.title_pic2, &row.title_pic3]
                .into_iter()
                .flatten()
            {
                // 原站常用协议相对地址；只规范化图片许可，原记录仍用于原样提交。
                let url = if url.starts_with("//") {
                    format!("https:{url}")
                } else {
                    url.clone()
                };
                if self.images.accepts(&url) {
                    state.image_urls.insert(url);
                }
            }
        }
        Ok(())
    }

    pub async fn list_cms_articles(&self, query: ArticleQuery) -> Result<CmsArticlePage, CmsError> {
        let valid_date = |value: &str| {
            value.is_empty()
                || (value.len() == 10
                    && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok())
        };
        if query.current == 0
            || ![10, 20, 30, 50, 100, 200, 500].contains(&query.pagesize)
            || query.id.is_some_and(|id| id <= 0)
            || query.classid.is_some_and(|id| id <= 0)
            || !valid_date(&query.start)
            || !valid_date(&query.end)
            || (!query.start.is_empty() && !query.end.is_empty() && query.start > query.end)
        {
            return Err(CmsError::new(
                "VALIDATION",
                "文章筛选参数无效，请检查 ID、日期和分页",
            ));
        }
        let (status, quality) = match query.view {
            ArticleView::Quality => (3, 1),
            ArticleView::First => (0, 0),
            ArticleView::Second => (1, 0),
            ArticleView::Third => (2, 0),
        };
        let author_visible = matches!(query.view, ArticleView::Quality | ArticleView::First);
        let mut params = vec![
            ("status", status.to_string()),
            ("quality", quality.to_string()),
            ("priority", "0".into()),
            ("current", query.current.to_string()),
            ("pagesize", query.pagesize.to_string()),
            (
                "editor",
                u8::from(author_visible && query.editor).to_string(),
            ),
            (
                "nubia",
                u8::from(query.view == ArticleView::Quality && query.nubia).to_string(),
            ),
        ];
        for (name, value) in [
            ("start", &query.start),
            ("end", &query.end),
            ("title", &query.title),
        ] {
            if !value.is_empty() {
                params.push((name, value.clone()));
            }
        }
        if author_visible && !query.author.is_empty() {
            params.push(("author", query.author.clone()));
        }
        for (name, value) in [("id", query.id), ("classid", query.classid)] {
            if let Some(value) = value {
                params.push((name, value.to_string()));
            }
        }
        let (generation, credential) = self.snapshot().await?;
        let value = self
            .get("/api/Article", &params, generation, &credential)
            .await?;
        if value.get("msg").and_then(Value::as_str) != Some("succ") {
            return Err(CmsError::invalid());
        }
        let mut page: CmsArticlePage = Self::decode(value.clone())?;
        if page.current != query.current
            || page.page_size != query.pagesize
            || page.data.len() > query.pagesize as usize
        {
            return Err(CmsError::invalid());
        }
        let recommended: HashSet<i64> = value
            .get("recommand")
            .and_then(Value::as_array)
            .ok_or_else(CmsError::invalid)?
            .iter()
            .filter_map(|row| row.get("ArticleId").and_then(Value::as_i64))
            .collect();
        let mut promoted: HashMap<i64, Vec<String>> = HashMap::new();
        for row in value
            .get("promote")
            .and_then(Value::as_array)
            .ok_or_else(CmsError::invalid)?
        {
            if let Some(id) = row.get("ArticleId").and_then(Value::as_i64) {
                let channel = row
                    .get("Channel")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let subchannel = row
                    .get("SubChannel")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                promoted
                    .entry(id)
                    .or_default()
                    .push(format!("{channel}_{subchannel}"));
            }
        }
        // 关联索引在读取响应时一次生成，单元格不重复扫描整个素材列表。
        for (row, source) in page
            .data
            .iter_mut()
            .zip(value["data"].as_array().ok_or_else(CmsError::invalid)?)
        {
            row.snapshot = source.as_object().cloned().ok_or_else(CmsError::invalid)?;
            row.comment_recommand = if recommended.contains(&row.id) {
                "热点推荐".into()
            } else {
                String::new()
            };
            row.comment_promote = promoted.remove(&row.id).unwrap_or_default();
        }
        self.article_images(&page.data, generation).await?;
        Ok(page)
    }

    pub async fn list_article_classes(&self) -> Result<Vec<ArticleClass>, CmsError> {
        let (generation, credential) = self.snapshot().await?;
        let value = self
            .get(
                "/api/ArticleClass",
                &Vec::<(&str, &str)>::new(),
                generation,
                &credential,
            )
            .await?;
        Self::decode(value.get("data").cloned().ok_or_else(CmsError::invalid)?)
    }

    pub async fn get_cms_article(&self, id: i64) -> Result<CmsArticleDetail, CmsError> {
        if id <= 0 {
            return Err(CmsError::new("VALIDATION", "文章 ID 无效"));
        }
        let (generation, credential) = self.snapshot().await?;
        let value = self
            .get(
                &format!("/api/Article/{id}"),
                &Vec::<(&str, &str)>::new(),
                generation,
                &credential,
            )
            .await?;
        let article: CmsArticleDetail =
            Self::decode(value.get("data").cloned().ok_or_else(CmsError::invalid)?)?;
        if article.row.id != id {
            return Err(CmsError::invalid());
        }
        self.article_images(std::slice::from_ref(&article.row), generation)
            .await?;
        Ok(article)
    }

    pub async fn update_cms_article(
        &self,
        request: ArticleUpdate,
    ) -> Result<MutationResult, CmsError> {
        if request.id <= 0
            || request.class_id <= 0
            || request.title.trim().is_empty()
            || request.title_pic.trim().is_empty()
            || request.news_text.len() > 16 * 1024 * 1024
        {
            return Err(CmsError::new(
                "VALIDATION",
                "请检查文章 ID、分类、标题、主图和正文大小",
            ));
        }
        let mut body = serde_json::to_value(&request).map_err(|_| CmsError::invalid())?;
        body["tags"] =
            json!(serde_json::to_string(&request.tags).map_err(|_| CmsError::invalid())?);
        body["action"] = json!("edit");
        let (generation, credential) = self.snapshot().await?;
        self.article_write(
            self.client
                .put(self.endpoint(&format!("/api/Article/{}", request.id)))
                .bearer_auth(&credential.access_token)
                .json(&body),
            generation,
        )
        .await
    }

    pub async fn add_article_to_promote(
        &self,
        request: ArticlePromoteInput,
    ) -> Result<MutationResult, CmsError> {
        if request.article.id <= 0 {
            return Err(CmsError::new("VALIDATION", "文章 ID 无效"));
        }
        super::writes::validate_input(&request.input)?;
        // 此接口的 Id 是文章 ID，日期键是 Publishdate，不能套用普通新增的 Id=0。
        let mut body = Value::Object(request.article.snapshot);
        body["Id"] = json!(request.article.id);
        body["commentRecommand"] = json!(request.article.comment_recommand);
        body["commentPromote"] = json!(request.article.comment_promote);
        let input = super::writes::pascal(
            serde_json::to_value(&request.input).map_err(|_| CmsError::invalid())?,
        );
        body.as_object_mut()
            .expect("文章对象")
            .extend(input.as_object().expect("素材对象").clone());
        let object = body.as_object_mut().expect("文章对象");
        let date = object.remove("PublishDate").expect("类型化日期字段");
        object.insert("Publishdate".into(), date);
        let (generation, credential) = self.snapshot().await?;
        self.article_write(
            self.client
                .post(self.endpoint("/api/PromoteData"))
                .bearer_auth(&credential.access_token)
                .json(&body),
            generation,
        )
        .await
    }

    async fn article_write(
        &self,
        request: RequestBuilder,
        generation: u64,
    ) -> Result<MutationResult, CmsError> {
        let value = self.finish_request(request, generation, true).await?;
        // 写请求返回异常/空响应时不能报告保存成功，也不能自动重发。
        if value.get("msg").and_then(Value::as_str) != Some("succ") {
            return Err(CmsError::new(
                "CMS_WRITE_UNCONFIRMED",
                "结果未确认，请刷新核对；请勿直接重复提交",
            ));
        }
        Ok(MutationResult { succeeded: true })
    }
}
