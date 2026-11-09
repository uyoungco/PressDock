use super::{local::*, *};
use crate::{
    ai::{AiError, credentials::AiVault},
    database::Database,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
#[derive(Default)]
pub(super) struct Vault {
    values: Mutex<HashMap<String, String>>,
    fail: AtomicBool,
}
impl AiVault for Vault {
    fn load(&self, r: &str) -> std::result::Result<String, AiError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(AiError::new("TEST", "test"));
        }
        self.values
            .lock()
            .unwrap()
            .get(r)
            .cloned()
            .ok_or_else(|| AiError::new("TEST", "test"))
    }
    fn save(&self, r: &str, s: &str) -> std::result::Result<(), AiError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(AiError::new("TEST", "test"));
        }
        self.values.lock().unwrap().insert(r.into(), s.into());
        Ok(())
    }
    fn clear(&self, r: &str) -> std::result::Result<(), AiError> {
        self.values.lock().unwrap().remove(r);
        Ok(())
    }
}
pub(super) fn boot() -> Bootstrap {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../docs/settings-sync/fixtures-v1.json")).unwrap();
    serde_json::from_value(json!({"snapshot":fixture["base"],"secrets":[{"providerId":"demo-provider","value":"DEMO-ONLY-native"}]})).unwrap()
}
fn change(value: &str) -> Change {
    Change::Set {
        target: json!({"entity":"model","id":"demo-model"}),
        field: "displayName".into(),
        value: json!(value),
    }
}
async fn setup() -> SyncResult<(tempfile::TempDir, Database, LocalStore, Arc<Vault>)> {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("test.db")).await?;
    let vault = Arc::new(Vault::default());
    let store = LocalStore {
        vault: vault.clone(),
    };
    LocalStore::ensure_device(&db).await?;
    store.install(&db, boot()).await?;
    Ok((dir, db, store, vault))
}

#[tokio::test]
async fn interrupted_credential_preparation_is_collected_after_database_reopen() -> SyncResult<()> {
    let (dir, db, store, vault) = setup().await?;
    let current = db.ai_credential_ref("demo-provider").await?.unwrap();
    let next = store
        .prepare(
            &db,
            &boot().snapshot.config,
            &[SecretValue {
                provider_id: "demo-provider".into(),
                value: Some("DEMO-ONLY-interrupted-preparation".into()),
            }],
        )
        .await?;
    let orphan = next.refs["demo-provider"].as_ref().unwrap();
    assert!(vault.load(orphan).is_ok());
    db.pool.close().await;
    let reopened = Database::open(&dir.path().join("test.db")).await?;
    store.collect(&reopened).await?;
    assert!(vault.load(orphan).is_err());
    assert_eq!(vault.load(&current).unwrap(), "DEMO-ONLY-native");
    Ok(())
}

#[tokio::test]
async fn rejected_queue_archive_preserves_frozen_requests_and_credentials_after_cloud_install()
-> SyncResult<()> {
    let (dir, db, store, vault) = setup().await?;
    store
        .enqueue(
            &db,
            vec![
                change("演示保留的本机修改"),
                Change::SetSecret {
                    provider_id: "demo-provider".into(),
                    value: "DEMO-ONLY-archived-key".into(),
                },
            ],
            None,
        )
        .await?;
    store
        .enqueue(&db, vec![change("演示后续修改")], None)
        .await?;
    let before = store.pending(&db).await?;
    let reference = db.ai_credential_ref("demo-provider").await?.unwrap();
    sqlx::query("UPDATE sync_outbox SET status='failedValidation',last_error_code='ENTITY_DELETED' WHERE sequence=1").execute(&db.pool).await?;
    store.archive_rejected(&db).await?;
    assert!(store.pending(&db).await?.is_empty());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sync_recovery_operations")
            .fetch_one(&db.pool)
            .await?,
        2
    );
    assert!(
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT active_generation FROM sync_state WHERE id=1"
        )
        .fetch_one(&db.pool)
        .await?
        .is_none()
    );
    assert_eq!(
        store
            .enqueue(&db, vec![change("演示禁止继续编辑")], None)
            .await
            .unwrap_err()
            .code,
        "SYNC_NOT_READY"
    );
    db.pool.close().await;
    let reopened = Database::open(&dir.path().join("test.db")).await?;
    store.install(&reopened, boot()).await?;
    store.collect(&reopened).await?;
    assert_eq!(vault.load(&reference).unwrap(), "DEMO-ONLY-archived-key");
    for pending in before {
        assert_eq!(
            store.unseal(&reopened, &pending.operation_id).await?,
            pending.raw
        );
    }
    let saved: String = sqlx::query_scalar("SELECT config_json FROM sync_recovery_batches")
        .fetch_one(&reopened.pool)
        .await?;
    let saved: Config = serde_json::from_str(&saved)?;
    assert_eq!(saved.models[0].display_name, "演示后续修改");
    assert_eq!(
        export(&reopened).await?.models[0].display_name,
        boot().snapshot.config.models[0].display_name
    );
    let ordinary = serde_json::to_string(&reopened.ai_settings().await?)?;
    assert!(!ordinary.contains("DEMO-ONLY-archived-key"));
    Ok(())
}

