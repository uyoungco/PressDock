use super::*;

fn fixtures() -> Value {
    serde_json::from_str(include_str!("../../../docs/settings-sync/fixtures-v1.json")).unwrap()
}

#[test]
fn client_validates_all_shared_server_fixtures() {
    let f = fixtures();
    assert_eq!(f["demo"], true);
    for c in f["cases"].as_array().unwrap() {
        let raw = c["raw"]
            .as_str()
            .map(str::as_bytes)
            .map(Vec::from)
            .unwrap_or_else(|| serde_json::to_vec(&c["input"]).unwrap());
        let kind: DocumentKind = serde_json::from_value(c["kind"].clone()).unwrap();
        let deleted: Vec<String> =
            serde_json::from_value(c["deletedKeys"].clone()).unwrap_or_default();
        let before = f["base"].clone();
        let result = validate_document(&raw, kind, Some(&f["base"]), &deleted);
        let code = result.as_ref().err().map(|e| e.code);
        assert_eq!(code, c["expectedCode"].as_str(), "{}", c["name"]);
        if let Some(expected) = c.get("expected") {
            assert_eq!(result.unwrap(), *expected, "{}", c["name"]);
        }
        assert_eq!(before, f["base"]);
    }
}

#[test]
fn utf8_and_transport_size_boundaries_are_not_truncated() {
    let f = fixtures();
    let mut raw = serde_json::to_vec(&f["base"]).unwrap();
    raw.resize(MAX_DOCUMENT_BYTES, b' ');
    assert!(validate_document(&raw, DocumentKind::Snapshot, None, &[]).is_ok());
    raw.push(b' ');
    assert_eq!(
        validate_document(&raw, DocumentKind::Snapshot, None, &[])
            .unwrap_err()
            .code,
        "PAYLOAD_TOO_LARGE"
    );
    assert_eq!(
        validate_document(&[0xff], DocumentKind::Snapshot, None, &[])
            .unwrap_err()
            .code,
        "INVALID_DOCUMENT"
    );
}

#[test]
fn large_unicode_templates_and_preset_counts_match_server_limits() {
    let mut s = fixtures()["base"].clone();
    let mut t = s["config"]["templates"][0].clone();
    s["config"]["defaults"] = json!({"titleTemplateId":null,"paginationTemplateId":null});
    t["systemPrompt"] = json!("中".repeat(20_000));
    t["userPrompt"] = json!("文".repeat(20_000));
    let mut list: Vec<_> = (0..8)
        .map(|i| {
            let mut t = t.clone();
            t["id"] = json!(format!("demo-large-{i}"));
            t
        })
        .collect();
    s["config"]["templates"] = json!(list);
    assert!(validate_snapshot(&s).is_ok());
    t["id"] = json!("demo-large-over");
    list.push(t);
    s["config"]["templates"] = json!(list);
    assert_eq!(validate_snapshot(&s).unwrap_err().code, "PAYLOAD_TOO_LARGE");
    s["config"]["templates"][8]["userPrompt"] = json!("x");
    let remaining = MAX_CONFIG_BYTES - size(&s["config"]);
    s["config"]["templates"][8]["userPrompt"] = json!(format!(
        "x{}{}",
        "中".repeat(remaining / 3),
        "a".repeat(remaining % 3)
    ));
    assert_eq!(size(&s["config"]), MAX_CONFIG_BYTES);
    assert!(validate_snapshot(&s).is_ok());
    let prompt = s["config"]["templates"][8]["userPrompt"]
        .as_str()
        .unwrap()
        .to_owned();
    s["config"]["templates"][8]["userPrompt"] = json!(format!("{prompt}a"));
    assert_eq!(validate_snapshot(&s).unwrap_err().code, "PAYLOAD_TOO_LARGE");
    s["config"]["templates"] = json!([]);
    s["config"]["defaults"] = json!({"titleTemplateId":null,"paginationTemplateId":null});
    let mut presets: Vec<_> = (0..2048).map(|i| json!({"channel":format!("演示{i}"),"subChannel":"子渠道","field":"titlePic","size":null,"maxBytes":null,"format":"webp"})).collect();
    s["config"]["imagePresets"] = json!(presets);
    assert!(validate_snapshot(&s).is_ok());
    presets.push(json!({"channel":"演示超限","subChannel":"子渠道","field":"titlePic","size":null,"maxBytes":null,"format":"webp"}));
    s["config"]["imagePresets"] = json!(presets);
    assert_eq!(validate_snapshot(&s).unwrap_err().code, "VALIDATION_FAILED");
}

