use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path, query_param},
};

fn raw(id: i64) -> Value {
    json!({"Id":id,"Title":format!("【演示数据】文章 {id}"),"ClassId":1,"ClassName":null,
        "TitlePic":null,"TitlePic2":"","TitlePic3":null,"Writer":null,"SmallText":"演示摘要",
        "SourceUrl":null,"NewsTime":1730000000,"Pages":2,"Tags":"[\"演示\"]","NTags":null})
}
fn row(id: i64) -> CmsArticleRow {
    let value = raw(id);
    let mut row: CmsArticleRow = serde_json::from_value(value.clone()).unwrap();
    row.snapshot = value.as_object().unwrap().clone();
    row
}
fn detail(id: i64, status: i32) -> CmsArticleDetail {
    let mut value = raw(id);
    value["NewsText"] = json!(
        "<p style=\"color:red\">【演示】 &amp; <img src=\"//demo.invalid/a.jpg\" /></p>\r\n[!--empirenews.page--]"
    );
    value["Status"] = json!(status);
    value["UpdatedAt"] = Value::Null;
    serde_json::from_value(value).unwrap()
}
fn single(article: CmsArticleDetail, view: ReviewView) -> ArticleReviewInput {
    ArticleReviewInput {
        view,
        decision: ReviewDecision::Accept,
        comment: "不应提交的原因".into(),
        article,
    }
}
fn batch(ids: &[i64], view: ReviewView) -> ArticlesReviewInput {
    ArticlesReviewInput {
        view,
        decision: ReviewDecision::Accept,
        comment: String::new(),
        articles: ids.iter().map(|id| row(*id)).collect(),
    }
}
async fn detail_route(server: &MockServer, article: &CmsArticleDetail) {
    Mock::given(method("GET"))
        .and(path(format!("/api/Article/{}", article.row.id)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"data":article,"msg":"succ"})),
        )
        .mount(server)
        .await;
}
async fn list_route(server: &MockServer, id: i64, status: i32, value: Value) {
    Mock::given(method("GET")).and(path("/api/Article")).and(query_param("id",id.to_string()))
        .and(query_param("status",status.to_string())).and(query_param("current","1"))
        .and(query_param("pagesize","10")).and(query_param("quality","0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":[value],"total":1,"current":1,"pageSize":10,"recommand":[],"promote":[],"msg":"succ"})))
        .mount(server).await;
}
async fn write_route(server: &MockServer, id: i64, response: ResponseTemplate) {
    Mock::given(method("PUT"))
        .and(path(format!("/api/Article/{id}")))
        .respond_with(response)
        .expect(1)
        .mount(server)
        .await;
}
fn success() -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({"msg":"succ"}))
}
async fn writes(server: &MockServer) -> Vec<wiremock::Request> {
    server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.method == "PUT")
        .collect()
}

#[tokio::test]
async fn single_review_preserves_original_html_and_nulls_omits_tags_status_and_forces_accept_comment()
 {
    let (service, server) = crate::cms::ipc_service().await;
    let article = detail(1, 0);
    detail_route(&server, &article).await;
    write_route(&server, 1, success()).await;
    let expected = single_body(&article);
    let summary = service
        .review_article(single(article, ReviewView::First))
        .await
        .unwrap();
    assert!(matches!(summary.items[0].status, ReviewStatus::Succeeded));
    let requests = writes(&server).await;
    let body: Value = requests[0].body_json().unwrap();
    let mut expected = expected;
    expected["action"] = json!("accept");
    expected["comment"] = json!("");
    assert_eq!(body, expected);
    assert_eq!(
        requests[0].headers.get("authorization").unwrap(),
        "Bearer test-token"
    );
    assert!(body["writer"].is_null());
    assert!(body.get("tags").is_none() && body.get("status").is_none());
}

#[tokio::test]
async fn review_accept_and_reject_support_all_three_levels() {
    for (view, status) in [
        (ReviewView::First, 0),
        (ReviewView::Second, 1),
        (ReviewView::Third, 2),
    ] {
        let (service, server) = crate::cms::ipc_service().await;
        let article = detail(1, status);
        detail_route(&server, &article).await;
        write_route(&server, 1, success()).await;
        let mut request = single(article, view);
        request.decision = ReviewDecision::Reject;
        request.comment = match status {
            0 => "",
            1 => " \n ",
            _ => "旧客户端的原因",
        }
        .into();
        let summary = service.review_article(request).await.unwrap();
        assert!(matches!(summary.items[0].status, ReviewStatus::Succeeded));
        let body: Value = writes(&server).await[0].body_json().unwrap();
        assert_eq!(body["action"], "reject");
        assert_eq!(body["comment"], "");
    }
}

