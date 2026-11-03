use super::{EnqueueRequest, HarvestError, HarvestService};
use crate::error::CommandError;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    Method, Request, Response, StatusCode, body::Bytes, server::conn::http1, service::service_fn,
};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::{convert::Infallible, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager, async_runtime::JoinHandle};
use tokio::{net::TcpListener, task::JoinSet};

const ADDRESS: &str = "127.0.0.1:18765";
pub(crate) const INSTALL_URL: &str = "http://127.0.0.1:18765/pressdock-import.user.js";
const SCRIPT: &str = include_str!("../../../userscripts/pressdock-import.user.js");
const MAX_BODY: usize = 16 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeInfo {
    pub running: bool,
    pub error: Option<String>,
}

pub(crate) struct Bridge {
    pub info: BridgeInfo,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl Bridge {
    pub(crate) async fn start(app: AppHandle) -> Self {
        // 端口占用只禁用油猴入口，不中断数据库、窗口和原有采集队列的启动。
        let listener = TcpListener::bind(ADDRESS).await;
        let (info, task) = match listener {
            Ok(listener) => {
                let task = tauri::async_runtime::spawn(async move {
                    // JoinSet 随监听任务销毁时中止连接，退出后不遗留待入队请求。
                    let mut connections = JoinSet::new();
                    loop {
                        tokio::select! {
                            accepted = listener.accept() => {
                                let Ok((stream, peer)) = accepted else { break };
                                if !peer.ip().is_loopback() || connections.len() >= 32 {
                                    continue;
                                }
                                let app = app.clone();
                                connections.spawn(async move {
                                    let service = service_fn(move |request| {
                                        let app = app.clone();
                                        async move { Ok::<_, Infallible>(route(&app, request).await) }
                                    });
                                    let mut builder = http1::Builder::new();
                                    builder.keep_alive(false).max_buf_size(16 * 1024);
                                    let _ = tokio::time::timeout(
                                        Duration::from_secs(15),
                                        builder.serve_connection(TokioIo::new(stream), service),
                                    ).await;
                                });
                            }
                            _ = connections.join_next(), if !connections.is_empty() => {}
                        }
                    }
                });
                (
                    BridgeInfo {
                        running: true,
                        error: None,
                    },
                    Some(task),
                )
            }
            Err(error) => (
                BridgeInfo {
                    running: false,
                    error: Some(format!(
                        "无法启动油猴连接（{ADDRESS}）：{error}。请释放端口后重启 PressDock。"
                    )),
                },
                None,
            ),
        };
        Self {
            info,
            task: Mutex::new(task),
        }
    }

    pub(crate) fn stop(&self) {
        if let Some(task) = self.task.lock().expect("油猴连接任务锁").take() {
            task.abort();
        }
    }
}

fn response(
    status: StatusCode,
    content_type: &'static str,
    body: impl Into<Bytes>,
) -> Response<Full<Bytes>> {
    // 不设置任何 CORS 许可，普通网页无法通过预检发送带客户端标识的请求。
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Full::new(body.into()))
        .expect("固定 HTTP 响应头")
}

fn json(status: StatusCode, value: impl Serialize) -> Response<Full<Bytes>> {
    response(
        status,
        "application/json; charset=utf-8",
        serde_json::to_vec(&value).expect("HTTP DTO 可序列化"),
    )
}

fn error(status: StatusCode, code: &'static str, message: &str) -> Response<Full<Bytes>> {
    json(status, CommandError::from(HarvestError::new(code, message)))
}

async fn route(app: &AppHandle, request: Request<hyper::body::Incoming>) -> Response<Full<Bytes>> {
    // Host 精确匹配固定回环地址，阻止 DNS 重绑定；静态安装脚本也遵循此约束。
    if request.headers().get("host").and_then(|v| v.to_str().ok()) != Some(ADDRESS) {
        return error(
            StatusCode::FORBIDDEN,
            "BRIDGE_HOST",
            "仅接受 PressDock 本机地址",
        );
    }
    if request.method() == Method::GET && request.uri().path() == "/pressdock-import.user.js" {
        return response(StatusCode::OK, "text/javascript; charset=utf-8", SCRIPT);
    }
    if request.uri().path() != "/api/v1/harvest" {
        return error(StatusCode::NOT_FOUND, "NOT_FOUND", "接口不存在");
    }
    if request.method() != Method::POST {
        return error(
            StatusCode::METHOD_NOT_ALLOWED,
            "BRIDGE_METHOD",
            "仅支持 POST 导入请求",
        );
    }
    let headers = request.headers();
    if headers
        .get("x-pressdock-client")
        .and_then(|v| v.to_str().ok())
        != Some("userscript-v1")
    {
        return error(StatusCode::FORBIDDEN, "BRIDGE_CLIENT", "缺少油猴客户端标识");
    }
    if !headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
        })
    {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "BRIDGE_CONTENT_TYPE",
            "请求须为 JSON",
        );
    }
    // 流式限制实际接收大小，不仅检查可伪造的 Content-Length。
    let bytes = match tokio::time::timeout(
        Duration::from_secs(5),
        Limited::new(request.into_body(), MAX_BODY).collect(),
    )
    .await
    {
        Ok(Ok(body)) => body.to_bytes(),
        Ok(Err(_)) => {
            return error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "BRIDGE_BODY",
                "请求体无效或超过 16 KiB",
            );
        }
        Err(_) => {
            return error(
                StatusCode::REQUEST_TIMEOUT,
                "BRIDGE_TIMEOUT",
                "读取导入请求超时",
            );
        }
    };
    let request: EnqueueRequest = match serde_json::from_slice(&bytes) {
        Ok(request) => request,
        Err(_) => {
            return error(
                StatusCode::BAD_REQUEST,
                "VALIDATION",
                "导入请求须包含有效的 id 和 url",
            );
        }
    };
    match app.state::<HarvestService>().enqueue(app, &request).await {
        Ok(job) => json(
            StatusCode::OK,
            serde_json::json!({
                "jobId": job.id, "status": job.status, "collectionDate": job.collection_date,
            }),
        ),
        Err(err) => {
            let status = match err.code {
                "AUTH_EXPIRED" => StatusCode::UNAUTHORIZED,
                "SESSION_CHANGED" => StatusCode::CONFLICT,
                "VALIDATION" => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            json(status, CommandError::from(err))
        }
    }
}
