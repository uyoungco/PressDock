//! 显式双端验收：只临时修改一项共享规则，所有采集及 AI 请求均为零。
use super::{
    local::{SyncError, SyncResult},
    runtime::SettingsSync,
};
use crate::{ai::AiService, cms::CmsService, database::Database, harvest::SourceMode};
use serde_json::json;
use std::path::PathBuf;

#[tokio::test]
#[ignore = "显式恢复夹具：默认等待手机缓存；PRESSDOCK_RECOVERY_TARGET=windows 时等待独立 Windows 安装并暂存被拒请求；不执行模型请求，不修改正式模型"]
async fn provision_deleted_demo_model_for_android_recovery() -> SyncResult<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tools");
    let windows = std::env::var("PRESSDOCK_RECOVERY_TARGET").as_deref() == Ok("windows");
    let observation_path = root.join(if windows {
        "settings-sync-windows-recovery/cached.json"
    } else {
        "settings-sync-rejected-android-cached.json"
    });
    let state_path = root.join(if windows {
        "settings-sync-windows-recovery/state.json"
    } else {
        "settings-sync-rejected-state.json"
    });
    if observation_path.exists() {
        return Err(SyncError::new("PROBE_STALE_OBSERVATION", false));
    }
    let directory = root
        .join("settings-sync-probes")
        .join(format!("rejected-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    let db = Database::open(&directory.join("probe.db")).await?;
    let cms = CmsService::new(&directory).map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    cms.restore_session()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
        .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
    let ai = AiService::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let sync = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let status = sync.start(&db, &ai, &cms, false).await?;
    if !status.ready || status.successful_reads != 1 || status.pending != 0 {
        return Err(SyncError::new("PROBE_START_FAILED", false));
    }
    let original = super::local::export(&db).await?;
    let mut model = original
        .models
        .first()
        .cloned()
        .ok_or(SyncError::new("PROBE_NO_MODEL", false))?;
    let suffix = uuid::Uuid::new_v4().to_string();
    model.id = format!("demo-recovery-{suffix}");
    model.model_id = "DEMO-NO-REQUEST".into();
    model.display_name = format!("【演示数据】恢复验收{}", &suffix[..8]);
    sync.model(&db, model.clone(), None).await?;
    let observed: SyncResult<()> = async {
        if !sync.upload_one(&db, &cms).await? || sync.status(&db).await?.pending != 0 {
            return Err(SyncError::new("PROBE_UPLOAD_FAILED", false));
        }
        let state = json!({"phase":if windows { "awaitingWindowsCache" } else { "awaitingAndroidCache" },"modelId":model.id,
            "modelDisplayName":model.display_name,"testDatabase":directory.join("probe.db")});
        tokio::fs::write(&state_path, serde_json::to_vec_pretty(&state)?)
            .await
            .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(480);
        loop {
            if let Ok(raw) = tokio::fs::read(&observation_path).await {
                let observation: serde_json::Value = serde_json::from_slice(&raw)?;
                return if observation["modelDisplayName"] == model.display_name {
                    Ok(())
                } else {
                    Err(SyncError::new("PROBE_ANDROID_MISMATCH", false))
                };
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(SyncError::new("PROBE_ANDROID_TIMEOUT", false));
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }
    .await;
    // 专用客户端缓存后删除云端演示实体；观察失败也执行清理，不保留临时共享模型。
    sync.remove(&db, "model", &model.id).await?;
    for _ in 0..4 {
        if sync.status(&db).await?.pending == 0 {
            break;
        }
        if !sync.upload_one(&db, &cms).await? {
            return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
        }
    }
    let verify = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let status = verify.start(&db, &ai, &cms, false).await?;
    if !status.ready
        || status.successful_reads != 1
        || status.pending != 0
        || serde_json::to_value(super::local::export(&db).await?)?
            != serde_json::to_value(&original)?
    {
        return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
    }
    let revision: i64 =
        sqlx::query_scalar("SELECT last_observed_revision FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?;
    let refs:Vec<String>=sqlx::query_scalar("SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT credential_ref FROM sync_credential_gc").fetch_all(&db.pool).await?;
    for reference in refs {
        if (reference.starts_with("sync-secret-") || reference.starts_with("sync-payload-"))
            && !sync.local.clear(&reference).await
        {
            return Err(SyncError::new("PROBE_CLEANUP_FAILED", false));
        }
    }
    db.pool.close().await;
    let report = json!({"check":if windows { "windows-recovery-demo-model-remote-delete" } else { "android-recovery-demo-model-remote-delete" },
        "phase":"remoteDemoDeleted","passed":observed.is_ok(),
        "modelId":model.id,"modelDisplayName":model.display_name,
        "originalSharedConfigurationRestored":true,"cloudRevision":revision,
        "dedicatedNativeCredentialsCleaned":true,"aiRequests":0,"cmsWrites":0});
    tokio::fs::write(&state_path, serde_json::to_vec_pretty(&report)?)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    println!("{report}");
    observed?;
    if windows {
        // 仅为独立测试安装生成真实业务队列；上传与拒绝由其正式后台工作器执行。
        // 不调用恢复 IPC，不代替用户在真实窗口里的取消和确认操作。
        let appdata = std::env::var_os("APPDATA").ok_or(SyncError::new("PROBE_PATH", false))?;
        let ui_path =
            PathBuf::from(appdata).join("com.example.pressdock.installercheck/pressdock.db");
        if !ui_path.exists() {
            return Err(SyncError::new("PROBE_PATH", false));
        }
        let ui_db = Database::open(&ui_path).await?;
        let ui_sync = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
        if ui_sync.status(&ui_db).await?.pending != 0 {
            return Err(SyncError::new("PROBE_UNEXPECTED_PENDING", false));
        }
        let base = super::local::export(&ui_db)
            .await?
            .models
            .into_iter()
            .find(|m| m.id == model.id)
            .ok_or(SyncError::new("PROBE_WINDOWS_CACHE_MISSING", false))?;
        let mut changed = base.clone();
        changed.display_name = "【演示数据】Windows 云端已删除后的本机修改".into();
        ui_sync.model(&ui_db, changed, Some(base)).await?;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(90);
        loop {
            let rejected: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE status='failedValidation' AND last_error_code='ENTITY_NOT_FOUND'").fetch_one(&ui_db.pool).await?;
            if rejected == 1 {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(SyncError::new("PROBE_WINDOWS_REJECTION_TIMEOUT", false));
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        ui_db.pool.close().await;
        let mut report = report;
        report["phase"] = json!("awaitingWindowsRecoveryDialog");
        report["nativeWorkerRejectedDemoOnlyChange"] = json!(true);
        report["rejectionCode"] = json!("ENTITY_NOT_FOUND");
        report["windowsDialogAccepted"] = json!(false);
        report["testInstallationCredentialsIntentionallyRetained"] = json!(true);
        tokio::fs::write(&state_path, serde_json::to_vec_pretty(&report)?)
            .await
            .map_err(|_| SyncError::new("PROBE_REPORT", false))?;
        println!("{report}");
    }
    Ok(())
}

#[tokio::test]
#[ignore = "显式双端验收：临时切换正式共享摘要规则，等待 Android 实机观察后恢复；不采集、不调用 AI/CMS 写接口"]
async fn windows_cdp_preference_and_android_webview_share_only_ai_rules() -> SyncResult<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tools");
    let directory = root
        .join("settings-sync-probes")
        .join(format!("transport-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    let state_path = root.join("settings-sync-transport-state.json");
    let observation_path = root.join("settings-sync-transport-android-observed.json");
    if observation_path.exists() {
        return Err(SyncError::new("PROBE_STALE_OBSERVATION", false));
    }
    let db = Database::open(&directory.join("probe.db")).await?;
    let cms = CmsService::new(&directory).map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    cms.restore_session()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
        .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
    let ai = AiService::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let sync = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let started = sync.start(&db, &ai, &cms, false).await?;
    if !started.ready || started.successful_reads != 1 || started.pending != 0 {
        return Err(SyncError::new("PROBE_START_FAILED", false));
    }
    let original = db.harvest_settings().await?;
    let mut desktop = original.clone();
    desktop.options.source_mode = SourceMode::Cdp;
    desktop.options.cdp_address = Some("http://127.0.0.1:19222".into());
    sync.harvest(&db, desktop.clone(), Some(original.clone()))
        .await?;
    let local_only = sync.status(&db).await?;
    if local_only.pending != 0 || local_only.write_requests != 0 {
        return Err(SyncError::new("PROBE_LOCAL_UPLOAD", false));
    }
    let mut changed = desktop.clone();
    changed.options.auto_summary = !original.options.auto_summary;
    sync.harvest(&db, changed.clone(), Some(desktop)).await?;
    let result: SyncResult<()> = async {
        if !sync.upload_one(&db, &cms).await? || sync.status(&db).await?.pending != 0 {
            return Err(SyncError::new("PROBE_UPLOAD_FAILED", false));
        }
        let state = json!({
            "phase":"awaitingAndroid", "originalAutoSummary":original.options.auto_summary,
            "expectedAutoSummary":changed.options.auto_summary, "desktopSourceMode":"cdp",
            "desktopLocalPreferenceUploads":0,"testDatabase":directory.join("probe.db"),
        });
        tokio::fs::write(&state_path, serde_json::to_vec_pretty(&state)?)
            .await
            .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(480);
        loop {
            if let Ok(raw) = tokio::fs::read(&observation_path).await {
                let observation: serde_json::Value = serde_json::from_slice(&raw)?;
                if observation["sourceMode"] != "webview"
                    || observation["autoSummary"] != changed.options.auto_summary
                    || observation["coldReadSuccesses"] != 1
                {
                    return Err(SyncError::new("PROBE_ANDROID_MISMATCH", false));
                }
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(SyncError::new("PROBE_ANDROID_TIMEOUT", false));
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }
    .await;
    // 即使实机观察失败，也先恢复本次临时规则；原操作仍按稳定 ID 补传。
    let baseline = db.harvest_settings().await?;
    let mut restored = baseline.clone();
    restored.options.auto_summary = original.options.auto_summary;
    sync.harvest(&db, restored, Some(baseline)).await?;
    for _ in 0..4 {
        if sync.status(&db).await?.pending == 0 {
            break;
        }
        if !sync.upload_one(&db, &cms).await? {
            return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
        }
    }
    let final_status = sync.status(&db).await?;
    let local = db.harvest_settings().await?;
    if final_status.pending != 0
        || final_status.read_requests != 1
        || local.options.source_mode != SourceMode::Cdp
        || local.options.cdp_address != changed.options.cdp_address
        || local.options.auto_summary != original.options.auto_summary
    {
        return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
    }
    let revision: i64 =
        sqlx::query_scalar("SELECT last_observed_revision FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?;
    let report = json!({
        "check":"windows-cdp-android-webview-shared-rule", "passed":result.is_ok(),
        "desktopLocalPreferenceUploads":0, "desktopSourceModePreserved":true,
        "desktopColdReads":final_status.read_requests, "desktopWriteRequests":final_status.write_requests,
        "originalSharedRuleRestored":true, "cloudRevision":revision,
        "pending":final_status.pending,"aiRequests":0,"cmsWrites":0,
        "androidObservationAcknowledged":result.is_ok(),
    });
    tokio::fs::write(&state_path, serde_json::to_vec_pretty(&report)?)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    let refs:Vec<String>=sqlx::query_scalar("SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT credential_ref FROM sync_credential_gc").fetch_all(&db.pool).await?;
    for reference in refs {
        if (reference.starts_with("sync-secret-") || reference.starts_with("sync-payload-"))
            && !sync.local.clear(&reference).await
        {
            return Err(SyncError::new("PROBE_CLEANUP_FAILED", false));
        }
    }
    db.pool.close().await;
    println!("{report}");
    result
}
