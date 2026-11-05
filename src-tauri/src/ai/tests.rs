use super::{credentials::AiVault, titles::candidates, *};
use crate::database::Database;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, header, method, path},
};

#[path = "ipc_tests.rs"]
mod ipc_tests;

#[derive(Default)]
struct TestVault {
    values: Mutex<HashMap<String, String>>,
    fail: AtomicBool,
}
impl AiVault for TestVault {
    fn load(&self, r: &str) -> Result<String, AiError> {
        self.values
            .lock()
            .unwrap()
            .get(r)
            .cloned()
            .ok_or_else(|| AiError::new("AI_CREDENTIAL_STORE", "测试凭据不存在"))
    }
    fn save(&self, r: &str, s: &str) -> Result<(), AiError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(AiError::new("AI_CREDENTIAL_STORE", "测试凭据保存失败"));
        }
        self.values.lock().unwrap().insert(r.into(), s.into());
        Ok(())
    }
    fn clear(&self, r: &str) -> Result<(), AiError> {
        self.values.lock().unwrap().remove(r);
        Ok(())
    }
}

fn provider(id: &str, base: &str, protocol: Protocol) -> SaveProviderRequest {
    SaveProviderRequest {
        id: id.into(),
        display_name: id.into(),
        base_url: base.into(),
        protocol,
        api_key: Some("fake-ai-test-secret".into()),
        compatibility: Compatibility::default(),
        create_only: false,
    }
}
fn model(id: &str, provider: &str) -> AiModelConfig {
    AiModelConfig {
        id: id.into(),
        provider_id: provider.into(),
        model_id: "test-model".into(),
        display_name: "测试模型".into(),
        context_window: None,
        max_output_tokens: None,
        reasoning_effort: None,
    }
}
fn request() -> TitleSuggestionRequest {
    TitleSuggestionRequest {
        job_id: uuid::Uuid::new_v4().to_string(),
        template_id: "builtin-news-title".into(),
        title: "当前标题 {{content}}".into(),
        content: "当前编辑正文".into(),
        model_config_id: None,
        candidate_count: None,
        max_length: None,
        requirements: "突出事实".into(),
    }
}

fn pagination_request() -> PaginationRequest {
    PaginationRequest {
        job_id: uuid::Uuid::new_v4().to_string(),
        template_id: "builtin-news-pagination".into(),
        model_config_id: "gateway".into(),
        title: "【演示数据】分页测试".into(),
        blocks: serde_json::from_value(json!([
            {"id":"B1","type":"text","text":"【演示数据】问题？","chars":10,"paragraph":0},
            {"id":"B2","type":"text","text":"演示答案 {{blocks}}。","chars":18,"paragraph":1},
            {"id":"B3","type":"image","chars":0,"paragraph":2}
        ]))
        .unwrap(),
    }
}

#[test]
fn deepseek_pagination_defaults_disable_thinking_for_both_protocols() {
    for protocol in [Protocol::ChatCompletions, Protocol::Responses] {
        for max_tokens_field in ["max_tokens", "max_completion_tokens"] {
            let mut provider = AiProviderConfig {
                id: "deepseek".into(),
                display_name: "DeepSeek".into(),
                base_url: "https://api.deepseek.com/v1".into(),
                protocol,
                has_api_key: true,
                compatibility: Compatibility::default(),
            };
            provider.compatibility.max_tokens_field = max_tokens_field.into();
            let mut m = model("deepseek", "deepseek");
            let build = |m: &AiModelConfig| {
                super::client::generation_request(
                    &provider,
                    m,
                    "系统 JSON 指令",
                    "演示正文",
                    GenerationTask::Pagination,
                )
            };
            let (endpoint, body) = build(&m);
            let output_field = if protocol == Protocol::Responses {
                "max_output_tokens"
            } else {
                max_tokens_field
            };
            assert_eq!(body[output_field], 4096);
            assert_eq!(body["stream"], false);
            assert_eq!(body["store"], false);
            if protocol == Protocol::Responses {
                assert_eq!(endpoint, "responses");
                assert_eq!(body["reasoning"], json!({"effort":"none"}));
                assert_eq!(body["text"]["format"]["type"], "json_object");
                assert!(body.get("thinking").is_none());
            } else {
                assert_eq!(endpoint, "chat/completions");
                assert_eq!(body["thinking"], json!({"type":"disabled"}));
                assert_eq!(body["response_format"]["type"], "json_object");
                assert!(body.get("reasoning_effort").is_none());
            }
            for effort in ["low", "medium", "high"] {
                m.reasoning_effort = Some(effort.into());
                m.max_output_tokens = Some(2222);
                let (_, body) = build(&m);
                assert_eq!(body[output_field], 2222);
                if protocol == Protocol::Responses {
                    assert_eq!(body["reasoning"], json!({"effort":effort}));
                    assert!(body.get("thinking").is_none());
                } else {
                    assert_eq!(body["thinking"], json!({"type":"enabled"}));
                    assert_eq!(body["reasoning_effort"], effort);
                }
            }
        }
    }
}