#[tokio::test]
async fn single_changes_to_preview_status_html_metadata_or_timestamp_never_write() {
    for field in ["Status", "NewsText", "Title", "UpdatedAt", "Tags"] {
        let (service, server) = crate::cms::ipc_service().await;
        let article = detail(1, 0);
        let mut changed = serde_json::to_value(&article).unwrap();
        let camel = match field {
            "Status" => "status",
            "NewsText" => "newsText",
            "Title" => "title",
            "UpdatedAt" => "updatedAt",
            _ => "tags",
        };
        changed[camel] = match field {
            "Status" => json!(1),
            "Tags" => json!(["新标签"]),
            _ => json!("已变化"),
        };
        Mock::given(method("GET"))
            .and(path("/api/Article/1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"msg":"succ","data":changed})),
            )
            .mount(&server)
            .await;
        let summary = service
            .review_article(single(article, ReviewView::First))
            .await
            .unwrap();
        assert_eq!(
            summary.items[0].code.as_deref(),
            Some("REVIEW_STALE"),
            "{field}"
        );
        assert!(writes(&server).await.is_empty());
    }
}

#[tokio::test]
async fn batch_pascal_body_serializes_tags_once_and_never_includes_body_or_status() {
    for (view, status) in [
        (ReviewView::First, 0),
        (ReviewView::Second, 1),
        (ReviewView::Third, 2),
    ] {
        let (service, server) = crate::cms::ipc_service().await;
        let mut raw = raw(1);
        raw["NewsText"] = json!("不能提交正文");
        raw["Status"] = json!(status);
        raw["Unknown"] = json!("不能透传");
        list_route(&server, 1, status, raw.clone()).await;
        let mut request = batch(&[1], view);
        request.articles[0].snapshot = raw.as_object().unwrap().clone();
        request.decision = ReviewDecision::Reject;
        request.comment = if status == 0 {
            ""
        } else {
            "旧客户端的原因"
        }
        .into();
        write_route(&server, 1, success()).await;
        let summary = service.review_articles(request).await.unwrap();
        assert!(matches!(summary.items[0].status, ReviewStatus::Succeeded));
        for field in ["NewsText", "Status", "Unknown"] {
            raw.as_object_mut().unwrap().remove(field);
        }
        raw["Tags"] = json!("[\"演示\"]");
        raw["NTags"] = json!("[]");
        raw["commentRecommand"] = json!("");
        raw["commentPromote"] = json!([]);
        raw["action"] = json!("reject");
        raw["comment"] = json!("");
        let body: Value = writes(&server).await[0].body_json().unwrap();
        assert_eq!(body, raw);
    }
}

#[tokio::test]
async fn batch_skips_changed_or_missing_record_and_continues_ordinary_rejection() {
    let (service, server) = crate::cms::ipc_service().await;
    let mut changed = raw(1);
    changed["Title"] = json!("变化");
    list_route(&server, 1, 0, changed).await;
    Mock::given(method("GET")).and(path("/api/Article")).and(query_param("id","2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"msg":"succ","data":[],"total":0,"current":1,"pageSize":10,"recommand":[],"promote":[]}))).mount(&server).await;
    for id in [3, 4] {
        list_route(&server, id, 0, raw(id)).await;
    }
    write_route(
        &server,
        3,
        ResponseTemplate::new(400).set_body_json(json!({"msg":"敏感原始诊断"})),
    )
    .await;
    write_route(&server, 4, success()).await;
    let summary = service
        .review_articles(batch(&[1, 2, 3, 4], ReviewView::First))
        .await
        .unwrap();
    assert_eq!(summary.items[0].code.as_deref(), Some("REVIEW_STALE"));
    assert_eq!(summary.items[1].code.as_deref(), Some("REVIEW_STALE"));
    assert!(matches!(summary.items[2].status, ReviewStatus::Failed));
    assert!(!summary.items[2].message.contains("敏感"));
    assert!(matches!(summary.items[3].status, ReviewStatus::Succeeded));
    assert_eq!(writes(&server).await.len(), 2);
}

#[tokio::test]
async fn batch_waits_for_each_response_and_keeps_partial_results() {
    let (service, server) = crate::cms::ipc_service().await;
    let service = Arc::new(service);
    for id in [1, 2] {
        list_route(&server, id, 0, raw(id)).await;
    }
    write_route(&server, 1, success().set_delay(Duration::from_millis(350))).await;
    write_route(&server, 2, success()).await;
    let task = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .review_articles(batch(&[1, 2], ReviewView::First))
                .await
                .unwrap()
        }
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while writes(&server).await.is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert!(!task.is_finished());
    assert_eq!(writes(&server).await.len(), 1);
    assert!(
        server.received_requests().await.unwrap().iter().all(|r| !r
            .url
            .query()
            .unwrap_or_default()
            .contains("id=2"))
    );
    assert_eq!(
        service
            .review_articles(batch(&[1], ReviewView::First))
            .await
            .err()
            .unwrap()
            .code,
        "REVIEW_BUSY"
    );
    let result = task.await.unwrap();
    assert!(
        result
            .items
            .iter()
            .all(|item| matches!(item.status, ReviewStatus::Succeeded))
    );
}

#[tokio::test]
async fn authentication_permissions_and_uncertain_responses_stop_remaining_requests() {
    for (response, code, status) in [
        (ResponseTemplate::new(401), "AUTH_EXPIRED", "failed"),
        (
            ResponseTemplate::new(200).set_body_json(json!({"code":"A0230"})),
            "AUTH_EXPIRED",
            "failed",
        ),
        (ResponseTemplate::new(403), "CMS_FORBIDDEN", "failed"),
        (
            ResponseTemplate::new(503),
            "CMS_WRITE_UNCONFIRMED",
            "unconfirmed",
        ),
        (
            ResponseTemplate::new(204),
            "CMS_WRITE_UNCONFIRMED",
            "unconfirmed",
        ),
        (
            ResponseTemplate::new(200).set_body_json(json!({"msg":"ok"})),
            "CMS_WRITE_UNCONFIRMED",
            "unconfirmed",
        ),
    ] {
        let (service, server) = crate::cms::ipc_service().await;
        for id in [1, 2, 3] {
            list_route(&server, id, 0, raw(id)).await;
        }
        write_route(&server, 1, success()).await;
        write_route(&server, 2, response).await;
        let summary = service
            .review_articles(batch(&[1, 2, 3], ReviewView::First))
            .await
            .unwrap();
        assert!(matches!(summary.items[0].status, ReviewStatus::Succeeded));
        assert_eq!(summary.items[1].code.as_deref(), Some(code));
        assert_eq!(
            serde_json::to_value(summary.items[1].status).unwrap(),
            status
        );
        assert!(matches!(
            summary.items[2].status,
            ReviewStatus::NotAttempted
        ));
        assert_eq!(summary.auth_expired, code == "AUTH_EXPIRED");
        assert_eq!(writes(&server).await.len(), 2);
    }
}

#[tokio::test]
async fn timeout_is_unconfirmed_stops_batch_and_never_automatically_retries() {
    let (mut service, server) = crate::cms::ipc_service().await;
    service.test_timeout(Duration::from_millis(80));
    for id in [1, 2] {
        list_route(&server, id, 0, raw(id)).await;
    }
    write_route(&server, 1, success().set_delay(Duration::from_millis(300))).await;
    let summary = service
        .review_articles(batch(&[1, 2], ReviewView::First))
        .await
        .unwrap();
    assert!(matches!(summary.items[0].status, ReviewStatus::Unconfirmed));
    assert!(matches!(
        summary.items[1].status,
        ReviewStatus::NotAttempted
    ));
    assert_eq!(writes(&server).await.len(), 1);
}

#[tokio::test]
async fn session_change_after_send_is_unconfirmed_and_no_next_account_write_occurs() {
    let (service, server) = crate::cms::ipc_service().await;
    let service = Arc::new(service);
    for id in [1, 2] {
        list_route(&server, id, 0, raw(id)).await;
    }
    write_route(&server, 1, success().set_delay(Duration::from_millis(200))).await;
    let task = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .review_articles(batch(&[1, 2], ReviewView::First))
                .await
                .unwrap()
        }
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while writes(&server).await.is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    service.clear_memory().await;
    let summary = task.await.unwrap();
    assert!(matches!(summary.items[0].status, ReviewStatus::Unconfirmed));
    assert!(matches!(
        summary.items[1].status,
        ReviewStatus::NotAttempted
    ));
    assert_eq!(writes(&server).await.len(), 1);
}

#[tokio::test]
async fn invalid_inputs_and_editor_role_are_rejected_before_network() {
    let (service, server) = crate::cms::ipc_service().await;
    for ids in [vec![], vec![1, 1], vec![0], (1..=501).collect()] {
        assert_eq!(
            service
                .review_articles(batch(&ids, ReviewView::First))
                .await
                .err()
                .unwrap()
                .code,
            "VALIDATION"
        );
    }
    let mut request = single(detail(0, 0), ReviewView::First);
    request.decision = ReviewDecision::Reject;
    request.comment = " \n ".into();
    assert_eq!(
        service.review_article(request).await.err().unwrap().code,
        "VALIDATION"
    );
    service
        .state
        .lock()
        .await
        .session
        .as_mut()
        .unwrap()
        .user
        .roles
        .push("editor".into());
    assert_eq!(
        service
            .review_articles(batch(&[1], ReviewView::First))
            .await
            .err()
            .unwrap()
            .code,
        "CMS_FORBIDDEN"
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 2); // 仅登录和账号读取。
    assert!(
        serde_json::from_value::<ArticlesReviewInput>(
            json!({"view":"quality","decision":"accept","comment":"","articles":[]})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ArticlesReviewInput>(
            json!({"view":"review-1","decision":"publish","comment":"","articles":[]})
        )
        .is_err()
    );
}
