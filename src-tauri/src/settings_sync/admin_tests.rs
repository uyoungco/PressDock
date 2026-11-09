use super::*;
use std::io::{BufRead, Write};

struct OwnedProbeChild(std::process::Child);
impl Drop for OwnedProbeChild {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

pub(super) async fn after_cloud_commit_before_local_receipt(receipt: &Receipt) {
    if std::env::var_os("PRESSDOCK_INIT_POST_COMMIT_DB").is_some() {
        assert_eq!(receipt.revision, 1, "专项空库的首次初始化必须为版本 1");
        println!("PRESSDOCK_INIT_COMMITTED:{}", receipt.operation_id);
        std::io::stdout().flush().unwrap();
        std::future::pending::<()>().await;
    }
}

#[tokio::test]
#[ignore = "显式真实云端故障：仅使用 pressdock-settings-init-qa-20261107 空库和演示密钥，云端初始化后强杀专用子进程；不访问正式配置或 AI/CMS 写接口"]
async fn real_cloud_commit_then_forced_exit_retries_original_initialization_once() -> SyncResult<()>
{
    const NAME: &str = "settings_sync::admin::tests::real_cloud_commit_then_forced_exit_retries_original_initialization_once";
    let sync = SettingsSync::initialization_fault_probe()
        .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    if let Some(path) = std::env::var_os("PRESSDOCK_INIT_POST_COMMIT_DB") {
        let db = Database::open(std::path::Path::new(&path)).await?;
        let cms = CmsService::new(std::path::Path::new(&path).parent().unwrap())
            .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
        cms.restore_session()
            .await
            .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
            .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
        let (_, token) = cms
            .settings_authorization()
            .await
            .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
        return initialize(&db, &sync, &token).await;
    }
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("post-cloud-commit.db");
    let cms =
        CmsService::new(directory.path()).map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    cms.restore_session()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
        .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
    let (_, token) = cms
        .settings_authorization()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
    assert!(
        matches!(sync.request(&token,"bootstrap",None).await,Err(ref e) if e.code=="NOT_INITIALIZED"),
        "必须使用尚未初始化的独立专项云库"
    );
    let db = Database::open(&path).await?;
    LocalStore::ensure_device(&db).await?;
    sync.local
        .install(&db, crate::settings_sync::local_tests::boot())
        .await?;
    db.pool.close().await;
    use std::os::windows::process::CommandExt;
    let mut child = OwnedProbeChild(
        std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", NAME, "--nocapture"])
            .env("PRESSDOCK_INIT_POST_COMMIT_DB", &path)
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap(),
    );
    let stdout = child.0.stdout.take().unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout)
            .lines()
            .map_while(|line| line.ok())
        {
            if let Some(id) = line.strip_prefix("PRESSDOCK_INIT_COMMITTED:") {
                let _ = sender.send(id.to_owned());
                break;
            }
        }
    });
    let ready = receiver.recv_timeout(std::time::Duration::from_secs(60));
    // 只操作本测试通过 Child 句柄创建的进程，超时也必须关闭它，防止延迟上传。
    let before_kill = Database::open(&path).await?;
    let preparation:SyncResult<(String,Vec<u8>)>=async {
        let id=ready.map_err(|_|SyncError::new("PROBE_COMMIT_TIMEOUT",false))?;
        let payload:String=sqlx::query_scalar("SELECT wire_body_payload_id FROM sync_initialization WHERE environment='production' AND receipt_json IS NULL").fetch_one(&before_kill.pool).await?;
        assert_eq!(payload,id);
        let raw=sync.local.unseal(&before_kill,&payload).await?;
        let remote:Bootstrap=serde_json::from_slice(&sync.request(&token,"bootstrap",None).await?)?;
        assert_eq!(remote.snapshot.revision,1);
        assert!(remote.secrets.iter().all(|s|s.value.as_deref()==Some("DEMO-ONLY-native")));
        Ok((id,raw))
    }.await;
    let killed = child.0.kill().is_ok();
    let _ = child.0.wait();
    before_kill.pool.close().await;
    let reopened = Database::open(&path).await?;
    let result:SyncResult<Value>=async {
        let (id,raw)=preparation?;
        assert!(killed,"已确认云端提交后，只强杀本测试的子进程");
        sync.local.collect(&reopened).await?;
        assert_eq!(sync.local.unseal(&reopened,&id).await?,raw,"强杀后恢复的请求必须逐字节一致");
        initialize(&reopened,&sync,&token).await?;
        let row=sqlx::query("SELECT wire_body_payload_id,receipt_json FROM sync_initialization WHERE environment='production'").fetch_one(&reopened.pool).await?;
        assert!(row.try_get::<Option<String>,_>("wire_body_payload_id")?.is_none());
        let receipt:Receipt=serde_json::from_str(&row.try_get::<String,_>("receipt_json")?)?;
        assert_eq!(receipt.operation_id,id);
        assert_eq!(receipt.revision,1);
        initialize(&reopened,&sync,&token).await?;
        let remote:Bootstrap=serde_json::from_slice(&sync.request(&token,"bootstrap",None).await?)?;
        assert_eq!(remote.snapshot.revision,1);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM sync_secure_payloads").fetch_one(&reopened.pool).await?,0);
        Ok(json!({"check":"windows-native-post-cloud-commit-forced-exit","passed":true,
            "isolatedCloudOrigin":"https://pressdock-settings-init-qa-20261107.i9543.workers.dev",
            "realCmsAuthentication":true,"cloudCommitConfirmedBeforeForcedExit":true,
            "localReceiptAbsentAtForcedExit":true,"originalRequestRecoveredByteForByte":true,
            "recoveredOriginalOperationId":true,"cloudRevisionAfterRetry":1,
            "localReceiptPersistedAfterRetry":true,"thirdInitializeSkippedUpload":true,
            "pendingInitializationPayloads":0,"aiRequests":0,"cmsWrites":0}))
    }.await;
    let refs:Vec<String>=sqlx::query_scalar("SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT credential_ref FROM sync_credential_gc").fetch_all(&reopened.pool).await?;
    for reference in refs {
        assert!(sync.local.clear(&reference).await);
    }
    reopened.pool.close().await;
    let mut report = result?;
    report["dedicatedNativeCredentialsCleaned"] = json!(true);
    let report_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.tools/settings-sync-init-post-commit/native-result.json");
    tokio::fs::write(report_path, serde_json::to_vec_pretty(&report)?)
        .await
        .map_err(|_| SyncError::new("PROBE_REPORT", false))?;
    println!("{report}");
    Ok(())
}