#[test]
fn pagination_thinking_defaults_do_not_change_other_providers_or_tasks() {
    for protocol in [Protocol::ChatCompletions, Protocol::Responses] {
        let mut provider = AiProviderConfig {
            id: "gateway".into(),
            display_name: "测试网关".into(),
            base_url: "https://gateway.example/v1".into(),
            protocol,
            has_api_key: false,
            compatibility: Compatibility::default(),
        };
        let m = model("model", "gateway");
        let ignore = |_: &serde_json::Value| {};
        for host in [
            "https://gateway.example/v1",
            "https://api.deepseek.com.evil.example",
        ] {
            provider.base_url = host.into();
            let (_, body) = super::client::generation_request(
                &provider,
                &m,
                "JSON",
                "演示",
                GenerationTask::Pagination,
            );
            assert!(body.get("reasoning").is_none());
            assert!(body.get("reasoning_effort").is_none());
            assert!(body.get("thinking").is_none());
        }
        provider.base_url = "https://api.deepseek.com".into();
        for task in [GenerationTask::General, GenerationTask::Metadata(&ignore)] {
            let (_, body) = super::client::generation_request(&provider, &m, "JSON", "演示", task);
            assert!(body.get("reasoning").is_none());
            assert!(body.get("thinking").is_none());
            assert!(body.get("reasoning_effort").is_none());
            let output_field = if protocol == Protocol::Responses {
                "max_output_tokens"
            } else {
                "max_completion_tokens"
            };
            if matches!(task, GenerationTask::General) {
                assert!(body.get(output_field).is_none());
                assert!(body.get("response_format").is_none());
                assert!(body.get("text").is_none());
            } else {
                assert_eq!(body[output_field], 8192);
            }
        }
    }
}

#[test]
fn pagination_contract_rejects_bad_references_and_variables() {
    let r = pagination_request();
    for output in [
        r#"{"bind_after":["B99"],"prefer_after":[]}"#,
        r#"{"bind_after":["B2","B1"],"prefer_after":[]}"#,
        r#"{"bind_after":["B1","B1"],"prefer_after":[]}"#,
        r#"{"bind_after":["B1"],"prefer_after":["B1"]}"#,
        r#"{"bind_after":[],"prefer_after":[],"body":"不可改写"}"#,
        r#"{"bind_after":[]}"#,
    ] {
        assert!(super::pagination::parse(output, &r.blocks).is_err());
    }
    assert!(
        super::pagination::parse(r#"{"bind_after":["B1"],"prefer_after":["B3"]}"#, &r.blocks)
            .is_ok()
    );
    assert!(super::pagination::validate_variables("{{title}} {{blocks}}").is_ok());
    assert!(super::pagination::validate_variables("{{content}}").is_err());
    assert!(super::pagination::validate_variables("{{blocks").is_err());
}

#[tokio::test]
async fn pagination_migration_preserves_title_settings_and_separates_defaults() {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0003_ai_settings.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE ai_prompt_templates SET name='自定义标题',system_prompt='保留指令',candidate_count=3,max_length=42").execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0006_ai_pagination.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let db = Database { pool };
    let settings = db.ai_settings().await.unwrap();
    let title = settings
        .templates
        .iter()
        .find(|t| t.purpose == TemplatePurpose::Title)
        .unwrap();
    assert_eq!(title.name, "自定义标题");
    assert_eq!(title.system_prompt, "保留指令");
    assert_eq!(
        (title.candidate_count, title.max_length, title.is_default),
        (3, 42, true)
    );
    let pagination = settings
        .templates
        .iter()
        .find(|t| t.purpose == TemplatePurpose::Pagination)
        .unwrap();
    assert!(pagination.is_default);
    pagination.validate().unwrap();
    let mut copy = pagination.clone();
    copy.id = "pagination-copy".into();
    db.ai_save_template(&copy).await.unwrap();
    let settings = db.ai_settings().await.unwrap();
    assert_eq!(
        settings.templates.iter().filter(|t| t.is_default).count(),
        2
    );
    assert!(
        settings
            .templates
            .iter()
            .any(|t| t.id == title.id && t.is_default)
    );
    copy.purpose = TemplatePurpose::Title;
    assert!(db.ai_save_template(&copy).await.is_err());
}

#[tokio::test]
async fn title_prompt_migration_updates_only_builtin_system_prompt_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ai.db");
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .foreign_keys(true),
    )
    .await
    .unwrap();
    sqlx::migrate!("./migrations")
        .run_to(8, &pool)
        .await
        .unwrap();
    let db = Database { pool };
    db.ai_save_provider(
        &provider("demo", "https://demo.example/v1", Protocol::Responses),
        None,
    )
    .await
    .unwrap();
    db.ai_save_model(&model("demo-model", "demo"))
        .await
        .unwrap();
    let mut builtin = db
        .ai_settings()
        .await
        .unwrap()
        .templates
        .into_iter()
        .find(|t| t.id == "builtin-news-title")
        .unwrap();
    builtin.name = "演示：已重命名的内置模板".into();
    builtin.system_prompt = "演示：升级前的自定义系统指令".into();
    builtin.user_prompt =
        "演示：保留 {{title}} {{content}} {{count}} {{max_length}} {{requirements}}".into();
    builtin.model_config_id = Some("demo-model".into());
    builtin.candidate_count = 3;
    builtin.max_length = 42;
    db.ai_save_template(&builtin).await.unwrap();
    let mut custom = builtin.clone();
    custom.id = "demo-custom-title".into();
    custom.system_prompt = "演示：保留自建模板的系统指令".into();
    db.ai_save_template(&custom).await.unwrap();
    let mut pagination = db
        .ai_settings()
        .await
        .unwrap()
        .templates
        .into_iter()
        .find(|t| t.purpose == TemplatePurpose::Pagination)
        .unwrap();
    pagination.system_prompt = "演示：保留分页系统指令".into();
    pagination.model_config_id = Some("demo-model".into());
    db.ai_save_template(&pagination).await.unwrap();
    let mut expected = serde_json::to_value(db.ai_settings().await.unwrap()).unwrap();
    db.pool.close().await;

    let db = Database::open(&path).await.unwrap();
    let settings = db.ai_settings().await.unwrap();
    let mut upgraded = settings
        .templates
        .iter()
        .find(|t| t.id == builtin.id)
        .unwrap()
        .clone();
    assert!(upgraded.system_prompt.contains("根据当前标题"));
    assert!(upgraded.system_prompt.contains("点击进来、继续阅读的欲望"));
    assert!(upgraded.system_prompt.contains("不编造信息"));
    expected["templates"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|t| t["id"] == builtin.id)
        .unwrap()["systemPrompt"] = json!(upgraded.system_prompt);
    assert_eq!(serde_json::to_value(settings).unwrap(), expected);

    upgraded.system_prompt = "演示：升级后再次修改的指令".into();
    db.ai_save_template(&upgraded).await.unwrap();
    let expected = serde_json::to_value(db.ai_settings().await.unwrap()).unwrap();
    db.pool.close().await;
    let db = Database::open(&path).await.unwrap();
    assert_eq!(
        serde_json::to_value(db.ai_settings().await.unwrap()).unwrap(),
        expected
    );
    db.pool.close().await;
}

