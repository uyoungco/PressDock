use super::{
    local::{self, SyncError, SyncResult},
    runtime::SettingsSync,
    *,
};
use crate::{
    ai::*,
    database::{Database, image_presets::ChannelImagePresets},
};
fn not_found() -> SyncError {
    SyncError::new("ENTITY_NOT_FOUND", false)
}
fn same_id(a: &str, b: &str) -> SyncResult<()> {
    if a != b {
        Err(SyncError::new("VALIDATION_FAILED", false))
    } else {
        Ok(())
    }
}
impl SettingsSync {
    pub async fn provider(
        &self,
        db: &Database,
        r: SaveProviderRequest,
        baseline: Option<Provider>,
    ) -> SyncResult<()> {
        r.validate()?;
        let _gate = self.gate.lock().await;
        let mut before = local::export(db).await?;
        if r.create_only && before.providers.iter().any(|p| p.id == r.id) {
            return Err(SyncError::new("DUPLICATE_ENTITY", false));
        }
        if let Some(base) = baseline {
            same_id(&base.id, &r.id)?;
            let old = before
                .providers
                .iter_mut()
                .find(|p| p.id == r.id)
                .ok_or_else(not_found)?;
            *old = base;
        }
        let mut after = before.clone();
        let p = Provider {
            id: r.id.clone(),
            display_name: r.display_name.trim().into(),
            base_url: r.base_url.trim_end_matches('/').into(),
            protocol: r.protocol,
            compatibility: r.compatibility,
        };
        if let Some(old) = after.providers.iter_mut().find(|p| p.id == r.id) {
            *old = p;
        } else {
            after.providers.push(p);
        }
        let mut changes = local::diff(&before, &after)?;
        if let Some(value) = r.api_key {
            changes.push(Change::SetSecret {
                provider_id: r.id,
                value,
            });
        }
        self.local.enqueue(db, changes, None).await?;
        self.changed().await;
        Ok(())
    }
    pub async fn clear_provider_secret(&self, db: &Database, id: String) -> SyncResult<()> {
        let _gate = self.gate.lock().await;
        self.local
            .enqueue(db, vec![Change::ClearSecret { provider_id: id }], None)
            .await?;
        self.changed().await;
        Ok(())
    }
    pub async fn model(
        &self,
        db: &Database,
        r: AiModelConfig,
        baseline: Option<AiModelConfig>,
    ) -> SyncResult<()> {
        r.validate()?;
        let _gate = self.gate.lock().await;
        let mut before = local::export(db).await?;
        if let Some(current) = before.models.iter().find(|m| m.id == r.id) {
            same_id(&current.provider_id, &r.provider_id)?;
        }
        if let Some(base) = baseline {
            same_id(&base.id, &r.id)?;
            let old = before
                .models
                .iter_mut()
                .find(|m| m.id == r.id)
                .ok_or_else(not_found)?;
            *old = base;
        }
        let mut after = before.clone();
        if let Some(old) = after.models.iter_mut().find(|m| m.id == r.id) {
            *old = r;
        } else {
            after.models.push(r);
        }
        self.local
            .enqueue(db, local::diff(&before, &after)?, None)
            .await?;
        self.changed().await;
        Ok(())
    }
    pub async fn template(
        &self,
        db: &Database,
        r: PromptTemplate,
        baseline: Option<PromptTemplate>,
    ) -> SyncResult<()> {
        r.validate()?;
        let _gate = self.gate.lock().await;
        let mut before = local::export(db).await?;
        let current = before.templates.iter().find(|t| t.id == r.id);
        if current.is_some_and(|t| t.purpose != r.purpose) {
            return Err(SyncError::new("VALIDATION_FAILED", false));
        }
        let was_default = match r.purpose {
            TemplatePurpose::Title => &before.defaults.title_template_id,
            TemplatePurpose::Pagination => &before.defaults.pagination_template_id,
            TemplatePurpose::BodyOrganization => &before.defaults.body_organization_template_id,
        }
        .as_deref()
            == Some(&r.id);
        let default_changed = baseline
            .as_ref()
            .map(|b| b.is_default != r.is_default)
            .unwrap_or(was_default != r.is_default);
        if let Some(base) = baseline {
            same_id(&base.id, &r.id)?;
            let old = before
                .templates
                .iter_mut()
                .find(|t| t.id == r.id)
                .ok_or_else(not_found)?;
            *old = Template {
                id: base.id,
                purpose: base.purpose,
                name: base.name,
                system_prompt: base.system_prompt,
                user_prompt: base.user_prompt,
                model_config_id: base.model_config_id,
                candidate_count: base.candidate_count,
                max_length: base.max_length,
                pagination_options: base.pagination_options,
            };
        }
        let mut after = before.clone();
        let id = r.id.clone();
        let purpose = r.purpose;
        let is_default = r.is_default;
        let t = Template {
            id: r.id,
            purpose: r.purpose,
            name: r.name.trim().into(),
            system_prompt: r.system_prompt,
            user_prompt: r.user_prompt,
            model_config_id: r.model_config_id,
            candidate_count: r.candidate_count,
            max_length: r.max_length,
            pagination_options: r.pagination_options,
        };
        if let Some(old) = after.templates.iter_mut().find(|t| t.id == id) {
            *old = t;
        } else {
            after.templates.push(t);
        }
        if default_changed {
            let default = match purpose {
                TemplatePurpose::Title => &mut after.defaults.title_template_id,
                TemplatePurpose::Pagination => &mut after.defaults.pagination_template_id,
                TemplatePurpose::BodyOrganization => {
                    &mut after.defaults.body_organization_template_id
                }
            };
            *default = if is_default { Some(id) } else { None };
        }
        self.local
            .enqueue(db, local::diff(&before, &after)?, None)
            .await?;
        self.changed().await;
        Ok(())
    }
    pub async fn remove(&self, db: &Database, kind: &str, id: &str) -> SyncResult<()> {
        let _gate = self.gate.lock().await;
        let before = local::export(db).await?;
        let mut after = before.clone();
        if matches!(kind, "provider" | "model") && db.harvest_model_in_use(kind, id).await? {
            return Err(SyncError::new("REFERENCE_NOT_FOUND", false));
        }
        match kind {
            "provider" => {
                after.providers.retain(|p| p.id != id);
                after.models.retain(|m| m.provider_id != id);
            }
            "model" => after.models.retain(|m| m.id != id),
            "template" => {
                after.templates.retain(|t| t.id != id);
                if after.defaults.title_template_id.as_deref() == Some(id) {
                    after.defaults.title_template_id = None;
                }
                if after.defaults.pagination_template_id.as_deref() == Some(id) {
                    after.defaults.pagination_template_id = None;
                }
                if after.defaults.body_organization_template_id.as_deref() == Some(id) {
                    after.defaults.body_organization_template_id = None;
                }
            }
            _ => return Err(SyncError::new("VALIDATION_FAILED", false)),
        }
        self.local
            .enqueue(db, local::diff(&before, &after)?, None)
            .await?;
        self.changed().await;
        Ok(())
    }
    pub async fn images(
        &self,
        db: &Database,
        r: ChannelImagePresets,
        baseline: Option<ChannelImagePresets>,
    ) -> SyncResult<ChannelImagePresets> {
        r.validate()?;
        let _gate = self.gate.lock().await;
        let mut before = local::export(db).await?;
        fn replace(config: &mut Config, r: &ChannelImagePresets) {
            config
                .image_presets
                .retain(|p| p.channel != r.channel || p.sub_channel != r.sub_channel);
            for (field, p) in [("titlePic", &r.title_pic), ("titlePic2", &r.title_pic2)] {
                if p.size.is_some() || p.max_bytes.is_some() || p.format.is_some() {
                    config.image_presets.push(ImagePreset {
                        channel: r.channel.clone(),
                        sub_channel: r.sub_channel.clone(),
                        field: field.into(),
                        size: p.size,
                        max_bytes: p.max_bytes.and_then(|v| u32::try_from(v).ok()),
                        format: p.format,
                    });
                }
            }
        }
        if let Some(base) = baseline {
            same_id(&base.channel, &r.channel)?;
            same_id(&base.sub_channel, &r.sub_channel)?;
            replace(&mut before, &base);
        }
        let mut after = before.clone();
        replace(&mut after, &r);
        self.local
            .enqueue(db, local::diff(&before, &after)?, None)
            .await?;
        self.changed().await;
        Ok(db
            .list_channel_image_presets()
            .await?
            .into_iter()
            .find(|p| p.channel == r.channel && p.sub_channel == r.sub_channel)
            .unwrap_or_else(|| ChannelImagePresets {
                channel: r.channel,
                sub_channel: r.sub_channel,
                title_pic: Default::default(),
                title_pic2: Default::default(),
            }))
    }
    pub async fn harvest(
        &self,
        db: &Database,
        r: crate::harvest::Settings,
        baseline: Option<crate::harvest::Settings>,
    ) -> SyncResult<()> {
        r.validate()?;
        let _gate = self.gate.lock().await;
        let mut before = local::export(db).await?;
        let rules = |s: &crate::harvest::Settings| HarvestRules {
            auto_classify: s.options.auto_classify,
            auto_tags: s.options.auto_tags,
            auto_summary: s.options.auto_summary,
            ai_auto_paginate: s.options.ai_auto_paginate,
            ai_organize_body: s.options.ai_organize_body,
            model_config_id: s.options.model_config_id.clone(),
        };
        if let Some(base) = baseline {
            before.harvest = rules(&base);
        }
        let mut after = before.clone();
        after.harvest = rules(&r);
        let changes = local::diff(&before, &after)?;
        // 即使只保存本机偏好，也合并当前有效的共享值，避免旧表单回写未编辑字段。
        let actual = local::export(db).await?;
        let snapshot = json!({"schemaVersion":2,"revision":1,"config":actual});
        let merged = if changes.is_empty() {
            snapshot
        } else {
            validate_operation(
                &json!({"schemaVersion":2,"operationId":uuid::Uuid::new_v4().to_string(),"deviceId":uuid::Uuid::new_v4().to_string(),"sequence":1,"changes":changes}),
                &snapshot,
                &[],
            )?
        };
        let mut local = r;
        let shared: HarvestRules = serde_json::from_value(merged["config"]["harvest"].clone())?;
        local.options.auto_classify = shared.auto_classify;
        local.options.auto_tags = shared.auto_tags;
        local.options.auto_summary = shared.auto_summary;
        local.options.ai_auto_paginate = shared.ai_auto_paginate;
        local.options.ai_organize_body = shared.ai_organize_body;
        local.options.model_config_id = shared.model_config_id;
        self.local.enqueue(db, changes, Some(&local)).await?;
        self.changed().await;
        Ok(())
    }
}
