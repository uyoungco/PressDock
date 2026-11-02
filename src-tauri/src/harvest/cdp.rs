use super::{
    source::{SNAPSHOT, Snapshot},
    *,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};

fn disconnected() -> HarvestError {
    HarvestError::new(
        "HARVEST_CDP_CLOSED",
        "浏览器连接已断开，请保持浏览器打开并重试",
    )
}
fn invalid_endpoint() -> HarvestError {
    HarvestError::invalid(
        "请填写数据目录、HTTP/HTTPS 调试入口或浏览器级 WS/WSS 地址，不能使用 /devtools/page/ 地址",
    )
}
fn websocket_endpoint(address: &str) -> Result<String, HarvestError> {
    let url = url::Url::parse(address).map_err(|_| invalid_endpoint())?;
    if !matches!(url.scheme(), "ws" | "wss")
        || url.host_str().is_none()
        || url.port() == Some(0)
        || !url.path().starts_with("/devtools/browser/")
    {
        return Err(invalid_endpoint());
    }
    Ok(url.into())
}

// 与 ArticleHarvest 一致：优先读调试连接文件，手动 HTTP 入口仅用于已经开放该入口的实例。
async fn endpoint(app: &AppHandle, options: &Options) -> Result<String, HarvestError> {
    let address = options
        .cdp_address
        .as_deref()
        .unwrap_or("")
        .trim()
        .trim_matches(['\'', '"']);
    if address.starts_with("ws://") || address.starts_with("wss://") {
        return websocket_endpoint(address);
    }
    if address.starts_with("http://") || address.starts_with("https://") {
        let mut url = url::Url::parse(address).map_err(|_| invalid_endpoint())?;
        if url.host_str().is_none() || url.port() == Some(0) {
            return Err(invalid_endpoint());
        }
        if !url.path().ends_with("/json/version") {
            url.set_path(&format!(
                "{}/json/version",
                url.path().trim_end_matches('/')
            ));
        }
        // 专用客户端不继承 CMS 或系统代理，调试端口始终直接连接。
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| HarvestError::new("HARVEST_CDP_CONNECT", "无法创建浏览器调试连接"))?;
        let data: Value = client
            .get(url)
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|_| {
                HarvestError::new(
                    "HARVEST_CDP_CONNECT",
                    "无法读取浏览器调试入口，请检查地址并开启远程调试",
                )
            })?
            .json()
            .await
            .map_err(|_| invalid_endpoint())?;
        return websocket_endpoint(
            data["webSocketDebuggerUrl"]
                .as_str()
                .ok_or_else(invalid_endpoint)?,
        );
    }
    let home = app.path().home_dir().map_err(|_| {
        HarvestError::new(
            "HARVEST_CDP_CONNECT",
            "无法定位用户目录，请手动填写浏览器数据目录",
        )
    })?;
    let directory = if address.is_empty() {
        #[cfg(target_os = "windows")]
        {
            PathBuf::from(
                std::env::var_os("LOCALAPPDATA")
                    .unwrap_or_else(|| home.join("AppData/Local").into_os_string()),
            )
            .join(match options.cdp_browser {
                CdpBrowser::Chrome => "Google/Chrome/User Data",
                CdpBrowser::Edge => "Microsoft/Edge/User Data",
            })
        }
        #[cfg(target_os = "macos")]
        {
            home.join("Library/Application Support")
                .join(match options.cdp_browser {
                    CdpBrowser::Chrome => "Google/Chrome",
                    CdpBrowser::Edge => "Microsoft Edge",
                })
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            return Err(HarvestError::invalid(
                "自动发现支持 Windows 和 macOS，请手动填写浏览器数据目录或 CDP 地址",
            ));
        }
    } else {
        let variables = regex::Regex::new(r"\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([^%]+)%")
            .expect("固定环境变量表达式");
        let expanded = variables.replace_all(address, |captures: &regex::Captures<'_>| {
            let key = captures
                .iter()
                .skip(1)
                .flatten()
                .next()
                .expect("环境变量名称")
                .as_str();
            std::env::var(key).unwrap_or_else(|_| captures[0].to_string())
        });
        if expanded == "~" {
            home
        } else if expanded.starts_with("~/") || expanded.starts_with("~\\") {
            home.join(&expanded[2..])
        } else {
            PathBuf::from(expanded.as_ref())
        }
    };
    let file = if directory
        .file_name()
        .is_some_and(|name| name == "DevToolsActivePort")
    {
        directory
    } else {
        directory.join("DevToolsActivePort")
    };
    let text = tokio::fs::read_to_string(file).await.map_err(|_| {
        HarvestError::new(
            "HARVEST_CDP_CONNECT",
            "无法发现浏览器，请确认所选浏览器已运行并开启远程调试，或手动填写数据目录/CDP 地址",
        )
    })?;
    let mut lines = text.lines();
    let port: u16 = lines
        .next()
        .unwrap_or("")
        .trim()
        .parse()
        .map_err(|_| invalid_endpoint())?;
    let path = lines.next().unwrap_or("").trim();
    if port == 0 || !path.starts_with("/devtools/browser/") {
        return Err(invalid_endpoint());
    }
    websocket_endpoint(&format!("ws://127.0.0.1:{port}{path}"))
}