#[tokio::test]
async fn title_prompt_migration_initializes_fresh_databases_and_preserves_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ai.db");
    let db = Database::open(&path).await.unwrap();
    let settings = db.ai_settings().await.unwrap();
    let builtin = settings
        .templates
        .iter()
        .find(|t| t.id == "builtin-news-title")
        .unwrap();
    assert!(builtin.system_prompt.contains("点击进来、继续阅读的欲望"));
    assert_eq!(
        (
            builtin.candidate_count,
            builtin.max_length,
            builtin.is_default
        ),
        (5, 30, true)
    );
    builtin.validate().unwrap();
    let expected = serde_json::to_value(settings).unwrap();
    db.pool.close().await;
    let db = Database::open(&path).await.unwrap();
    assert_eq!(
        serde_json::to_value(db.ai_settings().await.unwrap()).unwrap(),
        expected
    );
    db.pool.close().await;

    let deleted_path = dir.path().join("deleted.db");
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&deleted_path)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::migrate!("./migrations")
        .run_to(8, &pool)
        .await
        .unwrap();
    let db = Database { pool };
    db.ai_delete_config("template", "builtin-news-title")
        .await
        .unwrap();
    let expected = serde_json::to_value(db.ai_settings().await.unwrap()).unwrap();
    db.pool.close().await;
    let db = Database::open(&deleted_path).await.unwrap();
    assert_eq!(
        serde_json::to_value(db.ai_settings().await.unwrap()).unwrap(),
        expected
    );
    db.pool.close().await;
}

