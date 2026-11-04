use crate::{ai::AiService, cms::CmsService, database::Database, error::CommandError, harvest::*};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn harvest_bridge_status(
    cms: State<'_, CmsService>,
    bridge: State<'_, bridge::Bridge>,
) -> Result<bridge::BridgeInfo, CommandError> {
    cms.authorize().await?;
    Ok(bridge.info.clone())
}

#[tauri::command]
pub async fn harvest_install_userscript(
    window: WebviewWindow,
    app: AppHandle,
    cms: State<'_, CmsService>,
    bridge: State<'_, bridge::Bridge>,
) -> Result<(), CommandError> {
    // 安装入口只允许主窗口打开内嵌脚本的固定地址，不接受网页提供的任意 URL。
    if window.label() != "main" {
        return Err(HarvestError::invalid("仅支持在主窗口安装油猴脚本").into());
    }
    let generation = cms.authorize().await?;
    if !bridge.info.running {
        return Err(
            HarvestError::new("BRIDGE_UNAVAILABLE", "油猴连接未启动，请检查连接状态").into(),
        );
    }
    app.opener()
        .open_url(bridge::INSTALL_URL, None::<&str>)
        .map_err(|_| {
            HarvestError::new("OPEN_LINK", "无法打开系统浏览器，请手动安装独立油猴脚本")
        })?;
    cms.ensure_generation(generation).await?;
    Ok(())
}

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
    #[cfg(target_os = "android")]
    ensure_mobile_source(&request.options)?;
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
    let mut jobs = database.harvest_list(user, &date).await?;
    // 历史状态来自 SQLite；当前候选标签页只从同账号的活动上下文附加。
    harvest.decorate_jobs(&mut jobs, user);
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
    harvest: State<'_, HarvestService>,
) -> Result<Job, CommandError> {
    Ok(harvest.enqueue(&app, &request).await?)
}
#[tauri::command]
pub async fn harvest_job_action(
    id: String,
    action: Action,
    app: AppHandle,
    cms: State<'_, CmsService>,
    harvest: State<'_, HarvestService>,
    ai: State<'_, AiService>,
) -> Result<(), CommandError> {
    let (user, generation) = cms.harvest_identity().await?;
    // 重试和设置保存/入队共用锁，使获取配置快照与已确认的设置一致。
    let _lock = if matches!(action, Action::Retry) {
        Some(ai.operations.lock().await)
    } else {
        None
    };
    cms.ensure_generation(generation).await?;
    harvest.action(&app, &id, user, action).await?;
    cms.ensure_generation(generation).await?;
    Ok(())
}

#[tauri::command]
pub async fn harvest_select_source_tab(
    id: String,
    target_id: String,
    window: WebviewWindow,
    app: AppHandle,
    cms: State<'_, CmsService>,
    harvest: State<'_, HarvestService>,
) -> Result<(), CommandError> {
    // 浏览器页面不能借助此命令操作用户的其他标签页。
    if window.label() != "main" || uuid::Uuid::parse_str(&id).is_err() || target_id.is_empty() {
        return Err(HarvestError::invalid("无效的标签页选择请求").into());
    }
    let (user, generation) = cms.harvest_identity().await?;
    harvest
        .select_source_tab(&app, &id, user, &target_id)
        .await?;
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
