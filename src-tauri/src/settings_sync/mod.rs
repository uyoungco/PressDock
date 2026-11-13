//! 全局配置协议 v1 与原生同步服务。秘密值不通过普通读取 IPC 返回。
pub mod admin;
mod edits;
#[cfg(all(test, target_os = "windows"))]
mod live_harvest_test;
#[cfg(all(test, target_os = "windows"))]
mod live_native_tests;
pub(crate) mod local;
#[cfg(test)]
mod local_tests;
pub(crate) mod runtime;
#[cfg(all(test, target_os = "windows"))]
mod windows_process_test;
use crate::ai::{AiModelConfig, PromptTemplate, SaveProviderRequest};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_CONFIG_BYTES: usize = 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub schema_version: u32,
    pub revision: u64,
    pub config: Config,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub providers: Vec<Provider>,
    pub models: Vec<AiModelConfig>,
    pub templates: Vec<Template>,
    pub image_presets: Vec<ImagePreset>,
    pub defaults: Defaults,
    pub harvest: HarvestRules,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub display_name: String,
    pub base_url: String,
    pub protocol: crate::ai::Protocol,
    pub compatibility: crate::ai::Compatibility,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Template {
    pub id: String,
    pub purpose: crate::ai::TemplatePurpose,
    pub name: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub model_config_id: Option<String>,
    pub candidate_count: u8,
    pub max_length: u16,
    pub pagination_options: Option<crate::ai::PaginationOptions>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImagePreset {
    pub channel: String,
    pub sub_channel: String,
    pub field: String,
    pub size: Option<crate::imaging::Size>,
    pub max_bytes: Option<u32>,
    pub format: Option<crate::imaging::Format>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Defaults {
    pub title_template_id: Option<String>,
    pub pagination_template_id: Option<String>,
    #[serde(default)]
    pub body_organization_template_id: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarvestRules {
    pub auto_classify: bool,
    pub auto_tags: bool,
    pub auto_summary: bool,
    pub ai_auto_paginate: bool,
    #[serde(default)]
    pub ai_organize_body: bool,
    pub model_config_id: Option<String>,
}
// 不派生 Debug：网络请求可能含 API 密钥，只允许固定错误码进入日志。
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    pub schema_version: u32,
    pub operation_id: String,
    pub device_id: String,
    pub sequence: u64,
    pub changes: Vec<Change>,
}
#[derive(Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Change {
    Create {
        entity: String,
        value: Value,
    },
    Set {
        target: Value,
        field: String,
        value: Value,
    },
    Delete {
        target: Value,
    },
    SetSecret {
        provider_id: String,
        value: String,
    },
    ClearSecret {
        provider_id: String,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecretValue {
    pub provider_id: String,
    pub value: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Initialize {
    pub schema_version: u32,
    pub operation_id: String,
    pub device_id: String,
    pub sequence: u64,
    pub config: Config,
    pub secrets: Vec<SecretValue>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bootstrap {
    pub snapshot: Snapshot,
    pub secrets: Vec<SecretValue>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub schema_version: u32,
    pub operation_id: String,
    pub device_id: String,
    pub sequence: u64,
    pub revision: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ProtocolError {
    pub code: &'static str,
}
type Result<T> = std::result::Result<T, ProtocolError>;
fn ensure(ok: bool, code: &'static str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(ProtocolError { code })
    }
}
fn valid(ok: bool) -> Result<()> {
    ensure(ok, "VALIDATION_FAILED")
}
fn keys(v: &Value, names: &[&str]) -> Result<()> {
    let o = v.as_object().ok_or(ProtocolError {
        code: "VALIDATION_FAILED",
    })?;
    valid(o.len() == names.len() && names.iter().all(|n| o.contains_key(*n)))
}
fn text(v: &Value, max: usize, empty: bool) -> Result<()> {
    valid(
        v.as_str()
            .is_some_and(|s| (empty || !s.trim().is_empty()) && s.chars().count() <= max),
    )
}
fn integer(v: &Value, min: u64, max: u64) -> Result<()> {
    valid(v.as_u64().is_some_and(|n| n >= min && n <= max))
}
fn version(v: &Value) -> Result<()> {
    ensure(v["schemaVersion"] == 2, "UNSUPPORTED_VERSION")
}
fn size(v: &Value) -> usize {
    serde_json::to_vec(v).map_or(usize::MAX, |s| s.len())
}
fn collection(entity: &str) -> Option<&'static str> {
    match entity {
        "provider" => Some("providers"),
        "model" => Some("models"),
        "template" => Some("templates"),
        "imagePreset" => Some("imagePresets"),
        _ => None,
    }
}
fn fields(entity: &str) -> &'static [&'static str] {
    match entity {
        "provider" => &[
            "displayName",
            "baseUrl",
            "protocol",
            "compatibility.maxTokensField",
            "compatibility.systemRole",
            "compatibility.sendStore",
        ],
        "model" => &[
            "modelId",
            "displayName",
            "contextWindow",
            "maxOutputTokens",
            "reasoningEffort",
        ],
        "template" => &[
            "name",
            "systemPrompt",
            "userPrompt",
            "modelConfigId",
            "candidateCount",
            "maxLength",
            "paginationOptions",
        ],
        "imagePreset" => &["size", "maxBytes", "format"],
        "defaults" => &[
            "titleTemplateId",
            "paginationTemplateId",
            "bodyOrganizationTemplateId",
        ],
        "harvest" => &[
            "autoClassify",
            "autoTags",
            "autoSummary",
            "aiAutoPaginate",
            "aiOrganizeBody",
            "modelConfigId",
        ],
        _ => &[],
    }
}
pub fn entity_key(entity: &str, v: &Value) -> String {
    if entity == "imagePreset" {
        json!([entity, v["channel"], v["subChannel"], v["field"]]).to_string()
    } else {
        json!([entity, v["id"]]).to_string()
    }
}
fn entity(entity: &str, v: &Value) -> Result<()> {
    match entity {
        "provider" => {
            keys(
                v,
                &["id", "displayName", "baseUrl", "protocol", "compatibility"],
            )?;
            keys(
                &v["compatibility"],
                &["maxTokensField", "systemRole", "sendStore"],
            )?;
            let mut request = v.clone();
            request["apiKey"] = Value::Null;
            let r: SaveProviderRequest =
                serde_json::from_value(request).map_err(|_| ProtocolError {
                    code: "VALIDATION_FAILED",
                })?;
            valid(r.validate().is_ok() && !r.base_url.contains(['?', '#']))
        }
        "model" => {
            keys(
                v,
                &[
                    "id",
                    "providerId",
                    "modelId",
                    "displayName",
                    "contextWindow",
                    "maxOutputTokens",
                    "reasoningEffort",
                ],
            )?;
            let r: AiModelConfig =
                serde_json::from_value(v.clone()).map_err(|_| ProtocolError {
                    code: "VALIDATION_FAILED",
                })?;
            valid(r.validate().is_ok())
        }
        "template" => {
            keys(
                v,
                &[
                    "id",
                    "purpose",
                    "name",
                    "systemPrompt",
                    "userPrompt",
                    "modelConfigId",
                    "candidateCount",
                    "maxLength",
                    "paginationOptions",
                ],
            )?;
            if !v["paginationOptions"].is_null() {
                keys(
                    &v["paginationOptions"],
                    &["minChars", "targetChars", "maxChars"],
                )?;
            }
            let mut value = v.clone();
            value["isDefault"] = json!(false);
            let r: PromptTemplate = serde_json::from_value(value).map_err(|_| ProtocolError {
                code: "VALIDATION_FAILED",
            })?;
            valid(
                r.validate().is_ok()
                    && r.pagination_options
                        .as_ref()
                        .is_none_or(|p| p.validate().is_ok()),
            )
        }
        "imagePreset" => {
            keys(
                v,
                &[
                    "channel",
                    "subChannel",
                    "field",
                    "size",
                    "maxBytes",
                    "format",
                ],
            )?;
            text(&v["channel"], 1024, false)?;
            text(&v["subChannel"], 1024, false)?;
            valid(matches!(
                v["field"].as_str(),
                Some("titlePic" | "titlePic2")
            ))?;
            valid(
                v["format"].is_null()
                    || matches!(v["format"].as_str(), Some("jpeg" | "png" | "webp")),
            )?;
            if !v["maxBytes"].is_null() {
                integer(&v["maxBytes"], 1, 20_971_520)?;
            }
            if !v["size"].is_null() {
                keys(&v["size"], &["width", "height"])?;
                let s: crate::imaging::Size =
                    serde_json::from_value(v["size"].clone()).map_err(|_| ProtocolError {
                        code: "VALIDATION_FAILED",
                    })?;
                valid(s.validate().is_ok())?;
            }
            Ok(())
        }
        _ => Err(ProtocolError {
            code: "UNKNOWN_FIELD",
        }),
    }
}
fn config(c: &Value) -> Result<()> {
    keys(
        c,
        &[
            "providers",
            "models",
            "templates",
            "imagePresets",
            "defaults",
            "harvest",
        ],
    )?;
    ensure(size(c) <= MAX_CONFIG_BYTES, "PAYLOAD_TOO_LARGE")?;
    for (kind, name, max) in [
        ("provider", "providers", 64),
        ("model", "models", 1024),
        ("template", "templates", 128),
        ("imagePreset", "imagePresets", 2048),
    ] {
        let list = c[name].as_array().ok_or(ProtocolError {
            code: "VALIDATION_FAILED",
        })?;
        valid(list.len() <= max)?;
        let mut seen = HashSet::new();
        for v in list {
            entity(kind, v)?;
            ensure(seen.insert(entity_key(kind, v)), "DUPLICATE_ENTITY")?;
        }
    }
    let providers: HashSet<_> = c["providers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].clone())
        .collect();
    let models: HashSet<_> = c["models"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].clone())
        .collect();
    let mut pairs = HashSet::new();
    for m in c["models"].as_array().unwrap() {
        ensure(providers.contains(&m["providerId"]), "REFERENCE_NOT_FOUND")?;
        ensure(
            pairs.insert(json!([m["providerId"], m["modelId"]]).to_string()),
            "DUPLICATE_ENTITY",
        )?;
    }
    for t in c["templates"].as_array().unwrap() {
        ensure(
            t["modelConfigId"].is_null() || models.contains(&t["modelConfigId"]),
            "REFERENCE_NOT_FOUND",
        )?;
    }
    keys(
        &c["defaults"],
        &[
            "titleTemplateId",
            "paginationTemplateId",
            "bodyOrganizationTemplateId",
        ],
    )?;
    for purpose in ["title", "pagination", "bodyOrganization"] {
        let id = &c["defaults"][format!("{purpose}TemplateId")];
        if !id.is_null() {
            text(id, 100, false)?;
        }
        ensure(
            id.is_null()
                || c["templates"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| &t["id"] == id && t["purpose"] == purpose),
            "REFERENCE_NOT_FOUND",
        )?;
    }
    let h = &c["harvest"];
    keys(
        h,
        &[
            "autoClassify",
            "autoTags",
            "autoSummary",
            "aiAutoPaginate",
            "aiOrganizeBody",
            "modelConfigId",
        ],
    )?;
    for k in [
        "autoClassify",
        "autoTags",
        "autoSummary",
        "aiAutoPaginate",
        "aiOrganizeBody",
    ] {
        valid(h[k].is_boolean())?;
    }
    if !h["modelConfigId"].is_null() {
        text(&h["modelConfigId"], 100, false)?;
        valid(h["modelConfigId"].as_str().unwrap().len() <= 100)?;
    }
    ensure(
        h["modelConfigId"].is_null() || models.contains(&h["modelConfigId"]),
        "REFERENCE_NOT_FOUND",
    )
}
pub fn validate_snapshot(v: &Value) -> Result<()> {
    keys(v, &["schemaVersion", "revision", "config"])?;
    version(v)?;
    integer(&v["revision"], 1, MAX_SAFE_INTEGER)?;
    config(&v["config"])
}
fn envelope(v: &Value) -> Result<()> {
    version(v)?;
    for k in ["operationId", "deviceId"] {
        let s = v[k].as_str().ok_or(ProtocolError {
            code: "VALIDATION_FAILED",
        })?;
        let uuid = uuid::Uuid::parse_str(s).map_err(|_| ProtocolError {
            code: "VALIDATION_FAILED",
        })?;
        valid(
            uuid.get_version_num() == 4
                && uuid.get_variant() == uuid::Variant::RFC4122
                && uuid.to_string() == s,
        )?;
    }
    integer(&v["sequence"], 1, MAX_SAFE_INTEGER)
}
fn secret(v: &Value) -> Result<()> {
    text(v, 8192, false)?;
    let s = v.as_str().unwrap();
    valid(s.len() <= 8192 && !s.chars().any(char::is_control))
}
fn secrets(v: &Value, c: &Value) -> Result<()> {
    let list = v.as_array().ok_or(ProtocolError {
        code: "VALIDATION_FAILED",
    })?;
    let ids: HashSet<_> = c["providers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].clone())
        .collect();
    let mut seen = HashSet::new();
    for s in list {
        keys(s, &["providerId", "value"])?;
        ensure(ids.contains(&s["providerId"]), "REFERENCE_NOT_FOUND")?;
        ensure(seen.insert(s["providerId"].clone()), "DUPLICATE_ENTITY")?;
        if !s["value"].is_null() {
            secret(&s["value"])?;
        }
    }
    valid(seen.len() == ids.len())
}
fn target(v: &Value) -> Result<&str> {
    let kind = v["entity"].as_str().ok_or(ProtocolError {
        code: "UNKNOWN_FIELD",
    })?;
    ensure(!fields(kind).is_empty(), "UNKNOWN_FIELD")?;
    if kind == "imagePreset" {
        keys(v, &["entity", "channel", "subChannel", "field"])?;
        text(&v["channel"], 1024, false)?;
        text(&v["subChannel"], 1024, false)?;
        valid(matches!(
            v["field"].as_str(),
            Some("titlePic" | "titlePic2")
        ))?;
    } else if kind == "defaults" || kind == "harvest" {
        keys(v, &["entity"])?;
    } else {
        keys(v, &["entity", "id"])?;
        text(&v["id"], if kind == "provider" { 64 } else { 100 }, false)?;
    }
    Ok(kind)
}
fn touch(touched: &mut HashMap<String, Vec<String>>, key: String, field: &str) -> Result<()> {
    let old = touched.entry(key).or_default();
    ensure(
        !old.iter().any(|s| s == field || s == "*") && (field != "*" || old.is_empty()),
        "DUPLICATE_CHANGE",
    )?;
    old.push(field.to_owned());
    Ok(())
}
pub fn validate_operation(v: &Value, current: &Value, deleted_keys: &[String]) -> Result<Value> {
    validate_snapshot(current)?;
    keys(
        v,
        &[
            "schemaVersion",
            "operationId",
            "deviceId",
            "sequence",
            "changes",
        ],
    )?;
    envelope(v)?;
    let changes = v["changes"].as_array().ok_or(ProtocolError {
        code: "VALIDATION_FAILED",
    })?;
    valid(!changes.is_empty() && changes.len() <= 128)?;
    let mut next = current.clone();
    let c = &mut next["config"];
    let mut touched = HashMap::new();
    let mut secret_ids = HashSet::new();
    for change in changes {
        match change["type"].as_str() {
            Some("setSecret" | "clearSecret") => {
                let set = change["type"] == "setSecret";
                keys(
                    change,
                    if set {
                        &["type", "providerId", "value"]
                    } else {
                        &["type", "providerId"]
                    },
                )?;
                text(&change["providerId"], 64, false)?;
                ensure(
                    secret_ids.insert(change["providerId"].clone()),
                    "DUPLICATE_CHANGE",
                )?;
                if set {
                    secret(&change["value"])?;
                }
            }
            Some("create") => {
                keys(change, &["type", "entity", "value"])?;
                let kind = change["entity"].as_str().ok_or(ProtocolError {
                    code: "UNKNOWN_FIELD",
                })?;
                let name = collection(kind).ok_or(ProtocolError {
                    code: "UNKNOWN_FIELD",
                })?;
                entity(kind, &change["value"])?;
                let key = entity_key(kind, &change["value"]);
                touch(&mut touched, key.clone(), "*")?;
                ensure(!deleted_keys.contains(&key), "ENTITY_DELETED")?;
                let list = c[name].as_array_mut().unwrap();
                ensure(
                    !list.iter().any(|x| entity_key(kind, x) == key),
                    "DUPLICATE_ENTITY",
                )?;
                list.push(change["value"].clone());
            }
            Some("set" | "delete") => {
                let set = change["type"] == "set";
                keys(
                    change,
                    if set {
                        &["type", "target", "field", "value"]
                    } else {
                        &["type", "target"]
                    },
                )?;
                let t = &change["target"];
                let kind = target(t)?;
                let singleton = kind == "defaults" || kind == "harvest";
                let key = if singleton {
                    kind.to_owned()
                } else {
                    entity_key(kind, t)
                };
                let field = if set {
                    change["field"].as_str().ok_or(ProtocolError {
                        code: "UNKNOWN_FIELD",
                    })?
                } else {
                    "*"
                };
                ensure(
                    if set {
                        fields(kind).contains(&field)
                    } else {
                        !singleton
                    },
                    "UNKNOWN_FIELD",
                )?;
                touch(&mut touched, key.clone(), field)?;
                let row = if singleton {
                    &mut c[kind]
                } else {
                    let list = c[collection(kind).unwrap()].as_array_mut().unwrap();
                    let index = list.iter().position(|x| entity_key(kind, x) == key).ok_or(
                        ProtocolError {
                            code: "ENTITY_NOT_FOUND",
                        },
                    )?;
                    if !set {
                        list.remove(index);
                        continue;
                    }
                    &mut list[index]
                };
                if let Some((parent, child)) = field.split_once('.') {
                    row[parent][child] = change["value"].clone();
                } else {
                    row[field] = change["value"].clone();
                }
            }
            _ => {
                return Err(ProtocolError {
                    code: "UNKNOWN_FIELD",
                });
            }
        }
    }
    config(c)?;
    for id in secret_ids {
        ensure(
            c["providers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["id"] == id),
            "REFERENCE_NOT_FOUND",
        )?;
    }
    let revision = next["revision"].as_u64().unwrap() + 1;
    integer(&json!(revision), 1, MAX_SAFE_INTEGER)?;
    next["revision"] = json!(revision);
    Ok(next)
}
fn normalize(v: &mut Value) {
    match v {
        Value::Number(n) => {
            if let Some(x) = n.as_f64()
                && x >= 0.0
                && x <= MAX_SAFE_INTEGER as f64
                && x.fract() == 0.0
            {
                *v = json!(x as u64);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(normalize),
        Value::Object(o) => o.values_mut().for_each(normalize),
        _ => (),
    }
}
fn depth(v: &Value, level: u32) -> Result<()> {
    ensure(level <= 32, "INVALID_DOCUMENT")?;
    match v {
        Value::Array(a) => {
            for v in a {
                depth(v, level + 1)?;
            }
        }
        Value::Object(o) => {
            for v in o.values() {
                depth(v, level + 1)?;
            }
        }
        _ => (),
    }
    Ok(())
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    Snapshot,
    Operation,
    Initialize,
    Bootstrap,
    Receipt,
}
pub fn validate_document(
    raw: &[u8],
    kind: DocumentKind,
    current: Option<&Value>,
    deleted_keys: &[String],
) -> Result<Value> {
    ensure(raw.len() <= MAX_DOCUMENT_BYTES, "PAYLOAD_TOO_LARGE")?;
    let mut v: Value = serde_json::from_slice(raw).map_err(|_| ProtocolError {
        code: "INVALID_DOCUMENT",
    })?;
    depth(&v, 0)?;
    normalize(&mut v);
    match kind {
        DocumentKind::Receipt => {
            keys(
                &v,
                &[
                    "schemaVersion",
                    "operationId",
                    "deviceId",
                    "sequence",
                    "revision",
                ],
            )?;
            envelope(&v)?;
            integer(&v["revision"], 1, MAX_SAFE_INTEGER)?;
        }
        DocumentKind::Snapshot => validate_snapshot(&v)?,
        DocumentKind::Operation => {
            return validate_operation(
                &v,
                current.ok_or(ProtocolError {
                    code: "INVALID_DOCUMENT",
                })?,
                deleted_keys,
            );
        }
        DocumentKind::Initialize => {
            keys(
                &v,
                &[
                    "schemaVersion",
                    "operationId",
                    "deviceId",
                    "sequence",
                    "config",
                    "secrets",
                ],
            )?;
            envelope(&v)?;
            config(&v["config"])?;
            secrets(&v["secrets"], &v["config"])?;
        }
        DocumentKind::Bootstrap => {
            keys(&v, &["snapshot", "secrets"])?;
            validate_snapshot(&v["snapshot"])?;
            secrets(&v["secrets"], &v["snapshot"]["config"])?;
        }
    }
    Ok(v)
}

#[cfg(test)]
mod tests;