#[tokio::test]
async fn pagination_uses_saved_provider_protocol_limits_and_rejects_partial_output() {
    for (protocol, field) in [
        (Protocol::ChatCompletions, "max_tokens"),
        (Protocol::Responses, "max_output_tokens"),
    ] {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("ai.db")).await.unwrap();
        let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
        let mut p = provider("gateway", &format!("{}/prefix", server.uri()), protocol);
        p.compatibility.max_tokens_field = "max_tokens".into();
        p.compatibility.system_role = "developer".into();
        ai.save_provider(&db, p).await.unwrap();
        db.ai_save_model(&model("gateway", "gateway"))
            .await
            .unwrap();
        let output = r#"{"bind_after":["B1"],"prefer_after":[]}"#;
        let endpoint = if protocol == Protocol::ChatCompletions {
            "/prefix/chat/completions"
        } else {
            "/prefix/responses"
        };
        let payload = if protocol == Protocol::ChatCompletions {
            json!({"choices":[{"finish_reason":"stop","message":{"content":output}}]})
        } else {
            json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":output}]}]})
        };
        Mock::given(method("POST"))
            .and(path(endpoint))
            .and(header("authorization", "Bearer fake-ai-test-secret"))
            .respond_with(ResponseTemplate::new(200).set_body_json(payload.clone()))
            .expect(2)
            .mount(&server)
            .await;
        let result = ai
            .suggest_pagination(&db, pagination_request())
            .await
            .unwrap();
        assert_eq!(result.semantic.bind_after, vec!["B1"]);
        let mut m = model("gateway", "gateway");
        m.max_output_tokens = Some(2222);
        m.reasoning_effort = Some("low".into());
        db.ai_save_model(&m).await.unwrap();
        ai.suggest_pagination(&db, pagination_request())
            .await
            .unwrap();
        let received = server.received_requests().await.unwrap();
        let first: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
        let second: serde_json::Value = serde_json::from_slice(&received[1].body).unwrap();
        assert_eq!(first[field], 4096);
        assert_eq!(second[field], 2222);
        if protocol == Protocol::ChatCompletions {
            assert_eq!(first["messages"][0]["role"], "developer");
            assert_eq!(first["response_format"]["type"], "json_object");
            assert_eq!(second["reasoning_effort"], "low");
        } else {
            assert_eq!(first["text"]["format"]["type"], "json_object");
            assert_eq!(second["reasoning"]["effort"], "low");
        }
        assert!(
            serde_json::to_string(&first)
                .unwrap()
                .contains("演示答案 {{blocks}}")
        );
        server.reset().await;
        let mut partial = payload.clone();
        if protocol == Protocol::ChatCompletions {
            partial["choices"][0]["finish_reason"] = json!("length");
        } else {
            partial["status"] = json!("incomplete");
            partial["incomplete_details"] = json!({"reason":"max_output_tokens"});
        }
        Mock::given(method("POST"))
            .and(path(endpoint))
            .respond_with(ResponseTemplate::new(200).set_body_json(partial))
            .expect(1)
            .mount(&server)
            .await;
        let error = ai
            .suggest_pagination(&db, pagination_request())
            .await
            .err()
            .expect("截断响应必须报错");
        assert_eq!(error.code, "AI_OUTPUT_LIMIT");
        assert!(error.message.contains("包含推理消耗"));
        assert!(error.message.contains("手动重试"));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
        server.reset().await;
        let mut wrong = pagination_request();
        wrong.template_id = "builtin-news-title".into();
        assert!(ai.suggest_pagination(&db, wrong).await.is_err());
        assert!(server.received_requests().await.unwrap().is_empty());
    }
}

// 显式手动调用才访问真实服务；普通测试不会请求 AI。密钥由进程环境提供，仅进入内存凭据替身。
#[tokio::test]
#[ignore = "需要显式提供真实 AI 测试配置"]
async fn pagination_live_smoke() {
    let key = std::env::var("PRESSDOCK_LIVE_AI_KEY").expect("缺少真实 AI 测试密钥");
    let base = std::env::var("PRESSDOCK_LIVE_AI_BASE").expect("缺少真实 AI 测试地址");
    let model_id = std::env::var("PRESSDOCK_LIVE_AI_MODEL").expect("缺少真实 AI 测试模型");
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("live-pagination.db"))
        .await
        .unwrap();
    let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
    let mut config = provider("gateway", &base, Protocol::ChatCompletions);
    config.api_key = Some(key);
    config.compatibility.max_tokens_field = "max_tokens".into();
    config.compatibility.send_store = false;
    ai.save_provider(&db, config).await.unwrap();
    let mut configured_model = model("gateway", "gateway");
    configured_model.model_id = model_id;
    db.ai_save_model(&configured_model).await.unwrap();
    let mut template = db
        .ai_settings()
        .await
        .unwrap()
        .templates
        .into_iter()
        .find(|t| t.purpose == TemplatePurpose::Pagination)
        .unwrap();
    template.model_config_id = Some("gateway".into());
    db.ai_save_template(&template).await.unwrap();
    let fixtures: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../docs/ai-pagination/demo-fixtures.json"
    ))
    .unwrap();
    let mut reports = Vec::new();
    for fixture in fixtures.into_iter().filter(|f| {
        f["split"] == "semantic" || f["id"] == "demo-short" || f["id"] == "demo-caption-tail"
    }) {
        let started = std::time::Instant::now();
        let r = PaginationRequest {
            job_id: uuid::Uuid::new_v4().to_string(),
            template_id: template.id.clone(),
            model_config_id: "gateway".into(),
            title: fixture["title"].as_str().unwrap().into(),
            blocks: serde_json::from_value(fixture["blocks"].clone()).unwrap(),
        };
        let result = ai.suggest_pagination(&db, r).await.unwrap();
        reports.push(json!({"id":fixture["id"],"semantic":result.semantic,"elapsedMs":started.elapsed().as_millis()}));
    }
    println!("真实分页调用通过：{} 个演示用例", reports.len());
    if let Ok(path) = std::env::var("PRESSDOCK_LIVE_PAGINATION_OUTPUT") {
        std::fs::write(path, serde_json::to_string_pretty(&reports).unwrap()).unwrap();
    }
}

