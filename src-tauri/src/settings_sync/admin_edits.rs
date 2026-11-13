//! 仅对独立开发环境的临时演示实体验收，不调用 AI 或 CMS 写接口。
use super::*;
use crate::ai::{AiService, PromptTemplate, SaveProviderRequest, TemplatePurpose};
use crate::database::image_presets::ChannelImagePresets;

async fn drain(sync: &SettingsSync, db: &Database, cms: &CmsService) -> SyncResult<()> {
    while sync.status(db).await?.pending > 0 {
        if !sync.upload_one(db, cms).await? {
            return Err(SyncError::new("PROBE_UPLOAD_FAILED", false));
        }
    }
    Ok(())
}

pub(super) async fn run(
    sync: &SettingsSync,
    db: &Database,
    cms: &CmsService,
    _ai: &AiService,
) -> SyncResult<()> {
    let before = local::export(db).await?;
    if before.models.first().is_none_or(|m| m.id != "demo-model") {
        return Err(SyncError::new("PROBE_NOT_DEMO", false));
    }
    let suffix = uuid::Uuid::new_v4().to_string();
    let provider_id = format!("demo-native-{suffix}");
    let provider = |name: &str, key: Option<&str>, create_only: bool| SaveProviderRequest {
        id: provider_id.clone(),
        display_name: name.into(),
        base_url: "https://demo-native.invalid/v1".into(),
        protocol: crate::ai::Protocol::ChatCompletions,
        compatibility: crate::ai::Compatibility::default(),
        api_key: key.map(str::to_string),
        create_only,
    };
    sync.provider(
        db,
        provider(
            "【演示数据】新增提供商",
            Some("DEMO-ONLY-native-created"),
            true,
        ),
        None,
    )
    .await?;
    drain(sync, db, cms).await?;
    sync.provider(
        db,
        provider(
            "【演示数据】修改提供商",
            Some("DEMO-ONLY-native-replaced"),
            false,
        ),
        None,
    )
    .await?;
    drain(sync, db, cms).await?;
    sync.clear_provider_secret(db, provider_id.clone()).await?;
    drain(sync, db, cms).await?;
    let mut model = before.models[0].clone();
    model.id = suffix.clone();
    model.provider_id = provider_id.clone();
    model.model_id = "DEMO-ONLY-native-model".into();
    sync.model(db, model.clone(), None).await?;
    drain(sync, db, cms).await?;
    let baseline = model.clone();
    model.display_name = "【演示数据】修改模型".into();
    sync.model(db, model, Some(baseline)).await?;
    drain(sync, db, cms).await?;
    let settings = db.ai_settings().await?;
    let default = settings
        .templates
        .iter()
        .find(|t| t.purpose == crate::ai::TemplatePurpose::Title && t.is_default)
        .cloned();
    let mut template: PromptTemplate = settings
        .templates
        .into_iter()
        .find(|t| t.purpose == crate::ai::TemplatePurpose::Title)
        .ok_or(SyncError::new("PROBE_NO_TEMPLATE", false))?;
    template.id = uuid::Uuid::new_v4().to_string();
    template.name = "【演示数据】新增模板".into();
    template.model_config_id = Some(suffix.clone());
    template.is_default = false;
    sync.template(db, template.clone(), None).await?;
    drain(sync, db, cms).await?;
    let baseline = template.clone();
    template.name = "【演示数据】修改模板".into();
    template.is_default = true;
    sync.template(db, template.clone(), Some(baseline)).await?;
    drain(sync, db, cms).await?;
    if let Some(mut original) = default {
        original.is_default = true;
        sync.template(db, original, None).await?;
        drain(sync, db, cms).await?;
    } else {
        template.is_default = false;
        sync.template(db, template.clone(), None).await?;
        drain(sync, db, cms).await?;
    }
    let image = |pic: Value| -> SyncResult<ChannelImagePresets> {
        Ok(serde_json::from_value(
            json!({"channel":"【演示数据】原生同步","subChannel":suffix,"titlePic":pic,"titlePic2":{}}),
        )?)
    };
    let first = image(json!({"size":{"width":160,"height":100},"format":"png"}))?;
    sync.images(db, first.clone(), None).await?;
    drain(sync, db, cms).await?;
    sync.images(
        db,
        image(json!({"size":{"width":200,"height":100},"format":"jpeg","maxBytes":204800}))?,
        Some(first),
    )
    .await?;
    drain(sync, db, cms).await?;
    sync.images(db, image(json!({}))?, None).await?;
    drain(sync, db, cms).await?;
    let harvest = db.harvest_settings().await?;
    let original_body = db
        .ai_settings()
        .await?
        .templates
        .into_iter()
        .find(|t| t.purpose == TemplatePurpose::BodyOrganization && t.is_default);
    let mut body = db
        .ai_settings()
        .await?
        .templates
        .into_iter()
        .find(|t| t.purpose == TemplatePurpose::BodyOrganization)
        .ok_or(SyncError::new("PROBE_NO_BODY_TEMPLATE", false))?;
    body.id = uuid::Uuid::new_v4().to_string();
    body.name = "【演示数据】正文整理同步".into();
    body.model_config_id = Some(suffix.clone());
    body.is_default = true;
    sync.template(db, body.clone(), None).await?;
    drain(sync, db, cms).await?;
    let mut organized = harvest.clone();
    organized.options.ai_organize_body = !harvest.options.ai_organize_body;
    sync.harvest(db, organized.clone(), Some(harvest.clone()))
        .await?;
    drain(sync, db, cms).await?;
    let (_, token) = cms
        .settings_authorization()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
    let raw = sync.request(&token, "bootstrap", None).await?;
    validate_document(&raw, DocumentKind::Bootstrap, None, &[])?;
    let downloaded: Bootstrap = serde_json::from_slice(&raw)?;
    if downloaded.snapshot.config.harvest.ai_organize_body != organized.options.ai_organize_body
        || downloaded
            .snapshot
            .config
            .defaults
            .body_organization_template_id
            .as_deref()
            != Some(body.id.as_str())
        || !downloaded
            .snapshot
            .config
            .templates
            .iter()
            .any(|t| t.id == body.id && t.purpose == TemplatePurpose::BodyOrganization)
    {
        return Err(SyncError::new("PROBE_BODY_READBACK_FAILED", false));
    }
    sync.harvest(db, harvest.clone(), None).await?;
    drain(sync, db, cms).await?;
    if let Some(original) = original_body {
        sync.template(db, original, None).await?;
        drain(sync, db, cms).await?;
    }
    sync.remove(db, "template", &body.id).await?;
    drain(sync, db, cms).await?;
    let mut changed = harvest.clone();
    changed.options.auto_summary = !harvest.options.auto_summary;
    changed.options.model_config_id = Some(suffix.clone());
    sync.harvest(db, changed, Some(harvest.clone())).await?;
    drain(sync, db, cms).await?;
    sync.harvest(db, harvest.clone(), None).await?;
    drain(sync, db, cms).await?;
    let writes = sync.status(db).await?.write_requests;
    let mut local = harvest.clone();
    local.retention_days = Some(17);
    local.options.developer_mode = !local.options.developer_mode;
    local.options.cdp_address = Some("demo-native-profile".into());
    sync.harvest(db, local, Some(harvest.clone())).await?;
    sync.harvest(db, harvest, None).await?;
    if sync.status(db).await?.write_requests != writes || sync.status(db).await?.pending != 0 {
        return Err(SyncError::new("PROBE_LOCAL_WAS_UPLOADED", false));
    }
    for (kind, id) in [
        ("template", template.id.as_str()),
        ("model", suffix.as_str()),
        ("provider", provider_id.as_str()),
    ] {
        sync.remove(db, kind, id).await?;
        drain(sync, db, cms).await?;
    }
    if serde_json::to_value(local::export(db).await?)? != serde_json::to_value(&before)? {
        return Err(SyncError::new("PROBE_RESTORE_FAILED", false));
    }
    let (_, token) = cms
        .settings_authorization()
        .await
        .map_err(|_| SyncError::new("AUTH_EXPIRED", false))?;
    let cloud: Bootstrap = serde_json::from_slice(&sync.request(&token, "bootstrap", None).await?)?;
    if serde_json::to_value(cloud.snapshot.config)? != serde_json::to_value(before)? {
        return Err(SyncError::new("PROBE_CLOUD_MISMATCH", false));
    }
    println!(
        "{}",
        json!({"check":"windows-native-all-shared-edits-dev","passed":true,"providerModelTemplatePresetCrud":true,"defaultTemplateChangedAndRestored":true,"bodyOrganizationReadbackAndRestore":true,"secretCreatedReplacedCleared":true,"harvestRulesChangedAndRestored":true,"localPreferencesUploads":0,"allOriginalDemoSettingsRestored":true,"aiRequests":0,"cmsWrites":0})
    );
    Ok(())
}
