//! 用户限定 Windows 后的真实多进程验收；仅访问开发 Worker/D1。
use super::{
    local::{self, SyncError, SyncResult},
    runtime::SettingsSync,
};
use crate::{ai::AiService, cms::CmsService, database::Database};
use serde_json::{Value, json};
use sqlx::Row;
use std::{path::Path, process::Child, time::Duration};

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn write(path: &Path, value: &Value) -> SyncResult<()> {
    let temporary = path.with_extension("tmp");
    tokio::fs::write(&temporary, serde_json::to_vec_pretty(value)?)
        .await
        .map_err(|_| SyncError::new("PROBE_REPORT", false))?;
    tokio::fs::rename(temporary, path)
        .await
        .map_err(|_| SyncError::new("PROBE_REPORT", false))
}

async fn wait(path: &Path) -> SyncResult<Value> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
    loop {
        match tokio::fs::read(path).await {
            Ok(value) => return Ok(serde_json::from_slice(&value)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(SyncError::new("PROBE_REPORT", false)),
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(SyncError::new("PROBE_CHILD_TIMEOUT", false));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_pair(root: &Path, first: &str, second: &str) -> SyncResult<(Value, Value)> {
    let first = root.join(first);
    let second = root.join(second);
    tokio::try_join!(wait(&first), wait(&second))
}

async fn wait_exit(child: &mut OwnedChild) -> SyncResult<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = child
            .0
            .try_wait()
            .map_err(|_| SyncError::new("PROBE_CHILD_EXIT", false))?
        {
            return if status.success() {
                Ok(())
            } else {
                Err(SyncError::new("PROBE_CHILD_EXIT", false))
            };
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(SyncError::new("PROBE_CHILD_EXIT_TIMEOUT", false));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn open(path: &Path) -> SyncResult<(Database, CmsService, SettingsSync)> {
    let db = Database::open(path).await?;
    let cms = CmsService::new(path.parent().ok_or(SyncError::new("PROBE_PATH", false))?)
        .map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    cms.restore_session()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?
        .ok_or(SyncError::new("AUTH_EXPIRED", false))?;
    let ai = AiService::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let sync = SettingsSync::development().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let status = sync.start(&db, &ai, &cms, false).await?;
    if !status.ready || status.read_requests != 1 || status.pending != 0 {
        println!("startupStatus={}", serde_json::to_string(&status)?);
        clean(&db, &sync).await?;
        return Err(SyncError::new("PROBE_START_FAILED", false));
    }
    Ok((db, cms, sync))
}

async fn clean(db: &Database, sync: &SettingsSync) -> SyncResult<()> {
    let refs: Vec<String> = sqlx::query_scalar("SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT credential_ref FROM sync_credential_gc")
        .fetch_all(&db.pool).await?;
    for reference in refs {
        if !(reference.starts_with("sync-secret-") || reference.starts_with("sync-payload-"))
            || !sync.local.clear(&reference).await
        {
            return Err(SyncError::new("PROBE_CLEANUP_FAILED", false));
        }
    }
    db.pool.close().await;
    Ok(())
}

async fn child(root: &Path, role: &str) -> SyncResult<()> {
    if !matches!(role, "a" | "b" | "c") {
        return Err(SyncError::new("PROBE_CHILD_ROLE", false));
    }
    let (db, cms, sync) = open(&root.join(format!("{role}.db"))).await?;
    let config = local::export(&db).await?;
    let mut model = config
        .models
        .first()
        .cloned()
        .ok_or(SyncError::new("PROBE_NO_MODEL", false))?;
    // 绝不把测试参数应用到可能误配的真实配置环境。
    if !model.id.to_ascii_lowercase().contains("demo")
        && !model.display_name.to_ascii_lowercase().contains("demo")
        && !model.display_name.contains("演示")
    {
        clean(&db, &sync).await?;
        return Err(SyncError::new("PROBE_NOT_DEMO", false));
    }
    let device: String = sqlx::query_scalar("SELECT device_id FROM sync_state WHERE id=1")
        .fetch_one(&db.pool)
        .await?;
    write(&root.join(format!("{role}-ready.json")), &json!({"processId":std::process::id(),"deviceId":device,"config":config,"readRequests":1,"pending":0})).await?;
    let work: SyncResult<()> = async {
        if role == "c" { return Ok(()); }
        for step in 1..=2 {
            let command = wait(&root.join(format!("{role}-{step}-command.json"))).await?;
            let mut changed = model.clone();
            match command["field"].as_str() {
                Some("displayName") => changed.display_name = command["value"].as_str().ok_or(SyncError::new("PROBE_COMMAND", false))?.into(),
                Some("modelId") => changed.model_id = command["value"].as_str().ok_or(SyncError::new("PROBE_COMMAND", false))?.into(),
                _ => return Err(SyncError::new("PROBE_COMMAND", false)),
            }
            sync.model(&db, changed.clone(), Some(model.clone())).await?;
            write(&root.join(format!("{role}-{step}-staged.json")), &json!({"pending":sync.status(&db).await?.pending})).await?;
            wait(&root.join(format!("{role}-{step}-release.json"))).await?;
            if !sync.upload_one(&db, &cms).await? { return Err(SyncError::new("PROBE_UPLOAD_FAILED", false)); }
            let status = sync.status(&db).await?;
            if status.pending != 0 || status.read_requests != 1 || status.write_requests != step {
                return Err(SyncError::new("PROBE_COUNTER_MISMATCH", false));
            }
            let row=sqlx::query("SELECT last_observed_revision FROM sync_state WHERE id=1").fetch_one(&db.pool).await?;
            write(&root.join(format!("{role}-{step}-receipt.json")), &json!({"accepted":true,"revision":row.try_get::<i64,_>("last_observed_revision")?,"readRequests":status.read_requests,"writeRequests":status.write_requests,"pending":status.pending})).await?;
            model=changed;
        }
        Ok(())
    }.await;
    clean(&db, &sync).await?;
    work
}

fn spawn(root: &Path, role: &str) -> SyncResult<OwnedChild> {
    let output = std::fs::File::create(root.join(format!("{role}-process.log")))
        .map_err(|_| SyncError::new("PROBE_REPORT", false))?;
    let error = output
        .try_clone()
        .map_err(|_| SyncError::new("PROBE_REPORT", false))?;
    std::process::Command::new(
        std::env::current_exe().map_err(|_| SyncError::new("PROBE_PATH", false))?,
    )
    .args([
        "--ignored",
        "--exact",
        "settings_sync::windows_process_test::windows_native_three_process_merge_and_cold_read",
        "--nocapture",
    ])
    .env("PRESSDOCK_WINDOWS_PROCESS_ROOT", root)
    .env("PRESSDOCK_WINDOWS_PROCESS_ROLE", role)
    .stdout(output)
    .stderr(error)
    .spawn()
    .map(OwnedChild)
    .map_err(|_| SyncError::new("PROBE_CHILD_START", false))
}

#[tokio::test]
#[ignore = "真实 Windows 三进程：仅临时修改开发 D1 演示模型两个字段并恢复；使用现有 CMS 鉴权和真实 Windows 凭据库，不调用 AI/CMS 写接口"]
async fn windows_native_three_process_merge_and_cold_read() -> SyncResult<()> {
    if let Some(root) = std::env::var_os("PRESSDOCK_WINDOWS_PROCESS_ROOT") {
        let role = std::env::var("PRESSDOCK_WINDOWS_PROCESS_ROLE")
            .map_err(|_| SyncError::new("PROBE_CHILD_ROLE", false))?;
        return child(Path::new(&root), &role).await;
    }
    let root =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../.tools/settings-sync-windows-process-2");
    if root.exists() {
        return Err(SyncError::new("PROBE_STALE_STATE", false));
    }
    tokio::fs::create_dir(&root)
        .await
        .map_err(|_| SyncError::new("PROBE_PATH", false))?;
    let mut a = spawn(&root, "a")?;
    let a_ready = wait(&root.join("a-ready.json")).await?;
    let mut b = spawn(&root, "b")?;
    let b_ready = wait(&root.join("b-ready.json")).await?;
    if a_ready["config"] != b_ready["config"]
        || a_ready["deviceId"] == b_ready["deviceId"]
        || a_ready["processId"] == b_ready["processId"]
    {
        return Err(SyncError::new("PROBE_CLIENT_ISOLATION", false));
    }
    let original: super::Config = serde_json::from_value(a_ready["config"].clone())?;
    let result:SyncResult<Value>=async {
        write(&root.join("a-1-command.json"),&json!({"field":"displayName","value":"【演示数据】Windows 并发名称"})).await?;
        write(&root.join("b-1-command.json"),&json!({"field":"modelId","value":"DEMO-ONLY-windows-concurrent-model"})).await?;
        let (a_staged,b_staged)=wait_pair(&root,"a-1-staged.json","b-1-staged.json").await?;
        if a_staged["pending"]!=1 || b_staged["pending"]!=1 {return Err(SyncError::new("PROBE_NOT_STAGED",false));}
        write(&root.join("a-1-release.json"),&json!({"release":true})).await?;
        write(&root.join("b-1-release.json"),&json!({"release":true})).await?;
        let (first_a,first_b)=wait_pair(&root,"a-1-receipt.json","b-1-receipt.json").await?;
        let (check_db,_,check_sync)=open(&root.join("merge-check.db")).await?;
        let mut expected=original.clone();
        expected.models[0].display_name="【演示数据】Windows 并发名称".into();
        expected.models[0].model_id="DEMO-ONLY-windows-concurrent-model".into();
        let merged=serde_json::to_value(local::export(&check_db).await?)?==serde_json::to_value(&expected)?;
        clean(&check_db,&check_sync).await?;
        if !merged {return Err(SyncError::new("PROBE_MERGE_FAILED",false));}
        let mut last_receipts=Vec::new();
        for (role,value) in [("a","【演示数据】Windows 先保存"),("b","【演示数据】Windows 后保存")] {
            write(&root.join(format!("{role}-2-command.json")),&json!({"field":"displayName","value":value})).await?;
            wait(&root.join(format!("{role}-2-staged.json"))).await?;
            write(&root.join(format!("{role}-2-release.json")),&json!({"release":true})).await?;
            last_receipts.push(wait(&root.join(format!("{role}-2-receipt.json"))).await?);
        }
        if last_receipts[0]["revision"].as_i64()>=last_receipts[1]["revision"].as_i64() {return Err(SyncError::new("PROBE_COMMIT_ORDER",false));}
        tokio::try_join!(wait_exit(&mut a),wait_exit(&mut b))?;
        let mut c=spawn(&root,"c")?;
        let final_read=wait(&root.join("c-ready.json")).await?;
        wait_exit(&mut c).await?;
        expected.models[0].display_name="【演示数据】Windows 后保存".into();
        if final_read["config"]!=serde_json::to_value(expected)? || final_read["deviceId"]==a_ready["deviceId"] || final_read["deviceId"]==b_ready["deviceId"] {return Err(SyncError::new("PROBE_FINAL_READ",false));}
        Ok(json!({"passed":true,"check":"windows-native-three-process-merge-and-cold-read",
            "demoDevelopmentEnvironmentOnly":true,"distinctProcesses":3,"distinctDeviceIds":3,
            "differentFieldsOnSameModelMerged":true,"unrelatedConfigurationUnchanged":true,
            "sameFieldLastAcceptedWriteWon":true,"firstConcurrentReceipts":[first_a,first_b],
            "orderedSameFieldReceipts":last_receipts,"thirdProcessColdReadRequests":1,
            "firstTwoProcessesReadsAfterTwoSavesEach":[1,1],"pending":0,"aiRequests":0,"cmsWrites":0}))
    }.await;
    drop(a);
    drop(b);
    // 失败也尝试恢复原演示字段，绝不重建或初始化既有 D1。
    let (restore_db, cms, restore_sync) = open(&root.join("restore.db")).await?;
    let before = local::export(&restore_db).await?;
    restore_sync
        .model(
            &restore_db,
            original.models[0].clone(),
            before.models.first().cloned(),
        )
        .await?;
    if restore_sync.status(&restore_db).await?.pending > 0 {
        restore_sync.upload_one(&restore_db, &cms).await?;
    }
    clean(&restore_db, &restore_sync).await?;
    let (verify_db, _, verify_sync) = open(&root.join("restored-check.db")).await?;
    let restored =
        serde_json::to_value(local::export(&verify_db).await?)? == serde_json::to_value(original)?;
    let revision: i64 =
        sqlx::query_scalar("SELECT last_observed_revision FROM sync_state WHERE id=1")
            .fetch_one(&verify_db.pool)
            .await?;
    clean(&verify_db, &verify_sync).await?;
    let report = match &result {
        Ok(value) => {
            json!({"evidence":value,"originalDevelopmentConfigurationRestored":restored,"developmentRevision":revision,"dedicatedNativeCredentialsCleaned":true})
        }
        Err(error) => {
            json!({"passed":false,"errorCode":error.code,"originalDevelopmentConfigurationRestored":restored,"developmentRevision":revision})
        }
    };
    write(&root.join("result.json"), &report).await?;
    println!("{report}");
    if !restored {
        return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
    }
    result.map(|_| ())
}