#[tokio::test]
async fn settings_persist_default_is_unique_and_references_are_protected() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ai.db");
    let db = Database::open(&path).await.unwrap();
    let vault = Arc::new(TestVault::default());
    let ai = AiService::with_vault(vault.clone()).unwrap();
    ai.save_provider(
        &db,
        provider(
            "first",
            "https://gateway.example/v1",
            Protocol::ChatCompletions,
        ),
    )
    .await
    .unwrap();
    ai.save_provider(
        &db,
        provider("second", "https://second.example/v1", Protocol::Responses),
    )
    .await
    .unwrap();
    db.ai_save_model(&model("model-1", "first")).await.unwrap();
    db.ai_save_model(&model("model-2", "second")).await.unwrap();
    assert!(
        db.ai_save_model(&model("duplicate", "first"))
            .await
            .is_err()
    );
    let mut template = db.ai_settings().await.unwrap().templates.remove(0);
    template.model_config_id = Some("model-1".into());
    db.ai_save_template(&template).await.unwrap();
    let mut copy = template.clone();
    copy.id = "copy".into();
    copy.name = "副本".into();
    copy.model_config_id = Some("model-2".into());
    db.ai_save_template(&copy).await.unwrap();
    let settings = db.ai_settings().await.unwrap();
    assert_eq!(
        settings
            .templates
            .iter()
            .filter(|t| t.is_default && t.purpose == TemplatePurpose::Title)
            .count(),
        1
    );
    assert!(
        settings
            .templates
            .iter()
            .any(|t| t.id == "copy" && t.is_default)
    );
    assert_eq!(
        ai.delete_config(&db, "provider", "first")
            .await
            .unwrap_err()
            .code,
        "AI_IN_USE"
    );
    assert_eq!(
        ai.delete_config(&db, "model", "model-2")
            .await
            .unwrap_err()
            .code,
        "AI_IN_USE"
    );
    assert_eq!(vault.values.lock().unwrap().len(), 2);
    assert!(
        !serde_json::to_string(&settings)
            .unwrap()
            .contains("fake-ai-test-secret")
    );
    assert!(
        !serde_json::to_string(&settings)
            .unwrap()
            .contains("credentialRef")
    );
    let mut invalid = copy.clone();
    invalid.user_prompt = "{{unknown}}".into();
    assert!(db.ai_save_template(&invalid).await.is_err());
    assert_eq!(db.ai_settings().await.unwrap().templates.len(), 3);
    db.pool.close().await;
    let db = Database::open(&path).await.unwrap();
    assert_eq!(db.ai_settings().await.unwrap().providers.len(), 2);
    assert_eq!(db.ai_settings().await.unwrap().templates.len(), 3);
    template.model_config_id = None;
    template.is_default = false;
    db.ai_save_template(&template).await.unwrap();
    ai.delete_config(&db, "provider", "first").await.unwrap();
    assert_eq!(vault.values.lock().unwrap().len(), 1);
    assert_eq!(db.ai_settings().await.unwrap().models.len(), 1);
    db.ai_delete_config("template", "copy").await.unwrap();
    assert!(
        db.ai_settings()
            .await
            .unwrap()
            .templates
            .iter()
            .filter(|t| t.purpose == TemplatePurpose::Title)
            .all(|t| !t.is_default)
    );
}

#[tokio::test]
async fn credential_failures_do_not_write_keys_or_replace_working_config() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("ai.db")).await.unwrap();
    let vault = Arc::new(TestVault::default());
    let ai = AiService::with_vault(vault.clone()).unwrap();
    ai.save_provider(
        &db,
        provider("gateway", "https://gateway.example/v1", Protocol::Responses),
    )
    .await
    .unwrap();
    let reference = db.ai_credential_ref("gateway").await.unwrap();
    let mut update = provider("gateway", "https://other.example/v1", Protocol::Responses);
    update.api_key = Some("new-fake-secret".into());
    vault.fail.store(true, Ordering::SeqCst);
    assert_eq!(
        ai.save_provider(&db, update).await.unwrap_err().code,
        "AI_CREDENTIAL_STORE"
    );
    assert_eq!(db.ai_credential_ref("gateway").await.unwrap(), reference);
    assert_eq!(
        db.ai_settings().await.unwrap().providers[0].base_url,
        "https://gateway.example/v1"
    );
    let mut update = provider("gateway", "https://gateway.example/v1", Protocol::Responses);
    update.api_key = None;
    ai.save_provider(&db, update).await.unwrap();
    assert_eq!(vault.values.lock().unwrap().len(), 1);
}

