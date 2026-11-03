use super::*;
use crate::error::Diagnostic;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};

// 静态脚本只返回页面快照；不暴露 invoke，也不把 CMS 会话或密钥注入来源网页。
pub(super) const SNAPSHOT: &str = r#"(() => {
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
pub(super) struct Snapshot {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub writer: String,
    #[serde(default)]
    pub html: String,
    pub next: Option<String>,
    pub document_token: Option<String>,
    pub ready_state: String,
    pub article_count: usize,
}
// 两种传输只负责页面操作，正文提取、分页边界及检查点由同一流程维护。
enum PageSource {
    Webview(Box<WebviewWindow>),
    Cdp(cdp::Page),
}
impl PageSource {
    async fn open(
        &mut self,
        app: &AppHandle,
        context: &worker::Context,
        url: &url::Url,
    ) -> Result<Option<String>, HarvestError> {
        match self {
            Self::Webview(window) => Ok(Some(webview::navigate(window, url).await?)),
            Self::Cdp(page) => {
                page.open(app, context, url).await?;
                Ok(None)
            }
        }
    }
    async fn snapshot(&self) -> Result<Snapshot, HarvestError> {
        match self {
            Self::Webview(window) => webview::snapshot(window).await,
            Self::Cdp(page) => page.snapshot().await,
        }
    }
    fn ensure_open(&self, app: &AppHandle) -> Result<(), HarvestError> {
        match self {
            Self::Webview(window) => webview::ensure_open(app, window),
            Self::Cdp(page) => page.ensure_open(),
        }
    }
    async fn show(&self) -> Result<(), HarvestError> {
        match self {
            Self::Webview(window) => {
                window.show()?;
                window.set_focus()?;
                Ok(())
            }
            Self::Cdp(page) => page.show().await,
        }
    }
    async fn wait(&self, context: &worker::Context) -> Result<(), HarvestError> {
        match self {
            Self::Webview(_) => {
                context.resume.notified().await;
                Ok(())
            }
            Self::Cdp(page) => tokio::select! {
                _ = context.resume.notified() => Ok(()),
                error = page.closed() => Err(error),
            },
        }
    }
}

pub(super) async fn collect(
    app: &AppHandle,
    context: &worker::Context,
    url: &str,
    options: &Options,
) -> Result<(RawArticle, String), HarvestError> {
    let service = app.state::<HarvestService>();
    let mut source = match options.source_mode {
        SourceMode::Webview => {
            if let Some(browser) = service.cdp.lock().await.take() {
                browser.close();
            }
            PageSource::Webview(Box::new(webview::open(app, context).await?))
        }
        SourceMode::Cdp => PageSource::Cdp(cdp::Page::new(app, context, options).await?),
    };
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
        let mut previous_document = source.open(app, context, &next).await?;
        let mut last_title = String::new();
        let page = loop {
            let started = Instant::now();
            let deadline = started + Duration::from_secs(30);
            let mut found = None;
            let mut read_errors = 0;
            let mut last_error = None;
            let mut last_snapshot = None;
            while Instant::now() < deadline {
                source.ensure_open(app)?;
                // 单次读取也受剩余正文等待期限约束，繁忙页面不能把 30 秒窗口不断延长。
                let snapshot = tokio::time::timeout(
                    deadline.saturating_duration_since(Instant::now()),
                    source.snapshot(),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(HarvestError::new(
                        "HARVEST_SOURCE_TIMEOUT",
                        "等待来源正文超时",
                    ))
                });
                let page = match snapshot {
                    Ok(page) => page,
                    Err(error) => {
                        if matches!(error.code, "HARVEST_PAGE_LIMIT" | "HARVEST_WEBVIEW_CLOSED")
                            || (error.code.starts_with("HARVEST_CDP")
                                && !matches!(
                                    error.code,
                                    "HARVEST_CDP_TIMEOUT" | "HARVEST_CDP_NAVIGATION"
                                ))
                        {
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
                    json!({"url":page.url,"title":page.title,"readyState":page.ready_state,"articleCount":page.article_count,"previousDocument":previous_document.as_deref().is_some_and(|token| page.document_token.as_deref() == Some(token))}),
                );
                {
                    if previous_document
                        .as_deref()
                        .is_some_and(|token| page.document_token.as_deref() == Some(token))
                    {
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
                .source_interaction
                .send_replace(Some(SourceInteraction::Verification));
            context
                .progress(app, Status::WaitingUser, Stage::Collecting)
                .await?;
            context.trace(
                app,
                "source.verification",
                "state",
                || json!({"page":page_index+1,"reason":"正文等待超时，请完成来源验证后继续"}),
            );
            source.show().await?;
            source.wait(context).await?;
            source.ensure_open(app)?;
            context.source_interaction.send_replace(None);
            context
                .progress(app, Status::Running, Stage::Collecting)
                .await?;
            // WebView 验证后重新导航；CDP 保留当前标签页及验证状态，直接重读。
            if let PageSource::Webview(window) = &source {
                let _ = window.hide();
                previous_document = Some(webview::navigate(window, &next).await?);
            }
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
    if let PageSource::Webview(window) = &source {
        let _ = window.hide();
    }
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
