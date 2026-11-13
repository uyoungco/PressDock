//! 演示数据覆盖付费请求边界、快照与不可变原文。
use super::organization;
use super::*;
use crate::{ai::*, database::Database};
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

async fn configured(db: &Database, base: &str) -> AiModelConfig {
    db.ai_save_provider(
        &SaveProviderRequest {
            id: "demo".into(),
            display_name: "演示提供商".into(),
            base_url: base.into(),
            protocol: Protocol::ChatCompletions,
            api_key: None,
            compatibility: Compatibility::default(),
            create_only: false,
        },
        None,
    )
    .await
    .unwrap();
    let model = AiModelConfig {
        id: "demo-model".into(),
        provider_id: "demo".into(),
        model_id: "demo".into(),
        display_name: "演示模型".into(),
        context_window: None,
        max_output_tokens: Some(2048),
        reasoning_effort: None,
    };
    db.ai_save_model(&model).await.unwrap();
    for mut template in db
        .ai_settings()
        .await
        .unwrap()
        .templates
        .into_iter()
        .filter(|t| t.purpose != TemplatePurpose::Title)
    {
        template.model_config_id = Some(model.id.clone());
        db.ai_save_template(&template).await.unwrap();
    }
    model
}

#[tokio::test]
async fn organization_and_pagination_switches_snapshot_independently_and_retry_keeps_checkpoint() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("demo.db");
    let db = Database::open(&path).await.unwrap();
    assert!(
        !db.harvest_settings()
            .await
            .unwrap()
            .options
            .ai_organize_body
    );
    let model = configured(&db, "https://example.com").await;
    for (index, (organize, paginate)) in
        [(false, false), (true, false), (false, true), (true, true)]
            .into_iter()
            .enumerate()
    {
        let mut settings = db.harvest_settings().await.unwrap();
        settings.options.auto_classify = false;
        settings.options.auto_tags = false;
        settings.options.auto_summary = false;
        settings.options.ai_organize_body = organize;
        settings.options.ai_auto_paginate = paginate;
        db.harvest_save_settings(&settings).await.unwrap();
        let request = EnqueueRequest {
            id: uuid::Uuid::new_v4().to_string(),
            url: format!("https://baijiahao.baidu.com/s?id={}", 9000 + index),
        };
        db.harvest_enqueue(1, &request).await.unwrap();
        let saved = db.harvest_claim(1).await.unwrap().unwrap();
        assert_eq!(saved.options.organization_snapshot.is_some(), organize);
        assert_eq!(saved.options.pagination_snapshot.is_some(), paginate);
        assert!(saved.options.metadata_snapshot.is_none());
        let raw = RawArticle {
            title: "【演示数据】快照".into(),
            writer: "演示".into(),
            source_url: request.url.clone(),
            news_html: "<p>【演示数据】不可变原文</p>".into(),
        };
        db.harvest_save_raw(&request.id, &raw, &request.url)
            .await
            .unwrap();
        let formatted = FormattedArticle {
            title: raw.title.clone(),
            writer: raw.writer.clone(),
            source_url: request.url.clone(),
            news_text: "<p>【演示数据】格式化输入</p>".into(),
            title_pic: String::new(),
            small_text: String::new(),
            class_id: 1,
            tags: vec![],
        };
        db.harvest_save_result(&request.id, &formatted, false)
            .await
            .unwrap();
        if organize {
            db.harvest_save_organized(
                &request.id,
                &OrganizationCheckpoint {
                    input_html: formatted.news_text.clone(),
                    contract_version: 2,
                    article: formatted.clone(),
                    warning: Some("【演示数据】整理回退".into()),
                },
            )
            .await
            .unwrap();
        }
        db.harvest_finish(
            &request.id,
            Status::Failed,
            Some("【演示数据】分页后中断"),
            None,
        )
        .await
        .unwrap();
        db.harvest_action(&request.id, 1, &Action::Retry)
            .await
            .unwrap();
        let retried = db.harvest_claim(1).await.unwrap().unwrap();
        assert_eq!(retried.organized.is_some(), organize);
        assert_eq!(retried.raw.unwrap().news_html, raw.news_html);
        assert_eq!(retried.formatted.unwrap().news_text, formatted.news_text);
        if let Some(snapshot) = retried.options.organization_snapshot {
            assert_eq!(snapshot.execution.model.id, model.id);
            assert_eq!(snapshot.contract_version, 2);
        }
        db.harvest_cancel(&request.id, 1).await.unwrap();
        assert!(
            db.harvest_save_organized(
                &request.id,
                &OrganizationCheckpoint {
                    input_html: String::new(),
                    contract_version: 2,
                    article: formatted,
                    warning: None
                }
            )
            .await
            .is_err()
        );
    }
    // 删除默认模板后新任务明确报错；原请求仍定位旧记录，不改用当前配置。
    let mut settings = db.harvest_settings().await.unwrap();
    settings.options.ai_organize_body = true;
    db.harvest_save_settings(&settings).await.unwrap();
    db.ai_delete_config("template", "builtin-body-organization")
        .await
        .unwrap();
    assert!(
        db.harvest_enqueue(
            1,
            &EnqueueRequest {
                id: uuid::Uuid::new_v4().to_string(),
                url: "https://baijiahao.baidu.com/s?id=9999".into()
            }
        )
        .await
        .is_err()
    );
    db.pool.close().await;
    let db = Database::open(&path).await.unwrap();
    assert!(
        !db.ai_settings()
            .await
            .unwrap()
            .templates
            .iter()
            .any(|t| t.purpose == TemplatePurpose::BodyOrganization)
    );
    db.pool.close().await;
}

