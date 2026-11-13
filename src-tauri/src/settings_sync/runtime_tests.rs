use super::*;
use crate::settings_sync::{
    local,
    local_tests::{Vault, boot},
};
use std::sync::Arc;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};
include!("runtime_protocol_tests.rs");
async fn setup() -> (
    tempfile::TempDir,
    Database,
    SettingsSync,
    AiService,
    CmsService,
    MockServer,
    MockServer,
) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("test.db")).await.unwrap();
    let server = MockServer::start().await;
    let (cms, cms_server) = crate::cms::ipc_service().await;
    let mut sync = SettingsSync::new().unwrap();
    sync.origin = server.uri();
    sync.local.vault = Arc::new(Vault::default());
    let ai = AiService::new().unwrap();
    (dir, db, sync, ai, cms, server, cms_server)
}
async fn bootstrap(server: &MockServer, boot: &Bootstrap) {
    Mock::given(method("GET"))
        .and(path("/bootstrap"))
        .respond_with(ResponseTemplate::new(200).set_body_json(boot))
        .mount(server)
        .await;
}
async fn install(db: &Database, sync: &SettingsSync) {
    LocalStore::ensure_device(db).await.unwrap();
    sync.local.install(db, boot()).await.unwrap();
}
fn receipt(request: &wiremock::Request) -> ResponseTemplate {
    let op: Operation = serde_json::from_slice(&request.body).unwrap();
    ResponseTemplate::new(200).set_body_json(json!({"schemaVersion":2,"operationId":op.operation_id,"deviceId":op.device_id,"sequence":op.sequence,"revision":100+op.sequence}))
}
fn name(value: &str) -> Change {
    Change::Set {
        target: json!({"entity":"model","id":"demo-model"}),
        field: "displayName".into(),
        value: json!(value),
    }
}

#[tokio::test]
async fn manual_credential_failure_preserves_active_configuration_and_secret() {
    let (_dir, db, mut sync, ai, cms, server, _cms) = setup().await;
    let vault = Arc::new(Vault::default());
    sync.local.vault = vault.clone();
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    let reference = db.ai_credential_ref("demo-provider").await.unwrap();
    let before = local::export(&db).await.unwrap().models[0]
        .display_name
        .clone();
    server.reset().await;
    let mut remote = boot();
    remote.snapshot.revision += 1;
    remote.snapshot.config.models[0].display_name = "演示不能落地的配置".into();
    bootstrap(&server, &remote).await;
    vault.fail.store(true, Ordering::SeqCst);
    let result = sync.manual(&db, &ai, &cms).await.unwrap();
    assert_eq!(result.successful_reads, 1);
    assert_eq!(result.last_error.as_deref(), Some("SYNC_CREDENTIAL_STORE"));
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        before
    );
    assert_eq!(
        db.ai_credential_ref("demo-provider").await.unwrap(),
        reference
    );
    vault.fail.store(false, Ordering::SeqCst);
    assert_eq!(
        sync.local
            .load(reference.as_deref().unwrap())
            .await
            .unwrap(),
        "DEMO-ONLY-native"
    );
}

#[tokio::test]
async fn manual_refreshes_after_success_without_changing_automatic_start_behavior() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    server.reset().await;
    let mut remote = boot();
    remote.snapshot.revision += 1;
    remote.snapshot.config.models[0].display_name = "演示远端更新".into();
    bootstrap(&server, &remote).await;
    let result = sync.manual(&db, &ai, &cms).await.unwrap();
    assert_eq!(result.successful_reads, 2);
    assert!(!result.using_cache);
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示远端更新"
    );
    assert_eq!(
        sync.start(&db, &ai, &cms, true)
            .await
            .unwrap()
            .read_requests,
        2
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn manual_uploads_in_sequence_before_reading_the_latest_snapshot() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    sync.local
        .enqueue(&db, vec![name("演示本机已上报")], None)
        .await
        .unwrap();
    server.reset().await;
    Mock::given(path("/operations"))
        .respond_with(receipt)
        .mount(&server)
        .await;
    let mut remote = boot();
    remote.snapshot.revision = 102;
    remote.snapshot.config.models[0].display_name = "演示本机已上报".into();
    bootstrap(&server, &remote).await;
    let result = sync.manual(&db, &ai, &cms).await.unwrap();
    assert_eq!(result.pending, 0);
    assert_eq!(result.successful_reads, 2);
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests
            .iter()
            .map(|request| request.url.path())
            .collect::<Vec<_>>(),
        vec!["/operations", "/bootstrap"]
    );
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示本机已上报"
    );
}