#[derive(Clone)]
struct ConnectionState {
    connected: bool,
    active: Option<(String, String)>,
    page_closed: bool,
    candidates: Vec<String>,
    oversized: bool,
}
type Replies = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

// 取消/超时会丢弃等待中的调用；删除对应 ID，迟到的响应不会误投到下一条命令。
struct PendingReply {
    id: u64,
    replies: Replies,
}
impl Drop for PendingReply {
    fn drop(&mut self) {
        self.replies.lock().expect("CDP 响应锁").remove(&self.id);
    }
}
pub(super) struct Client {
    commands: mpsc::UnboundedSender<Message>,
    next_id: AtomicU64,
    replies: Replies,
    state: watch::Sender<ConnectionState>,
    reader: tokio::task::AbortHandle,
}
impl Drop for Client {
    fn drop(&mut self) {
        self.reader.abort();
    }
}
impl Client {
    async fn connect(app: &AppHandle, options: &Options) -> Result<Arc<Self>, HarvestError> {
        let endpoint = endpoint(app, options).await?;
        let mut request = endpoint
            .into_client_request()
            .map_err(|_| invalid_endpoint())?;
        request
            .headers_mut()
            .insert("User-Agent", "PressDock".parse().expect("固定请求头"));
        // tokio-tungstenite 直接创建 TCP/TLS 连接，不从代理环境选择网络路径。
        let (socket, _) = tokio::time::timeout(
            Duration::from_secs(60),
            tokio_tungstenite::connect_async(request),
        )
        .await
        .map_err(|_| {
            HarvestError::new(
                "HARVEST_CDP_CONNECT",
                "连接浏览器超时，请在浏览器连接请求中点击允许",
            )
        })?
        .map_err(|_| {
            HarvestError::new(
                "HARVEST_CDP_CONNECT",
                "无法连接浏览器，请检查调试地址并允许浏览器的连接请求",
            )
        })?;
        let (mut writer, mut reader) = socket.split();
        let (commands, mut outgoing) = mpsc::unbounded_channel();
        let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
        let pending = replies.clone();
        let (state, _) = watch::channel(ConnectionState {
            connected: true,
            active: None,
            page_closed: false,
            candidates: Vec::new(),
            oversized: false,
        });
        let events = state.clone();
        // 独立接收循环在等待用户时也持续工作，使断线/关闭事件能唤醒采集任务。
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    command = outgoing.recv() => {
                        let Some(command) = command else { break; };
                        if writer.send(command).await.is_err() { break; }
                    },
                    message = reader.next() => {
                        let Some(Ok(message)) = message else { break; };
                        match message {
                            Message::Text(text) => {
                                if text.len() > 10 * 1024 * 1024 {
                                    events.send_modify(|state| state.oversized = true);
                                    break;
                                }
                                let Ok(value) = serde_json::from_str::<Value>(&text) else { break; };
                                if !value.is_object() { break; }
                                if let Some(id) = value["id"].as_u64() {
                                    let reply = pending.lock().expect("CDP 响应锁").remove(&id);
                                    if let Some(reply) = reply { let _ = reply.send(value); }
                                } else {
                                    events.send_if_modified(|state| {
                                        if value["method"] == "Target.targetDestroyed" && let Some(target) = value["params"]["targetId"].as_str() {
                                            let count = state.candidates.len();
                                            state.candidates.retain(|candidate| candidate != target);
                                            if count != state.candidates.len() && state.candidates.is_empty() {
                                                state.page_closed = true;
                                                return true;
                                            }
                                        }
                                        if let Some((target, session)) = &state.active {
                                            let closed = match value["method"].as_str() {
                                                Some("Target.targetDestroyed") => value["params"]["targetId"].as_str() == Some(target),
                                                Some("Target.detachedFromTarget") => value["params"]["sessionId"].as_str() == Some(session),
                                                Some("Inspector.detached") => value["sessionId"].as_str() == Some(session),
                                                _ => false,
                                            };
                                            if closed && !state.page_closed {
                                                state.page_closed = true;
                                                return true;
                                            }
                                        }
                                        false
                                    });
                                }
                            },
                            Message::Ping(payload) => { if writer.send(Message::Pong(payload)).await.is_err() { break; } },
                            Message::Close(_) => break,
                            _ => {},
                        }
                    }
                }
            }
            events.send_modify(|state| state.connected = false);
            pending.lock().expect("CDP 响应锁").clear();
        });
        let client = Arc::new(Self {
            commands,
            next_id: AtomicU64::new(1),
            replies,
            state,
            reader: task.abort_handle(),
        });
        client
            .call(
                "Target.setDiscoverTargets",
                json!({"discover":true}),
                None,
                Duration::from_secs(60),
            )
            .await?;
        Ok(client)
    }
    pub(super) fn close(&self) {
        self.reader.abort();
        self.state.send_modify(|state| state.connected = false);
        self.replies.lock().expect("CDP 响应锁").clear();
    }
    fn ensure_open(&self) -> Result<(), HarvestError> {
        let state = self.state.borrow();
        if state.oversized {
            return Err(HarvestError::new(
                "HARVEST_PAGE_LIMIT",
                "来源页面快照超过 10 MiB",
            ));
        }
        if !state.connected {
            return Err(disconnected());
        }
        if state.page_closed {
            return Err(HarvestError::new(
                "HARVEST_CDP_CLOSED",
                "采集标签页已关闭或调试会话已断开，请重试",
            ));
        }
        Ok(())
    }
    async fn closed(&self) -> HarvestError {
        let mut state = self.state.subscribe();
        loop {
            if let Err(error) = self.ensure_open() {
                return error;
            }
            if state.changed().await.is_err() {
                return disconnected();
            }
        }
    }
    async fn call(
        &self,
        method: &str,
        params: Value,
        session: Option<&str>,
        timeout: Duration,
    ) -> Result<Value, HarvestError> {
        self.ensure_open()?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.replies.lock().expect("CDP 响应锁").insert(id, tx);
        let _pending = PendingReply {
            id,
            replies: self.replies.clone(),
        };
        let mut command = json!({"id":id,"method":method,"params":params});
        if let Some(session) = session {
            command["sessionId"] = session.into();
        }
        self.commands
            .send(Message::Text(command.to_string().into()))
            .map_err(|_| disconnected())?;
        let mut response = tokio::time::timeout(timeout, rx)
            .await
            .map_err(|_| {
                HarvestError::new(
                    "HARVEST_CDP_TIMEOUT",
                    format!("等待浏览器执行 {method} 超时"),
                )
            })?
            .map_err(|_| self.ensure_open().err().unwrap_or_else(disconnected))?;
        if let Some(error) = response.get("error") {
            let detail = error["message"].as_str().unwrap_or("未知协议错误");
            // 页面导航可能临时销毁上下文；只有这些情况允许在正文等待期限内重读。
            let transient = [
                "Execution context was destroyed",
                "Cannot find context",
                "Cannot find default execution context",
                "Inspected target navigated",
            ]
            .iter()
            .any(|part| detail.contains(part));
            return Err(HarvestError::new(
                if transient {
                    "HARVEST_CDP_NAVIGATION"
                } else {
                    "HARVEST_CDP_PROTOCOL"
                },
                format!("浏览器执行 {method} 失败：{detail}"),
            ));
        }
        let result = response
            .get_mut("result")
            .filter(|value| value.is_object())
            .ok_or_else(|| HarvestError::new("HARVEST_CDP_DATA", "浏览器返回了无效的 CDP 响应"))?;
        // DOM 快照可达 10 MiB，转移 JSON 所有权，避免在协议层复制整篇正文。
        Ok(result.take())
    }
    pub(super) async fn tabs(&self) -> Result<Vec<SourceTab>, HarvestError> {
        let value = self
            .call(
                "Target.getTargets",
                json!({}),
                None,
                Duration::from_secs(10),
            )
            .await?;
        let entries = value["targetInfos"]
            .as_array()
            .ok_or_else(|| HarvestError::new("HARVEST_CDP_DATA", "浏览器未返回有效的标签页列表"))?;
        entries
            .iter()
            .filter(|entry| entry["type"] == "page")
            .map(|entry| {
                serde_json::from_value(entry.clone())
                    .map_err(|_| HarvestError::new("HARVEST_CDP_DATA", "浏览器标签页信息格式无效"))
            })
            .collect()
    }
    fn clear_active(&self) {
        self.state.send_modify(|state| {
            state.active = None;
            state.page_closed = false;
            state.candidates.clear();
        });
    }
}

