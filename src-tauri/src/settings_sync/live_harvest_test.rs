//! 显式实机验收控制器；使用真实 release 程序的采集桥接，不替代原生工作器。
use super::{
    local::{self, SyncError, SyncResult},
    runtime::SettingsSync,
};
use crate::{ai::AiService, cms::CmsService, database::Database};
use serde_json::{Value, json};
use sqlx::Row;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const SOURCE: &str = "https://baijiahao.baidu.com/s?id=1881087775499169707";

async fn report(root: &Path, value: Value) -> SyncResult<()> {
    tokio::fs::write(root.join("state.json"), serde_json::to_vec_pretty(&value)?)
        .await
        .map_err(|_| SyncError::new("PROBE_REPORT", false))
}

async fn wait_ack(root: &Path, name: &str) -> SyncResult<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    loop {
        if let Ok(raw) = tokio::fs::read(root.join(format!("{name}.json"))).await {
            let value: Value = serde_json::from_slice(&raw)?;
            if value["ownedBridgeProcessVerified"] == true {
                return Ok(());
            }
            return Err(SyncError::new("PROBE_BRIDGE_OWNER", false));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(SyncError::new("PROBE_LAUNCH_TIMEOUT", false));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn generation(db: &Database) -> SyncResult<String> {
    Ok(
        sqlx::query_scalar("SELECT active_generation FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?,
    )
}

async fn wait_new_generation(db: &Database, previous: &str) -> SyncResult<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    while generation(db).await? == previous {
        if tokio::time::Instant::now() >= deadline {
            return Err(SyncError::new("PROBE_COLD_READ_TIMEOUT", false));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(())
}

async fn enqueue(client: &reqwest::Client, id: &str, url: &str) -> SyncResult<()> {
    let response = client
        .post("http://127.0.0.1:18765/api/v1/harvest")
        .header("X-PressDock-Client", "userscript-v1")
        .json(&json!({"id":id,"url":url}))
        .send()
        .await
        .map_err(|_| SyncError::new("PROBE_ENQUEUE", false))?;
    if !response.status().is_success() {
        return Err(SyncError::new("PROBE_ENQUEUE", false));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| SyncError::new("PROBE_ENQUEUE", false))?;
    if value["jobId"] != id {
        return Err(SyncError::new("PROBE_UNEXPECTED_DEDUP", false));
    }
    Ok(())
}

async fn job_status(db: &Database, id: &str) -> SyncResult<String> {
    Ok(
        sqlx::query_scalar("SELECT status FROM harvest_jobs WHERE id=?")
            .bind(id)
            .fetch_one(&db.pool)
            .await?,
    )
}

async fn wait_running(db: &Database, id: &str) -> SyncResult<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        match job_status(db, id).await?.as_str() {
            "running" => return Ok(()),
            "queued" => {}
            _ => return Err(SyncError::new("PROBE_MISSED_RUNNING", false)),
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(SyncError::new("PROBE_RUNNING_TIMEOUT", false));
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn wait_completed(root: &Path, db: &Database, id: &str) -> SyncResult<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(900);
    let mut verification_reported = false;
    loop {
        let status = job_status(db, id).await?;
        match status.as_str() {
            "debugCompleted" => return Ok(()),
            "queued" | "running" => {}
            "waitingUser" => {
                if !verification_reported {
                    report(root, json!({"phase":"waitingForSourceVerification","jobId":id,
                        "processingOnly":true,"instruction":"请在原生来源窗口完成验证，再在 PressDock 点击验证完成，继续"})).await?;
                    verification_reported = true;
                }
            }
            _ => {
                let error: Option<String> =
                    sqlx::query_scalar("SELECT error FROM harvest_jobs WHERE id=?")
                        .bind(id)
                        .fetch_one(&db.pool)
                        .await?;
                report(
                    root,
                    json!({"phase":"taskStopped","jobId":id,"status":status,"error":error}),
                )
                .await?;
                return Err(SyncError::new("PROBE_HARVEST_STOPPED", false));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(SyncError::new("PROBE_HARVEST_TIMEOUT", false));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn job_evidence(db: &Database, id: &str) -> SyncResult<Value> {
    let row = sqlx::query("SELECT status,options,formatted,prepared,submitted_at,cms_article_id,attempts,warnings FROM harvest_jobs WHERE id=?")
        .bind(id).fetch_one(&db.pool).await?;
    let options: Value = serde_json::from_str(row.try_get("options")?)?;
    let formatted: Value = serde_json::from_str(row.try_get("formatted")?)?;
    let prepared: Value = serde_json::from_str(row.try_get("prepared")?)?;
    let submitted: Option<String> = row.try_get("submitted_at")?;
    let cms_id: Option<String> = row.try_get("cms_article_id")?;
    let warnings: Value = serde_json::from_str(row.try_get("warnings")?)?;
    if row.try_get::<&str, _>("status")? != "debugCompleted"
        || options["developerMode"] != true
        || submitted.is_some()
        || cms_id.is_some()
        || options["metadataSnapshot"].is_null()
        || prepared["newsText"].as_str().is_none_or(str::is_empty)
    {
        return Err(SyncError::new("PROBE_TASK_EVIDENCE", false));
    }
    Ok(
        json!({"jobId":id,"status":"debugCompleted","processingOnly":true,
        "autoSummarySnapshot":options["autoSummary"],"metadataExecutionSnapshotPresent":true,
        "paginationSnapshotPresent":!options["paginationSnapshot"].is_null(),
        "summaryChangedFromFormatter":prepared["smallText"]!=formatted["smallText"],
        "preparedResultPresent":true,"attempts":row.try_get::<i64,_>("attempts")?,
        "warningCount":warnings.as_array().map_or(0, Vec::len),
        "submissionIntentRecorded":false,"cmsArticleIdPresent":false}),
    )
}

#[tokio::test]
#[ignore = "用户指定真实来源链接：使用独立 Windows release 仅处理任务，临时切换正式摘要规则后恢复；会执行启用的 AI，禁止 CMS 文章写入"]
async fn running_native_harvest_keeps_snapshot_and_restarted_job_uses_new_rule() -> SyncResult<()> {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tools/settings-sync-harvest-live");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    if root.join("state.json").exists() {
        return Err(SyncError::new("PROBE_STALE_STATE", false));
    }
    let data =
        PathBuf::from(std::env::var_os("APPDATA").ok_or(SyncError::new("PROBE_PATH", false))?)
            .join("com.example.pressdock.installercheck");
    if data.exists() {
        return Err(SyncError::new("PROBE_EXISTING_INSTALLATION", false));
    }
    tokio::fs::create_dir(&data)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    let db = Database::open(&data.join("pressdock.db")).await?;
    let cms = CmsService::new(&data).map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    cms.restore_session()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
        .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
    let ai = AiService::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let sync = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let status = sync.start(&db, &ai, &cms, false).await?;
    if !status.ready || status.pending != 0 {
        return Err(SyncError::new("PROBE_START_FAILED", false));
    }
    let original = local::export(&db).await?;
    let original_settings = db.harvest_settings().await?;
    if !original_settings.options.auto_summary
        || original_settings.options.model_config_id.is_none()
    {
        return Err(SyncError::new("PROBE_UNEXPECTED_BASELINE", false));
    }
    db.harvest_set_developer_mode(true).await?;
    let baseline = db.harvest_settings().await?;
    let before_generation = generation(&db).await?;
    let first_id = uuid::Uuid::new_v4().to_string();
    let second_id = uuid::Uuid::new_v4().to_string();
    let result: SyncResult<Value> = async {
        report(&root,json!({"phase":"readyForFirstLaunch","applicationIdentifier":"com.example.pressdock.installercheck","processingOnly":true,"firstJobId":first_id,"secondJobId":second_id})).await?;
        wait_ack(&root,"first-launch").await?;
        wait_new_generation(&db,&before_generation).await?;
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(20)).build()
            .map_err(|_|SyncError::new("SYNC_NETWORK",true))?;
        enqueue(&client,&first_id,SOURCE).await?;
        wait_running(&db,&first_id).await?;
        let mut changed = baseline.clone();
        changed.options.auto_summary = false;
        sync.harvest(&db,changed,Some(baseline.clone())).await?;
        let running_after_change = job_status(&db,&first_id).await? == "running";
        if !running_after_change { return Err(SyncError::new("PROBE_MISSED_RUNNING",false)); }
        if !sync.upload_one(&db,&cms).await? { return Err(SyncError::new("PROBE_UPLOAD_FAILED",false)); }
        report(&root,json!({"phase":"firstTaskProcessing","firstJobId":first_id,"changedWhileRunning":true,"currentAutoSummary":false})).await?;
        wait_completed(&root,&db,&first_id).await?;
        let first = job_evidence(&db,&first_id).await?;
        let old_payload: String = sqlx::query_scalar("SELECT options || prepared FROM harvest_jobs WHERE id=?")
            .bind(&first_id).fetch_one(&db.pool).await?;
        let before_restart = generation(&db).await?;
        report(&root,json!({"phase":"readyForRestart","first":first,"processingOnly":true})).await?;
        wait_ack(&root,"restart-launch").await?;
        wait_new_generation(&db,&before_restart).await?;
        if db.harvest_settings().await?.options.auto_summary { return Err(SyncError::new("PROBE_RULE_NOT_DOWNLOADED",false)); }
        // 同一文章仅增加无业务意义的验收查询参数，避免保留期去重复用旧任务。
        enqueue(&client,&second_id,&format!("{SOURCE}&pressdock_acceptance=second")).await?;
        report(&root,json!({"phase":"secondTaskProcessing","first":first,"secondJobId":second_id})).await?;
        wait_completed(&root,&db,&second_id).await?;
        let second = job_evidence(&db,&second_id).await?;
        let old_after: String = sqlx::query_scalar("SELECT options || prepared FROM harvest_jobs WHERE id=?")
            .bind(&first_id).fetch_one(&db.pool).await?;
        if first["autoSummarySnapshot"] != true || second["autoSummarySnapshot"] != false
            || first["summaryChangedFromFormatter"] != true || second["summaryChangedFromFormatter"] != false
            || old_payload != old_after || first["attempts"] != 1 || second["attempts"] != 1
        { return Err(SyncError::new("PROBE_SNAPSHOT_MISMATCH",false)); }
        Ok(json!({"check":"windows-real-running-harvest-configuration-snapshot","passed":true,
            "sourceUrl":SOURCE,"first":first,"second":second,"changedWhileFirstJobRunning":true,
            "secondJobCreatedAfterNativeColdRestart":true,"firstJobSnapshotAndPreparedResultUnchanged":true,
            "cmsArticleWrites":0,"explicitlyEnqueuedJobs":2,"aiRequestsMayHaveExecuted":true}))
    }.await;
    // 失败也恢复共享规则；通过同一持久队列上传，不重建正式配置。
    let current = db.harvest_settings().await?;
    let mut restored = current.clone();
    restored.options.auto_summary = original_settings.options.auto_summary;
    sync.harvest(&db, restored, Some(current)).await?;
    for _ in 0..4 {
        if sync.status(&db).await?.pending == 0 {
            break;
        }
        sync.upload_one(&db, &cms).await?;
    }
    let verify = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let verified = verify.start(&db, &ai, &cms, false).await?;
    if verified.pending != 0
        || !verified.ready
        || serde_json::to_value(local::export(&db).await?)? != serde_json::to_value(&original)?
    {
        return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
    }
    let revision: i64 =
        sqlx::query_scalar("SELECT last_observed_revision FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?;
    let outcome = match &result {
        Ok(value) => {
            json!({"phase":"completed","evidence":value,"originalSharedConfigurationRestored":true,"cloudRevision":revision})
        }
        Err(error) => {
            json!({"phase":"failed","errorCode":error.code,"originalSharedConfigurationRestored":true,"cloudRevision":revision})
        }
    };
    report(&root, outcome.clone()).await?;
    println!("{outcome}");
    result.map(|_| ())
}

#[tokio::test]
#[ignore = "续验已完成手工来源验证的专用任务；冷重启后显式创建第二条仅处理任务，会执行 AI，禁止 CMS 文章写入"]
async fn verified_source_continues_with_snapshot_then_cold_restart_uses_changed_rule()
-> SyncResult<()> {
    let parent =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tools/settings-sync-harvest-live");
    let root = parent.join("continuation");
    if root.exists() || parent.join("restart-launch.json").exists() {
        return Err(SyncError::new("PROBE_STALE_STATE", false));
    }
    tokio::fs::create_dir(&root)
        .await
        .map_err(|_| SyncError::new("PROBE_REPORT", false))?;
    let data =
        PathBuf::from(std::env::var_os("APPDATA").ok_or(SyncError::new("PROBE_PATH", false))?)
            .join("com.example.pressdock.installercheck");
    let db = Database::open(&data.join("pressdock.db")).await?;
    let first_id = "27c85871-5e98-4876-9f3a-3021e541323f";
    let first = job_evidence(&db, first_id).await?;
    if first["autoSummarySnapshot"] != true
        || first["summaryChangedFromFormatter"] != true
        || first["attempts"] != 2
    {
        return Err(SyncError::new("PROBE_SNAPSHOT_MISMATCH", false));
    }
    let cms = CmsService::new(&data).map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    cms.restore_session()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
        .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
    let ai = AiService::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let sync = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let started = sync.start(&db, &ai, &cms, false).await?;
    if !started.ready || started.pending != 0 {
        return Err(SyncError::new("PROBE_START_FAILED", false));
    }
    let original = local::export(&db).await?;
    let baseline = db.harvest_settings().await?;
    if !baseline.options.auto_summary || !baseline.options.developer_mode {
        return Err(SyncError::new("PROBE_UNEXPECTED_BASELINE", false));
    }
    let old_payload: String =
        sqlx::query_scalar("SELECT options || prepared FROM harvest_jobs WHERE id=?")
            .bind(first_id)
            .fetch_one(&db.pool)
            .await?;
    let result: SyncResult<Value> = async {
        let mut changed = baseline.clone();
        changed.options.auto_summary = false;
        sync.harvest(&db, changed, Some(baseline.clone())).await?;
        if !sync.upload_one(&db, &cms).await? {
            return Err(SyncError::new("PROBE_UPLOAD_FAILED", false));
        }
        let before_restart = generation(&db).await?;
        report(&root, json!({"phase":"readyForRestart","first":first,"processingOnly":true,"cloudAutoSummary":false,"priorControllerTimedOut":true})).await?;
        wait_ack(&parent, "restart-launch").await?;
        wait_new_generation(&db, &before_restart).await?;
        if db.harvest_settings().await?.options.auto_summary {
            return Err(SyncError::new("PROBE_RULE_NOT_DOWNLOADED", false));
        }
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(20)).build()
            .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
        let second_id = uuid::Uuid::new_v4().to_string();
        enqueue(&client, &second_id, &format!("{SOURCE}&pressdock_acceptance=verified-source-cold-restart")).await?;
        report(&root, json!({"phase":"secondTaskProcessing","first":first,"secondJobId":second_id,"processingOnly":true})).await?;
        wait_completed(&root, &db, &second_id).await?;
        let second = job_evidence(&db, &second_id).await?;
        let old_after: String = sqlx::query_scalar("SELECT options || prepared FROM harvest_jobs WHERE id=?")
            .bind(first_id).fetch_one(&db.pool).await?;
        if second["autoSummarySnapshot"] != false
            || second["summaryChangedFromFormatter"] != false
            || second["attempts"] != 1 || old_payload != old_after
        {
            return Err(SyncError::new("PROBE_SNAPSHOT_MISMATCH", false));
        }
        Ok(json!({"check":"windows-real-harvest-after-manual-source-verification","passed":true,
            "first":first,"second":second,"priorControllerTimedOut":true,
            "firstTaskHadExplicitSourceRetry":true,"firstAttemptHadNoFormattedOrPreparedResult":true,
            "secondJobCreatedAfterNativeColdRestart":true,"firstJobSnapshotAndPreparedResultUnchanged":true,
            "cmsArticleWrites":0,"aiRequestsMayHaveExecuted":true}))
    }.await;
    let current = db.harvest_settings().await?;
    let mut restored = current.clone();
    restored.options.auto_summary = baseline.options.auto_summary;
    sync.harvest(&db, restored, Some(current)).await?;
    for _ in 0..4 {
        if sync.status(&db).await?.pending == 0 {
            break;
        }
        sync.upload_one(&db, &cms).await?;
    }
    let verify = SettingsSync::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let verified = verify.start(&db, &ai, &cms, false).await?;
    if verified.pending != 0
        || !verified.ready
        || serde_json::to_value(local::export(&db).await?)? != serde_json::to_value(&original)?
    {
        return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
    }
    let revision: i64 =
        sqlx::query_scalar("SELECT last_observed_revision FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?;
    let outcome = match &result {
        Ok(value) => {
            json!({"phase":"completed","evidence":value,"originalSharedConfigurationRestored":true,"cloudRevision":revision})
        }
        Err(error) => {
            json!({"phase":"failed","errorCode":error.code,"originalSharedConfigurationRestored":true,"cloudRevision":revision})
        }
    };
    report(&root, outcome.clone()).await?;
    println!("{outcome}");
    result.map(|_| ())
}
