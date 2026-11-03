use crate::{
    cms::{CmsError, CmsService},
    database::Database,
    error::CommandError,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Default)]
pub struct DraftGate(pub tokio::sync::Mutex<()>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelDraft {
    pub base: Option<crate::cms::PromoteRecord>,
    pub input: serde_json::Value,
}

#[tauri::command]
pub async fn channel_draft_load(
    cms: State<'_, CmsService>,
    db: State<'_, Database>,
    gate: State<'_, DraftGate>,
) -> Result<Option<ChannelDraft>, CommandError> {
    let _guard = gate.0.lock().await;
    let user = cms.draft_user().await?;
    let payload: Option<String> =
        sqlx::query_scalar("SELECT payload FROM channel_edit_drafts WHERE user_id=?")
            .bind(user)
            .fetch_optional(&db.pool)
            .await
            .map_err(storage)?;
    payload
        .map(|v| serde_json::from_str(&v).map_err(|_| storage(())))
        .transpose()
}

#[tauri::command]
pub async fn channel_draft_save(
    expected_user: i64,
    draft: ChannelDraft,
    cms: State<'_, CmsService>,
    db: State<'_, Database>,
    gate: State<'_, DraftGate>,
) -> Result<(), CommandError> {
    let _guard = gate.0.lock().await;
    let user = cms.draft_user().await?;
    if user != expected_user {
        return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化，草稿未写入").into());
    }
    // 草稿允许必填字段暂时为空，但仍限制结构、字段类型与总大小。
    let object = draft.input.as_object().ok_or_else(|| storage(()))?;
    let fields = [
        "channel",
        "subChannel",
        "publishDate",
        "url",
        "title",
        "titlePic",
        "titlePic2",
        "smallText",
        "writer",
    ];
    if object.len() != fields.len()
        || fields
            .iter()
            .any(|k| !object.get(*k).is_some_and(|v| v.is_null() || v.is_string()))
        || ["channel", "title", "titlePic"]
            .iter()
            .any(|k| !object[*k].is_string())
    {
        return Err(CmsError::new("VALIDATION", "素材草稿格式无效").into());
    }
    let payload = serde_json::to_string(&draft).map_err(storage)?;
    if payload.len() > 256 * 1024 {
        return Err(CmsError::new("VALIDATION", "素材草稿超过大小限制").into());
    }
    sqlx::query("INSERT INTO channel_edit_drafts(user_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
        .bind(user).bind(payload).bind(chrono::Utc::now().to_rfc3339()).execute(&db.pool).await.map_err(storage)?;
    Ok(())
}

#[tauri::command]
pub async fn channel_draft_clear(
    expected_user: i64,
    cms: State<'_, CmsService>,
    db: State<'_, Database>,
    gate: State<'_, DraftGate>,
) -> Result<(), CommandError> {
    let _guard = gate.0.lock().await;
    let user = cms.draft_user().await?;
    if user != expected_user {
        return Err(CmsError::new("SESSION_CHANGED", "登录状态已变化，草稿未写入").into());
    }
    sqlx::query("DELETE FROM channel_edit_drafts WHERE user_id=?")
        .bind(user)
        .execute(&db.pool)
        .await
        .map_err(storage)?;
    Ok(())
}

fn storage(_: impl std::fmt::Debug) -> CommandError {
    CmsError::new("DRAFT_STORAGE", "本机草稿读写失败，请检查可用空间后重试").into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri::Manager;

    fn draft() -> ChannelDraft {
        ChannelDraft {
            base: None,
            input: json!({"channel":"演示渠道","subChannel":null,"publishDate":"","url":"","title":"尚未提交的测试草稿","titlePic":"","titlePic2":null,"smallText":"本机测试正文","writer":""}),
        }
    }

    #[tokio::test]
    async fn drafts_survive_reopen_reject_other_owners_and_clear_on_logout() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("draft.db");
        let db = Database::open(&path)
            .await
            .unwrap_or_else(|_| panic!("草稿测试操作失败"));
        let (cms, _server) = crate::cms::ipc_service().await;
        let app = tauri::test::mock_builder()
            .manage(cms)
            .manage(db.clone())
            .manage(DraftGate::default())
            .manage(crate::harvest::HarvestService::new(None))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        assert!(
            channel_draft_save(7, draft(), app.state(), app.state(), app.state())
                .await
                .is_err()
        );
        let mut malformed = draft();
        malformed.input["title"] = json!(null);
        assert!(
            channel_draft_save(6, malformed, app.state(), app.state(), app.state())
                .await
                .is_err()
        );
        channel_draft_save(6, draft(), app.state(), app.state(), app.state())
            .await
            .unwrap_or_else(|_| panic!("草稿测试操作失败"));
        db.pool.close().await;
        let reopened = Database::open(&path)
            .await
            .unwrap_or_else(|_| panic!("草稿测试操作失败"));
        drop(app);
        let (cms, _server2) = crate::cms::ipc_service().await;
        let app = tauri::test::mock_builder()
            .manage(cms)
            .manage(reopened.clone())
            .manage(DraftGate::default())
            .manage(crate::harvest::HarvestService::new(None))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let loaded = channel_draft_load(app.state(), app.state(), app.state())
            .await
            .unwrap_or_else(|_| panic!("草稿测试操作失败"))
            .unwrap();
        assert_eq!(loaded.input["title"], draft().input["title"]);
        assert!(
            channel_draft_clear(7, app.state(), app.state(), app.state())
                .await
                .is_err()
        );
        super::super::cms_logout(app.state(), app.state(), app.state(), app.state())
            .await
            .unwrap_or_else(|_| panic!("草稿测试操作失败"));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channel_edit_drafts")
            .fetch_one(&reopened.pool)
            .await
            .unwrap_or_else(|_| panic!("草稿测试操作失败"));
        assert_eq!(count, 0);
        assert!(
            channel_draft_save(6, draft(), app.state(), app.state(), app.state())
                .await
                .is_err()
        );
        reopened.pool.close().await;
    }
}