pub(super) struct Browser {
    browser: CdpBrowser,
    address: Option<String>,
    generation: u64,
    client: Arc<Client>,
    aliases: Arc<Mutex<HashMap<String, (String, String)>>>,
}
impl Browser {
    pub(super) fn close(&self) {
        self.client.close();
    }
}
#[derive(Clone)]
pub(super) struct Active {
    pub client: Arc<Client>,
    pub target_id: String,
    pub session_id: String,
}
impl Active {
    pub async fn show(&self) -> Result<(), HarvestError> {
        self.client
            .call(
                "Target.activateTarget",
                json!({"targetId":self.target_id}),
                None,
                Duration::from_secs(10),
            )
            .await?;
        Ok(())
    }
}
fn url_key(value: &str) -> String {
    url::Url::parse(value)
        .map(|mut url| {
            url.set_fragment(None);
            String::from(url)
        })
        .unwrap_or_else(|_| value.to_string())
}
pub(super) struct Page {
    client: Arc<Client>,
    aliases: Arc<Mutex<HashMap<String, (String, String)>>>,
    active: Option<Active>,
    requested: String,
    attaching: bool,
}
impl Page {
    pub async fn new(
        app: &AppHandle,
        context: &worker::Context,
        options: &Options,
    ) -> Result<Self, HarvestError> {
        let service = app.state::<HarvestService>();
        let mut cached = service.cdp.lock().await;
        let address = options
            .cdp_address
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let reusable = cached.as_ref().is_some_and(|browser| {
            browser.browser == options.cdp_browser
                && browser.address == address
                && browser.generation == context.generation
                && browser.client.state.borrow().connected
        });
        if !reusable {
            if let Some(browser) = cached.take() {
                browser.close();
            }
            let client = Client::connect(app, options).await?;
            *cached = Some(Browser {
                browser: options.cdp_browser,
                address,
                generation: context.generation,
                client,
                aliases: Arc::new(Mutex::new(HashMap::new())),
            });
        }
        let browser = cached.as_ref().expect("已连接的浏览器");
        browser.client.clear_active();
        *context.cdp_client.lock().expect("活动 CDP 连接锁") = Some(browser.client.clone());
        Ok(Self {
            client: browser.client.clone(),
            aliases: browser.aliases.clone(),
            active: None,
            requested: String::new(),
            attaching: false,
        })
    }
    pub async fn open(
        &mut self,
        app: &AppHandle,
        context: &worker::Context,
        url: &url::Url,
    ) -> Result<(), HarvestError> {
        self.detach().await;
        *context.cdp_target.lock().expect("活动 CDP 标签页锁") = None;
        let key = url_key(url.as_str());
        let mut tabs = self
            .client
            .tabs()
            .await?
            .into_iter()
            .filter(|tab| url_key(&tab.url) == key)
            .collect::<Vec<_>>();
        if tabs.is_empty() {
            let alias = self.aliases.lock().expect("CDP 别名锁").get(&key).cloned();
            if let Some((target, final_url)) = alias {
                tabs = self
                    .client
                    .tabs()
                    .await?
                    .into_iter()
                    .filter(|tab| tab.target_id == target && url_key(&tab.url) == final_url)
                    .collect();
                if tabs.is_empty() {
                    self.aliases.lock().expect("CDP 别名锁").remove(&key);
                }
            }
        }
        let target_id = match tabs.len() {
            0 => self
                .client
                .call(
                    "Target.createTarget",
                    json!({"url":url.as_str(),"background":true}),
                    None,
                    Duration::from_secs(10),
                )
                .await?["targetId"]
                .as_str()
                .ok_or_else(|| HarvestError::new("HARVEST_CDP_DATA", "浏览器未返回新建标签页标识"))?
                .to_string(),
            1 => tabs[0].target_id.clone(),
            _ => {
                // 候选只放在当前任务上下文，用户离开导入页后仍可回来继续选择。
                self.client.state.send_modify(|state| {
                    state.candidates = tabs.iter().map(|tab| tab.target_id.clone()).collect()
                });
                context.selected_tab.send_replace(None);
                let mut selection = context.selected_tab.subscribe();
                context
                    .source_interaction
                    .send_replace(Some(SourceInteraction::SelectTab { tabs }));
                context
                    .progress(app, Status::WaitingUser, Stage::Collecting)
                    .await?;
                let target = tokio::select! {
                    choice = selection.wait_for(|choice| choice.is_some()) => choice.map_err(|_| disconnected())?.clone().expect("已选择的标签页"),
                    error = self.client.closed() => return Err(error),
                };
                context.source_interaction.send_replace(None);
                context
                    .progress(app, Status::Running, Stage::Collecting)
                    .await?;
                target
            }
        };
        self.client.clear_active();
        self.attaching = true;
        let response = self
            .client
            .call(
                "Target.attachToTarget",
                json!({"targetId":target_id,"flatten":true}),
                None,
                Duration::from_secs(10),
            )
            .await?;
        let session_id = response["sessionId"]
            .as_str()
            .ok_or_else(|| HarvestError::new("HARVEST_CDP_DATA", "浏览器未返回调试会话标识"))?
            .to_string();
        self.client.state.send_modify(|state| {
            state.active = Some((target_id.clone(), session_id.clone()));
            state.page_closed = false;
        });
        self.attaching = false;
        let active = Active {
            client: self.client.clone(),
            target_id,
            session_id,
        };
        *context.cdp_target.lock().expect("活动 CDP 标签页锁") = Some(active.clone());
        self.active = Some(active);
        self.requested = key;
        Ok(())
    }
    pub async fn snapshot(&self) -> Result<Snapshot, HarvestError> {
        let active = self.active.as_ref().expect("已打开的采集标签页");
        let mut value = self
            .client
            .call(
                "Runtime.evaluate",
                json!({"expression":SNAPSHOT,"returnByValue":true}),
                Some(&active.session_id),
                Duration::from_secs(5),
            )
            .await?;
        if value.get("exceptionDetails").is_some() {
            return Err(HarvestError::new(
                "HARVEST_CDP_SCRIPT",
                "读取页面脚本失败，请确认浏览器允许脚本执行",
            ));
        }
        let snapshot: Snapshot = serde_json::from_value(value["result"]["value"].take())
            .map_err(|_| HarvestError::new("HARVEST_CDP_DATA", "来源页面快照格式无效"))?;
        if !snapshot.html.is_empty() {
            source_url(&snapshot.url)?;
            self.aliases.lock().expect("CDP 别名锁").insert(
                self.requested.clone(),
                (active.target_id.clone(), url_key(&snapshot.url)),
            );
        }
        Ok(snapshot)
    }
    pub fn ensure_open(&self) -> Result<(), HarvestError> {
        self.client.ensure_open()
    }
    pub async fn show(&self) -> Result<(), HarvestError> {
        self.active
            .as_ref()
            .expect("已打开的采集标签页")
            .show()
            .await
    }
    pub async fn closed(&self) -> HarvestError {
        self.client.closed().await
    }
    async fn detach(&mut self) {
        if let Some(active) = self.active.take() {
            self.client.clear_active();
            let _ = self
                .client
                .call(
                    "Target.detachFromTarget",
                    json!({"sessionId":active.session_id}),
                    None,
                    Duration::from_secs(2),
                )
                .await;
        }
    }
}
impl Drop for Page {
    fn drop(&mut self) {
        // 取消若发生在 attach 响应前，尚不知道 sessionId，关闭本程序连接以释放未知会话。
        if self.attaching {
            self.client.close();
        }
        // 外层 worker 通过丢弃 future 取消任务，仍需释放调试会话；绝不关闭用户标签页。
        if let Some(active) = self.active.take() {
            self.client.clear_active();
            tauri::async_runtime::spawn(async move {
                let _ = active
                    .client
                    .call(
                        "Target.detachFromTarget",
                        json!({"sessionId":active.session_id}),
                        None,
                        Duration::from_secs(2),
                    )
                    .await;
            });
        }
    }
}

