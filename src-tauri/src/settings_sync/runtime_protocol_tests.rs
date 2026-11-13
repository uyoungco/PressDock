#[tokio::test]
async fn protocol_mismatch_survives_restart_and_retries_exact_v2_requests_after_upgrade() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    install(&db, &sync).await;
    sync.attempted.store(true, Ordering::SeqCst);
    sync.local
        .enqueue(&db, vec![name("演示升级后补传")], None)
        .await
        .unwrap();
    let original = sync.local.pending(&db).await.unwrap().remove(0);
    let payload: String = sqlx::query_scalar("SELECT wire_body_payload_id FROM sync_outbox")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    Mock::given(path("/operations"))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_json(json!({"schemaVersion":1,"error":{"code":"UNSUPPORTED_VERSION"}})),
        )
        .mount(&server)
        .await;
    assert!(!sync.upload_one(&db, &cms).await.unwrap());
    assert_eq!(sync.status(&db).await.unwrap().phase, "protocolMismatch");
    assert!(!sync.upload_one(&db, &cms).await.unwrap());
    assert_eq!(server.received_requests().await.unwrap().len(), 1);

    let mut restarted = SettingsSync::new().unwrap();
    restarted.origin = server.uri();
    restarted.local.vault = sync.local.vault.clone();
    let persisted = restarted.status(&db).await.unwrap();
    assert_eq!(persisted.phase, "protocolMismatch");
    assert_eq!(persisted.last_error.as_deref(), Some("UNSUPPORTED_VERSION"));
    server.reset().await;
    let mut old = serde_json::to_value(boot()).unwrap();
    old["snapshot"]["schemaVersion"] = json!(1);
    Mock::given(path("/bootstrap"))
        .respond_with(ResponseTemplate::new(200).set_body_json(old))
        .mount(&server)
        .await;
    let paused = restarted.manual(&db, &ai, &cms).await.unwrap();
    assert_eq!(paused.phase, "protocolMismatch");
    assert_eq!(paused.pending, 1);
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
    assert_eq!(
        restarted.local.pending(&db).await.unwrap()[0].raw,
        original.raw
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT wire_body_payload_id FROM sync_outbox")
            .fetch_one(&db.pool)
            .await
            .unwrap(),
        payload
    );

    server.reset().await;
    let committed = Arc::new(AtomicBool::new(false));
    let observed = committed.clone();
    Mock::given(path("/bootstrap"))
        .respond_with(move |_: &wiremock::Request| {
            let mut remote = boot();
            remote.snapshot.revision = if observed.load(Ordering::SeqCst) {
                101
            } else {
                100
            };
            if observed.load(Ordering::SeqCst) {
                remote.snapshot.config.models[0].display_name = "演示升级后补传".into();
            }
            ResponseTemplate::new(200).set_body_json(remote)
        })
        .mount(&server)
        .await;
    Mock::given(path("/check"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(json!({"error":{"code":"OPERATION_NOT_FOUND"}})),
        )
        .mount(&server)
        .await;
    Mock::given(path("/operations"))
        .respond_with(move |request: &wiremock::Request| {
            committed.store(true, Ordering::SeqCst);
            receipt(request)
        })
        .mount(&server)
        .await;
    let resumed = restarted.manual(&db, &ai, &cms).await.unwrap();
    assert_eq!(resumed.phase, "reported");
    assert_eq!(resumed.pending, 0);
    assert_eq!(resumed.last_error, None);
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests.iter().map(|r| r.url.path()).collect::<Vec<_>>(),
        vec!["/bootstrap", "/check", "/operations", "/bootstrap"]
    );
    assert_eq!(requests[1].body, original.raw);
    assert_eq!(requests[2].body, original.raw);
    assert_eq!(
        local::export(&db).await.unwrap().models[0].display_name,
        "演示升级后补传"
    );
}