#[tokio::test]
async fn failed_recovery_archive_preserves_queue_and_active_generation_atomically() -> SyncResult<()>
{
    let (_dir, db, store, _vault) = setup().await?;
    store
        .enqueue(&db, vec![change("演示尚未拒绝")], None)
        .await?;
    assert_eq!(
        store.archive_rejected(&db).await.unwrap_err().code,
        "RECOVERY_NOT_AVAILABLE"
    );
    let generation: String =
        sqlx::query_scalar("SELECT active_generation FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?;
    let request = store.pending(&db).await?.remove(0).raw;
    sqlx::query("UPDATE sync_outbox SET status='failedValidation'")
        .execute(&db.pool)
        .await?;
    sqlx::query("CREATE TRIGGER fail_archive BEFORE INSERT ON sync_recovery_operations BEGIN SELECT RAISE(ABORT,'injected'); END").execute(&db.pool).await?;
    assert!(store.archive_rejected(&db).await.is_err());
    assert_eq!(store.pending(&db).await?.remove(0).raw, request);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT active_generation FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?,
        generation
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sync_recovery_batches")
            .fetch_one(&db.pool)
            .await?,
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sync_recovery_credentials")
            .fetch_one(&db.pool)
            .await?,
        0
    );
    Ok(())
}

#[tokio::test]
async fn initialization_request_survives_reopen_without_rebuilding_secret_or_operation_id()
-> SyncResult<()> {
    let (dir, db, store, vault) = setup().await?;
    let source = boot();
    vault.fail.store(true, Ordering::SeqCst);
    assert!(
        store
            .freeze_initialization(
                &db,
                "production",
                source.snapshot.config.clone(),
                boot().secrets
            )
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sync_initialization")
            .fetch_one(&db.pool)
            .await?,
        0
    );
    vault.fail.store(false, Ordering::SeqCst);
    let frozen = store
        .freeze_initialization(&db, "production", source.snapshot.config, source.secrets)
        .await?;
    let request: Initialize = serde_json::from_slice(&frozen)?;
    db.pool.close().await;
    let bytes = tokio::fs::read(dir.path().join("test.db")).await.unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("DEMO-ONLY-native"));
    let reopened = Database::open(&dir.path().join("test.db")).await?;
    let payload: String = sqlx::query_scalar(
        "SELECT wire_body_payload_id FROM sync_initialization WHERE environment='production'",
    )
    .fetch_one(&reopened.pool)
    .await?;
    // 原凭据和表单之后改变，也必须用持久化的原字节补传。
    store
        .enqueue(
            &reopened,
            vec![Change::SetSecret {
                provider_id: "demo-provider".into(),
                value: "DEMO-ONLY-later".into(),
            }],
            None,
        )
        .await?;
    assert_eq!(payload, request.operation_id);
    assert_eq!(store.unseal(&reopened, &payload).await?, frozen);
    assert_eq!(request.sequence, 1);
    Ok(())
}