#[tokio::test]
async fn manual_temporary_upload_failure_still_reads_and_overlays_pending_fields() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    sync.local
        .enqueue(&db, vec![name("演示待传字段")], None)
        .await
        .unwrap();
    let pending = sync.local.pending(&db).await.unwrap().remove(0);
    server.reset().await;
    Mock::given(path("/operations"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    Mock::given(path("/check"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(json!({"error":{"code":"OPERATION_NOT_FOUND"}})),
        )
        .mount(&server)
        .await;
    let mut remote = boot();
    remote.snapshot.revision += 1;
    remote.snapshot.config.models[0].model_id = "demo-remote-model".into();
    bootstrap(&server, &remote).await;
    let result = sync.manual(&db, &ai, &cms).await.unwrap();
    assert_eq!(result.pending, 1);
    assert_eq!(result.successful_reads, 2);
    assert!(!result.using_cache);
    assert_eq!(result.last_error.as_deref(), Some("SYNC_SERVER"));
    let config = local::export(&db).await.unwrap();
    assert_eq!(config.models[0].display_name, "演示待传字段");
    assert_eq!(config.models[0].model_id, "demo-remote-model");
    assert_eq!(sync.local.pending(&db).await.unwrap()[0].raw, pending.raw);
}

#[tokio::test]
async fn manual_auth_or_permanent_rejection_stops_without_downloading_or_replaying() {
    for (http, code, phase) in [
        (401, "AUTH_EXPIRED", "waitingAuth"),
        (409, "ENTITY_DELETED", "failedValidation"),
    ] {
        let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
        bootstrap(&server, &boot()).await;
        sync.start(&db, &ai, &cms, false).await.unwrap();
        sync.local
            .enqueue(&db, vec![name("演示保留修改")], None)
            .await
            .unwrap();
        server.reset().await;
        Mock::given(path("/operations"))
            .respond_with(ResponseTemplate::new(http).set_body_json(json!({"error":{"code":code}})))
            .mount(&server)
            .await;
        let result = sync.manual(&db, &ai, &cms).await.unwrap();
        assert_eq!(result.phase, phase);
        assert_eq!(result.pending, 1);
        assert_eq!(result.read_requests, 1);
        assert_eq!(sync.manual(&db, &ai, &cms).await.unwrap().phase, phase);
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn manual_rejects_snapshot_older_than_an_acknowledged_write() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    sync.local
        .enqueue(&db, vec![name("演示已确认字段")], None)
        .await
        .unwrap();
    Mock::given(path("/operations"))
        .respond_with(receipt)
        .mount(&server)
        .await;
    let reference = db.ai_credential_ref("demo-provider").await.unwrap();
    let result = sync.manual(&db, &ai, &cms).await.unwrap();
    assert!(result.ready && result.using_cache);
    assert_eq!(result.last_error.as_deref(), Some("STALE_SNAPSHOT"));
    assert_eq!(result.successful_reads, 1);
    assert_eq!(result.pending, 0);
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示已确认字段"
    );
    assert_eq!(
        db.ai_credential_ref("demo-provider").await.unwrap(),
        reference
    );
}

#[tokio::test]
async fn manual_download_excludes_background_upload_and_preserves_newly_queued_edits() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    server.reset().await;
    Mock::given(path("/bootstrap"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(boot())
                .set_delay(Duration::from_millis(100)),
        )
        .mount(&server)
        .await;
    Mock::given(path("/check"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(json!({"error":{"code":"OPERATION_NOT_FOUND"}})),
        )
        .mount(&server)
        .await;
    let (result, _) = tokio::join!(sync.manual(&db, &ai, &cms), async {
        while server.received_requests().await.unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
        let _gate = sync.gate.lock().await;
        sync.local
            .enqueue(&db, vec![name("演示并发保留")], None)
            .await
            .unwrap();
        drop(_gate);
        assert!(!sync.upload_one(&db, &cms).await.unwrap());
    });
    assert_eq!(result.unwrap().pending, 1);
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示并发保留"
    );
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|request| request.url.path() != "/operations")
    );
}

