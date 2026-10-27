pub mod ai;
pub mod image_presets;
pub mod models;
mod repository;

use crate::error::AppError;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::path::Path;

#[derive(Clone)]
pub struct Database {
    pub(crate) pool: SqlitePool,
}

impl Database {
    pub async fn open(path: &Path) -> Result<Self, AppError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        let database = Self { pool };
        database.seed_demo().await?;
        Ok(database)
    }
    pub async fn health(&self) -> Result<bool, AppError> {
        let value: i64 = sqlx::query_scalar("SELECT 1").fetch_one(&self.pool).await?;
        Ok(value == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn draft_survives_reopen_and_original_is_immutable()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("pressdock.db");
        let db = Database::open(&path).await?;
        assert!(db.health().await?);
        let original = db
            .list_articles()
            .await?
            .into_iter()
            .find(|article| article.id == "demo-1")
            .unwrap();
        // 模拟旧版本留下的草稿，迁移后只读历史仍须保留既有编辑数据。
        sqlx::query("UPDATE drafts SET title=?,content=? WHERE id=?")
            .bind("独立编辑标题")
            .bind("独立编辑正文")
            .bind(&original.id)
            .execute(&db.pool)
            .await?;
        db.pool.close().await;
        let reopened = Database::open(&path).await?;
        let saved = reopened
            .list_articles()
            .await?
            .into_iter()
            .find(|article| article.id == "demo-1")
            .unwrap();
        assert_eq!(saved.title, "独立编辑标题");
        assert_eq!(saved.content, "独立编辑正文");
        assert_eq!(saved.source.title, original.source.title);
        assert_eq!(saved.source.content, original.source.content);
        assert_eq!(reopened.list_articles().await?.len(), 4);
        reopened.pool.close().await;
        Ok(())
    }

    #[tokio::test]
    async fn invalid_requests_do_not_write_data() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let db = Database::open(&directory.path().join("test.db")).await?;
        assert!(db.create_demo_article("file:///etc/passwd").await.is_err());
        assert!(db.create_demo_article("javascript:alert(1)").await.is_err());
        let demo = db.create_demo_article("https://example.com/test").await?;
        assert!(demo.is_demo);
        assert_eq!(db.list_articles().await?.len(), 5);
        Ok(())
    }
}
