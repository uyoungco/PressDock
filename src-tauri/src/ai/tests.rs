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
        settings.templates.iter().filter(|t| t.is_default).count(),
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
    assert_eq!(db.ai_settings().await.unwrap().templates.len(), 2);
    db.pool.close().await;
    let db = Database::open(&path).await.unwrap();
    assert_eq!(db.ai_settings().await.unwrap().providers.len(), 2);
    assert_eq!(db.ai_settings().await.unwrap().templates.len(), 2);
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