#[test]
fn validation_and_candidate_filtering_use_unicode_and_never_truncate() {
    assert_eq!(
        candidates(
            "```json\n[\"  简洁标题  \",\"简洁标题\",\"\",\"超过长度的标题\",\"😀新闻\"]\n```",
            5,
            4
        )
        .unwrap(),
        vec!["简洁标题", "😀新闻"]
    );
    assert!(candidates("不是 JSON", 5, 30).is_err());
    assert!(candidates("[\"太长的标题\"]", 5, 1).is_err());
    assert!(super::titles::validate_variables("{{content}}").is_ok());
    assert!(super::titles::validate_variables("{{wrong}}").is_err());
    assert!(super::titles::validate_variables("{{title").is_err());
    assert!(
        provider("Bad-ID", "https://gateway.example", Protocol::Responses)
            .validate()
            .is_err()
    );
    assert!(
        provider(
            "gateway",
            "https://name:key@gateway.example",
            Protocol::Responses
        )
        .validate()
        .is_err()
    );
    assert!(
        provider("gateway", "http://remote.example", Protocol::Responses)
            .validate()
            .is_err()
    );
    assert!(
        provider("gateway", "http://127.0.0.1:1234/v1", Protocol::Responses)
            .validate()
            .is_ok()
    );
    let mut m = model("a", "p");
    m.context_window = Some(10);
    m.max_output_tokens = Some(20);
    assert!(m.validate().is_err());
    assert!(rules(0, 30).is_err());
    assert!(rules(5, 201).is_err());
}