const TEST_NAME: &str =
    "settings_sync::admin::tests::native_initialization_missing_source_key_and_forced_process_exit";

#[tokio::test]
#[ignore = "显式运行：仅临时数据库和专用演示 Windows 凭据；强制结束本测试创建的子进程；不访问云端"]
async fn native_initialization_missing_source_key_and_forced_process_exit() -> SyncResult<()> {
    let local = LocalStore::default();
    if let Some(path) = std::env::var_os("PRESSDOCK_INIT_KILL_PROBE_DB") {
        let db = Database::open(std::path::Path::new(&path)).await?;
        let (config, secrets) = capture_initialization(&local, &db).await?;
        let raw = local
            .freeze_initialization(&db, "development", config, secrets)
            .await?;
        let init: Initialize = serde_json::from_slice(&raw)?;
        let _credentials = LocalStore::credential_guard(&db).await?;
        // 此行只含随机操作 ID，通知父进程持久化已经完成，然后等待被强制终止。
        println!("PRESSDOCK_INIT_READY:{}", init.operation_id);
        std::io::stdout().flush().unwrap();
        std::future::pending::<()>().await;
        unreachable!();
    }
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("initialization-probe.db");
    let db = Database::open(&path).await?;
    LocalStore::ensure_device(&db).await?;
    local
        .install(&db, crate::settings_sync::local_tests::boot())
        .await?;
    let reference = db.ai_credential_ref("demo-provider").await?.unwrap();
    assert!(local.clear(&reference).await);
    let failure = capture_initialization(&local, &db).await;
    assert!(matches!(failure,Err(ref e) if e.code=="SYNC_CREDENTIAL_STORE"));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sync_initialization")
            .fetch_one(&db.pool)
            .await?,
        0
    );
    local
        .vault
        .save(&reference, "DEMO-ONLY-repaired-init-source")
        .map_err(SyncError::from)?;
    db.pool.close().await;
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", TEST_NAME, "--nocapture"])
        .env("PRESSDOCK_INIT_KILL_PROBE_DB", &path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout)
            .lines()
            .map_while(|line| line.ok())
        {
            if let Some(id) = line.strip_prefix("PRESSDOCK_INIT_READY:") {
                let _ = sender.send(id.to_owned());
                break;
            }
        }
    });
    let ready = receiver.recv_timeout(std::time::Duration::from_secs(30));
    let killed = child.kill().is_ok();
    let _ = child.wait();
    let reopened = Database::open(&path).await?;
    local.collect(&reopened).await?;
    let result: SyncResult<()> = async {
        let id = ready.map_err(|_| SyncError::new("PROBE_PREPARE_FAILED", false))?;
        assert!(killed, "只能终止本测试已确认进入等待的子进程");
        let payload: String = sqlx::query_scalar(
            "SELECT wire_body_payload_id FROM sync_initialization WHERE environment='development'",
        )
        .fetch_one(&reopened.pool)
        .await?;
        assert_eq!(payload, id);
        let frozen = local.unseal(&reopened, &payload).await?;
        let request: Initialize = serde_json::from_slice(&frozen)?;
        assert_eq!(request.operation_id, id);
        assert_eq!(
            request.secrets[0].value.as_deref(),
            Some("DEMO-ONLY-repaired-init-source")
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sync_initialization")
                .fetch_one(&reopened.pool)
                .await?,
            1
        );
        assert_eq!(local.unseal(&reopened, &payload).await?, frozen);
        Ok(())
    }
    .await;
    let refs:Vec<String>=sqlx::query_scalar("SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT credential_ref FROM sync_credential_gc").fetch_all(&reopened.pool).await?;
    for reference in refs {
        assert!(local.clear(&reference).await);
    }
    reopened.pool.close().await;
    result?;
    println!(
        "{}",
        json!({"check":"windows-native-initialization-faults","passed":true,"missingSourceKeyRejected":true,"frozenInitializationRecoveredAfterForcedProcessExit":true,"cloudRequests":0,"aiRequests":0,"cmsWrites":0,"dedicatedCredentialsCleaned":true})
    );
    Ok(())
}
