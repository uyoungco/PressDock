//! 仅向固定开发 Worker 写入带演示标识的数据；凭据不输出、不落盘。
use reqwest::{Client, redirect::Policy};
use serde_json::{Value, json};
use std::time::Duration;
const ORIGIN: &str = "https://pressdock-settings-dev.i9543.workers.dev/api/v1/settings";
async fn call(
    client: &Client,
    token: &str,
    route: &str,
    body: Option<&Value>,
) -> Result<(u16, Value), &'static str> {
    for _ in 0..4 {
        let request = if let Some(body) = body {
            client.post(format!("{ORIGIN}/{route}")).json(body)
        } else {
            client.get(format!("{ORIGIN}/{route}"))
        };
        let response = request
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "开发 Worker 请求失败")?;
        let status = response.status().as_u16();
        let payload = response
            .json::<Value>()
            .await
            .map_err(|_| "开发 Worker 返回无效 JSON")?;
        if status == 503 && payload["error"]["code"] == "WRITE_BUSY" {
            continue;
        }
        return Ok((status, payload));
    }
    Err("开发 Worker 连续繁忙")
}
fn op(changes: Value) -> Value {
    json!({"schemaVersion":1,"operationId":uuid::Uuid::new_v4().to_string(),"deviceId":uuid::Uuid::new_v4().to_string(),"sequence":1,"changes":changes})
}
fn set(field: &str, value: Value) -> Value {
    json!({"type":"set","target":{"entity":"model","id":"demo-model"},"field":field,"value":value})
}
async fn accepted(c: &Client, t: &str, body: &Value) -> Result<Value, &'static str> {
    let (s, v) = call(c, t, "operations", Some(body)).await?;
    if s != 200 {
        return Err("开发写入未通过");
    }
    Ok(v)
}
#[tokio::main]
async fn main() -> Result<(), &'static str> {
    let saved = keyring::Entry::new("com.example.pressdock.cms", "newsadmin.nccontrol.com.cn")
        .map_err(|_| "凭据库不可用")?
        .get_password()
        .map_err(|_| "缺少CMS会话")?;
    let saved: Value = serde_json::from_str(&saved).map_err(|_| "会话格式错误")?;
    let token = saved["accessToken"].as_str().ok_or("会话格式错误")?;
    let client = Client::builder()
        .retry(reqwest::retry::never())
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(35))
        .build()
        .map_err(|_| "客户端不可用")?;
    let fixture: Value =
        serde_json::from_str(include_str!("../../docs/settings-sync/fixtures-v1.json"))
            .map_err(|_| "演示样例错误")?;
    let init = json!({"schemaVersion":1,"operationId":uuid::Uuid::new_v4().to_string(),"deviceId":uuid::Uuid::new_v4().to_string(),"sequence":1,"config":fixture["base"]["config"],"secrets":[{"providerId":"demo-provider","value":"DEMO-ONLY-live-cloud-probe"}]});
    let (s, before) = call(&client, token, "bootstrap", None).await?;
    if s == 409 && before["error"]["code"] == "NOT_INITIALIZED" {
        let (s, receipt) = call(&client, token, "initialize", Some(&init)).await?;
        if s != 200 {
            return Err("演示初始化失败");
        }
        for _ in 0..2 {
            let (s, repeated) = call(&client, token, "initialize", Some(&init)).await?;
            if s != 200 || repeated != receipt {
                return Err("初始化幂等失败");
            }
        }
        println!(
            "{}",
            json!({"check":"initialize-three-identical","passed":true})
        );
    } else if s != 200 || before["snapshot"]["config"]["providers"][0]["id"] != "demo-provider" {
        return Err("开发库已有非演示配置，拒绝改动");
    }
    let mut other_init = init.clone();
    other_init["operationId"] = json!(uuid::Uuid::new_v4().to_string());
    other_init["deviceId"] = json!(uuid::Uuid::new_v4().to_string());
    let (s, rejected) = call(&client, token, "initialize", Some(&other_init)).await?;
    if s != 409 || rejected["error"]["code"] != "ALREADY_INITIALIZED" {
        return Err("重复初始化覆盖保护失败");
    }
    for round in 0..20 {
        let a = op(json!([set(
            "displayName",
            json!(format!("演示并发-{round}"))
        )]));
        let b = op(json!([set("maxOutputTokens", json!(4200 + round))]));
        let (ra, rb) = tokio::join!(accepted(&client, token, &a), accepted(&client, token, &b));
        ra?;
        rb?;
        let (_, merged) = call(&client, token, "bootstrap", None).await?;
        let model = &merged["snapshot"]["config"]["models"][0];
        if model["displayName"] != format!("演示并发-{round}")
            || model["maxOutputTokens"] != 4200 + round
        {
            return Err("不同字段并发合并失败");
        }
        let a = op(json!([set(
            "displayName",
            json!(format!("演示旧操作-{round}"))
        )]));
        let receipt = accepted(&client, token, &a).await?;
        let b = op(json!([set(
            "displayName",
            json!(format!("演示最后保存-{round}"))
        )]));
        let last = accepted(&client, token, &b).await?;
        if accepted(&client, token, &a).await? != receipt {
            return Err("重复提交未返回原收据");
        }
        let (_, current) = call(&client, token, "bootstrap", None).await?;
        if current["snapshot"]["revision"] != last["revision"]
            || current["snapshot"]["config"]["models"][0]["displayName"]
                != format!("演示最后保存-{round}")
        {
            return Err("旧操作覆盖了新操作");
        }
        println!(
            "{}",
            json!({"check":"merge-last-write-late-retry","round":round+1,"passed":true})
        );
    }
    let (_, before) = call(&client, token, "bootstrap", None).await?;
    let invalid = op(json!([{"type":"delete","target":{"entity":"model","id":"demo-model"}}]));
    let (s, _) = call(&client, token, "operations", Some(&invalid)).await?;
    let (_, after) = call(&client, token, "bootstrap", None).await?;
    if s != 409 || before != after {
        return Err("非法引用未原子拒绝");
    }
    for value in [Some("DEMO-ONLY-live-replaced"), None] {
        let change = if let Some(value) = value {
            json!({"type":"setSecret","providerId":"demo-provider","value":value})
        } else {
            json!({"type":"clearSecret","providerId":"demo-provider"})
        };
        accepted(&client, token, &op(json!([change]))).await?;
        let (_, boot) = call(&client, token, "bootstrap", None).await?;
        if boot["secrets"][0]["value"] != json!(value) {
            return Err("密钥替换清除失败");
        }
    }
    let denied = client
        .get(format!("{ORIGIN}/bootstrap"))
        .send()
        .await
        .map_err(|_| "鉴权检查失败")?;
    if denied.status() != 401 {
        return Err("未登录读取未拒绝");
    }
    println!(
        "{}",
        json!({"check":"live-dev-cloud-complete","passed":true,"roundsPerScenario":20,"accounts":1,"secondRealAccount":"pending","invalidReferenceAtomic":true,"secretReplaceClear":true,"unauthenticatedDenied":true})
    );
    Ok(())
}