#[tokio::test]
async fn both_protocols_discovery_options_and_gateway_compatibility() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("ai.db")).await.unwrap();
    let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
    for (id, protocol) in [
        ("chat", Protocol::ChatCompletions),
        ("responses", Protocol::Responses),
    ] {
        ai.save_provider(
            &db,
            provider(id, &format!("{}/proxy/v1", server.uri()), protocol),
        )
        .await
        .unwrap();
        db.ai_save_model(&model(id, id)).await.unwrap();
    }
    Mock::given(method("GET"))
        .and(path("/proxy/v1/models"))
        .and(header("authorization", "Bearer fake-ai-test-secret"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"data":[{"id":"beta"},{"id":"alpha"},{"id":"alpha"}]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        ai.list_models(&db, "chat").await.unwrap(),
        vec!["alpha", "beta"]
    );
    Mock::given(method("POST")).and(path("/proxy/v1/chat/completions")).and(body_partial_json(json!({"store":false,"stream":false,"model":"test-model"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"choices":[{"message":{"content":"[\"新的标题\",\"新的标题\",\"另一标题\"]"},"finish_reason":"stop"}]}))).expect(2).mount(&server).await;
    let mut template = db.ai_settings().await.unwrap().templates.remove(0);
    let mut unbound = request();
    unbound.model_config_id = Some("chat".into());
    assert_eq!(
        ai.suggest_titles(&db, unbound).await.err().unwrap().code,
        "AI_VALIDATION"
    );
    template.model_config_id = Some("chat".into());
    db.ai_save_template(&template).await.unwrap();
    let result = ai.suggest_titles(&db, request()).await.unwrap();
    assert_eq!(result.candidates.len(), 2);
    assert_eq!(result.model_config_id, "chat");
    let received = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&received[1].body).unwrap();
    assert!(body.get("max_completion_tokens").is_none());
    assert!(body.get("reasoning_effort").is_none());
    assert!(
        body["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("当前标题 {{content}}")
    );
    assert!(
        body["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("当前编辑正文")
    );
    let mut configured = model("chat", "chat");
    configured.max_output_tokens = Some(2048);
    configured.reasoning_effort = Some("low".into());
    db.ai_save_model(&configured).await.unwrap();
    ai.suggest_titles(&db, request()).await.unwrap();
    let requests = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&requests[2].body).unwrap();
    assert_eq!(body["max_completion_tokens"], 2048);
    assert_eq!(body["reasoning_effort"], "low");
    Mock::given(method("POST")).and(path("/proxy/v1/responses")).and(body_partial_json(json!({"max_output_tokens":1024,"reasoning":{"effort":"high"},"store":false})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status":"completed","output":[{"type":"reasoning","summary":[]},{"type":"message","content":[{"type":"output_text","text":"[\"响应协议标题\"]"}]}]}))).expect(1).mount(&server).await;
    let mut configured = model("responses", "responses");
    configured.max_output_tokens = Some(1024);
    configured.reasoning_effort = Some("high".into());
    db.ai_save_model(&configured).await.unwrap();
    let mut r = request();
    r.model_config_id = Some("responses".into());
    r.candidate_count = Some(1);
    r.max_length = Some(20);
    let result = ai.suggest_titles(&db, r).await.unwrap();
    assert_eq!(result.candidates, vec!["响应协议标题"]);
    server.reset().await;
    let mut p = provider(
        "chat",
        &format!("{}/proxy/v1", server.uri()),
        Protocol::ChatCompletions,
    );
    p.compatibility = Compatibility {
        max_tokens_field: "max_tokens".into(),
        system_role: "developer".into(),
        send_store: false,
    };
    ai.save_provider(&db, p).await.unwrap();
    Mock::given(method("POST"))
        .and(path("/proxy/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"choices":[{"message":{"content":"测试成功"}}]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let mut compat_model = model("chat", "chat");
    compat_model.max_output_tokens = Some(256);
    ai.generate_text(&db, &compat_model, "指令", "测试")
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(body.get("store").is_none());
    assert_eq!(body["messages"][0]["role"], "developer");
    assert_eq!(body["max_tokens"], 256);
    assert!(body.get("max_completion_tokens").is_none());
}

#[tokio::test]
async fn metadata_token_budget_respects_both_protocols_and_explicit_limits() {
    for (protocol, tokens_field) in [
        (Protocol::ChatCompletions, "max_completion_tokens"),
        (Protocol::ChatCompletions, "max_tokens"),
        (Protocol::Responses, "max_output_tokens"),
    ] {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("ai.db")).await.unwrap();
        let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
        let mut config = provider("gateway", &server.uri(), protocol);
        if tokens_field == "max_tokens" {
            config.compatibility.max_tokens_field = "max_tokens".into();
        }
        ai.save_provider(&db, config).await.unwrap();
        let text = r#"{"smallText":"本地测试摘要","tags":["测试","摘要","标签"]}"#;
        let (endpoint, response) = match protocol {
            Protocol::ChatCompletions => (
                "/chat/completions",
                json!({"choices":[{"finish_reason":"stop","message":{"content":text}}]}),
            ),
            Protocol::Responses => (
                "/responses",
                json!({"status":"completed","output":[{"type":"reasoning","summary":[]},{"type":"message","content":[{"type":"output_text","text":text}]}]}),
            ),
        };
        Mock::given(method("POST"))
            .and(path(endpoint))
            .respond_with(ResponseTemplate::new(200).set_body_json(response))
            .expect(3)
            .mount(&server)
            .await;
        for limit in [None, Some(2048)] {
            let mut configured = model("metadata", "gateway");
            configured.max_output_tokens = limit;
            configured.reasoning_effort = Some("high".into());
            let observed = Mutex::new(Vec::new());
            let observe = |response: &serde_json::Value| {
                observed.lock().unwrap().push(response.clone());
            };
            assert_eq!(
                ai.generate_for_task(
                    &db,
                    &configured,
                    "只返回 JSON 对象",
                    "本地测试文章",
                    GenerationTask::Metadata(&observe),
                )
                .await
                .unwrap(),
                text
            );
            assert_eq!(observed.lock().unwrap().len(), 1);
        }
        ai.generate_text(&db, &model("general", "gateway"), "测试", "本地文本")
            .await
            .unwrap();
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 3);
        for (request, limit) in requests.iter().zip([Some(8192), Some(2048), None]) {
            let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
            for field in ["max_output_tokens", "max_completion_tokens", "max_tokens"] {
                if field == tokens_field
                    && let Some(limit) = limit
                {
                    assert_eq!(body[field], limit);
                } else {
                    assert!(body.get(field).is_none(), "不应发送 {field}：{body}");
                }
            }
            if limit.is_some() {
                let (format, effort) = match protocol {
                    Protocol::ChatCompletions => {
                        (&body["response_format"]["type"], &body["reasoning_effort"])
                    }
                    Protocol::Responses => (
                        &body["text"]["format"]["type"],
                        &body["reasoning"]["effort"],
                    ),
                };
                assert_eq!(format, "json_object");
                assert_eq!(effort, "high");
            }
        }
    }
}

