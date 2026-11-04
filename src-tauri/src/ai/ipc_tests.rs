//! 经过 Tauri Webview 消息入口和构建产物 ACL，避免仅调用服务遗漏桌面授权。
use super::*;
use serde_json::Value;
use tauri::{
    Manager,
    ipc::{CallbackFn, InvokeBody},
    test::{MockRuntime, get_ipc_response},
    webview::InvokeRequest,
};

fn invoke(
    window: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: command.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize().unwrap())
}

fn request_body(request: &PaginationRequest) -> Value {
    json!({"request": {"jobId":request.job_id, "templateId":request.template_id,
        "modelConfigId":request.model_config_id, "title":request.title, "blocks":request.blocks}})
}

#[test]
fn registered_commands_have_build_manifest_and_main_window_permissions() {
    let handler = include_str!("../lib.rs");
    let manifest = include_str!("../../build.rs");
    let capability: Value =
        serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
    assert!(
        capability["windows"]
            .as_array()
            .unwrap()
            .contains(&json!("main"))
    );
    let commands: Vec<_> = regex::Regex::new(r"commands::(\w+)")
        .unwrap()
        .captures_iter(
            handler
                .split_once("tauri::generate_handler![")
                .unwrap()
                .1
                .split_once("])")
                .unwrap()
                .0,
        )
        .map(|capture| capture[1].to_string())
        .collect();
    assert!(!commands.is_empty());
    let manifest_commands: Vec<_> = regex::Regex::new(r#""(\w+)""#)
        .unwrap()
        .captures_iter(
            manifest
                .split_once(".commands(&[")
                .unwrap()
                .1
                .split_once("])")
                .unwrap()
                .0,
        )
        .map(|capture| capture[1].to_string())
        .collect();
    for command in &commands {
        assert!(
            manifest_commands.contains(command),
            "命令未加入构建清单：{command}"
        );
        let permission = format!("allow-{}", command.replace('_', "-"));
        assert!(
            capability["permissions"]
                .as_array()
                .unwrap()
                .contains(&json!(permission)),
            "主窗口缺少权限：{command}"
        );
    }
    assert_eq!(
        commands.len(),
        manifest_commands.len(),
        "命令清单与注册数量不同"
    );
}

#[test]
fn android_import_permissions_only_cover_main_business_configuration() {
    let capability: Value =
        serde_json::from_str(include_str!("../../capabilities/android.json")).unwrap();
    assert_eq!(capability["windows"], json!(["main"]));
    assert_eq!(capability["platforms"], json!(["android"]));
    assert!(capability.get("remote").is_none());
    let permissions = capability["permissions"].as_array().unwrap();
    for command in [
        "harvest-load-settings",
        "harvest-save-settings",
        "harvest-set-developer-mode",
        "harvest-list-jobs",
        "harvest-enqueue",
        "harvest-job-action",
        "ai-load-settings",
        "ai-save-provider",
        "ai-save-model",
        "ai-save-template",
        "ai-delete-config",
        "ai-list-models",
        "ai-test-model",
        "ai-cancel",
    ] {
        assert!(permissions.contains(&json!(format!("allow-{command}"))));
    }
    for command in [
        "harvest-bridge-status",
        "harvest-install-userscript",
        "harvest-select-source-tab",
        "harvest-open-devtools",
        "ai-suggest-titles",
        "ai-suggest-pagination",
    ] {
        assert!(!permissions.contains(&json!(format!("allow-{command}"))));
    }
    assert!(
        permissions
            .iter()
            .all(|p| !p.as_str().unwrap().contains("pressdock-platform"))
    );
}

async fn fixture(
    delay: Duration,
    protocol: Protocol,
) -> (
    Database,
    AiService,
    crate::cms::CmsService,
    MockServer,
    MockServer,
    tempfile::TempDir,
) {
    let directory = tempfile::tempdir().unwrap();
    let db = Database::open(&directory.path().join("demo-ipc.db"))
        .await
        .unwrap();
    let ai = AiService::with_vault(Arc::new(TestVault::default())).unwrap();
    let server = MockServer::start().await;
    let (endpoint, payload) = match protocol {
        Protocol::ChatCompletions => (
            "/chat/completions",
            json!({
                "choices":[{"message":{"content":"{\"bind_after\":[],\"prefer_after\":[\"B1\"]}"},"finish_reason":"stop"}]
            }),
        ),
        Protocol::Responses => (
            "/responses",
            json!({
                "status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"{\"bind_after\":[],\"prefer_after\":[\"B1\"]}"}]}]
            }),
        ),
    };
    let calls = std::sync::atomic::AtomicUsize::new(0);
    Mock::given(method("POST"))
        .and(path(endpoint))
        .respond_with(move |_: &wiremock::Request| {
            let wait = if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                delay.min(Duration::from_secs(2))
            } else {
                delay
            };
            ResponseTemplate::new(200)
                .set_delay(wait)
                .set_body_json(payload.clone())
        })
        .mount(&server)
        .await;
    ai.save_provider(&db, provider("gateway", &server.uri(), protocol))
        .await
        .unwrap();
    db.ai_save_model(&model("gateway", "gateway"))
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
    template.model_config_id = Some("gateway".into());
    db.ai_save_template(&template).await.unwrap();
    let (cms, cms_server) = crate::cms::ipc_service().await;
    (db, ai, cms, server, cms_server, directory)
}