#[test]
fn typed_wire_models_round_trip_without_secret_fields_in_snapshot() {
    let f = fixtures();
    let snapshot: Snapshot = serde_json::from_value(f["base"].clone()).unwrap();
    assert_eq!(serde_json::to_value(snapshot).unwrap(), f["base"]);
    for c in f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["expectedCode"].is_null() && c.get("raw").is_none())
    {
        match c["kind"].as_str().unwrap() {
            "operation" => {
                let _: Operation = serde_json::from_value(c["input"].clone()).unwrap();
            }
            "initialize" => {
                let _: Initialize = serde_json::from_value(c["input"].clone()).unwrap();
            }
            "bootstrap" => {
                let _: Bootstrap = serde_json::from_value(c["input"].clone()).unwrap();
            }
            _ => (),
        }
    }
}

#[test]
fn field_inventory_covers_existing_native_settings_structs() {
    use crate::database::image_presets::{ChannelImagePresets, ImagePreset as NativeImagePreset};
    let f = fixtures();
    let c = &f["base"]["config"];
    let catalog: Value = serde_json::from_str(include_str!(
        "../../../docs/settings-sync/field-map-v1.json"
    ))
    .unwrap();
    let mut p = c["providers"][0].clone();
    p["hasApiKey"] = json!(false);
    let p: crate::ai::AiProviderConfig = serde_json::from_value(p).unwrap();
    let m: AiModelConfig = serde_json::from_value(c["models"][0].clone()).unwrap();
    let mut t = c["templates"][0].clone();
    t["isDefault"] = json!(true);
    let t: PromptTemplate = serde_json::from_value(t).unwrap();
    let preset: NativeImagePreset = serde_json::from_value(
        json!({"size":{"width":280,"height":124},"maxBytes":102400,"format":"webp"}),
    )
    .unwrap();
    let group = ChannelImagePresets {
        channel: "演示".into(),
        sub_channel: "演示子渠道".into(),
        title_pic: preset.clone(),
        title_pic2: preset.clone(),
    };
    let mut h = c["harvest"].clone();
    for (key, value) in [
        ("sourceMode", json!("webview")),
        ("cdpBrowser", json!("chrome")),
        ("cdpAddress", Value::Null),
        ("developerMode", json!(false)),
        ("retentionDays", Value::Null),
    ] {
        h[key] = value;
    }
    let h: crate::harvest::Settings = serde_json::from_value(h).unwrap();
    for (name, value) in [
        ("AiProviderConfig", serde_json::to_value(p).unwrap()),
        ("Compatibility", c["providers"][0]["compatibility"].clone()),
        ("AiModelConfig", serde_json::to_value(m).unwrap()),
        ("PromptTemplate", serde_json::to_value(t).unwrap()),
        (
            "PaginationOptions",
            c["templates"][1]["paginationOptions"].clone(),
        ),
        ("ChannelImagePresets", serde_json::to_value(group).unwrap()),
        ("ImagePreset", serde_json::to_value(preset).unwrap()),
        ("Size", c["imagePresets"][0]["size"].clone()),
        ("HarvestSettings", serde_json::to_value(h).unwrap()),
    ] {
        let actual: HashSet<_> = value.as_object().unwrap().keys().collect();
        let mapped: HashSet<_> = catalog["groups"][name]["fields"]
            .as_object()
            .unwrap()
            .keys()
            .collect();
        assert_eq!(
            actual, mapped,
            "{name} 新增或遗漏字段，须同步更新协议字段清单"
        );
    }
    let request_fields: HashSet<_> = catalog["groups"]["SaveProviderRequest"]["fields"]
        .as_object()
        .unwrap()
        .keys()
        .collect();
    let request = json!({"id":"demo-provider","displayName":"演示","baseUrl":"https://example.com","protocol":"responses","compatibility":c["providers"][0]["compatibility"],"apiKey":null,"createOnly":false});
    let _: SaveProviderRequest = serde_json::from_value(request.clone()).unwrap();
    assert_eq!(
        request.as_object().unwrap().keys().collect::<HashSet<_>>(),
        request_fields
    );
}

#[tokio::test]
async fn draft_schemas_parse_in_isolated_sqlite_and_enforce_commit_guard() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../../docs/settings-sync/d1-v1.draft.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../docs/settings-sync/local-v1.draft.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO settings_commit_guard VALUES (1,1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("UPDATE settings_state SET revision=1,initialized=1,config_json='{}' WHERE id=1")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(
        sqlx::query("INSERT INTO settings_commit_guard VALUES (2,0)")
            .execute(&mut *tx)
            .await
            .is_err()
    );
    tx.rollback().await.unwrap();
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM settings_state WHERE id=1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(revision, 0);
    assert!(
        sqlx::query("INSERT INTO settings_commit_guard VALUES (1,0)")
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(sqlx::query("INSERT INTO sync_outbox VALUES ('demo-op','demo-device',1,1,'{}',NULL,NULL,'queued',0,NULL,NULL)").execute(&pool).await.is_err());
    pool.close().await;
}
