use super::{credentials::CredentialVault, *};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path, query_param},
};

#[derive(Default)]
struct TestVault {
    secret: Mutex<Option<String>>,
    fail_save: bool,
}
impl CredentialVault for TestVault {
    fn load(&self) -> Result<Option<String>, ()> {
        Ok(self.secret.lock().unwrap().clone())
    }
    fn save(&self, value: &str) -> Result<(), ()> {
        if self.fail_save {
            return Err(());
        }
        *self.secret.lock().unwrap() = Some(value.into());
        Ok(())
    }
    fn clear(&self) -> Result<(), ()> {
        *self.secret.lock().unwrap() = None;
        Ok(())
    }
}

fn credentials() -> LoginRequest {
    LoginRequest {
        username: "editor".into(),
        password: " test ".into(),
    }
}
fn query() -> PromoteQuery {
    PromoteQuery {
        channel: "2345".into(),
        subchannel: "右侧轮播小图_头条_280x124".into(),
        publishdate: "2026-10-23".into(),
        current: 1,
        pagesize: 10,
    }
}
async fn login_routes(server: &MockServer) {
    Mock::given(method("POST"))
        .and(path("/api/Auth/Login"))
        .and(body_json(
            json!({"username":"editor","password":" test ","name":"editor"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"code":"200","data":{"accessToken":"test-token","tokenType":"Bearer"}}),
        ))
        .mount(server)
        .await;
    Mock::given(method("GET")).and(path("/api/Account/CurrentUser")).and(header("Authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"code":"200","data":{"userId":6,"nickname":"editor","role":["admin"],"perms":["admin"]}})))
        .mount(server).await;
}

fn write_input() -> PromoteInput {
    PromoteInput {
        channel: "2345".into(),
        sub_channel: Some("头条".into()),
        publish_date: Some("2026-10-21".into()),
        url: Some("".into()),
        title: "测试标题".into(),
        title_pic: "https://images.example/main.png".into(),
        title_pic2: None,
        small_text: None,
        writer: Some("".into()),
    }
}
fn write_record() -> Value {
    json!({"Id":1,"ArticleId":101,"Channel":"2345","SubChannel":"头条","PublishDate":"2026-10-21","Url":"","Title":"测试标题","TitlePic":"https://images.example/main.png","TitlePic2":null,"SmallText":null,"Writer":"","Host":null,"LandUrl":"https://example.com/land","Order":7,"CreatedAt":"2026-10-20T01:02:03","UpdatedAt":null,"DeletedAt":null})
}

#[tokio::test]
async fn writes_use_exact_methods_pascal_fields_and_preserve_complete_record() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let mut original = write_record();
    original["CustomMeta"] = json!({"unchanged":true,"value":null});
    Mock::given(method("GET"))
        .and(path("/api/PromoteData/1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":original,"msg":""})))
        .mount(&server)
        .await;
    Mock::given(method("POST")).and(path("/api/PromoteData")).and(header("Authorization","Bearer test-token")).and(body_json(json!({"Id":0,"Channel":"2345","SubChannel":"头条","PublishDate":"2026-10-21","Url":"","Title":"测试标题","TitlePic":"https://images.example/main.png","TitlePic2":null,"SmallText":null,"Writer":""}))).respond_with(ResponseTemplate::new(201).set_body_json(json!({"msg":"ok"}))).expect(1).mount(&server).await;
    let mut expected = original.clone();
    expected["Title"] = json!("修改标题");
    Mock::given(method("PUT"))
        .and(path("/api/PromoteData/1"))
        .and(header("Authorization", "Bearer test-token"))
        .and(body_json(expected))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/PromoteData/1"))
        .and(header("Authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"code":"200"})))
        .expect(1)
        .mount(&server)
        .await;
    let service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    service.login(credentials()).await.unwrap();
    assert!(service.create_data(write_input()).await.unwrap().succeeded);
    let mut record = service.get_data(1).await.unwrap();
    record.title = Some("修改标题".into());
    // 同一个模型同时接受远程 PascalCase 和 IPC camelCase。
    let record = serde_json::from_value(serde_json::to_value(record).unwrap()).unwrap();
    assert!(service.update_data(record).await.unwrap().succeeded);
    assert!(service.delete_data(1).await.unwrap().succeeded);
}

#[tokio::test]
async fn sorting_rechecks_only_current_page_and_numbers_every_page_from_one() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/PromoteData"))
        .and(query_param("current", "2"))
        .and(query_param("pagesize", "10"))
        .and(query_param("channel", "2345"))
        .and(query_param("subchannel", "右侧轮播小图_头条_280x124"))
        .and(query_param("publishdate", "2026-10-23"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"data":[{"Id":1},{"Id":2}],"total":200,"current":2,"pageSize":10}),
        ))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/api/PromoteData"))
        .and(body_json(
            json!({"promoteDataPutOrders":[{"id":2,"order":1},{"id":1,"order":2}]}),
        ))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    service.login(credentials()).await.unwrap();
    let mut q = query();
    q.current = 2;
    assert!(
        service
            .save_order(q.clone(), vec![2, 1])
            .await
            .unwrap()
            .succeeded
    );
    assert_eq!(
        service
            .save_order(q.clone(), vec![1, 3])
            .await
            .err()
            .unwrap()
            .code,
        "CMS_PAGE_CHANGED"
    );
    assert_eq!(
        service
            .save_order(q.clone(), vec![1, 1])
            .await
            .err()
            .unwrap()
            .code,
        "VALIDATION"
    );
    for field in 0..3 {
        let mut invalid = q.clone();
        match field {
            0 => invalid.channel.clear(),
            1 => invalid.subchannel.clear(),
            _ => invalid.publishdate.clear(),
        };
        assert_eq!(
            service
                .save_order(invalid, vec![1, 2])
                .await
                .err()
                .unwrap()
                .code,
            "VALIDATION"
        );
    }
    Mock::given(method("GET"))
        .and(path("/api/PromoteData"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(
                json!({"data":[{"Id":1},{"Id":1}],"total":2,"current":2,"pageSize":10}),
            ),
        )
        .with_priority(1)
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        service.save_order(q, vec![1, 2]).await.err().unwrap().code,
        "CMS_PAGE_CHANGED"
    );
}

