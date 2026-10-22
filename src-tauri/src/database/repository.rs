use super::{
    Database,
    models::{Article, SaveDraftRequest, SourceArticle},
};
use crate::error::AppError;
use chrono::{SecondsFormat, Utc};
use sqlx::{Row, sqlite::SqliteRow};

fn from_row(row: SqliteRow) -> Result<Article, sqlx::Error> {
    Ok(Article {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        content: row.try_get("content")?,
        status: row.try_get("status")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        is_demo: row.try_get("is_demo")?,
        source: SourceArticle {
            id: row.try_get("source_id")?,
            title: row.try_get("source_title")?,
            url: row.try_get("url")?,
            content: row.try_get("source_content")?,
            imported_at: row.try_get("imported_at")?,
        },
    })
}

impl Database {
    pub async fn list_articles(&self) -> Result<Vec<Article>, AppError> {
        let rows = sqlx::query("SELECT d.id,d.title,d.content,d.status,d.created_at,d.updated_at,s.id AS source_id,s.title AS source_title,s.url,s.content AS source_content,s.imported_at,s.is_demo FROM drafts d JOIN source_articles s ON d.source_id=s.id ORDER BY d.updated_at DESC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(from_row)
            .collect::<Result<Vec<_>, _>>()?)
    }
    pub async fn get_article(&self, id: &str) -> Result<Article, AppError> {
        if id.is_empty() || id.len() > 100 {
            return Err(AppError::Validation("无效的文章 ID".into()));
        }
        let row = sqlx::query("SELECT d.id,d.title,d.content,d.status,d.created_at,d.updated_at,s.id AS source_id,s.title AS source_title,s.url,s.content AS source_content,s.imported_at,s.is_demo FROM drafts d JOIN source_articles s ON d.source_id=s.id WHERE d.id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)?;
        Ok(from_row(row)?)
    }
    pub async fn save_draft(&self, request: SaveDraftRequest) -> Result<Article, AppError> {
        request.validate()?;
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let result = sqlx::query(
            "UPDATE drafts SET title=?,content=?,status='draft',updated_at=? WHERE id=?",
        )
        .bind(request.title.trim())
        .bind(&request.content)
        .bind(now)
        .bind(&request.id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.get_article(&request.id).await
    }
    async fn insert_article(&self, article: &Article) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO source_articles (id,title,url,content,imported_at,is_demo) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
            .bind(&article.source.id).bind(&article.source.title).bind(&article.source.url).bind(&article.source.content).bind(&article.source.imported_at).bind(article.is_demo).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO drafts (id,source_id,title,content,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
            .bind(&article.id).bind(&article.source.id).bind(&article.title).bind(&article.content).bind(&article.status).bind(&article.created_at).bind(&article.updated_at).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
    pub(super) async fn seed_demo(&self) -> Result<(), AppError> {
        let articles: Vec<Article> = serde_json::from_str(include_str!(
            "../../../src/features/articles/demo-articles.json"
        ))?;
        for article in articles {
            self.insert_article(&article).await?;
        }
        Ok(())
    }
    pub async fn create_demo_article(&self, input: &str) -> Result<Article, AppError> {
        let parsed =
            url::Url::parse(input).map_err(|_| AppError::Validation("文章链接无效".into()))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || input.len() > 4096
        {
            return Err(AppError::Validation("仅支持 HTTP / HTTPS 文章链接".into()));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let title = "待编辑的演示素材".to_string();
        let content = "这是导入流程的演示素材，未抓取目标网页。真实采集服务尚未连接。".to_string();
        let article = Article {
            id: id.clone(),
            title: title.clone(),
            content: content.clone(),
            status: "imported".into(),
            created_at: now.clone(),
            updated_at: now.clone(),
            is_demo: true,
            source: SourceArticle {
                id: format!("source-{id}"),
                title,
                url: parsed.to_string(),
                content,
                imported_at: now,
            },
        };
        self.insert_article(&article).await?;
        Ok(article)
    }
}
