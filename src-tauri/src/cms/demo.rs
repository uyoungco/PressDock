//! 独立演示包的本机数据源；不创建网络请求，也不读取真实凭据。
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sqlx::SqlitePool;
use std::io::Cursor;
use tokio::sync::{Mutex, MutexGuard};

pub const USER_ID: i64 = 900001;
const IMAGE_PREFIX: &str = "https://pressdock-demo.invalid/images/";

#[derive(Default)]
struct Session {
    signed_in: bool,
    generation: u64,
}

pub struct DemoCms {
    pool: SqlitePool,
    session: Mutex<Session>,
}

fn storage(_: impl std::fmt::Debug) -> CmsError {
    CmsError::new("DEMO_STORAGE", "演示数据读写失败，请检查本机空间")
}
fn invalid(message: &str) -> CmsError {
    CmsError::new("VALIDATION", message)
}
fn session() -> AuthSession {
    AuthSession {
        user: CmsUser {
            user_id: USER_ID,
            nickname: "演示账号".into(),
            roles: vec!["demo".into()],
            perms: vec![],
        },
        persistent: true,
    }
}
fn record(id: i64, input: PromoteInput, position: i64) -> Result<PromoteRecord, CmsError> {
    let mut value = serde_json::to_value(input).map_err(storage)?;
    value["id"] = id.into();
    value["order"] = position.into();
    value["createdAt"] = "2026-11-03T09:00:00Z".into();
    value["updatedAt"] = chrono::Utc::now().to_rfc3339().into();
    let title = value["title"].as_str().unwrap_or_default();
    if !title.starts_with("[演示]") {
        value["title"] = format!("[演示] {title}").into();
    }
    serde_json::from_value(value).map_err(storage)
}