pub(super) async fn select_tab(
    app: &AppHandle,
    context: &worker::Context,
    target_id: &str,
) -> Result<(), HarvestError> {
    let candidates = match context.source_interaction.borrow().clone() {
        Some(SourceInteraction::SelectTab { tabs }) => tabs,
        _ => return Err(HarvestError::invalid("当前任务没有等待选择标签页")),
    };
    let selected = candidates
        .iter()
        .find(|tab| tab.target_id == target_id)
        .ok_or_else(|| HarvestError::invalid("请选择当前任务的候选标签页"))?;
    let client = context
        .cdp_client
        .lock()
        .expect("活动 CDP 连接锁")
        .clone()
        .ok_or_else(disconnected)?;
    let current = client.tabs().await?;
    // 提交时重新核对真实 URL，防止候选页在弹窗打开期间被关闭或导航到另一篇文章。
    let valid = current
        .into_iter()
        .filter(|tab| {
            candidates.iter().any(|candidate| {
                candidate.target_id == tab.target_id && url_key(&candidate.url) == url_key(&tab.url)
            })
        })
        .collect::<Vec<_>>();
    if !valid.iter().any(|tab| tab.target_id == selected.target_id) {
        context
            .source_interaction
            .send_replace(Some(SourceInteraction::SelectTab { tabs: valid }));
        worker::changed(app);
        return Err(HarvestError::invalid(
            "所选标签页已关闭或地址已变化，请重新选择或取消后重试",
        ));
    }
    context
        .selected_tab
        .send_replace(Some(target_id.to_string()));
    Ok(())
}