#[tokio::test]
async fn organization_makes_one_request_and_rejects_truncation_and_untrusted_output() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("demo.db")).await.unwrap();
    configured(&db, &server.uri()).await;
    let snapshot = OrganizationSnapshot {
        execution: db
            .ai_execution_snapshot("demo-model")
            .await
            .unwrap()
            .unwrap(),
        template_id: "builtin-body-organization".into(),
        system_prompt: include_str!("../../../docs/ai-body-organization/prompts/v6.txt").into(),
        user_prompt: "{{title}} {{blocks}}".into(),
        contract_version: 2,
    };
    let ai = AiService::new().unwrap();
    let html = format!(
        "<p>{}。{}。{}。</p>",
        "【演示数据】第一事件".repeat(10),
        "【演示数据】第二事件".repeat(10),
        "【演示数据】第三事件".repeat(10)
    );
    for (content, finish, valid) in [
        (r#"{"version":2,"actions":["A1"]}"#, "stop", true),
        (r#"{"version":2,"actions":["A1"]}"#, "length", false),
        (r#"{"version":2,"actions":["A99"]}"#, "stop", false),
        (r#"{"version":2,"actions":[],"html":"篡改"}"#, "stop", false),
    ] {
        server.reset().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"choices":[{"finish_reason":finish,"message":{"content":content}}]}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        assert_eq!(
            organization::organize(&ai, &snapshot, "【演示数据】排版", &html)
                .await
                .is_ok(),
            valid
        );
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 1);
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert_eq!(body["max_completion_tokens"], 2048);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(
            organization::organize(&ai, &snapshot, "演示短文", "<p>【演示数据】无候选。</p>")
                .await
                .unwrap(),
            "<p>【演示数据】无候选。</p>"
        );
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
#[ignore = "读取指定本机真实样本，回放 SQLite 检查点和 CMS 字段编码；不请求网络"]
async fn organization_local_checkpoint_and_payload_replay() {
    let root = std::env::var("PRESSDOCK_BODY_DATASET").expect("缺少本机样本目录");
    let fixtures: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(format!("{root}/fixtures.json")).unwrap())
            .unwrap();
    let originals: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(format!("{root}/cleaned-rust.json")).unwrap(),
    )
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("local-replay.db"))
        .await
        .unwrap();
    configured(&db, "https://example.com").await;
    let mut settings = db.harvest_settings().await.unwrap();
    settings.options.auto_classify = false;
    settings.options.auto_tags = false;
    settings.options.auto_summary = false;
    settings.options.developer_mode = true;
    settings.options.ai_organize_body = true;
    db.harvest_save_settings(&settings).await.unwrap();
    let mut count = 0;
    for f in fixtures
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["demo"] != true)
    {
        let result_dir = if f["split"] == "holdout" {
            "v6-holdout"
        } else {
            "v6"
        };
        let result: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(format!("{root}/{result_dir}/{}-0.json", f["id"])).unwrap(),
        )
        .unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let url = format!("https://baijiahao.baidu.com/s?id={}", f["id"]);
        db.harvest_enqueue(
            1,
            &EnqueueRequest {
                id: id.clone(),
                url: url.clone(),
            },
        )
        .await
        .unwrap();
        db.harvest_claim(1).await.unwrap().unwrap();
        let raw = RawArticle {
            title: f["title"].as_str().unwrap().into(),
            writer: String::new(),
            source_url: url.clone(),
            news_html: originals
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["id"] == f["id"])
                .unwrap()["source"]["html"]
                .as_str()
                .unwrap()
                .into(),
        };
        db.harvest_save_raw(&id, &raw, &url).await.unwrap();
        let mut article = FormattedArticle {
            title: raw.title.clone(),
            writer: String::new(),
            source_url: url,
            news_text: f["html"].as_str().unwrap().into(),
            title_pic: String::new(),
            small_text: String::new(),
            class_id: 1,
            tags: vec![],
        };
        db.harvest_save_result(&id, &article, false).await.unwrap();
        if let Some(output) = result["output"].as_str() {
            article.news_text = organization::prepare(&article.news_text)
                .unwrap()
                .apply(&crate::ai::organization::parse(output).unwrap())
                .unwrap();
        }
        assert_eq!(article.news_text, result["rendered"].as_str().unwrap());
        db.harvest_save_organized(
            &id,
            &OrganizationCheckpoint {
                input_html: f["html"].as_str().unwrap().into(),
                contract_version: 2,
                article: article.clone(),
                warning: None,
            },
        )
        .await
        .unwrap();
        db.harvest_save_result(&id, &article, true).await.unwrap();
        db.harvest_finish(&id, Status::DebugCompleted, None, None)
            .await
            .unwrap();
        let stored = db.harvest_job(&id, 1).await.unwrap();
        assert_eq!(stored.raw.unwrap().news_html, raw.news_html);
        assert_eq!(
            stored.formatted.unwrap().news_text,
            f["html"].as_str().unwrap()
        );
        assert_eq!(
            stored.prepared.unwrap().payload()["newsText"],
            article.news_text
        );
        count += 1;
    }
    assert_eq!(count, 20);
    println!(
        "真实样本本机回放通过：{count} 篇，原文及格式化输入不变，prepared.newsText 与 CMS 字段编码一致；零网络请求。"
    );
}