#[test]
fn pagination_through_webview_ipc_checks_acl_generation_and_cancellation() {
    check_webview_ipc(Protocol::ChatCompletions);
}

#[test]
fn pagination_responses_through_webview_ipc_checks_acl_generation_and_cancellation() {
    check_webview_ipc(Protocol::Responses);
}

fn check_webview_ipc(protocol: Protocol) {
    let (db, ai, cms, _server, _cms_server, _directory) =
        tauri::async_runtime::block_on(fixture(Duration::from_millis(100), protocol));
    let app = tauri::test::mock_builder()
        .manage(db)
        .manage(ai)
        .manage(cms)
        .invoke_handler(tauri::generate_handler![
            crate::commands::ai_suggest_pagination,
            crate::commands::ai_cancel
        ])
        // 必须读取真实构建生成的权限，不能使用不含 ACL 的 mock_context。
        .build(tauri::generate_context!())
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let blocked = tauri::WebviewWindowBuilder::new(&app, "unauthorized", Default::default())
        .build()
        .unwrap();
    let request = pagination_request();
    let result = invoke(&main, "ai_suggest_pagination", request_body(&request)).unwrap();
    assert_eq!(result["jobId"], request.job_id);
    assert_eq!(result["prefer_after"], json!(["B1"]));
    let denied = invoke(&blocked, "ai_suggest_pagination", request_body(&request)).unwrap_err();
    assert!(denied.as_str().unwrap().contains("not allowed"));

    let pending = pagination_request();
    let id = pending.job_id.clone();
    let cancelled = std::thread::scope(|scope| {
        let generating =
            scope.spawn(|| invoke(&main, "ai_suggest_pagination", request_body(&pending)));
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(2), async {
                while _server.received_requests().await.unwrap().len() < 2 {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
        });
        assert_eq!(
            invoke(&main, "ai_cancel", json!({"jobId":id})).unwrap(),
            Value::Null
        );
        generating.join().unwrap().unwrap_err()
    });
    assert_eq!(cancelled["code"], "AI_CANCELLED");
    assert!(app.state::<AiService>().operations.try_lock().is_ok());
}

