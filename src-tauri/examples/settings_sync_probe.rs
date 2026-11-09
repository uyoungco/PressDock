//! 步骤 1 的只读实测工具：凭据仅从原有 keyring 读取，不打印、不落盘。
use reqwest::{Client, redirect::Policy};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const CMS_CURRENT_USER: &str = "https://newsadmin.nccontrol.com.cn/api/Account/CurrentUser";
const WORKER_ORIGIN: &str = "https://pressdock-settings-dev.i9543.workers.dev";

async fn worker_check(
    client: &Client,
    label: &str,
    token: Option<&str>,
    expected_status: u16,
) -> Result<(), &'static str> {
    let mut request = client.get(format!("{WORKER_ORIGIN}/api/v1/verify"));
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let started = Instant::now();
    let response = request.send().await.map_err(|_| "Worker 请求失败")?;
    let status = response.status().as_u16();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);
    let cms_verified = payload["cms"]["verified"] == true;
    let d1_connected = payload["database"]["connected"] == true;
    let code = payload["code"].as_str().filter(|value| {
        matches!(
            *value,
            "AUTH_REQUIRED"
                | "AUTH_EXPIRED"
                | "CMS_FORBIDDEN"
                | "CMS_UNAVAILABLE"
                | "CMS_TIMEOUT"
                | "CMS_INVALID_RESPONSE"
                | "D1_UNAVAILABLE"
                | "INTERNAL_ERROR"
        )
    });
    println!(
        "{}",
        json!({"check":label,"httpStatus":status,"cmsVerified":cms_verified,"d1Connected":d1_connected,"code":code,"elapsedMs":started.elapsed().as_millis()})
    );
    if status != expected_status || (status == 200 && (!cms_verified || !d1_connected)) {
        return Err("Worker 验收结果与预期不符，见脱敏状态记录");
    }
    Ok(())
}

fn tamper_token(token: &str) -> String {
    if let Some((prefix, signature)) = token.rsplit_once('.')
        && !signature.is_empty()
    {
        let replacement = if signature.starts_with('A') { 'B' } else { 'A' };
        return format!("{prefix}.{replacement}{}", &signature[1..]);
    }
    format!("{token}-tampered")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credential {
    access_token: String,
    token_type: String,
}

#[tokio::main]
async fn main() -> Result<(), &'static str> {
    let credential = keyring::Entry::new("com.example.pressdock.cms", "newsadmin.nccontrol.com.cn")
        .map_err(|_| "无法访问 PressDock CMS 凭据条目")?
        .get_password()
        .map_err(|_| "没有可读取的 PressDock CMS 会话，请先在软件中登录")?;
    let credential: Credential =
        serde_json::from_str(&credential).map_err(|_| "CMS 会话格式无效")?;
    if credential.token_type != "Bearer"
        || credential.access_token.is_empty()
        || !credential.access_token.is_ascii()
        || credential.access_token.contains(['\r', '\n'])
    {
        return Err("CMS 会话格式无效");
    }
    let client = Client::builder()
        .retry(reqwest::retry::never())
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| "无法初始化 HTTP 客户端")?;
    let response = client
        .get(CMS_CURRENT_USER)
        .bearer_auth(&credential.access_token)
        .send()
        .await
        .map_err(|_| "无法连接真实 CMS 身份接口")?;
    let status = response.status().as_u16();
    let payload: Value = response.json().await.map_err(|_| "CMS 未返回有效 JSON")?;
    let authenticated = status == 200
        && payload.get("code").is_none_or(|v| v == "200" || v == 200)
        && payload["data"]["userId"].as_i64().is_some_and(|v| v > 0)
        && payload["data"]["role"]
            .as_array()
            .is_some_and(|v| !v.is_empty());
    println!(
        "{}",
        json!({"check":"direct-cms-current-user","httpStatus":status,"authenticated":authenticated})
    );
    if !authenticated {
        return Err("已保存 CMS 会话未通过真实身份验证");
    }
    if std::env::args().any(|argument| argument == "--cms-only") {
        return Ok(());
    }
    worker_check(
        &client,
        "worker-valid-session",
        Some(&credential.access_token),
        200,
    )
    .await?;
    worker_check(&client, "worker-missing-session", None, 401).await?;
    worker_check(
        &client,
        "worker-tampered-session",
        Some(&tamper_token(&credential.access_token)),
        401,
    )
    .await?;
    Ok(())
}
