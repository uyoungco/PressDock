use super::*;
use crate::{
    ai::{AiService, GenerationTask},
    cms::CmsService,
    database::Database,
};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Notify, watch};

pub struct HarvestService {
    pub(crate) wake: Notify,
    active: Mutex<Option<Arc<Context>>>,
    pub(crate) maintenance_warning: Option<String>,
    pub(super) source_ready: watch::Sender<webview::Readiness>,
}
#[derive(Clone, Copy)]
enum Stop {
    None,
    Cancel,
    Session,
}
pub(super) struct Context {
    pub id: String,
    user_id: i64,
    pub generation: u64,
    developer_mode: bool,
    attempt: i64,
    cancelled: watch::Sender<Stop>,
    pub resume: Notify,
}
pub(crate) fn changed(app: &AppHandle) {
    let _ = app.emit_to("main", "harvest-changed", ());
}
impl Context {
    pub fn trace(
        &self,
        app: &AppHandle,
        step: &str,
        kind: &'static str,
        data: impl FnOnce() -> Value,
    ) {
        // 按任务快照输出，关闭设置不截断旧调试任务；正常任务不构建大正文日志对象。
        if self.developer_mode {
            let _ = app.emit_to(
                "main",
                "harvest-debug",
                DebugEvent {
                    user_id: self.user_id,
                    job_id: self.id.clone(),
                    attempt: self.attempt,
                    timestamp: store::now(),
                    step: step.into(),
                    kind,
                    data: crate::error::redact(data(), &[]),
                    diagnostic: None,
                },
            );
        }
    }