#[tokio::test]
async fn multipart_upload_validates_size_and_mime_and_uses_cloudurl() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let server = MockServer::start().await;
    login_routes(&server).await;
    let url = format!("{}/uploaded.png", server.uri());
    Mock::given(method("POST"))
        .and(path("/api/FileData"))
        .and(header("Authorization", "Bearer test-token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"data":[{"cloudurl":url}],"msg":""})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/uploaded.png"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Content-Type", "image/png")
                .set_body_bytes(b"png".to_vec()),
        )
        .mount(&server)
        .await;
    let mut service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    service.allow_test_images();
    service.login(credentials()).await.unwrap();
    let png = include_bytes!("../../icons/32x32.png");
    assert_eq!(
        service
            .upload_image(UploadImage {
                file_name: "C:\\fakepath\\test.png".into(),
                mime_type: "image/png".into(),
                data_base64: STANDARD.encode(png)
            })
            .await
            .unwrap()
            .url,
        url
    );
    let requests = server.received_requests().await.unwrap();
    let upload = requests
        .iter()
        .find(|r| r.url.path() == "/api/FileData")
        .unwrap();
    let text = String::from_utf8_lossy(&upload.body);
    assert!(text.contains("name=\"file\"; filename=\"test.png\""));
    assert!(text.contains("Content-Type: image/png"));
    assert!(!upload.headers.contains_key("cookie"));
    assert!(service.load_image(url).await.is_ok());
    for (mime, data) in [
        ("text/html", "YWJj".into()),
        ("image/png", "!".into()),
        ("image/png", String::new()),
        (
            "image/png",
            "a".repeat(4 * (20 * 1024 * 1024usize).div_ceil(3) + 1),
        ),
    ] {
        assert_eq!(
            service
                .upload_image(UploadImage {
                    file_name: "x.png".into(),
                    mime_type: mime.into(),
                    data_base64: data
                })
                .await
                .err()
                .unwrap()
                .code,
            "VALIDATION"
        );
    }
}

