use super::*;
use crate::error::Diagnostic;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::oneshot;

const LABEL: &str = "harvest-source";
// 静态脚本只返回页面快照；不暴露 invoke，也不把 CMS 会话或密钥注入来源网页。
const SNAPSHOT: &str = r#"(() => {
 const roots=[...document.querySelectorAll('div[data-testid="article"]')];
 const title=document.querySelector('#header > div:nth-child(1)')?.textContent?.trim() || '';
 const writer=document.querySelector('p[data-testid="author-name"]')?.textContent?.trim() || '';
 const ready=['interactive','complete'].includes(document.readyState) && roots.some(e=>e.textContent.trim() || e.querySelector('img,video,audio,iframe'));
 if(!ready) return {readyState:document.readyState,articleCount:roots.length,url:location.href,title,writer,html:'',next:null,documentToken:window.__pressdockHarvestPreviousDocument || null};
 const html=roots.map(root=>{
  const copy=root.cloneNode(true);
  copy.querySelectorAll('span[data-testid="report-btn"]').forEach(e=>e.remove());
  const walker=document.createTreeWalker(copy,NodeFilter.SHOW_COMMENT); const comments=[];
  while(walker.nextNode())comments.push(walker.currentNode); comments.forEach(e=>e.remove());
  const originals=[...root.querySelectorAll('img')];
  copy.querySelectorAll('img').forEach((image,index)=>{ const source=originals[index]; const src=source?.getAttribute('data-src') || source?.currentSrc || image.getAttribute('src'); if(src)try{image.setAttribute('src',new URL(src,location.href).href)}catch{} });
  [copy,...copy.querySelectorAll('*')].forEach(e=>{
   ['class','href','style'].forEach(a=>e.removeAttribute(a));
  }); return copy.outerHTML;
 }).join('');
 return {readyState:document.readyState,articleCount:roots.length,url:location.href,title,writer,html,next:document.querySelector('a.next-page')?.getAttribute('href') || null,documentToken:window.__pressdockHarvestPreviousDocument || null};
 })()"#;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    writer: String,
    #[serde(default)]
    html: String,
    next: Option<String>,
    document_token: Option<String>,
    ready_state: String,
    article_count: usize,
}
#[derive(Deserialize, serde::Serialize)]
struct ScriptError {
    name: String,
    message: String,
    stack: Option<String>,
}
#[derive(Deserialize)]
struct Evaluation {
    ok: bool,
    value: Option<serde_json::Value>,
    error: Option<ScriptError>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Readiness {
    Loading,
    Navigating,
    Ready,
    Destroyed,
}

fn closed(window: &WebviewWindow) -> HarvestError {
    HarvestError::new(
        "HARVEST_WEBVIEW_CLOSED",
        "来源采集窗口已关闭，可重试本篇采集",
    )
    .diagnosed(Diagnostic {
        operation: "source.window".into(),
        causes: vec!["原生采集窗口已被销毁".into()],
        context: json!({"window":window.label()}),
    })
}
fn navigation_allowed(url: &url::Url) -> bool {
    (url.as_str() == "about:blank")
        || (matches!(url.scheme(), "http" | "https")
            && url
                .host_str()
                .is_some_and(|host| host == "baidu.com" || host.ends_with(".baidu.com"))
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none())
}
async fn window(app: &AppHandle) -> Result<WebviewWindow, HarvestError> {
    let started = Instant::now();
    let ready_tx = app.state::<HarvestService>().source_ready.clone();
    let mut ready_rx = ready_tx.subscribe();
    let existing = app.get_webview_window(LABEL);
    let reused = existing.is_some();
    let app = app.clone();
    // WebView2 不在同步 IPC/事件处理器内创建；由后台线程请求原生主循环完成创建。
    let window = if let Some(window) = existing {
        window
    } else {
        ready_tx.send_replace(Readiness::Loading);
        tauri::async_runtime::spawn_blocking(move || {
            let bootstrap = "about:blank".parse().expect("固定 URL");
            let navigation_ready = ready_tx.clone();
            let builder = WebviewWindowBuilder::new(
                &app, LABEL, WebviewUrl::External(bootstrap),
            )
            .title("来源网页 · PressDock 采集")
            .inner_size(1100., 800.)
            .visible(false)
            .devtools(false)
            .initialization_script_for_all_frames(crate::window_policy::script(crate::window_policy::enabled(&app)))
            .on_page_load(move |window, payload| {
                crate::window_policy::apply(&window);
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    navigation_ready.send_replace(Readiness::Ready);
                }
                window.app_handle().state::<HarvestService>().source_event(window.app_handle(), "source.window.navigation", json!({
                    "window":LABEL,"url":payload.url().as_str(),"event":format!("{:?}",payload.event()),"elapsedMs":started.elapsed().as_millis()
                }));
            })
            .on_navigation(navigation_allowed)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
            #[cfg(target_os = "macos")]
            let builder = builder.data_store_identifier(*b"PressDockHarvest");
            #[cfg(not(target_os = "macos"))]
            let builder = builder.data_directory(app.path().app_data_dir()?.join("harvest-webview"));
            let window = builder.build()?;
            let handle = app.clone();
            let lifetime_ready = ready_tx.clone();
            window.on_window_event(move |event| {
                let step = match event {
                    tauri::WindowEvent::CloseRequested { .. } => "source.window.closeRequested",
                    tauri::WindowEvent::Destroyed => {
                        lifetime_ready.send_replace(Readiness::Destroyed);
                        "source.window.destroyed"
                    }
                    _ => return,
                };
                handle.state::<HarvestService>().source_event(&handle, step, json!({"window":LABEL}));
            });
            app.state::<HarvestService>().source_event(&app, "source.window.created", json!({"window":LABEL,"elapsedMs":started.elapsed().as_millis()}));
            // 创建 about:blank 会被 Tauri 跳过；注册完成后显式导航，才能产生首次文档提交和加载完成事件。
            // 在派发前标记请求状态，避免快速加载完成后又被旧的 Navigating 状态覆盖。
            ready_tx.send_replace(Readiness::Navigating);
            app.state::<HarvestService>().source_event(&app, "source.window.bootstrap", json!({"window":LABEL,"url":"about:blank","action":"navigate","elapsedMs":started.elapsed().as_millis()}));
            if let Err(error) = window.navigate("about:blank".parse().expect("固定 URL")) {
                let diagnostic = Diagnostic::error("source.window.bootstrap", &error, json!({
                    "window":LABEL,"currentUrl":window.url().ok().map(|url|url.to_string()),"windowExists":app.get_webview_window(LABEL).is_some(),"bootstrapNavigationRequested":true,"elapsedMs":started.elapsed().as_millis()
                }));
                app.state::<HarvestService>().source_event(&app, "source.window.cleanup", json!({"window":LABEL,"initiatedBy":"app","reason":"程序因初始空白页导航失败关闭窗口"}));
                let _ = window.close();
                return Err(HarvestError::new("HARVEST_WEBVIEW", "采集窗口初始空白页导航失败，请重试").diagnosed(diagnostic));
            }
            Ok::<_, HarvestError>(window)
        }).await.map_err(|error| HarvestError::new("HARVEST_WEBVIEW", "采集窗口创建失败")
            .diagnosed(Diagnostic::error("source.window.create", &error, json!({"window":LABEL}))))??
    };
    // Wry 首次文档提交前会丢弃脚本回调；复用取消期间创建的窗口也必须等实际导航完成。
    let ready = tokio::time::timeout(Duration::from_secs(30), async {
        ready_rx
            .wait_for(|state| matches!(state, Readiness::Ready | Readiness::Destroyed))
            .await
            .map(|state| *state)
    })
    .await;
    match ready {
        Ok(Ok(Readiness::Ready)) => {
            window.app_handle().state::<HarvestService>().source_event(window.app_handle(), "source.window.ready", json!({"window":LABEL,"reused":reused,"currentUrl":window.url().ok().map(|url|url.to_string()),"elapsedMs":started.elapsed().as_millis()}));
            Ok(window)
        }
        Ok(Ok(_)) => Err(closed(&window)),
        other => {
            let state = *ready_rx.borrow();
            let details = json!({
                "window":LABEL,"timeoutMs":30000,"elapsedMs":started.elapsed().as_millis(),"reused":reused,
                "currentUrl":window.url().ok().map(|url|url.to_string()),
                "windowExists":window.app_handle().get_webview_window(LABEL).is_some(),
                "bootstrapNavigationRequested":state != Readiness::Loading,"readiness":format!("{state:?}")
            });
            let diagnostic = match other {
                Err(error) => Diagnostic::error("source.window.ready", &error, details.clone()),
                Ok(Err(error)) => Diagnostic::error("source.window.ready", &error, details.clone()),
                _ => unreachable!(),
            };
            window.app_handle().state::<HarvestService>().source_event(
                window.app_handle(),
                "source.window.cleanup",
                json!({"initiatedBy":"app","reason":"程序因初始化失败关闭窗口","details":details}),
            );
            let _ = window.close();
            Err(HarvestError::new(
                "HARVEST_WEBVIEW_TIMEOUT",
                "采集窗口初始页面加载失败，请重试",
            )
            .diagnosed(diagnostic))
        }
    }
}
async fn evaluate(window: &WebviewWindow, script: &str) -> Result<serde_json::Value, HarvestError> {
    let started = Instant::now();
    let context = || json!({"window":window.label(),"url":window.url().ok().map(|url|url.to_string()),"elapsedMs":started.elapsed().as_millis()});
    let (tx, rx) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));
    // 在页面内捕获异常，绕过 Wry 会忽略 JavaScript 异常的跨平台 API 限制。
    let script = format!(
        r#"(() => {{ try {{ return {{ok:true,value:({script})}}; }} catch(error) {{ return {{ok:false,error:{{name:error?.name || 'Error',message:String(error?.message ?? error),stack:error?.stack || null}}}}; }} }})()"#
    );
    window
        .eval_with_callback(script, move |result| {
            if let Ok(mut sender) = sender.lock()
                && let Some(tx) = sender.take()
            {
                let _ = tx.send(result);
            }
        })
        .map_err(|error| {
            HarvestError::new("HARVEST_WEBVIEW", "来源页面脚本无法执行")
                .diagnosed(Diagnostic::error("source.eval.dispatch", &error, context()))
        })?;
    let result = tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|error| {
            HarvestError::new("HARVEST_WEBVIEW_TIMEOUT", "读取来源页面暂时超时")
                .diagnosed(Diagnostic::error("source.eval.timeout", &error, context()))
        })?
        .map_err(|error| {
            if window.app_handle().get_webview_window(LABEL).is_none() {
                return closed(window);
            }
            HarvestError::new(
                "HARVEST_WEBVIEW_CALLBACK",
                "来源页面脚本回调中断，采集窗口仍存在",
            )
            .diagnosed(Diagnostic::error("source.eval.callback", &error, context()))
        })?;
    if result.len() > 10 * 1024 * 1024 {
        return Err(
            HarvestError::new("HARVEST_PAGE_LIMIT", "来源页面正文超过 10 MiB").diagnosed(
                Diagnostic {
                    operation: "source.eval.read".into(),
                    causes: vec![format!("实际回调大小 {} 字节，上限 10 MiB", result.len())],
                    context: context(),
                },
            ),
        );
    }
    let evaluation: Evaluation = serde_json::from_str(&result).map_err(|error| {
        HarvestError::new("HARVEST_WEBVIEW_DATA", "来源脚本没有返回有效 JSON")
            .diagnosed(Diagnostic::error("source.eval.parse", &error, json!({"page":context(),"result":result,"line":error.line(),"column":error.column()})))
    })?;
    if !evaluation.ok {
        let error = evaluation.error.unwrap_or(ScriptError {
            name: "Error".into(),
            message: "脚本返回失败但没有提供异常详情".into(),
            stack: None,
        });
        return Err(
            HarvestError::new("HARVEST_WEBVIEW_SCRIPT", "来源页面脚本执行失败").diagnosed(
                Diagnostic {
                    operation: "source.eval.javascript".into(),
                    causes: vec![format!("{}: {}", error.name, error.message)],
                    context: json!({"page":context(),"javascript":error}),
                },
            ),
        );
    }
    Ok(evaluation.value.unwrap_or(serde_json::Value::Null))
}
async fn navigate(window: &WebviewWindow, url: &url::Url) -> Result<String, HarvestError> {
    // navigate 异步生效；标记旧文档，避免把上一页或用户手动打开的页面当作本页。
    let token = uuid::Uuid::new_v4().to_string();
    evaluate(
        window,
        &format!(
            "(() => {{window.__pressdockHarvestPreviousDocument={};return null;}})()",
            serde_json::to_string(&token)?
        ),
    )
    .await?;
    window.navigate(url.clone())?;
    Ok(token)
}
async fn snapshot(window: &WebviewWindow) -> Result<Snapshot, HarvestError> {
    let value = evaluate(window, SNAPSHOT).await?;
    serde_json::from_value(value.clone()).map_err(|error| {
        HarvestError::new("HARVEST_WEBVIEW_DATA", "来源页面快照格式无效").diagnosed(
            Diagnostic::error(
                "source.snapshot.parse",
                &error,
                json!({"window":LABEL,"snapshot":value}),
            ),
        )
    })
}
pub(super) async fn collect(
    app: &AppHandle,
    context: &worker::Context,
    url: &str,
) -> Result<(RawArticle, String), HarvestError> {
    let window_started = Instant::now();
    let reused = app.get_webview_window(LABEL).is_some();
    let window = window(app).await?;
    context.trace(app, "source.window", "state", || json!({"window":LABEL,"reused":reused,"ready":true,"elapsedMs":window_started.elapsed().as_millis()}));
    let _ = window.hide();
    let mut next = source_url(url)?;
    let mut visited = HashSet::new();
    let mut parts = Vec::new();
    let mut first_title = String::new();
    let mut first_writer = String::new();
    let mut final_url = String::new();
    for page_index in 0..30 {
        if !visited.insert(next.to_string()) {
            return Err(HarvestError::new(
                "HARVEST_PAGINATION",
                "来源分页循环，未提交不完整文章",
            ));
        }
        context.trace(
            app,
            "source.navigation",
            "input",
            || json!({"page":page_index+1,"url":next.as_str()}),
        );
        let mut previous_document = navigate(&window, &next).await?;
        let mut last_title = String::new();
        let page = loop {
            let started = Instant::now();
            let deadline = started + Duration::from_secs(30);
            let mut found = None;
            let mut read_errors = 0;
            let mut last_error = None;
            let mut last_snapshot = None;
            while Instant::now() < deadline {
                if app.get_webview_window(LABEL).is_none() {
                    return Err(closed(&window));
                }
                let snapshot = snapshot(&window).await;
                let page = match snapshot {
                    Ok(page) => page,
                    Err(error) => {
                        if matches!(error.code, "HARVEST_PAGE_LIMIT" | "HARVEST_WEBVIEW_CLOSED") {
                            return Err(error);
                        }
                        read_errors += 1;
                        let signature = format!(
                            "{}:{}:{:?}",
                            error.code,
                            error.message,
                            error
                                .diagnostic
                                .as_ref()
                                .map(|diagnostic| &diagnostic.causes)
                        );
                        if last_error.as_ref().map(|(last, _)| last) != Some(&signature) {
                            context.error(app, "source.snapshot", &error, || json!({"page":page_index+1,"url":next.as_str(),"readErrors":read_errors,"elapsedMs":started.elapsed().as_millis()}));
                        }
                        last_error = Some((signature, error));
                        tokio::time::sleep(Duration::from_millis(250)).await;
                        continue;
                    }
                };
                last_snapshot = Some(
                    json!({"url":page.url,"title":page.title,"readyState":page.ready_state,"articleCount":page.article_count,"previousDocument":page.document_token.as_deref()==Some(previous_document.as_str())}),
                );
                {
                    if page.document_token.as_deref() == Some(previous_document.as_str()) {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                        continue;
                    }
                    if page_index == 0 && !page.title.is_empty() && page.title != last_title {
                        context.title(app, &page.title).await?;
                        last_title = page.title.clone();
                    }
                    if !page.html.is_empty() {
                        source_url(&page.url)?;
                        found = Some(page);
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            if let Some(page) = found {
                context.trace(app, "source.navigation", "output", || json!({"page":page_index+1,"url":page.url,"elapsedMs":started.elapsed().as_millis(),"readErrors":read_errors}));
                break page;
            }
            if let Some((_, error)) = &last_error {
                context.error(app, "source.wait", error, || json!({"page":page_index+1,"url":next.as_str(),"elapsedMs":started.elapsed().as_millis(),"readErrors":read_errors,"lastSnapshot":last_snapshot}));
            }
            context.trace(app, "source.wait", "state", || json!({"page":page_index+1,"url":next.as_str(),"elapsedMs":started.elapsed().as_millis(),"readErrors":read_errors,"lastSnapshot":last_snapshot}));
            context
                .progress(app, Status::WaitingUser, Stage::Collecting)
                .await?;
            context.trace(
                app,
                "source.verification",
                "state",
                || json!({"page":page_index+1,"reason":"正文等待超时，请完成来源验证后继续"}),
            );
            window.show()?;
            window.set_focus()?;
            context.resume.notified().await;
            if app.get_webview_window(LABEL).is_none() {
                return Err(closed(&window));
            }
            context
                .progress(app, Status::Running, Stage::Collecting)
                .await?;
            // 验证后从本任务的原链接重新导航，沿用已登录会话和正常重定向。
            // 这样既支持 mbd→百家号回跳，也不会提交用户验证期间另行打开的文章。
            let _ = window.hide();
            context.trace(app, "source.navigation", "input", || json!({"page":page_index+1,"url":next.as_str(),"reason":"验证后重新加载任务链接"}));
            previous_document = navigate(&window, &next).await?;
        };
        if page_index == 0 {
            first_title = page.title.clone();
            first_writer = page.writer.clone();
            final_url = page.url.clone();
        }
        let current = source_url(&page.url)?;
        if current != next && !visited.insert(current.to_string()) {
            return Err(HarvestError::new(
                "HARVEST_PAGINATION",
                "来源分页重定向到已采页面，未提交不完整文章",
            ));
        }
        context.trace(app, "source.page", "output", || json!({"page":page_index+1,"url":page.url,"title":page.title,"writer":page.writer,"html":page.html,"next":page.next}));
        parts.push(page.html);
        if parts.iter().map(String::len).sum::<usize>() > 16 * 1024 * 1024 {
            return Err(HarvestError::new(
                "HARVEST_PAGE_LIMIT",
                "合并正文超过 16 MiB",
            ));
        }
        app.state::<crate::database::Database>()
            .harvest_save_partial(
                &context.id,
                &RawArticle {
                    title: first_title.clone(),
                    writer: first_writer.clone(),
                    source_url: url.into(),
                    news_html: parts.join("\n"),
                },
            )
            .await?;
        if first_title.trim().is_empty() {
            return Err(HarvestError::new(
                "HARVEST_TITLE",
                "未提取到文章标题，未提交文章",
            ));
        }
        match page.next {
            Some(link) => {
                if page_index == 29 {
                    return Err(HarvestError::new(
                        "HARVEST_PAGINATION",
                        "来源超过 30 页，未提交不完整文章",
                    ));
                }
                let joined = current.join(&link).map_err(|error| {
                    HarvestError::invalid("来源分页链接无效").diagnosed(Diagnostic::error(
                        "source.pagination.url",
                        &error,
                        json!({"page":page_index+1,"url":current.as_str()}),
                    ))
                })?;
                next = source_url(joined.as_str())?;
            }
            None => break,
        }
    }
    let _ = window.hide();
    Ok((
        RawArticle {
            title: first_title,
            writer: first_writer,
            source_url: url.into(),
            news_html: parts.join("\n"),
        },
        final_url,
    ))
}
pub(super) fn show(app: &AppHandle) -> Result<(), HarvestError> {
    let window = app
        .get_webview_window(LABEL)
        .ok_or_else(|| HarvestError::new("HARVEST_WEBVIEW", "当前没有等待操作的来源窗口"))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}