#[tokio::test]
async fn task_snapshots_retain_their_native_credential_version_during_sync() -> SyncResult<()> {
    let (_dir, db, store, vault) = setup().await?;
    let previous = db.ai_credential_ref("demo-provider").await?.unwrap();
    let mut settings = db
        .harvest_settings()
        .await
        .map_err(|_| SyncError::new("TEST", false))?;
    settings.options.auto_summary = true;
    settings.options.model_config_id = Some("demo-model".into());
    db.harvest_save_settings(&settings)
        .await
        .map_err(|_| SyncError::new("TEST", false))?;
    let id = uuid::Uuid::new_v4().to_string();
    db.harvest_enqueue(
        1,
        &crate::harvest::EnqueueRequest {
            id: id.clone(),
            url: "https://baijiahao.baidu.com/s?id=1928".into(),
        },
    )
    .await
    .map_err(|_| SyncError::new("TEST", false))?;
    store
        .enqueue(
            &db,
            vec![Change::SetSecret {
                provider_id: "demo-provider".into(),
                value: "DEMO-ONLY-replaced".into(),
            }],
            None,
        )
        .await?;
    store.install(&db, boot()).await?;
    let job = db
        .harvest_job(&id, 1)
        .await
        .map_err(|_| SyncError::new("TEST", false))?;
    assert_eq!(
        job.options
            .metadata_snapshot
            .unwrap()
            .credential_ref
            .as_deref(),
        Some(previous.as_str())
    );
    assert_eq!(
        vault
            .values
            .lock()
            .unwrap()
            .get(&previous)
            .map(String::as_str),
        Some("DEMO-ONLY-native")
    );
    sqlx::query("DELETE FROM harvest_jobs WHERE id=?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    store.collect(&db).await?;
    assert!(!vault.values.lock().unwrap().contains_key(&previous));
    Ok(())
}
#[tokio::test]
async fn cache_and_frozen_secret_operations_survive_database_reopen() -> SyncResult<()> {
    let (dir, db, store, _vault) = setup().await?;
    for value in ["DEMO-ONLY-first", "DEMO-ONLY-second"] {
        store
            .enqueue(
                &db,
                vec![Change::SetSecret {
                    provider_id: "demo-provider".into(),
                    value: value.into(),
                }],
                None,
            )
            .await?;
    }
    let before = store.pending(&db).await?;
    let ids: Vec<_> = before.iter().map(|p| p.operation_id.clone()).collect();
    db.pool.close().await;
    let reopened = Database::open(&dir.path().join("test.db")).await?;
    let pending = store.pending(&reopened).await?;
    assert_eq!(
        pending
            .iter()
            .map(|p| p.operation_id.clone())
            .collect::<Vec<_>>(),
        ids
    );
    assert_eq!(
        pending.iter().map(|p| p.sequence).collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert!(String::from_utf8_lossy(&pending[0].raw).contains("DEMO-ONLY-first"));
    assert!(String::from_utf8_lossy(&pending[1].raw).contains("DEMO-ONLY-second"));
    let sqlite = tokio::fs::read(dir.path().join("test.db")).await.unwrap();
    assert!(!String::from_utf8_lossy(&sqlite).contains("DEMO-ONLY-first"));
    let plans: Vec<String> = sqlx::query_scalar("SELECT safe_plan_json FROM sync_outbox")
        .fetch_all(&reopened.pool)
        .await?;
    assert!(plans.iter().all(|s| !s.contains("DEMO-ONLY")));
    let reference = reopened.ai_credential_ref("demo-provider").await?.unwrap();
    assert_eq!(store.load(&reference).await?, "DEMO-ONLY-second");
    Ok(())
}
#[tokio::test]
async fn sqlite_failure_rolls_back_business_and_queue_together() -> SyncResult<()> {
    let (_dir, db, store, vault) = setup().await?;
    let before = serde_json::to_value(export(&db).await?)?;
    let keys = vault.values.lock().unwrap().len();
    sqlx::query("CREATE TRIGGER reject_sync BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected'); END").execute(&db.pool).await?;
    assert!(
        store
            .enqueue(
                &db,
                vec![
                    change("演示失败"),
                    Change::SetSecret {
                        provider_id: "demo-provider".into(),
                        value: "DEMO-ONLY-failed".into()
                    }
                ],
                None
            )
            .await
            .is_err()
    );
    assert_eq!(serde_json::to_value(export(&db).await?)?, before);
    assert!(store.pending(&db).await?.is_empty());
    assert_eq!(vault.values.lock().unwrap().len(), keys);
    Ok(())
}
#[tokio::test]
async fn failed_credential_preparation_never_changes_active_generation() -> SyncResult<()> {
    let (_dir, db, store, vault) = setup().await?;
    let before = serde_json::to_value(export(&db).await?)?;
    let generation: String =
        sqlx::query_scalar("SELECT active_generation FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?;
    vault.fail.store(true, Ordering::SeqCst);
    let mut next = boot();
    next.snapshot.config.models[0].display_name = "演示不能生效".into();
    assert!(store.install(&db, next).await.is_err());
    vault.fail.store(false, Ordering::SeqCst);
    assert_eq!(serde_json::to_value(export(&db).await?)?, before);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT active_generation FROM sync_state WHERE id=1")
            .fetch_one(&db.pool)
            .await?,
        generation
    );
    Ok(())
}
#[tokio::test]
async fn failed_snapshot_switch_keeps_old_credentials_and_queued_edits() -> SyncResult<()> {
    let (_dir, db, store, _) = setup().await?;
    store
        .enqueue(&db, vec![change("演示离线修改")], None)
        .await?;
    let before = serde_json::to_value(export(&db).await?)?;
    let old = db.ai_credential_ref("demo-provider").await?;
    sqlx::query("CREATE TRIGGER reject_generation BEFORE INSERT ON sync_generations BEGIN SELECT RAISE(ABORT,'injected'); END").execute(&db.pool).await?;
    assert!(store.install(&db, boot()).await.is_err());
    assert_eq!(serde_json::to_value(export(&db).await?)?, before);
    assert_eq!(db.ai_credential_ref("demo-provider").await?, old);
    assert_eq!(store.pending(&db).await?.len(), 1);
    Ok(())
}
#[tokio::test]
async fn pending_overlay_preserves_new_remote_fields_and_local_preferences() -> SyncResult<()> {
    let (_dir, db, store, _) = setup().await?;
    let mut local = db.harvest_settings().await?;
    local.options.developer_mode = true;
    local.options.cdp_address = Some("127.0.0.1:9222".into());
    local.retention_days = Some(77);
    db.harvest_save_settings(&local).await?;
    store.enqueue(&db, vec![change("演示待上传")], None).await?;
    let mut remote = boot();
    remote.snapshot.revision += 1;
    remote.snapshot.config.image_presets[0].max_bytes = Some(8888);
    store.install(&db, remote).await?;
    let config = export(&db).await?;
    assert_eq!(config.models[0].display_name, "演示待上传");
    assert_eq!(config.image_presets[0].max_bytes, Some(8888));
    let local = db.harvest_settings().await?;
    assert!(local.options.developer_mode);
    assert_eq!(local.options.cdp_address.as_deref(), Some("127.0.0.1:9222"));
    assert_eq!(local.retention_days, Some(77));
    assert_eq!(store.pending(&db).await?.len(), 1);
    Ok(())
}
#[tokio::test]
async fn tampered_ciphertext_or_missing_os_key_fails_without_plaintext_fallback() -> SyncResult<()>
{
    let (_dir, db, store, vault) = setup().await?;
    store.enqueue(&db, vec![change("演示加密")], None).await?;
    sqlx::query("UPDATE sync_secure_payloads SET ciphertext=randomblob(length(ciphertext))")
        .execute(&db.pool)
        .await?;
    assert!(store.pending(&db).await.is_err());
    vault.values.lock().unwrap().clear();
    assert!(store.pending(&db).await.is_err());
    Ok(())
}
#[test]
fn diff_changes_only_edited_fields_and_preserves_explicit_null() -> SyncResult<()> {
    let before = boot().snapshot.config;
    let mut after = before.clone();
    after.models[0].display_name = "演示新名称".into();
    after.models[0].max_output_tokens = None;
    let changes = serde_json::to_value(diff(&before, &after)?)?;
    assert_eq!(changes.as_array().unwrap().len(), 2);
    assert_eq!(changes[1]["value"], Value::Null);
    Ok(())
}

#[cfg(target_os = "windows")]
#[tokio::test]
#[ignore = "显式运行：访问真实 Windows 凭据库，仅保存和删除专用演示凭据"]
async fn native_windows_cache_and_queue_cross_process() -> SyncResult<()> {
    let store = LocalStore::default();
    if let Some(path) = std::env::var_os("PRESSDOCK_SYNC_PROBE_CHILD") {
        let db = Database::open(std::path::Path::new(&path)).await?;
        if std::env::var_os("PRESSDOCK_SYNC_PROBE_RECOVERY").is_some() {
            assert!(store.pending(&db).await?.is_empty());
            let ids: Vec<String> = sqlx::query_scalar(
                "SELECT operation_id FROM sync_recovery_operations ORDER BY sequence",
            )
            .fetch_all(&db.pool)
            .await?;
            assert_eq!(ids.len(), 2);
            assert!(
                String::from_utf8_lossy(&store.unseal(&db, &ids[0]).await?)
                    .contains("DEMO-ONLY-native-first")
            );
            assert!(
                String::from_utf8_lossy(&store.unseal(&db, &ids[1]).await?)
                    .contains("DEMO-ONLY-native-second")
            );
            let reference:String=sqlx::query_scalar("SELECT credential_ref FROM sync_recovery_credentials WHERE provider_id='demo-provider'").fetch_one(&db.pool).await?;
            assert_eq!(store.load(&reference).await?, "DEMO-ONLY-native-second");
            db.pool.close().await;
            return Ok(());
        }
        let pending = store.pending(&db).await?;
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].sequence, 1);
        assert_eq!(pending[1].sequence, 2);
        assert!(String::from_utf8_lossy(&pending[0].raw).contains("DEMO-ONLY-native-first"));
        assert!(String::from_utf8_lossy(&pending[1].raw).contains("DEMO-ONLY-native-second"));
        let reference = db.ai_credential_ref("demo-provider").await?.unwrap();
        assert_eq!(store.load(&reference).await?, "DEMO-ONLY-native-second");
        assert_eq!(export(&db).await?.models[0].display_name, "演示跨进程");
        db.pool.close().await;
        return Ok(());
    }
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("probe.db");
    let db = Database::open(&path).await?;
    LocalStore::ensure_device(&db).await?;
    store.install(&db, boot()).await?;
    store
        .enqueue(
            &db,
            vec![
                change("演示跨进程"),
                Change::SetSecret {
                    provider_id: "demo-provider".into(),
                    value: "DEMO-ONLY-native-first".into(),
                },
            ],
            None,
        )
        .await?;
    store
        .enqueue(
            &db,
            vec![
                Change::SetSecret {
                    provider_id: "demo-provider".into(),
                    value: "DEMO-ONLY-native-second".into(),
                },
                Change::Set {
                    target: json!({"entity":"template","id":"demo-title"}),
                    field: "systemPrompt".into(),
                    value: json!("演示".repeat(10000)),
                },
            ],
            None,
        )
        .await?;
    let refs:Vec<String>=sqlx::query_scalar("SELECT credential_ref FROM ai_providers WHERE credential_ref IS NOT NULL UNION SELECT credential_ref FROM sync_generation_secrets WHERE credential_ref IS NOT NULL UNION SELECT credential_key_ref FROM sync_secure_payloads UNION SELECT credential_ref FROM sync_credential_gc").fetch_all(&db.pool).await?;
    db.pool.close().await;
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "settings_sync::local_tests::native_windows_cache_and_queue_cross_process",
        ])
        .env("PRESSDOCK_SYNC_PROBE_CHILD", &path)
        .output()
        .unwrap();
    let reopened = Database::open(&path).await?;
    sqlx::query("UPDATE sync_outbox SET status='failedValidation' WHERE sequence=1")
        .execute(&reopened.pool)
        .await?;
    store.archive_rejected(&reopened).await?;
    reopened.pool.close().await;
    let recovered = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "settings_sync::local_tests::native_windows_cache_and_queue_cross_process",
        ])
        .env("PRESSDOCK_SYNC_PROBE_CHILD", &path)
        .env("PRESSDOCK_SYNC_PROBE_RECOVERY", "1")
        .output()
        .unwrap();
    for reference in refs {
        assert!(store.clear(&reference).await);
    }
    assert!(
        child.status.success(),
        "子进程必须从 SQLite 与真实系统凭据库恢复同一队列"
    );
    assert!(
        recovered.status.success(),
        "恢复副本及独立密钥版本必须跨进程可读"
    );
    println!(
        "{}",
        json!({"check":"windows-native-cross-process","passed":true,"pendingOperations":2,"largeRequestEncryptedInSqlite":true,"stableSecretVersions":true,"archivedRecoveryAcrossProcesses":true,"dedicatedCredentialsCleaned":true})
    );
    Ok(())
}
