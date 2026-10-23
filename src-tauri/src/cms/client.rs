use super::{
    credentials::{CredentialVault, NativeVault},
    images::ImageLoader,
    models::*,
};
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::{collections::HashSet, path::Path, sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[path = "write.rs"]
mod writes;

pub struct CmsError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Debug for CmsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CmsError")
            .field("code", &self.code)
            .finish()
    }
}

impl CmsError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    fn expired() -> Self {
        Self::new("AUTH_EXPIRED", "登录已失效，请重新登录")
    }
    fn invalid() -> Self {
        Self::new("CMS_RESPONSE", "后台返回的数据格式不符合接口约定")
    }
}

#[derive(Default)]
struct SessionState {
    generation: u64,
    credential: Option<Credential>,
    session: Option<AuthSession>,
    image_urls: HashSet<String>,
}

pub struct CmsService {
    client: Client,
    base_url: String,
    vault: Arc<dyn CredentialVault>,
    state: Mutex<SessionState>,
    // 将认证和凭据操作串行化，避免旧操作删除或恢复新凭据。
    auth_operations: Mutex<()>,
    images: ImageLoader,
}

impl CmsService {
    #[cfg(test)]
    pub(super) fn test_timeout(&mut self, duration: Duration) {
        self.client = Client::builder()
            .retry(reqwest::retry::never())
            .timeout(duration)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
    }
    #[cfg(test)]
    pub(super) fn allow_test_images(&mut self) {
        self.images.allow_loopback_http = true;
    }

    pub fn new(directory: &Path) -> Result<Self, reqwest::Error> {
        Self::with_vault(
            "https://newsadmin.nccontrol.com.cn".into(),
            Arc::new(NativeVault {
                disabled_path: directory.join("cms-session-disabled"),
            }),
        )
    }