/// 原生桌面手工验收宿主。使用实际前端、命令及 ACL；只有远程服务是带演示标识的本地接口。
/// npm run build 后执行 cargo test --locked --features tauri/custom-protocol pagination_native_desktop_fixture -- --ignored --nocapture
#[cfg(target_os = "windows")]
#[test]
#[ignore = "打开隔离的演示桌面窗口，人工验收后关闭"]
fn pagination_native_desktop_fixture() {
    let (db, ai, cms, server, cms_server, directory) =
        tauri::async_runtime::block_on(fixture(Duration::from_secs(60), Protocol::Responses));
    tauri::async_runtime::block_on(async {
        let text = format!(
            "<p><strong>【演示数据】桌面分页 IPC 验收。</strong>{}</p><p>{}</p><p>{}</p>",
            "这是首段演示内容，用于检查加粗与原文是否保留。".repeat(9),
            "这是第二段演示内容，用于检查默认配置生成与逐页预览。".repeat(9),
            "这是末段演示内容，用于检查应用后一次撤销恢复全文。".repeat(9)
        );
        let article = json!({"Id":1,"ClassId":1,"ClassName":"演示分类","Title":"【演示数据】分页桌面 IPC 验收", "TitlePic":"", "Pages":1,"Tags":[],"NewsText":text,"Status":3});
        Mock::given(method("GET")).and(path("/api/Article"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"msg":"succ","data":[article],"total":1,"current":1,"pageSize":50,"recommand":[],"promote":[]}))).mount(&cms_server).await;
        Mock::given(method("GET"))
            .and(path("/api/Article/1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":article})))
            .mount(&cms_server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/ArticleClass"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"data":[{"Id":1,"Name":"演示分类"}]})),
            )
            .mount(&cms_server)
            .await;
    });
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.example.pressdock.pagination-ipc-demo".into();
    let cancellations = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = cancellations.clone();
    let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        crate::commands::cms_restore_session,
        crate::commands::cms_list_articles,
        crate::commands::cms_get_article,
        crate::commands::cms_list_article_classes,
        crate::commands::ai_load_settings,
        crate::commands::ai_suggest_pagination,
        crate::commands::ai_cancel,
        crate::commands::harvest_load_settings,
        crate::commands::get_app_info,
        crate::commands::health_check,
    ];
    let app = tauri::Builder::default()
        .any_thread()
        .manage(db)
        .manage(ai)
        .manage(cms)
        .invoke_handler(move |invoke| {
            if invoke.message.command() == "ai_cancel" {
                observed.fetch_add(1, Ordering::SeqCst);
            }
            handler(invoke)
        })
        .build(context)
        .unwrap();
    tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("index.html#/articles/quality".into()),
    )
    .title("PressDock · 演示数据 · 分页 IPC 验收")
    .inner_size(1280., 800.)
    .data_directory(directory.path().join("webview"))
    .build()
    .unwrap();
    // 返回测试宿主继续断言；run 会随桌面事件循环直接结束整个测试进程。
    assert_eq!(app.run_return(|_, _| {}), 0);
    tauri::async_runtime::block_on(async {
        let requests = server.received_requests().await.unwrap();
        assert!(requests.len() >= 2, "需至少验收生成与取消两次请求");
        for request in &requests {
            assert_eq!(request.url.path(), "/responses");
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            assert_eq!(body["max_output_tokens"], 4096);
            assert_eq!(body["text"]["format"]["type"], "json_object");
        }
        assert!(
            cancellations.load(Ordering::SeqCst) > 0,
            "需通过原生 IPC 验收取消操作"
        );
        assert!(
            cms_server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .all(|request| {
                    request.method.as_str() == "GET" || request.url.path() == "/api/Auth/Login"
                }),
            "验收不应向 CMS 写入"
        );
        println!(
            "原生桌面 IPC 验收结束：AI 请求 {} 次，取消 IPC {} 次，CMS 无写入。",
            requests.len(),
            cancellations.load(Ordering::SeqCst)
        );
    });
}

