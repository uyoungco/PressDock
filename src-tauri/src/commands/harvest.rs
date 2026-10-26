use crate::{ai::AiService, cms::CmsService, database::Database, error::CommandError, harvest::*};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[tauri::command]
pub async fn harvest_load_settings(
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<Settings, CommandError> {
    let generation = cms.authorize().await?;
    let result = database.harvest_settings().await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}
#[tauri::command]
pub async fn harvest_save_settings(
    request: Settings,
    app: AppHandle,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
    ai: State<'_, AiService>,
) -> Result<(), CommandError> {
    let generation = cms.authorize().await?;
    let _lock = ai.operations.lock().await;
    cms.ensure_generation(generation).await?;
    database.harvest_save_settings(&request).await?;
    crate::window_policy::sync(&app, request.options.developer_mode);
    cms.ensure_generation(generation).await?;
    Ok(())
}
#[tauri::command]
pub async fn harvest_set_developer_mode(
    enabled: bool,
    app: AppHandle,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
    ai: State<'_, AiService>,
) -> Result<bool, CommandError> {
    let generation = cms.authorize().await?;
    // 与入队/完整设置保存串行，确保新任务固定的是已确认的模式。
    let _lock = ai.operations.lock().await;
    cms.ensure_generation(generation).await?;
    let saved = database.harvest_set_developer_mode(enabled).await?;
    crate::window_policy::sync(&app, saved);
    cms.ensure_generation(generation).await?;
    Ok(saved)
}
#[tauri::command]
pub async fn harvest_list_jobs(
    date: String,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
    harvest: State<'_, HarvestService>,
) -> Result<JobList, CommandError> {
    let (user, generation) = cms.harvest_identity().await?;
    let jobs = database.harvest_list(user, &date).await?;
    cms.ensure_generation(generation).await?;
    Ok(JobList {
        jobs,
        maintenance_warning: harvest.maintenance_warning.clone(),
    })
}
#[tauri::command]
pub async fn harvest_enqueue(
    request: EnqueueRequest,
    app: AppHandle,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
    ai: State<'_, AiService>,
    harvest: State<'_, HarvestService>,
) -> Result<Job, CommandError> {
    let (user, generation) = cms.harvest_identity().await?;
    let _lock = ai.operations.lock().await;
    cms.ensure_generation(generation).await?;
    let (job, options) = database.harvest_enqueue(user, &request).await?;
    cms.ensure_generation(generation).await?;
    if job.developer_mode {
        // 返回已有记录时也使用它的原模式/设置，不把当前开关套到历史任务上。
        let _ = app.emit_to(
            "main",
            "harvest-debug",
            DebugEvent {
                user_id: user,
                job_id: job.id.clone(),
                attempt: job.attempts,
                timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                step: "enqueue".into(),
                kind: "output",
                data: crate::error::redact(serde_json::json!({"requestId":request.id,"job":job,"options":options,"reused":job.id != request.id,"reason":if job.id != request.id {"定位已有记录；失败任务请点击重试"} else {"新任务入队"}}), &[]),
                diagnostic: None,
            },
        );
    }
    harvest.wake.notify_one();
    crate::harvest::worker::changed(&app);
    Ok(job)
}
#[tauri::command]
pub async fn harvest_job_action(
    id: String,
    action: Action,
    app: AppHandle,
    cms: State<'_, CmsService>,
    harvest: State<'_, HarvestService>,
) -> Result<(), CommandError> {
    let (user, generation) = cms.harvest_identity().await?;
    harvest.action(&app, &id, user, action).await?;
    cms.ensure_generation(generation).await?;
    Ok(())
}

#[tauri::command]
pub async fn harvest_open_devtools(
    window: WebviewWindow,
    database: State<'_, Database>,
    cms: State<'_, CmsService>,
) -> Result<(), CommandError> {
    // 即使绕过前端快捷键也必须检查调用窗口、会话和已保存开关；来源网页无此能力。
    if window.label() != "main" {
        return Err(HarvestError::invalid("仅支持在主窗口打开开发者工具").into());
    }
    let generation = cms.authorize().await?;
    let settings = database.harvest_settings().await?;
    cms.ensure_generation(generation).await?;
    if !settings.options.developer_mode {
        return Err(HarvestError::invalid("请先在采集与 AI 处理设置中开启开发者模式").into());
    }
    #[cfg(desktop)]
    {
        window.open_devtools();
        Ok(())
    }
    #[cfg(mobile)]
    Err(HarvestError::invalid("开发者工具仅支持桌面端").into())
}
