use super::*;
use crate::{ai::*, database::Database};
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

#[tokio::test]
async fn mobile_interrupt_checkpoints_restart_and_submission_unknown_remain_account_isolated() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("demo-mobile-import.db");
    let db = Database::open(&path).await.unwrap();
    let raw = RawArticle {
        title: "【演示数据】手机前台导入".into(),
        writer: "演示作者".into(),
        source_url: "https://baijiahao.baidu.com/s?id=9001".into(),
        news_html: "<p>【演示数据】不可变原文</p>".into(),
    };
    let article = FormattedArticle {
        title: raw.title.clone(),
        writer: raw.writer.clone(),
        source_url: raw.source_url.clone(),
        news_text: "<p>【演示数据】处理检查点</p>".into(),
        title_pic: String::new(),
        small_text: String::new(),
        class_id: 1,
        tags: vec!["演示".into()],
    };
    let interrupted = uuid::Uuid::new_v4().to_string();
    db.harvest_enqueue(
        1,
        &EnqueueRequest {
            id: interrupted.clone(),
            url: raw.source_url.clone(),
        },
    )
    .await
    .unwrap();
    assert!(db.harvest_claim(2).await.unwrap().is_none());
    assert_eq!(
        db.harvest_claim(1).await.unwrap().unwrap().job.id,
        interrupted
    );
    db.harvest_save_raw(&interrupted, &raw, &raw.source_url)
        .await
        .unwrap();
    db.harvest_save_result(&interrupted, &article, false)
        .await
        .unwrap();
    db.harvest_progress(&interrupted, Status::Running, Stage::Metadata)
        .await
        .unwrap();
    db.harvest_finish(&interrupted, Status::Interrupted, Some("演示退后台"), None)
        .await
        .unwrap();

    let unknown = uuid::Uuid::new_v4().to_string();
    db.harvest_enqueue(
        1,
        &EnqueueRequest {
            id: unknown.clone(),
            url: "https://baijiahao.baidu.com/s?id=9002".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(db.harvest_claim(1).await.unwrap().unwrap().job.id, unknown);
    db.harvest_save_raw(&unknown, &raw, &raw.source_url)
        .await
        .unwrap();
    db.harvest_save_result(&unknown, &article, true)
        .await
        .unwrap();
    db.harvest_submitting(&unknown).await.unwrap();

    let cancelled = uuid::Uuid::new_v4().to_string();
    db.harvest_enqueue(
        1,
        &EnqueueRequest {
            id: cancelled.clone(),
            url: "https://baijiahao.baidu.com/s?id=9003".into(),
        },
    )
    .await
    .unwrap();
    db.harvest_cancel(&cancelled, 1).await.unwrap();
    let other = uuid::Uuid::new_v4().to_string();
    db.harvest_enqueue(
        2,
        &EnqueueRequest {
            id: other.clone(),
            url: raw.source_url.clone(),
        },
    )
    .await
    .unwrap();
    db.pool.close().await;

    let reopened = Database::open(&path).await.unwrap();
    reopened.harvest_recover().await.unwrap();
    assert!(reopened.harvest_claim(1).await.unwrap().is_none());
    assert!(reopened.harvest_job(&interrupted, 2).await.is_err());
    assert!(
        reopened
            .harvest_action(&unknown, 2, &Action::ConfirmNotSubmitted)
            .await
            .is_err()
    );
    let saved = reopened.harvest_job(&interrupted, 1).await.unwrap();
    assert!(saved.job.status == Status::Interrupted);
    assert_eq!(saved.raw.unwrap().news_html, raw.news_html);
    assert_eq!(saved.formatted.unwrap().news_text, article.news_text);
    let saved = reopened.harvest_job(&unknown, 1).await.unwrap();
    assert!(saved.job.status == Status::SubmissionUnknown);
    assert_eq!(saved.prepared.unwrap().news_text, article.news_text);
    assert!(
        reopened
            .harvest_action(&unknown, 1, &Action::Retry)
            .await
            .is_err()
    );
    assert!(reopened.harvest_delete(&unknown, 1).await.is_err());
    assert!(
        reopened
            .harvest_job(&cancelled, 1)
            .await
            .unwrap()
            .job
            .status
            == Status::Cancelled
    );
    assert_eq!(
        reopened.harvest_claim(2).await.unwrap().unwrap().job.id,
        other
    );
    reopened
        .harvest_action(&unknown, 1, &Action::ConfirmNotSubmitted)
        .await
        .unwrap();
    assert!(reopened.harvest_claim(1).await.unwrap().is_none());
    reopened
        .harvest_action(&interrupted, 1, &Action::Retry)
        .await
        .unwrap();
    assert_eq!(
        reopened.harvest_claim(1).await.unwrap().unwrap().job.id,
        interrupted
    );
    let mut replacement = raw.clone();
    replacement.news_html = "<p>演示：不应覆盖原文</p>".into();
    reopened
        .harvest_save_raw(&interrupted, &replacement, &raw.source_url)
        .await
        .unwrap();
    assert_eq!(
        reopened
            .harvest_job(&interrupted, 1)
            .await
            .unwrap()
            .raw
            .unwrap()
            .news_html,
        raw.news_html
    );
    reopened.pool.close().await;
}

#[tokio::test]
async fn harvest_upgrade_disables_paid_pagination_and_preserves_legacy_checkpoints() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let migrations = sqlx::migrate!("./migrations");
    for m in migrations.iter().filter(|m| m.version < 7) {
        sqlx::raw_sql(m.sql.clone()).execute(&pool).await.unwrap();
    }
    let legacy=json!({"developerMode":true,"autoClassify":true,"autoTags":false,"autoSummary":true,"autoOrganize":true,"autoPaginate":true,"modelConfigId":null}).to_string();
    sqlx::query("UPDATE harvest_settings SET options=? WHERE id=1")
        .bind(&legacy)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO source_articles(id,title,url,content,imported_at,is_demo) VALUES('harvest-source-legacy','【演示数据】旧任务','https://baijiahao.baidu.com/s?id=1','<p>【演示数据】不可变原文</p>','2026-10-31',1)").execute(&pool).await.unwrap();
    let prepared = FormattedArticle {
        title: "【演示数据】旧任务".into(),
        writer: String::new(),
        source_url: "https://baijiahao.baidu.com/s?id=1".into(),
        news_text: "<p>【演示数据】旧处理结果</p>".into(),
        title_pic: String::new(),
        small_text: String::new(),
        class_id: 1,
        tags: vec![],
    };
    sqlx::query("INSERT INTO harvest_jobs(id,user_id,url,normalized_url,collection_date,timezone,status,stage,options,source_id,prepared,created_at,updated_at) VALUES('legacy',1,'https://baijiahao.baidu.com/s?id=1','https://baijiahao.baidu.com/s?id=1','2026-10-31','+08:00','failed','organizing',?,'harvest-source-legacy',?,'2026-10-31','2026-10-31')")
        .bind(&legacy).bind(serde_json::to_string(&prepared).unwrap()).execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../migrations/0007_harvest_ai_pagination.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let db = Database { pool };
    let settings = db.harvest_settings().await.unwrap();
    assert!(!settings.options.ai_auto_paginate);
    assert!(
        settings.options.auto_classify
            && !settings.options.auto_tags
            && settings.options.auto_summary
            && settings.options.developer_mode
    );
    let saved = db.harvest_job("legacy", 1).await.unwrap();
    assert!(!saved.options.processing.ai_auto_paginate);
    assert!(saved.options.pagination_snapshot.is_none());
    assert!(saved.job.stage == Some(Stage::Organizing));
    assert_eq!(
        saved.raw.unwrap().news_html,
        "<p>【演示数据】不可变原文</p>"
    );
    assert_eq!(saved.prepared.unwrap().news_text, prepared.news_text);
    db.harvest_action("legacy", 1, &Action::Retry)
        .await
        .unwrap();
    assert!(
        db.harvest_job("legacy", 1)
            .await
            .unwrap()
            .prepared
            .is_some()
    );
    let options: String = sqlx::query_scalar("SELECT options FROM harvest_jobs WHERE id='legacy'")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert!(!options.contains("autoOrganize") && !options.contains("autoPaginate"));
}