    pub fn error(
        &self,
        app: &AppHandle,
        step: &str,
        error: &HarvestError,
        data: impl FnOnce() -> Value,
    ) {
        if self.developer_mode {
            let _ = app.emit_to(
                "main",
                "harvest-debug",
                DebugEvent {
                    user_id: self.user_id,
                    job_id: self.id.clone(),
                    attempt: self.attempt,
                    timestamp: store::now(),
                    step: step.into(),
                    kind: "error",
                    data: crate::error::redact(
                        json!({"code":error.code,"message":error.message,"details":data()}),
                        &[],
                    ),
                    diagnostic: error
                        .diagnostic
                        .clone()
                        .map(crate::error::Diagnostic::sanitized),
                },
            );
        }
    }
    pub async fn progress(
        &self,
        app: &AppHandle,
        status: Status,
        stage: Stage,
    ) -> Result<(), HarvestError> {
        app.state::<Database>()
            .harvest_progress(&self.id, status, stage)
            .await?;
        self.trace(
            app,
            stage.as_str(),
            "state",
            || json!({"status":status,"stage":stage}),
        );
        changed(app);
        Ok(())
    }
    pub async fn title(&self, app: &AppHandle, title: &str) -> Result<(), HarvestError> {
        app.state::<Database>()
            .harvest_title(&self.id, title)
            .await?;
        changed(app);
        Ok(())
    }
    pub async fn warning(&self, app: &AppHandle, message: &str) -> Result<(), HarvestError> {
        app.state::<Database>()
            .harvest_warning(&self.id, message)
            .await?;
        self.trace(app, "warning", "error", || json!({"message":message}));
        changed(app);
        Ok(())
    }
}
impl HarvestService {
    pub(crate) fn new(maintenance_warning: Option<String>) -> Self {
        Self {
            wake: Notify::new(),
            active: Mutex::new(None),
            maintenance_warning,
            source_ready: watch::channel(webview::Readiness::Loading).0,
        }
    }
    pub(super) fn source_event(&self, app: &AppHandle, step: &str, data: Value) {
        let active = self.active.lock().ok().and_then(|active| active.clone());
        if let Some(context) = active {
            context.trace(app, step, "state", || data);
            // 真实销毁也唤醒等待验证的任务，使其报告关闭，而不是无限等待继续按钮。
            if step == "source.window.destroyed" {
                context.resume.notify_one();
            }
        }
    }
    pub(crate) fn stop(&self) {
        if let Ok(active) = self.active.lock()
            && let Some(active) = active.as_ref()
        {
            active.cancelled.send_replace(Stop::Session);
        }
    }
    pub(crate) async fn action(
        &self,
        app: &AppHandle,
        id: &str,
        user: i64,
        action: Action,
    ) -> Result<(), HarvestError> {
        let db = app.state::<Database>();
        let job = db.harvest_view(id, user).await?;
        if matches!(action, Action::Cancel) {
            db.harvest_cancel(id, user).await?;
            // 持久取消完成后再找活动任务，覆盖 queued→running 尚未登记控制器的窗口。
            if let Ok(active) = self.active.lock()
                && let Some(context) = active
                    .as_ref()
                    .filter(|context| context.id == id && context.user_id == user)
            {
                context.cancelled.send_replace(Stop::Cancel);
            }
            // 排队任务取消后不会再被 worker 领取，也要输出 SQLite 中的最终状态。
            if job.developer_mode
                && let Ok(saved) = db.harvest_view(id, user).await
            {
                let _ = app.emit_to(
                    "main",
                    "harvest-debug",
                    DebugEvent {
                        user_id: user,
                        job_id: saved.id.clone(),
                        attempt: saved.attempts,
                        timestamp: store::now(),
                        step: "finished".into(),
                        kind: "state",
                        data: crate::error::redact(json!({"job":saved,"reason":"用户取消"}), &[]),
                        diagnostic: None,
                    },
                );
            }
            changed(app);
            self.wake.notify_one();
            return Ok(());
        }
        let active = self
            .active
            .lock()
            .map_err(|_| HarvestError::new("HARVEST_BUSY", "采集服务暂不可用"))?
            .clone()
            .filter(|context| context.id == id && context.user_id == user);
        match action {
            Action::Delete => {
                if active.is_some() {
                    return Err(HarvestError::invalid("任务正在结束，请稍后刷新后删除"));
                }
                db.harvest_delete(id, user).await?;
            }
            Action::Show if job.status == Status::WaitingUser => webview::show(app)?,
            Action::Resume if job.status == Status::WaitingUser => {
                active
                    .ok_or_else(|| HarvestError::invalid("采集任务已中断，请重试"))?
                    .resume
                    .notify_one();
            }
            _ => db.harvest_action(id, user, &action).await?,
        }
        changed(app);
        self.wake.notify_one();
        Ok(())
    }
}
// 调试完成与 CMS 创建成功使用不同返回值，禁止用 Ok(None) 冒充远端成功。
enum Outcome {
    Created(Option<String>),
    DebugCompleted,
}
async fn process(
    app: &AppHandle,
    context: &Context,
    stored: StoredJob,
) -> Result<Outcome, HarvestError> {
    let db = app.state::<Database>();
    let cms = app.state::<CmsService>();
    let options = &stored.options;
    context.trace(
        app,
        "start",
        "input",
        || json!({"job":stored.job,"options":options}),
    );
    let article = if let Some(prepared) = stored.prepared {
        context.trace(
            app,
            "checkpoint",
            "output",
            || json!({"raw":stored.raw,"formatted":stored.formatted,"prepared":prepared}),
        );
        for step in [
            "collecting",
            "formatting",
            "metadata",
            "organizing",
            "paginating",
        ] {
            context.trace(
                app,
                step,
                "skip",
                || json!({"reason":"复用已持久化的最终结果"}),
            );
        }
        prepared
    } else {
        let raw = if let Some(raw) = stored.raw {
            context.trace(
                app,
                "collecting",
                "skip",
                || json!({"reason":"复用不可变原文","raw":raw}),
            );
            raw
        } else {
            let (raw, final_url) = webview::collect(app, context, &stored.job.url).await?;
            db.harvest_save_raw(&context.id, &raw, &final_url).await?;
            context.trace(
                app,
                "collecting",
                "output",
                || json!({"raw":raw,"finalUrl":final_url}),
            );
            raw
        };
        let mut article = if let Some(formatted) = stored.formatted {
            context.trace(
                app,
                "formatting",
                "skip",
                || json!({"reason":"复用后台格式化检查点","article":formatted}),
            );
            formatted
        } else {
            context
                .progress(app, Status::Running, Stage::Formatting)
                .await?;
            let html = content::clean_html(&raw.news_html);
            context.trace(
                app,
                "html.clean",
                "output",
                || json!({"input":raw.news_html,"output":html}),
            );
            context.trace(
                app,
                "formatting",
                "input",
                || json!({"endpoint":"/api/Util/FormatContent","content":html}),
            );
            let mut formatted = cms.harvest_format(&raw, &html, context.generation).await?;
            context.trace(app, "formatting", "output", || json!({"article":formatted}));
            formatted.news_text = content::with_breaks(&formatted.news_text);
            context.trace(
                app,
                "html.breaks",
                "output",
                || json!({"content":formatted.news_text}),
            );
            db.harvest_save_result(&context.id, &formatted, false)
                .await?;
            formatted
        };
        let needs_ai = options.auto_classify
            || options.auto_summary
            || options.auto_tags
            || options.auto_organize;
        let model = if needs_ai {
            let settings = db.ai_settings().await?;
            settings
                .models
                .into_iter()
                .find(|model| Some(&model.id) == options.model_config_id.as_ref())
        } else {
            None
        };
        if needs_ai && model.is_none() {
            context
                .warning(app, "未配置 AI 处理模型，AI 步骤已跳过，保留后台结果")
                .await?;
        }
        if let Some(model) = &model
            && (options.auto_classify || options.auto_tags || options.auto_summary)
        {
            context
                .progress(app, Status::Running, Stage::Metadata)
                .await?;
            if let Err(error) =
                content::metadata(app, context, options, &raw, &mut article, model).await
            {
                if matches!(
                    error.code,
                    "AUTH_EXPIRED" | "SESSION_CHANGED" | "HARVEST_STORAGE"
                ) {
                    return Err(error);
                }
                context.error(
                    app,
                    "metadata.fallback",
                    &error,
                    || json!({"article":article}),
                );
                context
                    .warning(app, &format!("AI 元数据已回退：{}", error.message))
                    .await?;
            }
        } else {
            context.trace(app, "metadata", "skip", || json!({"reason":if model.is_none() && needs_ai {"未配置模型"} else {"元数据开关均关闭"},"article":article}));
        }
        if options.auto_organize {
            if let Some(model) = &model {
                context.trace(
                    app,
                    "layout.prepare",
                    "input",
                    || json!({"html":article.news_text}),
                );
                match layout::prepare(&article.news_text) {
                    Ok(document) => {
                        let ai = app.state::<AiService>();
                        let mut input = content::json_input(&raw.title, document.input());
                        let mut output = None;
                        for attempt in 0..2 {
                            context
                                .progress(app, Status::Running, Stage::Organizing)
                                .await?;
                            context.trace(app, "layout.request", "input", || json!({"model":model.model_id,"pass":attempt+1,"system":layout::PROMPT,"user":input}));
                            let observe = |response: &Value| {
                                context.trace(
                                    app,
                                    "layout.response",
                                    "output",
                                    || json!({"pass":attempt+1,"response":response}),
                                );
                            };
                            let result = content::generate(
                                &ai,
                                &db,
                                model,
                                layout::PROMPT,
                                &input,
                                GenerationTask::Layout(&observe),
                            )
                            .await;
                            match result {
                                Ok(text) => {
                                    if options.auto_paginate {
                                        context
                                            .progress(app, Status::Running, Stage::Paginating)
                                            .await?;
                                        context.trace(app, "paginating", "input", || json!({"layout":text,"target":240,"singlePageMax":280,"tailMin":100}));
                                    }
                                    match layout::render(&document, &text, options.auto_paginate) {
                                        Ok(html) => {
                                            context.trace(
                                                app,
                                                "layout.validation",
                                                "output",
                                                || json!({"valid":true,"html":html}),
                                            );
                                            if options.auto_paginate {
                                                context.trace(app, "paginating", "output", || json!({"pages":html.split("[!--empirenews.page--]").collect::<Vec<_>>(),"html":html}));
                                            }
                                            output = Some(html);
                                            break;
                                        }
                                        Err(error) => {
                                            context.error(
                                                app,
                                                "layout.validation",
                                                &error,
                                                || json!({"pass":attempt+1,"response":text}),
                                            );
                                            if attempt == 0 {
                                                input = format!(
                                                    "{}\n上次完整响应未通过校验：{}。请重新生成完整JSON。修正优先保留全文，drop_blocks必须为空数组，不得省略正文或图片。\n上次响应：{}",
                                                    content::json_input(
                                                        &raw.title,
                                                        document.input()
                                                    ),
                                                    error.message,
                                                    text
                                                );
                                            } else {
                                                context
                                                    .warning(
                                                        app,
                                                        &format!(
                                                            "正文整理已回退：{}",
                                                            error.message
                                                        ),
                                                    )
                                                    .await?;
                                            }
                                        }
                                    }
                                }
                                Err(error) => {
                                    context.error(
                                        app,
                                        "layout.fallback",
                                        &error,
                                        || json!({"pass":attempt+1,"article":article}),
                                    );
                                    context
                                        .warning(app, &format!("正文整理已回退：{}", error.message))
                                        .await?;
                                    break;
                                }
                            }
                        }
                        if let Some(html) = output {
                            article.news_text = html;
                        } else {
                            context.trace(app, "organizing", "skip", || json!({"reason":"正文整理失败，回退后台原排版","html":article.news_text}));
                            if options.auto_paginate {
                                context.trace(app, "paginating", "skip", || json!({"reason":"正文整理失败，按原规则整体回退","html":article.news_text}));
                            }
                        }
                    }
                    Err(error) => {
                        context.error(app, "layout.prepare", &error, || json!({"article":article}));
                        context.warning(app, &error.message).await?;
                        if options.auto_paginate {
                            context.trace(app, "paginating", "skip", || json!({"reason":"正文结构不支持整理，按原规则整体回退","html":article.news_text}));
                        }
                    }
                }
            } else {
                context.trace(
                    app,
                    "organizing",
                    "skip",
                    || json!({"reason":"未配置模型","html":article.news_text}),
                );
                if options.auto_paginate {
                    context.trace(app, "paginating", "skip", || json!({"reason":"正文整理不可执行，按既有规则整体回退","html":article.news_text}));
                }
            }
        } else {
            context.trace(
                app,
                "organizing",
                "skip",
                || json!({"reason":"AI 正文整理开关关闭"}),
            );
            if options.auto_paginate {
                context
                    .progress(app, Status::Running, Stage::Paginating)
                    .await?;
                context.trace(app, "paginating", "input", || json!({"html":article.news_text,"target":240,"singlePageMax":280,"tailMin":100}));
                match layout::paginate_existing(&article.news_text) {
                    Ok(html) => {
                        context.trace(app, "paginating", "output", || json!({"pages":html.split("[!--empirenews.page--]").collect::<Vec<_>>(),"html":html}));
                        article.news_text = html;
                    }
                    Err(error) => {
                        context.error(
                            app,
                            "paginating.fallback",
                            &error,
                            || json!({"article":article}),
                        );
                        context.warning(app, &error.message).await?;
                    }
                }
            }
        }
        if !options.auto_paginate {
            context.trace(
                app,
                "paginating",
                "skip",
                || json!({"reason":"自动内容分页开关关闭"}),
            );
        }
        db.harvest_save_result(&context.id, &article, true).await?;
        article
    };
    cms.ensure_generation(context.generation).await?;
    context.trace(app, "payload", "output", || article.payload());
    // 调试分支在写提交意图之前结束；绝不调用 Article，也不留下 submitting/未知状态。
    if options.developer_mode {
        context.trace(
            app,
            "submitting",
            "skip",
            || json!({"reason":"开发者模式：仅保存本地结果，不创建 CMS 文章"}),
        );
        return Ok(Outcome::DebugCompleted);
    }
    db.harvest_submitting(&context.id).await?;
    changed(app);
    Ok(Outcome::Created(
        cms.harvest_submit(&article, context.generation).await?,
    ))
}
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let service = app.state::<HarvestService>();
        let db = app.state::<Database>();
        let cms = app.state::<CmsService>();
        loop {
            let identity = cms.harvest_identity().await;
            let stored = match identity {
                Ok((user, _)) => db.harvest_claim(user).await,
                Err(_) => Ok(None),
            };
            let job = match stored {
                Ok(Some(job)) => job,
                Ok(None) => {
                    tokio::select! {_=service.wake.notified()=>{},_=tokio::time::sleep(Duration::from_secs(2))=>{}}
                    continue;
                }
                Err(error) => {
                    eprintln!("PressDock harvest: {}", error.code);
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            };
            let Ok((user, generation)) = cms.harvest_identity().await else {
                let _ = db
                    .harvest_finish(
                        &job.job.id,
                        Status::WaitingLogin,
                        Some("请使用原账号重新登录后重试"),
                        None,
                    )
                    .await;
                changed(&app);
                continue;
            };
            if user != job.user_id {
                let _ = db
                    .harvest_finish(
                        &job.job.id,
                        Status::Interrupted,
                        Some("账号已变化，请用原账号重试"),
                        None,
                    )
                    .await;
                changed(&app);
                continue;
            }
            let (cancelled, mut cancellation) = watch::channel(Stop::None);
            let context = Arc::new(Context {
                id: job.job.id.clone(),
                user_id: user,
                generation,
                developer_mode: job.options.developer_mode,
                attempt: job.job.attempts,
                cancelled,
                resume: Notify::new(),
            });
            if let Ok(mut active) = service.active.lock() {
                *active = Some(context.clone());
            }
            // 领取后、控制器登记前可能已被取消；必须先复核持久状态再执行任何步骤。
            if !matches!(db.harvest_view(&context.id,user).await,Ok(job) if job.status==Status::Running)
            {
                if let Ok(mut active) = service.active.lock() {
                    *active = None;
                }
                changed(&app);
                continue;
            }
            changed(&app);
            let auth_guard = async {
                loop {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    cms.ensure_generation(generation).await?;
                }
                #[allow(unreachable_code)]
                Ok::<(), crate::cms::CmsError>(())
            };
            let result = tokio::select! {biased;
                _=cancellation.changed()=>Err(match *cancellation.borrow() { Stop::Session=>HarvestError::new("SESSION_CHANGED","账号已退出或变化，请用原账号重新登录"), _=>HarvestError::new("HARVEST_CANCELLED","任务已取消") }),
                result=auth_guard=>Err(result.err().map(HarvestError::from).unwrap_or_else(||HarvestError::new("SESSION_CHANGED","登录状态已变化"))),
                result=process(&app,&context,job)=>result,
            };
            if let Err(error) = &result {
                context.error(&app, "processing.failed", error, || json!({}));
            }
            let saved = db.harvest_view(&context.id, user).await;
            let status = match (&result, &saved) {
                (Ok(Outcome::Created(_)), _) => Status::Succeeded,
                (Ok(Outcome::DebugCompleted), _) => Status::DebugCompleted,
                (Err(error), Ok(saved))
                    if saved.stage == Some(Stage::Submitting)
                        && !matches!(
                            error.code,
                            "CMS_REMOTE" | "CMS_FORBIDDEN" | "AUTH_EXPIRED"
                        ) =>
                {
                    Status::SubmissionUnknown
                }
                (Err(error), _) if matches!(error.code, "AUTH_EXPIRED" | "SESSION_CHANGED") => {
                    Status::WaitingLogin
                }
                (Err(error), _) if error.code == "HARVEST_CANCELLED" => Status::Cancelled,
                _ => Status::Failed,
            };
            let message = result.as_ref().err().map(|error| error.message.as_str());
            let cms_id = match &result {
                Ok(Outcome::Created(id)) => id.as_deref(),
                _ => None,
            };
            if let Err(error) = db
                .harvest_finish(&context.id, status, message, cms_id)
                .await
            {
                context.error(&app, "finished.save", &error, || json!({"status":status}));
                eprintln!("PressDock harvest finish: {}", error.code);
            }
            if let Ok(saved) = db.harvest_view(&context.id, user).await {
                context.trace(&app, "finished", if result.is_ok() { "output" } else { "error" }, || json!({"job":saved,"error":result.as_ref().err().map(|error|json!({"code":error.code,"message":error.message}))}));
            }
            if let Ok(mut active) = service.active.lock() {
                *active = None;
            }
            changed(&app);
        }
    });
}