impl DemoCms {
    pub async fn new(pool: SqlitePool) -> Result<Self, sqlx::Error> {
        let mut tx = pool.begin().await?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS demo_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS demo_promote (id INTEGER PRIMARY KEY,payload TEXT NOT NULL,position INTEGER NOT NULL)").execute(&mut *tx).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS demo_images (url TEXT PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL)").execute(&mut *tx).await?;
        let initialized: Option<String> =
            sqlx::query_scalar("SELECT value FROM demo_meta WHERE key='seeded'")
                .fetch_optional(&mut *tx)
                .await?;
        if initialized.is_none() {
            for (index, (width, height)) in [(280, 124), (560, 248)].into_iter().enumerate() {
                let image = image::RgbImage::from_fn(width, height, |x, y| {
                    image::Rgb([
                        40 + (x * 100 / width) as u8,
                        80 + (y * 90 / height) as u8,
                        160,
                    ])
                });
                let mut bytes = Cursor::new(Vec::new());
                image
                    .write_to(&mut bytes, image::ImageFormat::Png)
                    .map_err(|_| sqlx::Error::Protocol("演示图片生成失败".into()))?;
                sqlx::query("INSERT INTO demo_images VALUES (?,?,?)")
                    .bind(format!("{IMAGE_PREFIX}seed-{index}.png"))
                    .bind("image/png")
                    .bind(bytes.into_inner())
                    .execute(&mut *tx)
                    .await?;
            }
            for index in 0..80_i64 {
                let input = PromoteInput {
                    channel: format!("演示渠道 {}", if index < 40 { "A" } else { "B" }),
                    sub_channel: Some(if index % 40 < 20 { "演示轮播图" } else { "演示信息流" }.into()),
                    publish_date: Some(if index % 2 == 0 { "2026-11-03" } else { "2026-11-02" }.into()),
                    url: None,
                    title: format!("[演示] 移动素材样例 {:02}", index + 1),
                    title_pic: format!("{IMAGE_PREFIX}seed-0.png"),
                    title_pic2: Some(format!("{IMAGE_PREFIX}seed-1.png")),
                    small_text: Some("这是本机 Mock 素材，用于检查筛选、分页、详情、编辑和返回恢复。所有修改仅保存到演示版数据库。".into()),
                    writer: Some("演示作者".into()),
                };
                let row = record(USER_ID + index, input, index)
                    .map_err(|_| sqlx::Error::Protocol("演示数据生成失败".into()))?;
                let payload = serde_json::to_string(&row)
                    .map_err(|_| sqlx::Error::Protocol("演示数据生成失败".into()))?;
                sqlx::query("INSERT INTO demo_promote VALUES (?,?,?)")
                    .bind(row.id)
                    .bind(payload)
                    .bind(index)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query("INSERT INTO demo_meta VALUES ('seeded','1'),('signed_in','0')")
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(Self {
            pool,
            session: Mutex::new(Session::default()),
        })
    }

    async fn signed_in(&self) -> Result<MutexGuard<'_, Session>, CmsError> {
        let state = self.session.lock().await;
        if !state.signed_in {
            return Err(CmsError::new("AUTH_EXPIRED", "请进入演示工作区"));
        }
        Ok(state)
    }
    pub async fn authorize(&self) -> Result<u64, CmsError> {
        Ok(self.signed_in().await?.generation)
    }
    pub async fn login(&self, input: LoginRequest) -> Result<AuthSession, CmsError> {
        if input.username != "demo" || input.password != "demo" {
            return Err(invalid("演示版只支持进入本机演示工作区"));
        }
        let mut state = self.session.lock().await;
        sqlx::query("UPDATE demo_meta SET value='1' WHERE key='signed_in'")
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        state.signed_in = true;
        state.generation += 1;
        Ok(session())
    }
    pub async fn restore(&self) -> Result<Option<AuthSession>, CmsError> {
        let mut state = self.session.lock().await;
        let saved: String = sqlx::query_scalar("SELECT value FROM demo_meta WHERE key='signed_in'")
            .fetch_one(&self.pool)
            .await
            .map_err(storage)?;
        state.signed_in = saved == "1";
        state.generation += 1;
        Ok(state.signed_in.then(session))
    }
    pub async fn logout(&self) -> Result<LogoutResult, CmsError> {
        let mut state = self.session.lock().await;
        sqlx::query("UPDATE demo_meta SET value='0' WHERE key='signed_in'")
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        state.signed_in = false;
        state.generation += 1;
        Ok(LogoutResult {
            remote_succeeded: false,
            credentials_cleared: true,
        })
    }
    pub async fn channels(&self) -> Result<Vec<ChannelGroup>, CmsError> {
        let _session = self.signed_in().await?;
        Ok(["演示渠道 A", "演示渠道 B"]
            .into_iter()
            .map(|channel| ChannelGroup {
                channel: channel.into(),
                subchannels: vec!["演示轮播图".into(), "演示信息流".into()],
            })
            .collect())
    }
    async fn all(&self) -> Result<Vec<(i64, PromoteRecord)>, CmsError> {
        let rows: Vec<(i64, String)> =
            sqlx::query_as("SELECT position,payload FROM demo_promote ORDER BY position,id")
                .fetch_all(&self.pool)
                .await
                .map_err(storage)?;
        rows.into_iter()
            .map(|(position, payload)| {
                Ok((position, serde_json::from_str(&payload).map_err(storage)?))
            })
            .collect()
    }
    fn select(
        rows: Vec<(i64, PromoteRecord)>,
        query: &PromoteQuery,
    ) -> Result<Vec<(i64, PromoteRecord)>, CmsError> {
        if query.current == 0
            || ![10, 20, 30, 50].contains(&query.pagesize)
            || (query.channel.is_empty() && !query.subchannel.is_empty())
        {
            return Err(invalid("演示查询条件无效"));
        }
        Ok(rows
            .into_iter()
            .filter(|(_, row)| {
                (query.channel.is_empty() || row.channel.as_deref() == Some(&query.channel))
                    && (query.subchannel.is_empty()
                        || row.sub_channel.as_deref() == Some(&query.subchannel))
                    && (query.publishdate.is_empty()
                        || row.publish_date.as_deref() == Some(&query.publishdate))
            })
            .collect())
    }
    pub async fn list(&self, query: PromoteQuery) -> Result<PromotePage, CmsError> {
        let _session = self.signed_in().await?;
        let rows = Self::select(self.all().await?, &query)?;
        let total = rows.len() as u64;
        let offset = (u64::from(query.current) - 1) * u64::from(query.pagesize);
        let data = rows
            .into_iter()
            .skip(offset.min(usize::MAX as u64) as usize)
            .take(query.pagesize as usize)
            .map(|(_, row)| row)
            .collect();
        Ok(PromotePage {
            data,
            total,
            current: query.current,
            page_size: query.pagesize,
        })
    }
    pub async fn get(&self, id: i64) -> Result<PromoteRecord, CmsError> {
        let _session = self.signed_in().await?;
        let payload: Option<String> =
            sqlx::query_scalar("SELECT payload FROM demo_promote WHERE id=?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await
                .map_err(storage)?;
        serde_json::from_str(&payload.ok_or_else(|| invalid("演示素材不存在"))?).map_err(storage)
    }
    async fn validate(&self, input: &PromoteInput) -> Result<(), CmsError> {
        if input.title.trim().is_empty()
            || !["演示渠道 A", "演示渠道 B"].contains(&input.channel.as_str())
        {
            return Err(invalid("请选择演示渠道并填写标题"));
        }
        if let Some(date) = input.publish_date.as_deref().filter(|v| !v.is_empty())
            && (date.len() != 10 || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err())
        {
            return Err(invalid("发布日期格式应为 YYYY-MM-DD"));
        }
        for url in std::iter::once(&input.title_pic)
            .chain(input.title_pic2.iter().filter(|v| !v.is_empty()))
        {
            let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM demo_images WHERE url=?")
                .bind(url)
                .fetch_one(&self.pool)
                .await
                .map_err(storage)?;
            if !url.starts_with(IMAGE_PREFIX) || exists == 0 {
                return Err(invalid("演示版请使用样例图片或选择本机图片"));
            }
        }
        Ok(())
    }
    pub async fn create(&self, input: PromoteInput) -> Result<MutationResult, CmsError> {
        let _session = self.signed_in().await?;
        self.validate(&input).await?;
        let mut tx = self.pool.begin().await.map_err(storage)?;
        let (id, position): (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(MAX(id),900000)+1,COALESCE(MAX(position),0)+1 FROM demo_promote",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(storage)?;
        let row = record(id, input, position)?;
        sqlx::query("INSERT INTO demo_promote VALUES (?,?,?)")
            .bind(id)
            .bind(serde_json::to_string(&row).map_err(storage)?)
            .bind(position)
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        tx.commit().await.map_err(storage)?;
        Ok(MutationResult { succeeded: true })
    }
    pub async fn update(&self, row: PromoteRecord) -> Result<MutationResult, CmsError> {
        let _session = self.signed_in().await?;
        let input = serde_json::from_value::<PromoteInput>(serde_json::json!({"channel":row.channel,"subChannel":row.sub_channel,"publishDate":row.publish_date,"url":row.url,"title":row.title,"titlePic":row.title_pic,"titlePic2":row.title_pic2,"smallText":row.small_text,"writer":row.writer})).map_err(storage)?;
        self.validate(&input).await?;
        let position: Option<i64> =
            sqlx::query_scalar("SELECT position FROM demo_promote WHERE id=?")
                .bind(row.id)
                .fetch_optional(&self.pool)
                .await
                .map_err(storage)?;
        let updated = record(
            row.id,
            input,
            position.ok_or_else(|| invalid("演示素材不存在"))?,
        )?;
        sqlx::query("UPDATE demo_promote SET payload=? WHERE id=?")
            .bind(serde_json::to_string(&updated).map_err(storage)?)
            .bind(row.id)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(MutationResult { succeeded: true })
    }
    pub async fn remove(&self, id: i64) -> Result<MutationResult, CmsError> {
        let _session = self.signed_in().await?;
        let result = sqlx::query("DELETE FROM demo_promote WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        if result.rows_affected() != 1 {
            return Err(invalid("演示素材不存在"));
        }
        Ok(MutationResult { succeeded: true })
    }
    pub async fn order(
        &self,
        query: PromoteQuery,
        ids: Vec<i64>,
    ) -> Result<MutationResult, CmsError> {
        let _session = self.signed_in().await?;
        if query.channel.is_empty() || query.subchannel.is_empty() || query.publishdate.is_empty() {
            return Err(invalid("请完整筛选演示渠道、子渠道和日期"));
        }
        let rows = Self::select(self.all().await?, &query)?;
        let page: Vec<_> = rows
            .into_iter()
            .skip(((u64::from(query.current) - 1) * u64::from(query.pagesize)) as usize)
            .take(query.pagesize as usize)
            .collect();
        let mut expected: Vec<_> = page.iter().map(|(_, row)| row.id).collect();
        let mut actual = ids.clone();
        expected.sort_unstable();
        actual.sort_unstable();
        if expected != actual || ids.len() < 2 {
            return Err(invalid("演示列表已变化，请刷新后排序"));
        }
        let mut tx = self.pool.begin().await.map_err(storage)?;
        for (index, id) in ids.into_iter().enumerate() {
            let mut row = page
                .iter()
                .find(|(_, row)| row.id == id)
                .expect("validated id set")
                .1
                .clone();
            row.order = Some(index as i64 + 1);
            sqlx::query("UPDATE demo_promote SET position=?,payload=? WHERE id=?")
                .bind(page[index].0)
                .bind(serde_json::to_string(&row).map_err(storage)?)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(storage)?;
        }
        tx.commit().await.map_err(storage)?;
        Ok(MutationResult { succeeded: true })
    }
    pub async fn image(&self, url: String) -> Result<PromoteImage, CmsError> {
        let _session = self.signed_in().await?;
        if !url.starts_with(IMAGE_PREFIX) {
            return Err(invalid("演示版只读取本机演示图片"));
        }
        let row: Option<(String, Vec<u8>)> =
            sqlx::query_as("SELECT mime,data FROM demo_images WHERE url=?")
                .bind(url)
                .fetch_optional(&self.pool)
                .await
                .map_err(storage)?;
        let (mime_type, bytes) = row.ok_or_else(|| invalid("演示图片不存在"))?;
        Ok(PromoteImage {
            mime_type,
            byte_size: bytes.len(),
            data_base64: STANDARD.encode(bytes),
        })
    }
    pub async fn upload(&self, input: UploadImage) -> Result<UploadedImage, CmsError> {
        let _session = self.signed_in().await?;
        let image = crate::imaging::Input {
            mime_type: input.mime_type.clone(),
            data_base64: input.data_base64,
        };
        let bytes = image
            .bytes()
            .map_err(|_| invalid("演示图片无效或超过 20 MiB"))?;
        let url = format!("{IMAGE_PREFIX}{}", uuid::Uuid::new_v4());
        sqlx::query("INSERT INTO demo_images VALUES (?,?,?)")
            .bind(&url)
            .bind(input.mime_type)
            .bind(bytes)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(UploadedImage { url })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query() -> PromoteQuery {
        PromoteQuery {
            channel: "".into(),
            subchannel: "".into(),
            publishdate: "".into(),
            current: 1,
            pagesize: 20,
        }
    }
    async fn login(demo: &DemoCms) {
        demo.login(LoginRequest {
            username: "demo".into(),
            password: "demo".into(),
        })
        .await
        .unwrap();
    }
    fn input() -> PromoteInput {
        PromoteInput {
            channel: "演示渠道 A".into(),
            sub_channel: Some("演示轮播图".into()),
            publish_date: Some("2026-11-03".into()),
            url: None,
            title: "本机新增验收".into(),
            title_pic: format!("{IMAGE_PREFIX}seed-0.png"),
            title_pic2: None,
            small_text: Some("Mock 正文".into()),
            writer: None,
        }
    }

    #[tokio::test]
    async fn demo_auth_crud_and_restart_stay_in_local_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("demo.db");
        let db = crate::database::Database::open(&path).await.unwrap();
        let demo = DemoCms::new(db.pool.clone()).await.unwrap();
        assert!(demo.list(query()).await.is_err());
        assert!(
            demo.login(LoginRequest {
                username: "real-user".into(),
                password: "unused".into()
            })
            .await
            .is_err()
        );
        login(&demo).await;
        let page = demo.list(query()).await.unwrap();
        assert_eq!(page.total, 80);
        assert_eq!(page.data.len(), 20);
        assert!(
            page.data
                .iter()
                .all(|row| row.title.as_deref().unwrap().starts_with("[演示]"))
        );
        demo.create(input()).await.unwrap();
        let id = USER_ID + 80;
        let mut row = demo.get(id).await.unwrap();
        row.title = Some("已编辑".into());
        demo.update(row).await.unwrap();
        assert_eq!(
            demo.get(id).await.unwrap().title.as_deref(),
            Some("[演示] 已编辑")
        );
        db.pool.close().await;
        drop(demo);
        let reopened = crate::database::Database::open(&path).await.unwrap();
        let demo = DemoCms::new(reopened.pool.clone()).await.unwrap();
        assert!(demo.restore().await.unwrap().is_some());
        assert_eq!(demo.list(query()).await.unwrap().total, 81);
        demo.remove(id).await.unwrap();
        assert!(demo.get(id).await.is_err());
        let result = demo.logout().await.unwrap();
        assert!(!result.remote_succeeded, "演示退出不能声称后台操作成功");
        assert!(demo.create(input()).await.is_err());
        assert!(
            DemoCms::new(reopened.pool.clone())
                .await
                .unwrap()
                .restore()
                .await
                .unwrap()
                .is_none()
        );
        reopened.pool.close().await;
    }

    #[tokio::test]
    async fn demo_sort_checks_page_members_and_preserves_other_rows() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::database::Database::open(&directory.path().join("demo.db"))
            .await
            .unwrap();
        let demo = DemoCms::new(db.pool.clone()).await.unwrap();
        login(&demo).await;
        let filtered = PromoteQuery {
            channel: "演示渠道 A".into(),
            subchannel: "演示轮播图".into(),
            publishdate: "2026-11-03".into(),
            pagesize: 10,
            ..query()
        };
        let other = PromoteQuery {
            publishdate: "2026-11-02".into(),
            ..filtered.clone()
        };
        let before: Vec<_> = demo
            .list(other.clone())
            .await
            .unwrap()
            .data
            .iter()
            .map(|r| r.id)
            .collect();
        let mut ids: Vec<_> = demo
            .list(filtered.clone())
            .await
            .unwrap()
            .data
            .iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids.len(), 10);
        ids.reverse();
        assert!(
            demo.order(filtered.clone(), ids[..9].to_vec())
                .await
                .is_err()
        );
        let mut duplicates = ids.clone();
        duplicates[0] = duplicates[1];
        assert!(demo.order(filtered.clone(), duplicates).await.is_err());
        demo.order(filtered.clone(), ids.clone()).await.unwrap();
        assert_eq!(
            demo.list(filtered)
                .await
                .unwrap()
                .data
                .iter()
                .map(|r| r.id)
                .collect::<Vec<_>>(),
            ids
        );
        assert_eq!(
            demo.list(other)
                .await
                .unwrap()
                .data
                .iter()
                .map(|r| r.id)
                .collect::<Vec<_>>(),
            before
        );
        db.pool.close().await;
    }