    pub(super) fn with_vault(
        base_url: String,
        vault: Arc<dyn CredentialVault>,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .retry(reqwest::retry::never())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            base_url,
            vault,
            state: Mutex::new(SessionState::default()),
            auth_operations: Mutex::new(()),
            images: ImageLoader::new()?,
        })
    }

    async fn vault_load(&self) -> Result<Option<String>, CmsError> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.load())
            .await
            .ok()
            .and_then(Result::ok)
            .ok_or_else(|| CmsError::new("CREDENTIAL_STORE", "无法读取安全凭据，请重试或重新登录"))
    }

    async fn vault_clear(&self) -> bool {
        let vault = self.vault.clone();
        matches!(
            tokio::task::spawn_blocking(move || vault.clear()).await,
            Ok(Ok(()))
        )
    }

    async fn vault_save(&self, credential: &Credential) -> bool {
        let Ok(secret) = serde_json::to_string(credential) else {
            return false;
        };
        let vault = self.vault.clone();
        matches!(
            tokio::task::spawn_blocking(move || vault.save(&secret)).await,
            Ok(Ok(()))
        )
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
    }

    fn authenticated(&self, path: &str, credential: &Credential) -> RequestBuilder {
        self.client
            .get(self.endpoint(path))
            .bearer_auth(&credential.access_token)
    }

    async fn send(&self, request: RequestBuilder) -> Result<Value, CmsError> {
        let response = request.send().await.map_err(|error| {
            CmsError::new(
                "CMS_NETWORK",
                if error.is_timeout() {
                    "请求超时，请重试"
                } else {
                    "无法连接新闻后台，请检查网络后重试"
                },
            )
        })?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|_| CmsError::new("CMS_NETWORK", "读取后台响应失败，请重试"))?;
        let value = serde_json::from_str::<Value>(&text).ok();
        let code = value.as_ref().and_then(|v| v.get("code")).map(|v| {
            v.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string())
        });
        if status == StatusCode::UNAUTHORIZED || code.as_deref() == Some("A0230") {
            return Err(CmsError::expired());
        }
        if status == StatusCode::FORBIDDEN {
            return Err(CmsError::new("CMS_FORBIDDEN", "当前账号无权访问此功能"));
        }
        if !status.is_success() || code.as_deref().is_some_and(|v| v != "200") {
            let message = value
                .as_ref()
                .and_then(|v| v.get("msg").or_else(|| v.get("detail")))
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
                .or_else(|| value.as_ref().and_then(|v| v.as_str()))
                .unwrap_or(
                    if value.is_none()
                        && !text.trim().is_empty()
                        && !text.trim_start().starts_with('<')
                    {
                        text.trim()
                    } else if status == StatusCode::BAD_REQUEST {
                        "请求参数无效，请检查输入"
                    } else {
                        "新闻后台请求失败，请稍后重试"
                    },
                );
            return Err(CmsError::new(
                "CMS_REMOTE",
                message.chars().take(200).collect::<String>(),
            ));
        }
        // Logout 允许空响应，读取接口由调用方进一步检查结构。
        Ok(value.unwrap_or(Value::Null))
    }

    fn decode<T: DeserializeOwned>(value: Value) -> Result<T, CmsError> {
        serde_json::from_value(value).map_err(|_| CmsError::invalid())
    }

    async fn current_user(&self, credential: &Credential) -> Result<CmsUser, CmsError> {
        let value = self
            .send(self.authenticated("/api/Account/CurrentUser", credential))
            .await?;
        let user: CmsUser =
            Self::decode(value.get("data").cloned().ok_or_else(CmsError::invalid)?)?;
        if user.user_id <= 0 || user.nickname.is_empty() || user.roles.is_empty() {
            return Err(CmsError::invalid());
        }
        Ok(user)
    }

    pub async fn login(&self, request: LoginRequest) -> Result<AuthSession, CmsError> {
        if request.username.trim().is_empty() || request.password.is_empty() {
            return Err(CmsError::new("VALIDATION", "请输入用户名和密码"));
        }
        let _operation = self.auth_operations.lock().await;
        self.clear_memory().await;
        if !self.vault_clear().await {
            return Err(CmsError::new(
                "CREDENTIAL_STORE",
                "无法禁用原登录凭据，请检查应用数据目录后重试",
            ));
        }
        let value = self.send(self.client.post(self.endpoint("/api/Auth/Login")).json(&json!({
            "username": request.username.trim(), "password": request.password, "name": request.username.trim(),
        }))).await?;
        if value.get("code").and_then(Value::as_str) != Some("200") {
            return Err(CmsError::invalid());
        }
        let credential: Credential =
            Self::decode(value.get("data").cloned().ok_or_else(CmsError::invalid)?)?;
        if !Self::valid_credential(&credential) {
            return Err(CmsError::invalid());
        }
        let user = self.current_user(&credential).await?;
        let persistent = self.vault_save(&credential).await;
        let session = AuthSession { user, persistent };
        let mut state = self.state.lock().await;
        state.credential = Some(credential);
        state.session = Some(session.clone());
        Ok(session)
    }

    fn valid_credential(credential: &Credential) -> bool {
        credential.token_type == "Bearer"
            && !credential.access_token.trim().is_empty()
            && !credential.access_token.contains(['\r', '\n'])
    }

    pub async fn restore_session(&self) -> Result<Option<AuthSession>, CmsError> {
        let _operation = self.auth_operations.lock().await;
        let active = {
            let state = self.state.lock().await;
            state
                .credential
                .clone()
                .zip(state.session.as_ref().map(|s| s.persistent))
        };
        let (credential, persistent) = if let Some(active) = active {
            active
        } else {
            let Some(secret) = self.vault_load().await? else {
                return Ok(None);
            };
            let credential: Credential = match serde_json::from_str(&secret) {
                Ok(value) => value,
                Err(_) => {
                    self.vault_clear().await;
                    return Ok(None);
                }
            };
            (credential, true)
        };
        if !Self::valid_credential(&credential) {
            self.clear_memory().await;
            self.vault_clear().await;
            return Ok(None);
        }
        match self.current_user(&credential).await {
            Ok(user) => {
                let session = AuthSession { user, persistent };
                let mut state = self.state.lock().await;
                state.generation += 1;
                state.image_urls.clear();
                state.credential = Some(credential);
                state.session = Some(session.clone());
                Ok(Some(session))
            }
            Err(error) if error.code == "AUTH_EXPIRED" => {
                self.clear_memory().await;
                self.vault_clear().await;
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    async fn clear_memory(&self) {
        let mut state = self.state.lock().await;
        state.generation += 1;
        state.credential = None;
        state.session = None;
        state.image_urls.clear();
    }

    pub async fn logout(&self) -> LogoutResult {
        let _operation = self.auth_operations.lock().await;
        let credential = self.state.lock().await.credential.clone();
        self.clear_memory().await;
        let credentials_cleared = self.vault_clear().await;
        let remote_succeeded = if let Some(credential) = credential {
            self.send(
                self.client
                    .delete(self.endpoint("/api/Auth/Logout"))
                    .bearer_auth(&credential.access_token),
            )
            .await
            .is_ok()
        } else {
            true
        };
        LogoutResult {
            remote_succeeded,
            credentials_cleared,
        }
    }

    pub async fn authorize(&self) -> Result<u64, CmsError> {
        let state = self.state.lock().await;
        if state.session.is_none() {
            return Err(CmsError::expired());
        }
        Ok(state.generation)
    }

    pub async fn ensure_generation(&self, generation: u64) -> Result<(), CmsError> {
        let state = self.state.lock().await;
        if state.generation != generation || state.session.is_none() {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化，请重试"));
        }
        Ok(())
    }

    async fn snapshot(&self) -> Result<(u64, Credential), CmsError> {
        let state = self.state.lock().await;
        let credential = state.credential.clone().ok_or_else(CmsError::expired)?;
        Ok((state.generation, credential))
    }

    async fn get(
        &self,
        path: &str,
        query: &impl serde::Serialize,
        generation: u64,
        credential: &Credential,
    ) -> Result<Value, CmsError> {
        let result = self
            .send(self.authenticated(path, credential).query(query))
            .await;
        if result
            .as_ref()
            .is_err_and(|error| error.code == "AUTH_EXPIRED")
        {
            let _operation = self.auth_operations.lock().await;
            self.ensure_generation(generation).await?;
            self.clear_memory().await;
            self.vault_clear().await;
            return Err(CmsError::expired());
        }
        self.ensure_generation(generation).await?;
        result
    }

    pub async fn list_channels(&self) -> Result<Vec<ChannelGroup>, CmsError> {
        let (generation, credential) = self.snapshot().await?;
        let mut groups: Vec<ChannelGroup> = Vec::new();
        let mut current = 1_u32;
        let mut count = 0_u64;
        loop {
            let value = self
                .get(
                    "/api/PromoteChannel",
                    &[("current", current), ("pagesize", 200)],
                    generation,
                    &credential,
                )
                .await?;
            let page: ChannelPage = Self::decode(value)?;
            let size = page.data.len();
            count += size as u64;
            for row in page.data {
                let Some(channel) = row.channel.filter(|v| !v.is_empty()) else {
                    continue;
                };
                let index = groups.iter().position(|group| group.channel == channel);
                let group = if let Some(index) = index {
                    &mut groups[index]
                } else {
                    groups.push(ChannelGroup {
                        channel,
                        subchannels: Vec::new(),
                    });
                    groups.last_mut().expect("just inserted a channel")
                };
                if let Some(subchannel) = row.subchannel.filter(|v| !v.is_empty())
                    && !group.subchannels.contains(&subchannel)
                {
                    group.subchannels.push(subchannel);
                }
            }
            if size == 0 || size < 200 || count >= page.total {
                break;
            }
            current = current.checked_add(1).ok_or_else(CmsError::invalid)?;
        }
        self.ensure_generation(generation).await?;
        Ok(groups)
    }

    pub async fn list_data(&self, query: PromoteQuery) -> Result<PromotePage, CmsError> {
        if query.current == 0
            || ![10, 20, 30, 50].contains(&query.pagesize)
            || (!query.publishdate.is_empty()
                && (query.publishdate.len() != 10
                    || chrono::NaiveDate::parse_from_str(&query.publishdate, "%Y-%m-%d").is_err()))
            || (query.channel.is_empty() && !query.subchannel.is_empty())
        {
            return Err(CmsError::new("VALIDATION", "素材筛选参数无效"));
        }
        let (generation, credential) = self.snapshot().await?;
        let value = self
            .get("/api/PromoteData", &query, generation, &credential)
            .await?;
        let page: PromotePage = Self::decode(value)?;
        if page.current != query.current
            || page.page_size != query.pagesize
            || page.data.len() > query.pagesize as usize
        {
            return Err(CmsError::invalid());
        }
        let mut state = self.state.lock().await;
        if state.generation != generation || state.session.is_none() {
            return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化，请重试"));
        }
        for row in &page.data {
            for url in [&row.title_pic, &row.title_pic2].into_iter().flatten() {
                if self.images.accepts(url) {
                    state.image_urls.insert(url.clone());
                }
            }
        }
        Ok(page)
    }

    pub async fn load_image(&self, url: String) -> Result<PromoteImage, CmsError> {
        let generation = {
            let state = self.state.lock().await;
            if state.session.is_none() {
                return Err(CmsError::expired());
            }
            if !state.image_urls.contains(&url) || !self.images.accepts(&url) {
                return Err(CmsError::new(
                    "IMAGE_URL",
                    "仅可加载本次会话素材列表中的 HTTPS 图片",
                ));
            }
            state.generation
        };
        let result = self.images.load(&url).await;
        self.ensure_generation(generation).await?;
        result
    }
}