#[tokio::test]
async fn manual_logout_during_download_never_installs_old_response() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    server.reset().await;
    let mut remote = boot();
    remote.snapshot.config.models[0].display_name = "演示旧会话响应".into();
    Mock::given(path("/bootstrap"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(remote)
                .set_delay(Duration::from_millis(100)),
        )
        .mount(&server)
        .await;
    let before = local::export(&db).await.unwrap().models[0]
        .display_name
        .clone();
    let (result, _) = tokio::join!(sync.manual(&db, &ai, &cms), async {
        while server.received_requests().await.unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
        cms.logout().await;
    });
    assert_eq!(result.err().unwrap().code, "SESSION_CHANGED");
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        before
    );
}
#[tokio::test]
async fn bootstrap_preserves_cms_failure_codes_without_installing_or_exposing_response_details() {
    for code in [
        "CMS_TIMEOUT",
        "CMS_UNAVAILABLE",
        "CMS_INVALID_RESPONSE",
        "CMS_FORBIDDEN",
    ] {
        let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
        Mock::given(path("/bootstrap"))
            .respond_with(ResponseTemplate::new(if code == "CMS_FORBIDDEN" { 403 } else { 503 }).set_body_json(json!({"schemaVersion":2,"error":{"code":code,"retryable":true,"detail":"demo-secret-must-not-escape"}})))
            .mount(&server).await;
        let result = sync.start(&db, &ai, &cms, false).await.unwrap();
        assert!(!result.ready);
        assert_eq!(result.last_error.as_deref(), Some(code));
        assert_eq!(result.read_requests, 1);
        assert_eq!(result.successful_reads, 0);
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("demo-secret")
        );
    }
}
#[tokio::test]
async fn rejected_changes_recovery_waits_for_cold_start_and_never_replays_archived_operations() {
    let (dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    sync.start(&db, &ai, &cms, false).await.unwrap();
    sync.local
        .enqueue(&db, vec![name("演示被拒修改")], None)
        .await
        .unwrap();
    sync.local
        .enqueue(&db, vec![name("演示后续修改")], None)
        .await
        .unwrap();
    Mock::given(path("/operations")).respond_with(ResponseTemplate::new(409).set_body_json(json!({"schemaVersion":2,"error":{"code":"ENTITY_DELETED","retryable":false,"operationId":null}}))).mount(&server).await;
    assert!(!sync.upload_one(&db, &cms).await.unwrap());
    let before = server.received_requests().await.unwrap().len();
    let result = sync.resolve_rejected(&db, &ai, &cms).await.unwrap();
    assert_eq!(result.phase, "restartRequired");
    assert!(!result.ready);
    assert_eq!(result.pending, 0);
    assert_eq!(result.read_requests, 1);
    assert_eq!(result.write_requests, 1);
    assert_eq!(
        sync.start(&db, &ai, &cms, true).await.unwrap().phase,
        "restartRequired"
    );
    assert!(!sync.upload_one(&db, &cms).await.unwrap());
    assert_eq!(server.received_requests().await.unwrap().len(), before);
    db.pool.close().await;
    server.reset().await;
    let reopened = Database::open(&dir.path().join("test.db")).await.unwrap();
    let mut next = SettingsSync::new().unwrap();
    next.origin = server.uri();
    next.local.vault = sync.local.vault.clone();
    let mut cloud = boot();
    cloud.snapshot.config.models[0].display_name = "演示云端最新配置".into();
    bootstrap(&server, &cloud).await;
    assert!(next.start(&reopened, &ai, &cms, false).await.unwrap().ready);
    assert_eq!(
        local::export(&reopened).await.unwrap().models[0].display_name,
        "演示云端最新配置"
    );
    assert!(next.local.pending(&reopened).await.unwrap().is_empty());
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sync_recovery_operations")
            .fetch_one(&reopened.pool)
            .await
            .unwrap(),
        2
    );
}

