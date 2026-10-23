use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

fn validation(message: &str) -> CmsError {
    CmsError::new("VALIDATION", message)
}

pub(crate) fn external_url(value: &str) -> Result<url::Url, CmsError> {
    let url = url::Url::parse(value).map_err(|_| validation("链接格式无效"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || value.chars().any(char::is_control)
    {
        return Err(validation("仅支持 HTTP/HTTPS 网页链接"));
    }
    Ok(url)
}

fn validate_input(input: &PromoteInput) -> Result<(), CmsError> {
    if input.channel.trim().is_empty()
        || input.title.trim().is_empty()
        || input.title_pic.trim().is_empty()
    {
        return Err(validation("Channel、Title 和 TitlePic 必填"));
    }
    if let Some(date) = input.publish_date.as_deref().filter(|v| !v.is_empty())
        && (date.len() != 10 || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err())
    {
        return Err(validation("发布日期格式应为 YYYY-MM-DD"));
    }
    Ok(())
}

fn pascal(value: Value) -> Value {
    Value::Object(
        value
            .as_object()
            .expect("typed record")
            .iter()
            .map(|(key, value)| {
                let mut chars = key.chars();
                let name = match chars.next() {
                    Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                    None => String::new(),
                };
                (name, value.clone())
            })
            .collect(),
    )
}

impl CmsService {
    pub fn external_link(value: &str) -> Result<String, CmsError> {
        Ok(external_url(value)?.into())
    }
    async fn finish_request(
        &self,
        request: RequestBuilder,
        generation: u64,
        writing: bool,
    ) -> Result<Value, CmsError> {
        let result = self.send(request).await;
        if result.as_ref().is_err_and(|e| e.code == "AUTH_EXPIRED") {
            let _operation = self.auth_operations.lock().await;
            self.ensure_generation(generation).await?;
            self.clear_memory().await;
            self.vault_clear().await;
            return Err(CmsError::expired());
        }
        self.ensure_generation(generation).await?;
        result.map_err(|e| {
            if writing && e.code == "CMS_NETWORK" {
                CmsError::new(
                    "CMS_WRITE_UNCONFIRMED",
                    "结果未确认，请刷新核对；请勿直接重复提交",
                )
            } else {
                e
            }
        })
    }

    async fn allow_record_images(
        &self,
        record: &PromoteRecord,
        generation: u64,
    ) -> Result<(), CmsError> {
        let mut state = self.state.lock().await;
        if state.generation != generation || state.session.is_none() {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化，请重试"));
        }
        for url in [&record.title_pic, &record.title_pic2]
            .into_iter()
            .flatten()
        {
            if self.images.accepts(url) {
                state.image_urls.insert(url.clone());
            }
        }
        Ok(())
    }

    pub async fn get_data(&self, id: i64) -> Result<PromoteRecord, CmsError> {
        if id <= 0 {
            return Err(validation("素材 ID 无效"));
        }
        let (generation, credential) = self.snapshot().await?;
        let value = self
            .get(
                &format!("/api/PromoteData/{id}"),
                &Vec::<(&str, &str)>::new(),
                generation,
                &credential,
            )
            .await?;
        let record: PromoteRecord =
            Self::decode(value.get("data").cloned().ok_or_else(CmsError::invalid)?)?;
        if record.id != id {
            return Err(CmsError::invalid());
        }
        self.allow_record_images(&record, generation).await?;
        Ok(record)
    }

    pub async fn create_data(&self, input: PromoteInput) -> Result<MutationResult, CmsError> {
        validate_input(&input)?;
        let (generation, credential) = self.snapshot().await?;
        let mut body = pascal(serde_json::to_value(input).map_err(|_| CmsError::invalid())?);
        body["Id"] = json!(0);
        self.finish_request(
            self.client
                .post(self.endpoint("/api/PromoteData"))
                .bearer_auth(&credential.access_token)
                .json(&body),
            generation,
            true,
        )
        .await?;
        Ok(MutationResult { succeeded: true })
    }

    pub async fn update_data(&self, record: PromoteRecord) -> Result<MutationResult, CmsError> {
        if record.id <= 0 {
            return Err(validation("素材 ID 无效"));
        }
        validate_input(&PromoteInput {
            channel: record.channel.clone().unwrap_or_default(),
            sub_channel: record.sub_channel.clone(),
            publish_date: record.publish_date.clone(),
            url: record.url.clone(),
            title: record.title.clone().unwrap_or_default(),
            title_pic: record.title_pic.clone().unwrap_or_default(),
            title_pic2: record.title_pic2.clone(),
            small_text: record.small_text.clone(),
            writer: record.writer.clone(),
        })?;
        let (generation, credential) = self.snapshot().await?;
        let body = pascal(serde_json::to_value(&record).map_err(|_| CmsError::invalid())?);
        self.finish_request(
            self.client
                .put(self.endpoint(&format!("/api/PromoteData/{}", record.id)))
                .bearer_auth(&credential.access_token)
                .json(&body),
            generation,
            true,
        )
        .await?;
        Ok(MutationResult { succeeded: true })
    }

    pub async fn delete_data(&self, id: i64) -> Result<MutationResult, CmsError> {
        if id <= 0 {
            return Err(validation("素材 ID 无效"));
        }
        let (generation, credential) = self.snapshot().await?;
        self.finish_request(
            self.client
                .delete(self.endpoint(&format!("/api/PromoteData/{id}")))
                .bearer_auth(&credential.access_token),
            generation,
            true,
        )
        .await?;
        Ok(MutationResult { succeeded: true })
    }

    pub async fn save_order(
        &self,
        query: PromoteQuery,
        ids: Vec<i64>,
    ) -> Result<MutationResult, CmsError> {
        let unique: HashSet<_> = ids.iter().copied().collect();
        if query.channel.trim().is_empty()
            || query.subchannel.trim().is_empty()
            || query.publishdate.is_empty()
            || ids.len() < 2
            || unique.len() != ids.len()
            || ids.iter().any(|id| *id <= 0)
        {
            return Err(validation("请完整搜索渠道、子渠道和日期后，对当前页排序"));
        }
        let (generation, credential) = self.snapshot().await?;
        let page = self.list_data(query).await?;
        self.ensure_generation(generation).await?;
        let current_ids: HashSet<_> = page.data.iter().map(|row| row.id).collect();
        if page.data.len() != ids.len() || current_ids != unique {
            return Err(CmsError::new(
                "CMS_PAGE_CHANGED",
                "列表已变化，请取消排序并刷新后重试",
            ));
        }
        let orders: Vec<_> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| json!({"id":id,"order":i+1}))
            .collect();
        self.finish_request(
            self.client
                .put(self.endpoint("/api/PromoteData"))
                .bearer_auth(&credential.access_token)
                .json(&json!({"promoteDataPutOrders":orders})),
            generation,
            true,
        )
        .await?;
        Ok(MutationResult { succeeded: true })
    }

    pub async fn upload_image(&self, input: UploadImage) -> Result<UploadedImage, CmsError> {
        const LIMIT: usize = 20 * 1024 * 1024;
        if input.data_base64.len() > 4 * LIMIT.div_ceil(3)
            || !input.mime_type.starts_with("image/")
            || input.mime_type.contains(['\r', '\n', ';'])
        {
            return Err(validation("请选择不超过 20 MiB 的图片"));
        }
        let bytes = STANDARD
            .decode(&input.data_base64)
            .map_err(|_| validation("图片数据无效"))?;
        if bytes.is_empty() || bytes.len() > LIMIT {
            return Err(validation("请选择不超过 20 MiB 的图片"));
        }
        let name = input
            .file_name
            .rsplit(['/', '\\'])
            .next()
            .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
            .ok_or_else(|| validation("文件名无效"))?;
        let (generation, credential) = self.snapshot().await?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(name.to_owned())
            .mime_str(&input.mime_type)
            .map_err(|_| validation("图片类型无效"))?;
        let value = self
            .finish_request(
                self.client
                    .post(self.endpoint("/api/FileData"))
                    .bearer_auth(&credential.access_token)
                    .multipart(reqwest::multipart::Form::new().part("file", part)),
                generation,
                true,
            )
            .await?;
        let url = value
            .get("data")
            .and_then(Value::as_array)
            .and_then(|v| v.first())
            .and_then(|v| v.get("cloudurl"))
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .ok_or_else(CmsError::invalid)?
            .to_owned();
        let mut state = self.state.lock().await;
        if state.generation != generation || state.session.is_none() {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化，请重试"));
        }
        if self.images.accepts(&url) {
            state.image_urls.insert(url.clone());
        }
        Ok(UploadedImage { url })
    }
}