/// 不访问来源网站、不写真实 CMS；从带演示标识的格式化检查点验收后台分页及设置。
#[cfg(target_os = "windows")]
#[test]
#[ignore = "启动原生 WebView，自动验证演示导入、取消与分页配置入口"]
fn harvest_native_desktop_fixture() {
    use crate::harvest::{EnqueueRequest, FormattedArticle, HarvestService, Status};
    let (db, ai, cms, server, cms_server, directory) =
        tauri::async_runtime::block_on(fixture(Duration::from_secs(60), Protocol::Responses));
    let saved_db = db.clone();
    let (user, jobs) = tauri::async_runtime::block_on(async {
        let user = cms.harvest_identity().await.unwrap().0;
        let mut settings = db.harvest_settings().await.unwrap();
        settings.options.developer_mode = true;
        settings.options.auto_classify = false;
        settings.options.auto_tags = false;
        settings.options.auto_summary = false;
        settings.options.ai_auto_paginate = true;
        settings.options.model_config_id = None;
        db.harvest_save_settings(&settings).await.unwrap();
        let rich = format!(
            "<p style=\"text-align:center\"><strong>【演示数据】导入分页验收。</strong>{}</p><p><img src=\"https://example.com/demo.png\" alt=\"演示图片\"></p><p class=\"img-caption\">演示图注</p><p><a href=\"https://example.com/\">{}</a></p><p>来源：演示稿件</p>",
            "保留原有格式和每个正文字符。".repeat(18),
            "第二段演示内容保持链接及段落格式。".repeat(18)
        );
        let mut jobs = Vec::new();
        for (i, name) in [
            "success", "nested", "missing", "images", "disabled", "prepared", "cancel",
        ]
        .iter()
        .enumerate()
        {
            let id = uuid::Uuid::new_v4().to_string();
            let url = format!("https://baijiahao.baidu.com/s?id={}", i + 1000);
            db.harvest_enqueue(
                user,
                &EnqueueRequest {
                    id: id.clone(),
                    url: url.clone(),
                },
            )
            .await
            .unwrap();
            let html=match *name {
                "nested" => "<blockquote><p>[!--empirenews.page--]</p></blockquote><p>【演示数据】嵌套分页保留原排版。</p>".into(),
                "images" => "<p><img src=\"https://example.com/a.png\"></p><p>[!--empirenews.page--]</p><p><img src=\"https://example.com/b.png\"></p>".into(),
                _ => rich.clone(),
            };
            let article = FormattedArticle {
                title: format!("【演示数据】{name}"),
                writer: String::new(),
                source_url: url.clone(),
                news_text: html.clone(),
                title_pic: String::new(),
                small_text: String::new(),
                class_id: 1,
                tags: vec![],
            };
            let source = format!("harvest-source-{id}");
            sqlx::query("INSERT INTO source_articles(id,title,url,content,imported_at,is_demo) VALUES(?,?,?,?,?,1)")
                .bind(&source).bind(&article.title).bind(&url).bind(&html).bind("2026-10-31").execute(&db.pool).await.unwrap();
            sqlx::query("UPDATE harvest_jobs SET source_id=?,title=?,formatted=?,prepared=?,created_at=? WHERE id=?")
                .bind(source).bind(&article.title).bind(serde_json::to_string(&article).unwrap())
                .bind(if *name=="prepared" {Some(serde_json::to_string(&article).unwrap())} else {None})
                .bind(format!("2026-10-31T00:00:{i:02}Z")).bind(&id).execute(&db.pool).await.unwrap();
            if *name == "missing" {
                sqlx::query("UPDATE harvest_jobs SET options=json_remove(options,'$.paginationSnapshot') WHERE id=?").bind(&id).execute(&db.pool).await.unwrap();
            }
            if *name == "disabled" {
                sqlx::query("UPDATE harvest_jobs SET options=json_set(options,'$.aiAutoPaginate',json('false')) WHERE id=?").bind(&id).execute(&db.pool).await.unwrap();
            }
            jobs.push((id, *name, article));
        }
        (user, jobs)
    });
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.example.pressdock.harvest-pagination-demo".into();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(db)
        .manage(ai)
        .manage(cms)
        .manage(HarvestService::new(None))
        .manage(crate::window_policy::WindowPolicy(
            std::sync::atomic::AtomicBool::new(true),
        ))
        .invoke_handler(tauri::generate_handler![
            crate::commands::cms_restore_session,
            crate::commands::ai_load_settings,
            crate::commands::harvest_load_settings,
            crate::commands::harvest_save_settings,
            crate::commands::harvest_list_jobs,
            crate::commands::harvest_job_action,
            crate::commands::get_app_info,
            crate::commands::health_check,
        ])
        .build(context)
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("index.html#/import".into()),
    )
    .title("PressDock · 演示数据 · 素材导入共用分页验收")
    .inner_size(1280., 800.)
    .data_directory(directory.path().join("webview"))
    .build()
    .unwrap();
    let ui_result = Arc::new(Mutex::new(None));
    let ui_report = ui_result.clone();
    let check_db = saved_db.clone();
    tauri::async_runtime::spawn(async move {
        let result: Result<(),String>=async {
            native_wait(&window,r#"Array.from(document.querySelectorAll('tr')).some(r=>r.innerText.includes('【演示数据】cancel'))"#).await?;
            crate::harvest::start(window.app_handle().clone());
            native_wait(&window,r#"Array.from(document.querySelectorAll('tr')).some(r=>r.innerText.includes('【演示数据】cancel') && r.innerText.includes('AI 自动分页中'))"#).await?;
            native_eval(&window,r#"(() => { const row=Array.from(document.querySelectorAll('tr')).find(r=>r.innerText.includes('【演示数据】cancel')); const button=Array.from(row.querySelectorAll('button')).find(b=>b.textContent.trim()==='取消'); if(!button) throw Error('取消按钮不存在'); button.click(); return true; })()"#).await?;
            native_wait(&window,r#"Array.from(document.querySelectorAll('tr')).some(r=>r.innerText.includes('【演示数据】cancel') && r.innerText.includes('已取消'))"#).await?;
            native_eval(&window,r#"(() => { Array.from(document.querySelectorAll('a')).find(a=>a.getAttribute('href')==='#/settings').click(); return true; })()"#).await?;
            native_wait(&window,r#"Array.from(document.querySelectorAll('[role=tab]')).some(t=>t.textContent.trim()==='采集与 AI 处理')"#).await?;
            native_eval(&window,r#"(() => { const tab=Array.from(document.querySelectorAll('[role=tab]')).find(t=>t.textContent.trim()==='采集与 AI 处理'); tab.focus(); tab.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); tab.click(); return true; })()"#).await?;
            native_wait(&window,r#"!!document.getElementById('harvest-aiAutoPaginate') && document.body.innerText.includes('目标 240')"#).await?;
            let clean=native_eval(&window,r#"!document.getElementById('harvest-autoOrganize') && !document.getElementById('harvest-autoPaginate') && document.body.innerText.includes('元数据处理模型')"#).await?;
            if clean!=json!(true) {return Err("旧规则未移除或模型标签不符".into());}
            native_eval(&window,r#"(() => {document.getElementById('harvest-aiAutoPaginate').click();return true;})()"#).await?;
            for _ in 0..40 {
                if !check_db.harvest_settings().await.map_err(|e|e.to_string())?.options.ai_auto_paginate {break;}
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if check_db.harvest_settings().await.map_err(|e|e.to_string())?.options.ai_auto_paginate {return Err("分页开关未自动保存".into());}
            native_eval(&window,r#"(() => { Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='配置默认分页模板').click(); return true; })()"#).await?;
            native_wait(&window,r#"Array.from(document.querySelectorAll('[aria-pressed=true],[data-state=on]')).some(b=>b.textContent.trim()==='文章分页') && document.body.innerText.includes('提示词模板')"#).await?;
            Ok(())
        }.await;
        *ui_report.lock().unwrap() = Some(result);
        window.app_handle().exit(0);
    });
    assert_eq!(app.run_return(|_, _| {}), 0);
    assert_eq!(
        ui_result.lock().unwrap().take(),
        Some(Ok(())),
        "原生 DOM 交互验收失败"
    );
    tauri::async_runtime::block_on(async {
        for (id, name, original) in jobs {
            let stored = saved_db.harvest_job(&id, user).await.unwrap();
            if name == "cancel" {
                assert!(
                    stored.job.status == Status::Cancelled,
                    "需取消最后一个延迟任务"
                );
                assert!(stored.prepared.is_none());
                continue;
            }
            assert!(
                stored.job.status == Status::DebugCompleted,
                "{name} 必须调试完成：{}",
                serde_json::to_value(&stored.job).unwrap()
            );
            let html = stored.prepared.unwrap().news_text;
            match name {
                "success" => assert!(html.contains("[!--empirenews.page--]")),
                "images" => assert!(!html.contains("[!--empirenews.page--]")),
                _ => assert_eq!(html, original.news_text, "{name} 应完整保留排版"),
            }
            assert_eq!(stored.raw.unwrap().news_html, original.news_text);
            if matches!(name, "nested" | "missing") {
                assert!(stored.job.warnings.iter().any(|w| w.contains("保留原排版")));
            }
        }
        assert_eq!(server.received_requests().await.unwrap().len(), 2);
        assert!(
            cms_server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .all(|r| r.method.as_str() == "GET" || r.url.path() == "/api/Auth/Login")
        );
        println!(
            "素材导入原生验收通过：共用分页、原排版回退、纯图片、关闭及检查点跳过、取消；CMS 无写入。"
        );
    });
}

#[cfg(target_os = "windows")]
async fn native_eval(window: &tauri::WebviewWindow, expression: &str) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));
    let script = format!(
        "(() => {{try {{return {{ok:true,value:({expression})}};}} catch(e) {{return {{ok:false,error:String(e)}};}}}})()"
    );
    window
        .eval_with_callback(script, move |reply| {
            if let Some(tx) = sender.lock().unwrap().take() {
                let _ = tx.send(reply);
            }
        })
        .map_err(|e| e.to_string())?;
    let reply = tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let result: Value = serde_json::from_str(&reply).map_err(|e| e.to_string())?;
    if result["ok"] == true {
        Ok(result["value"].clone())
    } else {
        Err(result["error"].to_string())
    }
}
#[cfg(target_os = "windows")]
async fn native_wait(window: &tauri::WebviewWindow, expression: &str) -> Result<(), String> {
    for _ in 0..80 {
        if native_eval(window, expression).await? == json!(true) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(format!(
        "等待原生 DOM 条件超时：{expression}；页面：{}",
        native_eval(window, "document.body.innerText.slice(0,1500)").await?
    ))
}