#[tokio::test]
async fn cold_start_success_is_once_even_for_repeated_start_retry_status_and_wake() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    bootstrap(&server, &boot()).await;
    let first = sync.start(&db, &ai, &cms, false).await.unwrap();
    assert!(first.ready);
    assert_eq!(first.read_requests, 1);
    assert_eq!(first.successful_reads, 1);
    for _ in 0..5 {
        sync.wake.notify_one();
        assert!(sync.start(&db, &ai, &cms, true).await.unwrap().ready);
        sync.status(&db).await.unwrap();
    }
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.url.path() == "/bootstrap")
            .count(),
        1
    );
}
#[tokio::test]
async fn failed_first_read_blocks_until_explicit_retry_without_exporting_old_defaults() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    Mock::given(path("/bootstrap"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let failed = sync.start(&db, &ai, &cms, false).await.unwrap();
    assert!(!failed.ready);
    assert_eq!(failed.read_requests, 1);
    assert_eq!(
        sync.start(&db, &ai, &cms, false)
            .await
            .unwrap()
            .read_requests,
        1
    );
    server.reset().await;
    bootstrap(&server, &boot()).await;
    let retry = sync.start(&db, &ai, &cms, true).await.unwrap();
    assert!(retry.ready);
    assert_eq!(retry.read_requests, 2);
    assert_eq!(retry.successful_reads, 1);
}
#[tokio::test]
async fn unavailable_cloud_uses_valid_cache_and_preserves_pending_operations() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    install(&db, &sync).await;
    sync.local
        .enqueue(&db, vec![name("演示离线")], None)
        .await
        .unwrap();
    Mock::given(path("/bootstrap"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let status = sync.start(&db, &ai, &cms, false).await.unwrap();
    assert!(status.ready && status.using_cache);
    assert_eq!(status.pending, 1);
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示离线"
    );
}
#[tokio::test]
async fn logout_during_download_discards_old_response() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    Mock::given(path("/bootstrap"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(boot())
                .set_delay(Duration::from_millis(300)),
        )
        .mount(&server)
        .await;
    let (start, _) = tokio::join!(sync.start(&db, &ai, &cms, false), async {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if server
                    .received_requests()
                    .await
                    .unwrap()
                    .iter()
                    .any(|r| r.url.path() == "/bootstrap")
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .expect("须先进入下载再退出账号");
        cms.logout().await
    });
    let status = start.unwrap();
    assert!(!status.ready);
    assert_eq!(status.successful_reads, 0);
    assert_eq!(status.last_error.as_deref(), Some("SESSION_CHANGED"));
}
#[tokio::test]
async fn accepted_create_with_lost_response_is_removed_before_overlay() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    install(&db, &sync).await;
    let mut model = boot().snapshot.config.models[0].clone();
    model.id = "demo-added".into();
    model.model_id = "demo-added-id".into();
    sync.local
        .enqueue(
            &db,
            vec![Change::Create {
                entity: "model".into(),
                value: serde_json::to_value(&model).unwrap(),
            }],
            None,
        )
        .await
        .unwrap();
    let pending = sync.local.pending(&db).await.unwrap().remove(0);
    let mut remote = boot();
    remote.snapshot.revision = 9;
    remote.snapshot.config.models.push(model);
    bootstrap(&server, &remote).await;
    Mock::given(path("/check")).respond_with(ResponseTemplate::new(200).set_body_json(json!({"schemaVersion":2,"operationId":pending.operation_id,"deviceId":pending.device_id,"sequence":pending.sequence,"revision":8}))).mount(&server).await;
    let status = sync.start(&db, &ai, &cms, false).await.unwrap();
    assert!(status.ready);
    assert_eq!(status.pending, 0);
    assert_eq!(local::export(&db).await.unwrap().models.len(), 2);
    assert_eq!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .find(|r| r.url.path() == "/check")
            .unwrap()
            .body,
        pending.raw
    );
}
#[tokio::test]
async fn old_ack_never_marks_a_newer_local_edit_as_reported_or_fetches_snapshot() {
    let (_dir, db, sync, _ai, cms, server, _cms) = setup().await;
    install(&db, &sync).await;
    sync.attempted.store(true, Ordering::SeqCst);
    sync.local
        .enqueue(&db, vec![name("演示第一项")], None)
        .await
        .unwrap();
    Mock::given(path("/operations"))
        .respond_with(|request: &wiremock::Request| {
            receipt(request).set_delay(Duration::from_millis(60))
        })
        .mount(&server)
        .await;
    let (first, _) = tokio::join!(sync.upload_one(&db, &cms), async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        let _gate = sync.gate.lock().await;
        sync.local
            .enqueue(&db, vec![name("演示第二项")], None)
            .await
            .unwrap();
    });
    assert!(first.unwrap());
    assert_eq!(sync.status(&db).await.unwrap().pending, 1);
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示第二项"
    );
    assert!(sync.upload_one(&db, &cms).await.unwrap());
    assert_eq!(sync.status(&db).await.unwrap().pending, 0);
    assert_eq!(sync.reads.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn temporary_failures_persist_retry_and_auth_or_validation_errors_pause_without_looping() {
    for (status, code, expected) in [
        (503, "D1_UNAVAILABLE", "pending"),
        (429, "RATE_LIMITED", "pending"),
        (401, "AUTH_EXPIRED", "waitingAuth"),
        (422, "VALIDATION_FAILED", "failedValidation"),
    ] {
        let (_dir, db, sync, _ai, cms, server, _cms) = setup().await;
        install(&db, &sync).await;
        sync.attempted.store(true, Ordering::SeqCst);
        sync.local
            .enqueue(&db, vec![name("演示错误")], None)
            .await
            .unwrap();
        Mock::given(path("/operations")).respond_with(ResponseTemplate::new(status).set_body_json(json!({"schemaVersion":2,"error":{"code":code,"retryable":status>=500,"operationId":null}}))).mount(&server).await;
        assert!(!sync.upload_one(&db, &cms).await.unwrap());
        assert_eq!(sync.status(&db).await.unwrap().phase, expected);
        assert!(!sync.upload_one(&db, &cms).await.unwrap());
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
        assert_eq!(sync.local.pending(&db).await.unwrap().len(), 1);
        if status == 503 || status == 429 {
            server.reset().await;
            Mock::given(path("/operations"))
                .respond_with(receipt)
                .mount(&server)
                .await;
            sqlx::query("UPDATE sync_outbox SET retry_at=NULL")
                .execute(&db.pool)
                .await
                .unwrap();
            assert!(sync.upload_one(&db, &cms).await.unwrap());
            assert!(sync.local.pending(&db).await.unwrap().is_empty());
        }
    }
}
#[tokio::test]
async fn form_baseline_sends_only_edited_field_and_local_preferences_do_not_queue() {
    let (_dir, db, sync, _ai, _cms, _server, _cms_server) = setup().await;
    install(&db, &sync).await;
    let baseline = local::export(&db).await.unwrap().models.remove(0);
    sync.local
        .enqueue(&db, vec![name("演示已更新名称")], None)
        .await
        .unwrap();
    let mut stale_form = baseline.clone();
    stale_form.max_output_tokens = Some(4567);
    sync.model(&db, stale_form, Some(baseline)).await.unwrap();
    let pending = sync.local.pending(&db).await.unwrap();
    let op: Operation = serde_json::from_slice(&pending[1].raw).unwrap();
    assert_eq!(op.changes.len(), 1);
    assert_eq!(
        serde_json::to_value(&op.changes[0]).unwrap()["field"],
        "maxOutputTokens"
    );
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示已更新名称"
    );
    let base = db.harvest_settings().await.unwrap();
    let mut local = base.clone();
    local.retention_days = Some(15);
    local.options.cdp_address = Some("127.0.0.1:9222".into());
    local.options.developer_mode = true;
    sync.harvest(&db, local, Some(base)).await.unwrap();
    assert_eq!(sync.local.pending(&db).await.unwrap().len(), 2);
}
