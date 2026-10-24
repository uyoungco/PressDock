use super::Database;
use crate::{
    error::AppError,
    imaging::{Format, MAX_BYTES, Size},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImagePreset {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<Size>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<Format>,
}

impl ImagePreset {
    fn validate(&self) -> Result<(), AppError> {
        if let Some(size) = self.size {
            size.validate()
                .map_err(|e| AppError::Validation(e.message))?;
        }
        if self
            .max_bytes
            .is_some_and(|bytes| bytes == 0 || bytes > MAX_BYTES)
        {
            return Err(AppError::Validation(
                "图片体积上限需大于零且不超过 20480 KiB".into(),
            ));
        }
        Ok(())
    }

    fn is_empty(&self) -> bool {
        self.size.is_none() && self.max_bytes.is_none() && self.format.is_none()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelImagePresets {
    pub channel: String,
    pub sub_channel: String,
    pub title_pic: ImagePreset,
    pub title_pic2: ImagePreset,
}

impl ChannelImagePresets {
    fn validate(&self) -> Result<(), AppError> {
        if self.channel.trim().is_empty() || self.sub_channel.trim().is_empty() {
            return Err(AppError::Validation("请选择渠道和子渠道".into()));
        }
        self.title_pic.validate()?;
        self.title_pic2.validate()
    }
}

impl Database {
    pub async fn list_channel_image_presets(&self) -> Result<Vec<ChannelImagePresets>, AppError> {
        let rows = sqlx::query("SELECT channel,sub_channel,field,preset FROM channel_image_presets ORDER BY channel,sub_channel,field")
            .fetch_all(&self.pool).await?;
        let mut groups = BTreeMap::new();
        for row in rows {
            let channel: String = row.try_get("channel")?;
            let sub_channel: String = row.try_get("sub_channel")?;
            let field: String = row.try_get("field")?;
            let preset: ImagePreset = serde_json::from_str(row.try_get("preset")?)?;
            preset.validate()?;
            let group = groups
                .entry((channel.clone(), sub_channel.clone()))
                .or_insert_with(|| ChannelImagePresets {
                    channel,
                    sub_channel,
                    title_pic: ImagePreset::default(),
                    title_pic2: ImagePreset::default(),
                });
            match field.as_str() {
                "titlePic" => group.title_pic = preset,
                "titlePic2" => group.title_pic2 = preset,
                _ => return Err(AppError::Validation("图片预设字段无效".into())),
            }
        }
        Ok(groups.into_values().collect())
    }

    pub async fn save_channel_image_presets(
        &self,
        request: ChannelImagePresets,
    ) -> Result<ChannelImagePresets, AppError> {
        request.validate()?;
        let mut tx = self.pool.begin().await?;
        for (field, preset) in [
            ("titlePic", &request.title_pic),
            ("titlePic2", &request.title_pic2),
        ] {
            if preset.is_empty() {
                sqlx::query("DELETE FROM channel_image_presets WHERE channel=? AND sub_channel=? AND field=?")
                    .bind(&request.channel).bind(&request.sub_channel).bind(field).execute(&mut *tx).await?;
            } else {
                sqlx::query("INSERT INTO channel_image_presets(channel,sub_channel,field,preset) VALUES(?,?,?,?) ON CONFLICT(channel,sub_channel,field) DO UPDATE SET preset=excluded.preset")
                    .bind(&request.channel).bind(&request.sub_channel).bind(field).bind(serde_json::to_string(preset)?).execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
        Ok(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(channel: &str) -> ChannelImagePresets {
        ChannelImagePresets {
            channel: channel.into(),
            sub_channel: "轮播图".into(),
            title_pic: ImagePreset {
                size: Some(Size {
                    width: 280,
                    height: 124,
                }),
                max_bytes: Some(100 * 1024),
                format: Some(Format::Jpeg),
            },
            title_pic2: ImagePreset {
                format: Some(Format::Webp),
                ..Default::default()
            },
        }
    }

    #[tokio::test]
    async fn presets_survive_reopen_and_are_independent() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("presets.db");
        let db = Database::open(&path).await?;
        assert!(db.list_channel_image_presets().await?.is_empty());
        db.save_channel_image_presets(config("A")).await?;
        db.save_channel_image_presets(config("B")).await?;
        let mut a = config("A");
        a.title_pic = ImagePreset::default();
        db.save_channel_image_presets(a.clone()).await?;
        db.pool.close().await;
        let reopened = Database::open(&path).await?;
        let presets = reopened.list_channel_image_presets().await?;
        assert_eq!(presets.len(), 2);
        assert!(presets[0].title_pic.is_empty());
        assert_eq!(presets[0].title_pic2.format, Some(Format::Webp));
        assert_eq!(presets[1].title_pic.size.unwrap().width, 280);
        a.title_pic2 = ImagePreset::default();
        reopened.save_channel_image_presets(a).await?;
        assert_eq!(reopened.list_channel_image_presets().await?.len(), 1);
        reopened.pool.close().await;
        Ok(())
    }

    #[tokio::test]
    async fn saving_both_fields_rolls_back_on_storage_failure()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let db = Database::open(&directory.path().join("presets.db")).await?;
        db.save_channel_image_presets(config("A")).await?;
        sqlx::query("CREATE TRIGGER reject_second_preset BEFORE INSERT ON channel_image_presets WHEN NEW.field='titlePic2' BEGIN SELECT RAISE(ABORT, 'test storage failure'); END")
            .execute(&db.pool).await?;
        let mut updated = config("A");
        updated.title_pic.max_bytes = Some(2048);
        assert!(db.save_channel_image_presets(updated).await.is_err());
        assert_eq!(
            db.list_channel_image_presets().await?[0]
                .title_pic
                .max_bytes,
            Some(100 * 1024)
        );
        db.pool.close().await;
        Ok(())
    }

    #[tokio::test]
    async fn invalid_presets_do_not_partially_write() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let db = Database::open(&directory.path().join("presets.db")).await?;
        db.save_channel_image_presets(config("A")).await?;
        for (width, height, max_bytes) in [
            (0, 10, 10),
            (16_385, 10, 10),
            (5000, 5000, 10),
            (280, 124, 0),
            (280, 124, MAX_BYTES + 1),
        ] {
            let mut invalid = config("A");
            invalid.title_pic = ImagePreset::default();
            invalid.title_pic2.size = Some(Size { width, height });
            invalid.title_pic2.max_bytes = Some(max_bytes);
            assert!(db.save_channel_image_presets(invalid).await.is_err());
            assert_eq!(
                db.list_channel_image_presets().await?[0]
                    .title_pic
                    .max_bytes,
                Some(100 * 1024)
            );
        }
        let mut invalid = config(" ");
        assert!(
            db.save_channel_image_presets(invalid.clone())
                .await
                .is_err()
        );
        invalid.channel = "A".into();
        invalid.sub_channel.clear();
        assert!(db.save_channel_image_presets(invalid).await.is_err());
        assert!(serde_json::from_str::<ImagePreset>(r#"{"format":"gif"}"#).is_err());
        assert!(serde_json::from_str::<ImagePreset>(r#"{"size":{"width":100}}"#).is_err());
        db.pool.close().await;
        Ok(())
    }
}