#[tokio::test]
async fn upgraded_cloud_receipt_removes_protocol_rejected_create_without_replaying() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    install(&db, &sync).await;
    let mut model = boot().snapshot.config.models[0].clone();
    model.id = "demo-protocol-created".into();
    model.model_id = "demo-protocol-created-id".into();
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
    sqlx::query(
        "UPDATE sync_outbox SET status='failedValidation',last_error_code='UNSUPPORTED_VERSION'",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    let pending = sync.local.pending(&db).await.unwrap().remove(0);
    let mut remote = boot();
    remote.snapshot.revision = 8;
    remote.snapshot.config.models.push(model);
    bootstrap(&server, &remote).await;
    Mock::given(path("/check")).respond_with(ResponseTemplate::new(200).set_body_json(json!({"schemaVersion":2,"operationId":pending.operation_id,"deviceId":pending.device_id,"sequence":pending.sequence,"revision":8}))).mount(&server).await;
    let result = sync.manual(&db, &ai, &cms).await.unwrap();
    assert_eq!(result.pending, 0);
    assert_eq!(result.phase, "reported");
    assert_eq!(local::export(&db).await.unwrap().models.len(), 2);
    assert!(
        !server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.url.path() == "/operations")
    );
}

#[tokio::test]
async fn protocol_recovery_never_unlocks_legacy_or_other_permanent_errors() {
    for (version, code) in [
        (1, "UNSUPPORTED_VERSION"),
        (2, "ENTITY_DELETED"),
        (2, "VALIDATION_FAILED"),
    ] {
        let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
        install(&db, &sync).await;
        sync.local
            .enqueue(&db, vec![name("演示不可重放")], None)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE sync_outbox SET status='failedValidation',schema_version=?,last_error_code=?",
        )
        .bind(version)
        .bind(code)
        .execute(&db.pool)
        .await
        .unwrap();
        let result = sync.manual(&db, &ai, &cms).await.unwrap();
        assert_eq!(result.phase, "failedValidation");
        assert_eq!(result.last_error.as_deref(), Some(code));
        assert_eq!(result.pending, 1);
        assert!(server.received_requests().await.unwrap().is_empty());
    }
}

#[tokio::test]
async fn incompatible_bootstrap_blocks_queued_uploads_until_manual_v2_preflight() {
    let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
    install(&db, &sync).await;
    sync.local
        .enqueue(&db, vec![name("演示离线保留")], None)
        .await
        .unwrap();
    let mut old = serde_json::to_value(boot()).unwrap();
    old["snapshot"]["schemaVersion"] = json!(1);
    Mock::given(path("/bootstrap"))
        .respond_with(ResponseTemplate::new(200).set_body_json(old))
        .mount(&server)
        .await;
    assert_eq!(
        sync.start(&db, &ai, &cms, false).await.unwrap().phase,
        "protocolMismatch"
    );
    assert!(!sync.upload_one(&db, &cms).await.unwrap());
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
    assert_eq!(sync.local.pending(&db).await.unwrap()[0].attempts, 0);
}

#[tokio::test]
async fn protocol_preflight_network_and_auth_failures_preserve_frozen_queue() {
    for (http, code) in [(503, "CMS_TIMEOUT"), (401, "AUTH_EXPIRED")] {
        let (_dir, db, sync, ai, cms, server, _cms) = setup().await;
        install(&db, &sync).await;
        sync.local
            .enqueue(&db, vec![name("演示保留原字节")], None)
            .await
            .unwrap();
        sqlx::query("UPDATE sync_outbox SET status='failedValidation',last_error_code='UNSUPPORTED_VERSION'").execute(&db.pool).await.unwrap();
        let before = sync.local.pending(&db).await.unwrap().remove(0);
        Mock::given(path("/bootstrap"))
            .respond_with(ResponseTemplate::new(http).set_body_json(json!({"error":{"code":code}})))
            .mount(&server)
            .await;
        let result = sync.manual(&db, &ai, &cms).await.unwrap();
        assert_eq!(result.pending, 1);
        assert_eq!(result.last_error.as_deref(), Some(code));
        let after = sync.local.pending(&db).await.unwrap().remove(0);
        assert_eq!(after.raw, before.raw);
        assert_eq!(after.status, "failedValidation");
        assert_eq!(after.attempts, before.attempts);
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}
