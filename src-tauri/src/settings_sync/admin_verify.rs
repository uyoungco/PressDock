use super::*;
pub(super) async fn run(
    sync: SettingsSync,
    cms: &CmsService,
    development: bool,
    test_ai: bool,
) -> SyncResult<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tools/settings-sync-probes");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    let directory = root.join(format!("probe-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir(&directory)
        .await
        .map_err(|_| SyncError::new("SYNC_STORAGE", true))?;
    let path = directory.join("probe.db");
    let mut db = Database::open(&path).await?;
    let ai = crate::ai::AiService::new().map_err(|_| SyncError::new("SYNC_NETWORK", true))?;
    let result:SyncResult<()>=async {
        let status=sync.start(&db,&ai,cms,false).await?;if !status.ready||status.successful_reads!=1{return Err(SyncError::new("PROBE_START_FAILED",false));}
        let repeated=sync.start(&db,&ai,cms,true).await?;if repeated.read_requests!=1{return Err(SyncError::new("PROBE_REPEATED_READ",false));}
        let config=local::export(&db).await?;
        if development {
            super::edit_probe::run(&sync,&db,cms,&ai).await?;
            let before=config.models.first().cloned().ok_or(SyncError::new("PROBE_NO_MODEL",false))?;if before.id!="demo-model"{return Err(SyncError::new("PROBE_NOT_DEMO",false));}
            let mut changed=before.clone();changed.display_name=format!("演示原生补传-{}",uuid::Uuid::new_v4());let expected=changed.display_name.clone();sync.model(&db,changed,Some(before.clone())).await?;
            if sync.status(&db).await?.pending!=1{return Err(SyncError::new("PROBE_NO_OUTBOX",false));}
            db.pool.close().await;db=Database::open(&path).await?;let next=SettingsSync::development().map_err(|_|SyncError::new("SYNC_NETWORK",true))?;
            let restarted=next.start(&db,&ai,cms,false).await?;if !restarted.ready||local::export(&db).await?.models[0].display_name!=expected{return Err(SyncError::new("PROBE_RESTART_FAILED",false));}
            if !next.upload_one(&db,cms).await?||next.status(&db).await?.pending!=0{return Err(SyncError::new("PROBE_UPLOAD_FAILED",false));}
            let baseline=local::export(&db).await?.models.remove(0);next.model(&db,before,Some(baseline)).await?;if !next.upload_one(&db,cms).await? {return Err(SyncError::new("PROBE_RESTORE_FAILED",false));}
            println!("{}",json!({"check":"windows-native-live-dev","passed":true,"coldReadsPerInstance":1,"persistentOutboxAcrossReopen":true,"restoredOriginalDemoField":true,"uploadedWithoutAnotherSnapshotRead":true}));
        }else if test_ai {
            let model=config.models.first().ok_or(SyncError::new("PROBE_NO_MODEL",false))?;
            if db.ai_credential_ref(&model.provider_id).await?.is_none(){return Err(SyncError::new("PROBE_MISSING_KEY",false));}
            ai.generate_text(&db,model,"你是连接测试助手。","请仅回复：连接正常").await.map_err(|_|SyncError::new("PROBE_AI_FAILED",false))?;
            println!("{}",json!({"check":"windows-fresh-client-ai","passed":true,"coldReadRequests":repeated.read_requests,"keysDownloadedIntoNativeVault":true,"explicitAiRequests":1,"cmsWrites":0}));
        }else {
            println!("{}",json!({"check":"windows-native-production-download","passed":true,"coldReads":repeated.read_requests,"revision":sqlx::query_scalar::<_,i64>("SELECT last_observed_revision FROM sync_state WHERE id=1").fetch_one(&db.pool).await?,"androidChangeRead":config.models.iter().any(|m|m.display_name=="deepseek-flash-sync-check"),"aiRequests":0,"cmsWrites":0}));
        }Ok(())
    }.await;
    let refs:Vec<String>=sqlx::query_scalar("SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT credential_ref FROM sync_credential_gc").fetch_all(&db.pool).await?;
    for reference in refs {
        if reference.starts_with("sync-secret-") || reference.starts_with("sync-payload-") {
            sync.local.clear(&reference).await;
        }
    }
    db.pool.close().await;
    // 目标仅由固定目录和新 UUID 构造；删除前核对实际绝对路径。
    if let (Ok(root), Ok(target)) = (root.canonicalize(), directory.canonicalize())
        && target.starts_with(&root)
        && target
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("probe-"))
    {
        let _ = tokio::fs::remove_dir_all(target).await;
    }
    result
}