#[tokio::test]
async fn harvest_pagination_snapshot_survives_restart_and_uses_its_bound_model() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("harvest.db");
    let db = Database::open(&db_path).await.unwrap();
    let ai = AiService::new().unwrap();
    let server = MockServer::start().await;
    // 临时数据库的本地测试提供商不设密钥，因此绝不访问系统凭据库。
    ai.save_provider(
        &db,
        SaveProviderRequest {
            id: "demo-provider".into(),
            display_name: "【演示数据】本地模型".into(),
            base_url: server.uri(),
            protocol: Protocol::Responses,
            api_key: None,
            compatibility: Compatibility::default(),
            create_only: false,
        },
    )
    .await
    .unwrap();
    db.ai_save_model(&AiModelConfig {
        id: "demo-model".into(),
        provider_id: "demo-provider".into(),
        model_id: "demo-model".into(),
        display_name: "【演示数据】分页模型".into(),
        context_window: None,
        max_output_tokens: None,
        reasoning_effort: None,
    })
    .await
    .unwrap();
    let mut template = db
        .ai_settings()
        .await
        .unwrap()
        .templates
        .into_iter()
        .find(|t| t.purpose == TemplatePurpose::Pagination)
        .unwrap();
    template.model_config_id = Some("demo-model".into());
    template.system_prompt = "SNAPSHOT 【演示数据】只返回 JSON 语义编号。".into();
    db.ai_save_template(&template).await.unwrap();
    let mut settings = db.harvest_settings().await.unwrap();
    settings.options.auto_classify = false;
    settings.options.auto_tags = false;
    settings.options.auto_summary = false;
    settings.options.ai_auto_paginate = true;
    settings.options.model_config_id = None;
    db.harvest_save_settings(&settings).await.unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    db.harvest_enqueue(
        1,
        &EnqueueRequest {
            id: id.clone(),
            url: "https://baijiahao.baidu.com/s?id=101".into(),
        },
    )
    .await
    .unwrap();
    assert!(
        db.harvest_model_in_use("model", "demo-model")
            .await
            .unwrap()
    );
    assert!(
        db.harvest_model_in_use("provider", "demo-provider")
            .await
            .unwrap()
    );
    template.system_prompt = "LATER 【演示数据】不影响已入队任务。".into();
    template.pagination_options.as_mut().unwrap().target_chars = 300;
    db.ai_save_template(&template).await.unwrap();
    db.pool.close().await;
    let db = Database::open(&db_path).await.unwrap();
    assert!(
        db.harvest_settings()
            .await
            .unwrap()
            .options
            .ai_auto_paginate
    );
    let job = db.harvest_job(&id, 1).await.unwrap();
    let snapshot = job.options.pagination_snapshot.as_ref().unwrap();
    assert_eq!(snapshot.pagination_options.target_chars, 240);
    assert!(snapshot.system_prompt.starts_with("SNAPSHOT"));
    assert!(job.options.processing.model_config_id.is_none());
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../src/test/fixtures/pagination-shared.json"
    ))
    .unwrap();
    let f = &fixture[0];
    let html = f["html"].as_str().unwrap();
    Mock::given(method("POST")).and(path("/responses"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"bind_after\":[],\"prefer_after\":[]}"}]}]}))).expect(1).mount(&server).await;
    let output = pagination::paginate(&ai, &db, Some(snapshot), "【演示数据】导入分页", html)
        .await
        .unwrap();
    assert_eq!(
        output.matches("[!--empirenews.page--]").count(),
        f["breakAfter"].as_array().unwrap().len()
    );
    let request = &server.received_requests().await.unwrap()[0];
    let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
    assert!(body.to_string().contains("SNAPSHOT"));
    assert!(!body.to_string().contains("LATER"));
    assert_eq!(body["model"], "demo-model");
    assert_eq!(body["max_output_tokens"], 4096);
    server.reset().await;
    let images =
        "<p><img src=\"demo.png\"></p><p>[!--empirenews.page--]</p><p><img src=\"second.png\"></p>";
    assert!(
        !pagination::paginate(&ai, &db, None, "【演示数据】纯图片", images)
            .await
            .unwrap()
            .contains("[!--empirenews.page--]")
    );
    assert!(
        pagination::paginate(&ai, &db, None, "【演示数据】配置缺失", html)
            .await
            .is_err()
    );
    assert!(server.received_requests().await.unwrap().is_empty());
    Mock::given(method("POST")).respond_with(ResponseTemplate::new(200).set_body_json(json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"bind_after\":[\"B999\"],\"prefer_after\":[]}"}]}]}))).expect(1).mount(&server).await;
    assert!(
        pagination::paginate(&ai, &db, Some(snapshot), "【演示数据】无效响应", html)
            .await
            .is_err()
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1); // 不自动重试。
    settings.options.ai_auto_paginate = false;
    db.harvest_save_settings(&settings).await.unwrap();
    let off = uuid::Uuid::new_v4().to_string();
    db.harvest_enqueue(
        1,
        &EnqueueRequest {
            id: off.clone(),
            url: "https://baijiahao.baidu.com/s?id=102".into(),
        },
    )
    .await
    .unwrap();
    let job = db.harvest_job(&off, 1).await.unwrap();
    assert!(!job.options.processing.ai_auto_paginate && job.options.pagination_snapshot.is_none());
}
