#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
const LABEL: &str = "photocraft";

// 使用上游实际偏好字段设置默认简体中文，仅替换“自动”或尚未配置的语言。
// 保留其他偏好及用户明确选择的语言；不修改原始发布包或主窗口浏览器配置。
#[cfg(desktop)]
const DEFAULT_LANGUAGE: &str = r#"(() => {
  try {
    const key = 'photocraft.preferences';
    const preferences = JSON.parse(localStorage.getItem(key) || '{}');
    if (preferences.interface?.language && preferences.interface.language !== 'auto') return;
    preferences.interface = {...preferences.interface, language: 'zh-hans'};
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    // 浏览器偏好不可用时交由上游按默认值启动，不阻断工具加载。
    console.warn('PhotoCraft 默认语言初始化失败');
  }
})()"#;

#[cfg(desktop)]
pub(crate) fn open(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::{WebviewUrl, WebviewWindowBuilder, webview::DownloadEvent};
    use tauri_plugin_dialog::DialogExt;

    if let Some(window) = app.get_webview_window(LABEL) {
        // 聚焦已有实例而不重新导航，保留未保存的编辑内容。
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let window = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::CustomProtocol(
            "photocraft://localhost/"
                .parse()
                .expect("固定 PhotoCraft URL"),
        ),
    )
    .title("PhotoCraft")
    .inner_size(1280., 800.)
    .min_inner_size(900., 600.)
    .use_https_scheme(true)
    .initialization_script(DEFAULT_LANGUAGE)
    // 由网页接收图片拖放与剪贴板操作，不由 Tauri 拦截为应用事件。
    .disable_drag_drop_handler()
    .enable_clipboard_access()
    .on_download(|webview, event| match event {
        // 网页保存和导出生成 Blob，沿用系统下载目录与内核重名处理。
        DownloadEvent::Requested { url, .. } => url.scheme() == "blob",
        DownloadEvent::Finished { success: false, .. } => {
            webview
                .dialog()
                .message("文件下载失败，请检查系统下载目录后重新导出。")
                .title("PhotoCraft 导出失败")
                .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                .show(|_| {});
            true
        }
        _ => true,
    })
    .build()?;
    window.set_focus()
}

#[cfg(desktop)]
pub(crate) fn resource(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    use std::borrow::Cow;
    use tauri::http::{Method, Response, StatusCode};

    // 使用精确资源表，既不读取任意磁盘路径，也不依赖 Vite 或主窗口 CSP。
    macro_rules! asset {
        ($path:literal) => {
            include_bytes!(concat!("../../vendor/photocraft-web-0.23.1/", $path)).as_slice()
        };
    }
    let (status, mime, body): (_, _, &[u8]) = if context.webview_label() != LABEL {
        (StatusCode::FORBIDDEN, "text/plain", b"Forbidden")
    } else if !matches!(*request.method(), Method::GET | Method::HEAD) {
        (
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain",
            b"Method not allowed",
        )
    } else {
        let file = match request.uri().path() {
            "/" | "/index.html" => Some(("text/html; charset=utf-8", asset!("index.html"))),
            "/photocraft-web-boot-f1b57f4718fcff8.js" => Some((
                "text/javascript",
                asset!("photocraft-web-boot-f1b57f4718fcff8.js"),
            )),
            "/photocraft-web-boot-f1b57f4718fcff8_bg.wasm" => Some((
                "application/wasm",
                asset!("photocraft-web-boot-f1b57f4718fcff8_bg.wasm"),
            )),
            "/app/photocraft-web.js" => Some(("text/javascript", asset!("app/photocraft-web.js"))),
            "/app/parts.txt" => Some(("text/plain", asset!("app/parts.txt"))),
            "/app/photocraft-web-caa57f60c12c8283.part-aa" => Some((
                "application/octet-stream",
                asset!("app/photocraft-web-caa57f60c12c8283.part-aa"),
            )),
            // 发布包脚本从 app/ 相对导入 snippets，但实际文件位于根目录。
            "/snippets/eframe-d31a8450ea12dfc1/inline0.js"
            | "/app/snippets/eframe-d31a8450ea12dfc1/inline0.js" => Some((
                "text/javascript",
                asset!("snippets/eframe-d31a8450ea12dfc1/inline0.js"),
            )),
            "/LICENSE-MIT" => Some(("text/plain; charset=utf-8", asset!("LICENSE-MIT"))),
            "/LICENSE-APACHE" => Some(("text/plain; charset=utf-8", asset!("LICENSE-APACHE"))),
            "/NOTICE" => Some(("text/plain; charset=utf-8", asset!("NOTICE"))),
            "/ATTRIBUTION.md" => Some(("text/plain; charset=utf-8", asset!("ATTRIBUTION.md"))),
            _ => None,
        };
        match file {
            Some((mime, bytes)) => (StatusCode::OK, mime, bytes),
            None => (StatusCode::NOT_FOUND, "text/plain", b"Not found"),
        }
    };
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Content-Length", body.len())
        .header("Cache-Control", "no-cache")
        // 静态资源无业务数据；允许 WebKit 对自定义协议的模块和 fetch 请求。
        .header("Access-Control-Allow-Origin", "*")
        // 上游引导页使用内联模块与 WASM；此策略仅属于 PhotoCraft 协议。
        .header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'")
        .body(Cow::<[u8]>::Borrowed(if request.method() == Method::HEAD {
            b""
        } else {
            body
        }))
        .expect("固定 PhotoCraft 资源响应")
}