#[tokio::test]
async fn unfinished_responses_reject_partial_text_and_preserve_redacted_diagnostics() {
    let partial = json!([{"type":"message","content":[{"type":"output_text","text":"{\"smallText\":\"部分结果\"}"}]}]);
    for (mut response, code, message) in [
        (
            json!({"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"reasoning","summary":[]}]}),
            "AI_OUTPUT_LIMIT",
            "输出达到 token 上限",
        ),
        (
            json!({"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":partial}),
            "AI_OUTPUT_LIMIT",
            "输出达到 token 上限",
        ),
        (
            json!({"status":"incomplete","incomplete_details":{"reason":"content_filter"},"output":partial}),
            "AI_RESPONSE",
            "内容过滤",
        ),
        (
            json!({"status":"failed","error":{"code":"server_error","message":"回显 fake-ai-test-secret"},"output":partial}),
            "AI_RESPONSE",
            "服务生成失败",
        ),
        (
            json!({"status":"cancelled","output":partial}),
            "AI_RESPONSE",
            "已取消本次生成",
        ),
        (
            json!({"status":"queued","output":partial}),
            "AI_RESPONSE",
            "仍在生成",
        ),
        (
            json!({"status":"in_progress","output":partial}),
            "AI_RESPONSE",
            "仍在生成",
        ),
        (
            json!({"status":"incomplete","incomplete_details":{"reason":"unknown_reason"},"output":partial}),
            "AI_RESPONSE",
            "模型未完成输出",
        ),
        (
            json!({"status":"incomplete","output":partial}),
            "AI_RESPONSE",
            "模型未完成输出",
        ),
        (
            json!({"status":"unknown_status","output":partial}),
            "AI_RESPONSE",
            "模型未完成输出",
        ),
        (
            json!({"status":"completed","output":[{"type":"reasoning","summary":[]}]}),
            "AI_RESPONSE",
            "未返回可用文本",
        ),
    ] {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("ai.db")).await.unwrap();
        let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
        ai.save_provider(&db, provider("gateway", &server.uri(), Protocol::Responses))
            .await
            .unwrap();
        response["api_key"] = json!("fake-ai-test-secret");
        response["usage"] =
            json!({"output_tokens":512,"output_tokens_details":{"reasoning_tokens":512}});
        Mock::given(method("POST"))
            .and(path("/responses"))
            .respond_with(ResponseTemplate::new(200).set_body_json(response.clone()))
            .expect(1)
            .mount(&server)
            .await;
        let observed = Mutex::new(Vec::new());
        let observe = |response: &serde_json::Value| {
            observed.lock().unwrap().push(response.clone());
        };
        let error = ai
            .generate_for_task(
                &db,
                &model("metadata", "gateway"),
                "只返回 JSON 对象",
                "本地测试文章",
                GenerationTask::Metadata(&observe),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, code);
        assert!(error.message.contains(message), "{}", error.message);
        assert!(!error.message.contains("fake-ai-test-secret"));
        if code != "AI_OUTPUT_LIMIT" {
            assert!(!error.message.contains("输出上限"));
        }
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
        let observed = observed.lock().unwrap();
        assert_eq!(observed.len(), 1);
        let diagnostic = error.diagnostic.unwrap();
        assert_eq!(diagnostic.operation, "ai.responses.output");
        assert_eq!(diagnostic.context, observed[0]);
        assert_eq!(diagnostic.context["status"], response["status"]);
        assert_eq!(diagnostic.context["output"], response["output"]);
        assert_eq!(diagnostic.context["usage"], response["usage"]);
        assert_eq!(diagnostic.context["api_key"], "[REDACTED]");
        assert!(
            !serde_json::to_string(&diagnostic)
                .unwrap()
                .contains("fake-ai-test-secret")
        );
    }
}

#[tokio::test]
async fn http_errors_are_redacted_independent_and_never_retried() {
    for (status, body, code) in [
        (
            401,
            json!({"error":{"message":"fake-ai-test-secret"}}),
            "AI_AUTH",
        ),
        (403, json!({}), "AI_AUTH"),
        (429, json!({}), "AI_RATE_LIMIT"),
        (
            400,
            json!({"error":{"code":"context_length_exceeded"}}),
            "AI_CONTEXT_LIMIT",
        ),
        (500, json!({}), "AI_HTTP"),
        (200, json!({"choices":[]}), "AI_RESPONSE"),
        (
            200,
            json!({"choices":[{"finish_reason":"length","message":{"content":"不完整"}}]}),
            "AI_OUTPUT_LIMIT",
        ),
    ] {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("ai.db")).await.unwrap();
        let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
        ai.save_provider(
            &db,
            provider("chat", &server.uri(), Protocol::ChatCompletions),
        )
        .await
        .unwrap();
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .expect(1)
            .mount(&server)
            .await;
        let error = ai
            .generate_text(&db, &model("a", "chat"), "测试", "固定文本")
            .await
            .unwrap_err();
        assert_eq!(error.code, code);
        assert!(!error.message.contains("fake-ai-test-secret"));
        assert_ne!(error.code, "AUTH_EXPIRED");
    }
}

#[tokio::test]
async fn cancelling_jobs_before_start_or_during_io_never_returns_results() {
    let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    ai.cancel(&id);
    assert_eq!(
        ai.run(&id, async { Ok(1) }).await.unwrap_err().code,
        "AI_CANCELLED"
    );
    let id = uuid::Uuid::new_v4().to_string();
    let task = ai.run(&id, async {
        tokio::time::sleep(Duration::from_secs(10)).await;
        Ok(1)
    });
    let cancel = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        ai.cancel(&id);
    };
    let (result, ()) = tokio::join!(task, cancel);
    assert_eq!(result.unwrap_err().code, "AI_CANCELLED");
    assert_eq!(ai.run(&id, async { Ok(2) }).await.unwrap(), 2);
}