    #[tokio::test]
    async fn demo_images_are_local_and_external_urls_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::database::Database::open(&directory.path().join("demo.db"))
            .await
            .unwrap();
        let demo = DemoCms::new(db.pool.clone()).await.unwrap();
        login(&demo).await;
        assert!(
            demo.image("https://example.com/real.png".into())
                .await
                .is_err()
        );
        let original = demo
            .image(format!("{IMAGE_PREFIX}seed-0.png"))
            .await
            .unwrap();
        let uploaded = demo
            .upload(UploadImage {
                file_name: "demo.png".into(),
                mime_type: original.mime_type.clone(),
                data_base64: original.data_base64.clone(),
            })
            .await
            .unwrap();
        assert!(uploaded.url.starts_with(IMAGE_PREFIX));
        let loaded = demo.image(uploaded.url).await.unwrap();
        assert_eq!(loaded.data_base64, original.data_base64);
        assert!(
            demo.upload(UploadImage {
                file_name: "wrong.jpg".into(),
                mime_type: "image/jpeg".into(),
                data_base64: original.data_base64
            })
            .await
            .is_err()
        );
        let mut bad = input();
        bad.title_pic = "https://example.com/real.png".into();
        assert!(demo.create(bad).await.is_err());
        db.pool.close().await;
    }
}