#[tokio::test]
async fn write_forbidden_business_errors_and_expiry_do_not_report_success() {
    for (status, body, code, logged_in) in [
        (403, json!({}), "CMS_FORBIDDEN", true),
        (400, json!({"detail":"字段错误"}), "CMS_REMOTE", true),
        (
            200,
            json!({"code":"500","msg":"修改失败"}),
            "CMS_REMOTE",
            true,
        ),
        (200, json!({"code":"A0230"}), "AUTH_EXPIRED", false),
    ] {
        let server = MockServer::start().await;
        login_routes(&server).await;
        Mock::given(method("POST"))
            .and(path("/api/PromoteData"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .expect(1)
            .mount(&server)
            .await;
        let vault = Arc::new(TestVault::default());
        let service = CmsService::with_vault(server.uri(), vault.clone()).unwrap();
        service.login(credentials()).await.unwrap();
        assert_eq!(
            service.create_data(write_input()).await.err().unwrap().code,
            code
        );
        assert_eq!(service.authorize().await.is_ok(), logged_in);
        assert_eq!(vault.secret.lock().unwrap().is_some(), logged_in);
    }
}

#[tokio::test]
async fn timed_out_writes_are_unconfirmed_and_never_retried() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/PromoteData"))
        .respond_with(ResponseTemplate::new(204).set_delay(std::time::Duration::from_millis(100)))
        .expect(1)
        .mount(&server)
        .await;
    let mut service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    service.login(credentials()).await.unwrap();
    service.test_timeout(std::time::Duration::from_millis(20));
    assert_eq!(
        service.create_data(write_input()).await.err().unwrap().code,
        "CMS_WRITE_UNCONFIRMED"
    );
    assert!(service.authorize().await.is_ok());
}

#[tokio::test]
async fn late_write_results_cannot_cross_logout() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/PromoteData"))
        .respond_with(ResponseTemplate::new(204).set_delay(std::time::Duration::from_millis(150)))
        .mount(&server)
        .await;
    let service =
        Arc::new(CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap());
    service.login(credentials()).await.unwrap();
    let pending = {
        let service = service.clone();
        tokio::spawn(async move { service.create_data(write_input()).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .any(|r| r.url.path() == "/api/PromoteData")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    service.logout().await;
    assert_eq!(
        pending.await.unwrap().err().unwrap().code,
        "SESSION_CHANGED"
    );
}

#[test]
fn external_links_allow_only_safe_web_protocols() {
    assert!(CmsService::external_link("https://mini.jnnc.com/h/101.html?zn=mr").is_ok());
    assert!(CmsService::external_link("http://example.com/a").is_ok());
    for value in [
        "file:///C:/test",
        "javascript:alert(1)",
        "data:text/html,test",
        "https://user:secret@example.com",
        "https://example.com/\n",
    ] {
        assert!(CmsService::external_link(value).is_err());
    }
}

#[tokio::test]
async fn image_urls_are_scoped_to_list_results_and_session_generation() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let image_url = format!("{}/image", server.uri());
    Mock::given(path("/api/PromoteData"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data":[{"Id":1,"TitlePic":image_url,"TitlePic2":format!("{}/unauthorized", server.uri())}],
            "total":1,"current":1,"pageSize":10
        }))).mount(&server).await;
    Mock::given(path("/image"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Content-Type", "image/png")
                .set_body_bytes(b"image".to_vec())
                .set_delay(std::time::Duration::from_millis(150)),
        )
        .mount(&server)
        .await;
    Mock::given(path("/unauthorized"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let mut service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    service.allow_test_images();
    service.login(credentials()).await.unwrap();
    assert_eq!(
        service
            .load_image(image_url.clone())
            .await
            .err()
            .unwrap()
            .code,
        "IMAGE_URL"
    );
    service.list_data(query()).await.unwrap();
    assert_eq!(
        service
            .load_image(format!("{}/unauthorized", server.uri()))
            .await
            .err()
            .unwrap()
            .code,
        "IMAGE_LOAD"
    );
    assert!(service.authorize().await.is_ok());
    let service = Arc::new(service);
    let pending = {
        let service = service.clone();
        let url = image_url.clone();
        tokio::spawn(async move { service.load_image(url).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .any(|r| r.url.path() == "/image")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    service.login(credentials()).await.unwrap();
    assert_eq!(
        pending.await.unwrap().err().unwrap().code,
        "SESSION_CHANGED"
    );
    assert_eq!(
        service.load_image(image_url).await.err().unwrap().code,
        "IMAGE_URL"
    );
}

#[tokio::test]
async fn login_restore_and_failed_remote_logout_never_expose_tokens() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let vault = Arc::new(TestVault::default());
    let service = CmsService::with_vault(server.uri(), vault.clone()).unwrap();
    let session = service.login(credentials()).await.unwrap();
    assert!(session.persistent);
    let wire = serde_json::to_string(&session).unwrap();
    assert!(!wire.contains("token"));
    assert!(!wire.contains("password"));
    assert!(wire.contains("roles"));
    let restarted = CmsService::with_vault(server.uri(), vault.clone()).unwrap();
    assert_eq!(
        restarted
            .restore_session()
            .await
            .unwrap()
            .unwrap()
            .user
            .user_id,
        6
    );
    let result = restarted.logout().await;
    assert!(!result.remote_succeeded);
    assert!(result.credentials_cleared);
    assert!(vault.secret.lock().unwrap().is_none());
    assert!(restarted.authorize().await.is_err());
    assert!(restarted.restore_session().await.unwrap().is_none());
}

#[tokio::test]
async fn required_password_and_plain_text_problem_and_malformed_responses() {
    let server = MockServer::start().await;
    let service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    assert_eq!(
        service
            .login(LoginRequest {
                username: "editor".into(),
                password: String::new()
            })
            .await
            .err()
            .unwrap()
            .code,
        "VALIDATION"
    );
    assert!(server.received_requests().await.unwrap().is_empty());
    for (response, message) in [
        (
            ResponseTemplate::new(400).set_body_string("密码错误"),
            "密码错误",
        ),
        (
            ResponseTemplate::new(400).set_body_json(json!({"title":"Bad Request","status":400})),
            "请求参数无效，请检查输入",
        ),
        (
            ResponseTemplate::new(200).set_body_json(
                json!({"code":"200","data":{"accessToken":"","tokenType":"Bearer"}}),
            ),
            "后台返回的数据格式不符合接口约定",
        ),
        (
            ResponseTemplate::new(200).set_body_string("not json"),
            "后台返回的数据格式不符合接口约定",
        ),
    ] {
        server.reset().await;
        Mock::given(path("/api/Auth/Login"))
            .respond_with(response)
            .mount(&server)
            .await;
        assert_eq!(
            service.login(credentials()).await.err().unwrap().message,
            message
        );
        assert!(service.authorize().await.is_err());
    }
}

#[tokio::test]
async fn keyring_failure_keeps_only_memory_session() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let service = CmsService::with_vault(
        server.uri(),
        Arc::new(TestVault {
            fail_save: true,
            ..Default::default()
        }),
    )
    .unwrap();
    assert!(!service.login(credentials()).await.unwrap().persistent);
    assert!(service.authorize().await.is_ok());
}

#[tokio::test]
async fn channels_fetch_all_pages_and_preserve_deduplicated_order() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    service.login(credentials()).await.unwrap();
    Mock::given(path("/api/PromoteChannel")).and(query_param("current", "1")).and(query_param("pagesize", "200"))
        .respond_with(ResponseTemplate::new(200).insert_header("Content-Type","text/json").set_body_json(json!({"data":vec![json!({"Channel":"KOOK","SubChannel":"图一"});200],"total":203}))).expect(1).mount(&server).await;
    Mock::given(path("/api/PromoteChannel")).and(query_param("current", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":[{"Channel":"KOOK","SubChannel":"图二"},{"Channel":"PC","SubChannel":null},{"Channel":"KOOK","SubChannel":"图一"}],"total":203}))).expect(1).mount(&server).await;
    let groups = service.list_channels().await.unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].channel, "KOOK");
    assert_eq!(groups[0].subchannels, vec!["图一", "图二"]);
    assert!(groups[1].subchannels.is_empty());
}

#[tokio::test]
async fn query_encoding_nullable_fields_and_inaccurate_total_are_preserved() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    service.login(credentials()).await.unwrap();
    Mock::given(path("/api/PromoteData")).and(method("GET")).and(header("Authorization","Bearer test-token"))
        .and(query_param("subchannel","右侧轮播小图_头条_280x124")).and(query_param("publishdate","2026-10-23"))
        .and(query_param("current","1")).and(query_param("pagesize","10")).and(query_param("channel","2345"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":[{"Id":175996,"ArticleId":11650009,"TitlePic2":"","Host":null,"SubChannel":"右侧轮播小图_头条_280x124"}],"total":175016,"pageSize":10,"current":1}))).mount(&server).await;
    let page = service.list_data(query()).await.unwrap();
    assert_eq!(page.total, 175016);
    assert!(page.data[0].host.is_none());
    assert_eq!(page.data[0].title_pic2.as_deref(), Some(""));
    let wire = serde_json::to_value(&page).unwrap();
    assert_eq!(wire["data"][0]["subChannel"], "右侧轮播小图_头条_280x124");
    assert_eq!(wire["data"][0]["articleId"], 11650009);
}

#[tokio::test]
async fn forbidden_keeps_session_and_expiry_clears_saved_credentials() {
    for status in [401, 403, 200] {
        let server = MockServer::start().await;
        login_routes(&server).await;
        let vault = Arc::new(TestVault::default());
        let service = CmsService::with_vault(server.uri(), vault.clone()).unwrap();
        service.login(credentials()).await.unwrap();
        let response = if status == 200 {
            ResponseTemplate::new(status).set_body_json(json!({"code":"A0230"}))
        } else {
            ResponseTemplate::new(status)
        };
        Mock::given(path("/api/PromoteData"))
            .respond_with(response)
            .mount(&server)
            .await;
        let error = service.list_data(query()).await.err().unwrap();
        assert_eq!(
            error.code,
            if status == 403 {
                "CMS_FORBIDDEN"
            } else {
                "AUTH_EXPIRED"
            }
        );
        assert_eq!(service.authorize().await.is_ok(), status == 403);
        assert_eq!(vault.secret.lock().unwrap().is_some(), status == 403);
    }
}

#[tokio::test]
async fn old_data_response_cannot_reappear_after_logout() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let service =
        Arc::new(CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap());
    service.login(credentials()).await.unwrap();
    Mock::given(path("/api/PromoteData"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_millis(150))
                .set_body_json(json!({"data":[],"total":0,"current":1,"pageSize":10})),
        )
        .mount(&server)
        .await;
    let worker = {
        let service = service.clone();
        tokio::spawn(async move { service.list_data(query()).await })
    };
    // 等待请求真正到达测试服务器后退出，不依赖任务调度顺序。
    while !server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .any(|r| r.url.path() == "/api/PromoteData")
    {
        tokio::task::yield_now().await;
    }
    service.logout().await;
    assert_eq!(worker.await.unwrap().err().unwrap().code, "SESSION_CHANGED");
}

#[tokio::test]
async fn restoring_failures_keep_credentials_until_actual_expiry() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let vault = Arc::new(TestVault::default());
    CmsService::with_vault(server.uri(), vault.clone())
        .unwrap()
        .login(credentials())
        .await
        .unwrap();
    server.reset().await;
    Mock::given(path("/api/Account/CurrentUser"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let restarted = CmsService::with_vault(server.uri(), vault.clone()).unwrap();
    assert!(restarted.restore_session().await.is_err());
    assert!(vault.secret.lock().unwrap().is_some());
    assert!(restarted.authorize().await.is_err());
    server.reset().await;
    Mock::given(path("/api/Account/CurrentUser"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    assert!(restarted.restore_session().await.unwrap().is_none());
    assert!(vault.secret.lock().unwrap().is_none());
}

#[tokio::test]
async fn invalid_query_and_anonymous_calls_do_not_contact_business_api() {
    let server = MockServer::start().await;
    let service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    assert_eq!(
        service.list_data(query()).await.err().unwrap().code,
        "AUTH_EXPIRED"
    );
    assert!(service.list_channels().await.is_err());
    for bad in [
        PromoteQuery {
            current: 0,
            ..query()
        },
        PromoteQuery {
            pagesize: 200,
            ..query()
        },
        PromoteQuery {
            publishdate: "2026-02-30".into(),
            ..query()
        },
        PromoteQuery {
            channel: String::new(),
            ..query()
        },
    ] {
        assert_eq!(
            service.list_data(bad).await.err().unwrap().code,
            "VALIDATION"
        );
    }
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn api_redirect_is_not_followed() {
    let server = MockServer::start().await;
    let destination = MockServer::start().await;
    Mock::given(path("/api/Auth/Login"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("Location", format!("{}/capture", destination.uri())),
        )
        .mount(&server)
        .await;
    let service = CmsService::with_vault(server.uri(), Arc::new(TestVault::default())).unwrap();
    assert!(service.login(credentials()).await.is_err());
    assert!(destination.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn refreshing_an_active_session_revalidates_with_server() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let vault = Arc::new(TestVault::default());
    let service = CmsService::with_vault(server.uri(), vault.clone()).unwrap();
    service.login(credentials()).await.unwrap();
    server.reset().await;
    Mock::given(path("/api/Account/CurrentUser"))
        .respond_with(ResponseTemplate::new(401))
        .expect(1)
        .mount(&server)
        .await;
    assert!(service.restore_session().await.unwrap().is_none());
    assert!(service.authorize().await.is_err());
    assert!(vault.secret.lock().unwrap().is_none());
}

#[tokio::test]
async fn an_old_expired_response_does_not_clear_new_login() {
    let server = MockServer::start().await;
    login_routes(&server).await;
    let vault = Arc::new(TestVault::default());
    let service = Arc::new(CmsService::with_vault(server.uri(), vault.clone()).unwrap());
    service.login(credentials()).await.unwrap();
    Mock::given(path("/api/PromoteData"))
        .respond_with(ResponseTemplate::new(401).set_delay(std::time::Duration::from_millis(150)))
        .mount(&server)
        .await;
    let worker = {
        let service = service.clone();
        tokio::spawn(async move { service.list_data(query()).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.url.path() == "/api/PromoteData")
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    service.login(credentials()).await.unwrap();
    assert_eq!(worker.await.unwrap().err().unwrap().code, "SESSION_CHANGED");
    assert!(service.authorize().await.is_ok());
    assert!(vault.secret.lock().unwrap().is_some());
}
