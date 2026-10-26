use super::*;
use crate::database::Database;
use chrono::{Days, Local, NaiveDate, SecondsFormat, Utc};
use serde::de::DeserializeOwned;
use sqlx::{Row, sqlite::SqliteRow};

pub(crate) fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn enum_value<T: DeserializeOwned>(value: &str) -> Result<T, HarvestError> {
    Ok(serde_json::from_value(serde_json::json!(value))?)
}
fn job_row(row: &SqliteRow) -> Result<Job, HarvestError> {
    Ok(Job {
        developer_mode: row.try_get("developer_mode")?,
        id: row.try_get("id")?,
        url: row.try_get("url")?,
        title: row.try_get("title")?,
        collection_date: row.try_get("collection_date")?,
        status: enum_value(row.try_get("status")?)?,
        stage: row
            .try_get::<Option<&str>, _>("stage")?
            .map(enum_value)
            .transpose()?,
        warnings: serde_json::from_str(row.try_get("warnings")?)?,
        error: row.try_get("error")?,
        attempts: row.try_get("attempts")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        cms_article_id: row.try_get("cms_article_id")?,
    })
}
impl Database {
    pub(crate) async fn harvest_settings(&self) -> Result<Settings, HarvestError> {
        let row = sqlx::query(
            "SELECT options,model_config_id,retention_days FROM harvest_settings WHERE id=1",
        )
        .fetch_one(&self.pool)
        .await?;
        let mut options: Options = serde_json::from_str(row.try_get("options")?)?;
        options.model_config_id = row.try_get("model_config_id")?;
        Ok(Settings {
            options,
            retention_days: row.try_get("retention_days")?,
        })
    }
    pub(crate) async fn harvest_save_settings(
        &self,
        request: &Settings,
    ) -> Result<(), HarvestError> {
        request.validate()?;
        if let Some(id) = &request.options.model_config_id {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ai_models WHERE id=?)")
                    .bind(id)
                    .fetch_one(&self.pool)
                    .await?;
            if !exists {
                return Err(HarvestError::invalid("选择的模型不存在，请刷新模型配置"));
            }
        }
        sqlx::query(
            "UPDATE harvest_settings SET options=?,model_config_id=?,retention_days=? WHERE id=1",
        )
        .bind(serde_json::to_string(&request.options)?)
        .bind(&request.options.model_config_id)
        .bind(request.retention_days)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub(crate) async fn harvest_set_developer_mode(
        &self,
        enabled: bool,
    ) -> Result<bool, HarvestError> {
        // 开关即时生效且只更新这一项，避免保存开发者模式时提交其他尚未确认的表单设置。
        // json() 保持 JSON boolean，不能把 SQLite 的 0/1 直接写入后交给 serde 读取。
        Ok(sqlx::query_scalar("UPDATE harvest_settings SET options=json_set(options,'$.developerMode',json(?)) WHERE id=1 RETURNING json_extract(options,'$.developerMode')")
            .bind(if enabled { "true" } else { "false" })
            .fetch_one(&self.pool).await?)
    }
    pub(crate) async fn harvest_list(
        &self,
        user: i64,
        date: &str,
    ) -> Result<Vec<Job>, HarvestError> {
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() || date.len() != 10 {
            return Err(HarvestError::invalid("采集日期须为 YYYY-MM-DD"));
        }
        let rows=sqlx::query("SELECT id,url,title,collection_date,status,stage,warnings,error,attempts,created_at,updated_at,cms_article_id,COALESCE(json_extract(options,'$.developerMode'),0) AS developer_mode FROM harvest_jobs WHERE user_id=? AND collection_date=? ORDER BY created_at DESC,id DESC")
            .bind(user).bind(date).fetch_all(&self.pool).await?;
        rows.iter().map(job_row).collect()
    }
    pub(crate) async fn harvest_view(&self, id: &str, user: i64) -> Result<Job, HarvestError> {
        // 列表和操作只读轻量字段，避免每次状态刷新反复加载完整 HTML/payload。
        let row=sqlx::query("SELECT id,url,title,collection_date,status,stage,warnings,error,attempts,created_at,updated_at,cms_article_id,COALESCE(json_extract(options,'$.developerMode'),0) AS developer_mode FROM harvest_jobs WHERE id=? AND user_id=?")
            .bind(id).bind(user).fetch_optional(&self.pool).await?.ok_or_else(||HarvestError::invalid("采集任务不存在或不属于当前账号"))?;
        job_row(&row)
    }
    pub(crate) async fn harvest_job(&self, id: &str, user: i64) -> Result<StoredJob, HarvestError> {
        let row=sqlx::query("SELECT h.*,COALESCE(json_extract(h.options,'$.developerMode'),0) AS developer_mode,s.title AS raw_title,s.content AS raw_html FROM harvest_jobs h LEFT JOIN source_articles s ON s.id=h.source_id WHERE h.id=? AND h.user_id=?")
            .bind(id).bind(user).fetch_optional(&self.pool).await?.ok_or_else(||HarvestError::invalid("采集任务不存在或不属于当前账号"))?;
        let raw = row
            .try_get::<Option<String>, _>("raw_html")?
            .map(|news_html| {
                Ok::<_, HarvestError>(RawArticle {
                    title: row.try_get("raw_title")?,
                    writer: row.try_get("writer")?,
                    source_url: row.try_get("url")?,
                    news_html,
                })
            })
            .transpose()?;
        Ok(StoredJob {
            job: job_row(&row)?,
            user_id: user,
            options: serde_json::from_str(row.try_get("options")?)?,
            raw,
            formatted: row
                .try_get::<Option<&str>, _>("formatted")?
                .map(serde_json::from_str)
                .transpose()?,
            prepared: row
                .try_get::<Option<&str>, _>("prepared")?
                .map(serde_json::from_str)
                .transpose()?,
        })
    }
    pub(crate) async fn harvest_enqueue(
        &self,
        user: i64,
        request: &EnqueueRequest,
    ) -> Result<(Job, Options), HarvestError> {
        if uuid::Uuid::parse_str(&request.id).is_err() {
            return Err(HarvestError::invalid("无效的采集请求 ID"));
        }
        let normalized = source_url(&request.url)?.to_string();
        let options = self.harvest_settings().await?.options;
        let local = Local::now();
        let time = now();
        let mut tx = self.pool.begin().await?;
        // 请求 ID 保持幂等；账号、来源、任务模式分别去重，调试结果不阻挡之后的正常采集。
        if let Some(row) = sqlx::query("SELECT *,COALESCE(json_extract(options,'$.developerMode'),0) AS developer_mode FROM harvest_jobs WHERE id=?")
            .bind(&request.id)
            .fetch_optional(&mut *tx)
            .await?
        {
            if row.try_get::<i64, _>("user_id")? != user
                || row.try_get::<String, _>("normalized_url")? != normalized
            {
                return Err(HarvestError::invalid("采集请求 ID 已被使用"));
            }
            return Ok((job_row(&row)?, serde_json::from_str(row.try_get("options")?)?));
        }
        sqlx::query("INSERT INTO harvest_jobs(id,user_id,url,normalized_url,collection_date,timezone,status,options,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?,?) ON CONFLICT DO NOTHING")
            .bind(&request.id).bind(user).bind(request.url.trim()).bind(&normalized).bind(local.format("%Y-%m-%d").to_string()).bind(local.format("%:z").to_string())
            .bind(serde_json::to_string(&options)?).bind(&time).bind(&time).execute(&mut *tx).await?;
        let row = sqlx::query("SELECT *,COALESCE(json_extract(options,'$.developerMode'),0) AS developer_mode FROM harvest_jobs WHERE user_id=? AND normalized_url=? AND COALESCE(json_extract(options,'$.developerMode'),0)=?")
            .bind(user)
            .bind(normalized)
            .bind(options.developer_mode)
            .fetch_one(&mut *tx)
            .await?;
        let result = (
            job_row(&row)?,
            serde_json::from_str(row.try_get("options")?)?,
        );
        tx.commit().await?;
        Ok(result)
    }
    pub(crate) async fn harvest_claim(&self, user: i64) -> Result<Option<StoredJob>, HarvestError> {
        let row=sqlx::query("UPDATE harvest_jobs SET status='running',stage='collecting',error=NULL,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM harvest_jobs WHERE user_id=? AND status='queued' ORDER BY created_at,id LIMIT 1) AND status='queued' RETURNING id")
            .bind(now()).bind(user).fetch_optional(&self.pool).await?;
        match row {
            Some(row) => Ok(Some(self.harvest_job(row.try_get("id")?, user).await?)),
            None => Ok(None),
        }
    }
    pub(crate) async fn harvest_progress(
        &self,
        id: &str,
        status: Status,
        stage: Stage,
    ) -> Result<(), HarvestError> {
        let result=sqlx::query("UPDATE harvest_jobs SET status=?,stage=?,updated_at=? WHERE id=? AND status IN ('running','waitingUser','waitingLogin')")
            .bind(status.as_str()).bind(stage.as_str()).bind(now()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() != 1 {
            return Err(HarvestError::new("HARVEST_CANCELLED", "任务已经停止"));
        }
        Ok(())
    }
    pub(crate) async fn harvest_title(&self, id: &str, title: &str) -> Result<(), HarvestError> {
        sqlx::query("UPDATE harvest_jobs SET title=?,updated_at=? WHERE id=? AND status IN ('running','waitingUser')")
            .bind(title).bind(now()).bind(id).execute(&self.pool).await?;
        Ok(())
    }
    pub(crate) async fn harvest_save_partial(
        &self,
        id: &str,
        raw: &RawArticle,
    ) -> Result<(), HarvestError> {
        // 后续来源页失败时保留已采内容；这只是未完成检查点，不覆盖已定稿原文。
        sqlx::query(
            "UPDATE harvest_jobs SET partial_raw=?,updated_at=? WHERE id=? AND status='running'",
        )
        .bind(serde_json::to_string(raw)?)
        .bind(now())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub(crate) async fn harvest_save_raw(
        &self,
        id: &str,
        raw: &RawArticle,
        final_url: &str,
    ) -> Result<(), HarvestError> {
        let source_id = format!("harvest-source-{id}");
        let mut tx = self.pool.begin().await?;
        // 原文只插入一次；重试或后续格式化不得覆盖已经保存的素材。
        sqlx::query("INSERT INTO source_articles(id,title,url,content,imported_at,is_demo) SELECT ?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM harvest_jobs WHERE id=? AND status='running') ON CONFLICT(id) DO NOTHING")
            .bind(&source_id).bind(&raw.title).bind(&raw.source_url).bind(&raw.news_html).bind(now()).bind(id).execute(&mut *tx).await?;
        sqlx::query("UPDATE harvest_jobs SET source_id=?,partial_raw=NULL,title=?,writer=?,final_url=?,updated_at=? WHERE id=? AND status='running'")
            .bind(source_id).bind(&raw.title).bind(&raw.writer).bind(final_url).bind(now()).bind(id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
    pub(crate) async fn harvest_save_result(
        &self,
        id: &str,
        article: &FormattedArticle,
        prepared: bool,
    ) -> Result<(), HarvestError> {
        let sql = if prepared {
            "UPDATE harvest_jobs SET prepared=?,updated_at=? WHERE id=? AND status='running'"
        } else {
            "UPDATE harvest_jobs SET formatted=?,updated_at=? WHERE id=? AND status='running'"
        };
        sqlx::query(sql)
            .bind(serde_json::to_string(article)?)
            .bind(now())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub(crate) async fn harvest_warning(
        &self,
        id: &str,
        message: &str,
    ) -> Result<(), HarvestError> {
        sqlx::query("UPDATE harvest_jobs SET warnings=json_insert(warnings,'$[#]',?),updated_at=? WHERE id=? AND status='running'")
            .bind(message).bind(now()).bind(id).execute(&self.pool).await?;
        Ok(())
    }
    pub(crate) async fn harvest_submitting(&self, id: &str) -> Result<(), HarvestError> {
        // 任务模式来自持久快照，数据库写入意图也拒绝调试任务，避免误进入远端提交阶段。
        let result=sqlx::query("UPDATE harvest_jobs SET stage='submitting',submitted_at=?,updated_at=? WHERE id=? AND status='running' AND prepared IS NOT NULL AND COALESCE(json_extract(options,'$.developerMode'),0)=0")
            .bind(now()).bind(now()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() != 1 {
            return Err(HarvestError::new(
                "HARVEST_CANCELLED",
                "任务已停止，未提交 CMS",
            ));
        }
        Ok(())
    }
    pub(crate) async fn harvest_finish(
        &self,
        id: &str,
        status: Status,
        error: Option<&str>,
        cms_id: Option<&str>,
    ) -> Result<(), HarvestError> {
        sqlx::query("UPDATE harvest_jobs SET status=?,error=?,cms_article_id=COALESCE(?,cms_article_id),finished_at=?,updated_at=? WHERE id=? AND status IN ('running','waitingUser','waitingLogin')")
            .bind(status.as_str()).bind(error).bind(cms_id).bind(now()).bind(now()).bind(id).execute(&self.pool).await?;
        Ok(())
    }
    pub(crate) async fn harvest_cancel(&self, id: &str, user: i64) -> Result<(), HarvestError> {
        // 与领取任务原子竞争：即使 queued 刚变 running，取消仍持久生效。
        // 提交中只能记未知，不能声称远端请求已经撤销。
        let result=sqlx::query("UPDATE harvest_jobs SET status=CASE WHEN status='running' AND stage='submitting' THEN 'submissionUnknown' ELSE 'cancelled' END,error=CASE WHEN status='running' AND stage='submitting' THEN '已停止等待，请先核对 CMS 提交结果' ELSE NULL END,finished_at=?,updated_at=? WHERE id=? AND user_id=? AND status IN ('queued','running','waitingUser')")
            .bind(now()).bind(now()).bind(id).bind(user).execute(&self.pool).await?;
        if result.rows_affected() != 1 {
            return Err(HarvestError::invalid("任务状态已变化，请刷新记录"));
        }
        Ok(())
    }
    pub(crate) async fn harvest_action(
        &self,
        id: &str,
        user: i64,
        action: &Action,
    ) -> Result<(), HarvestError> {
        let job = self.harvest_view(id, user).await?;
        let status = match action {
            Action::Retry
                if matches!(
                    job.status,
                    Status::Failed | Status::Interrupted | Status::Cancelled | Status::WaitingLogin
                ) =>
            {
                Status::Queued
            }
            Action::ConfirmSubmitted if job.status == Status::SubmissionUnknown => {
                Status::Succeeded
            }
            Action::ConfirmNotSubmitted if job.status == Status::SubmissionUnknown => {
                Status::Failed
            }
            _ => return Err(HarvestError::invalid("当前任务状态不允许此操作")),
        };
        let result=sqlx::query("UPDATE harvest_jobs SET status=?,error=NULL,updated_at=? WHERE id=? AND user_id=? AND status=?")
            .bind(status.as_str()).bind(now()).bind(id).bind(user).bind(job.status.as_str()).execute(&self.pool).await?;
        if result.rows_affected() != 1 {
            return Err(HarvestError::invalid("任务状态已变化，请刷新记录"));
        }
        Ok(())
    }
    pub(crate) async fn harvest_delete(&self, id: &str, user: i64) -> Result<(), HarvestError> {
        let mut tx = self.pool.begin().await?;
        // 删除与重试在 SQLite 内按状态竞争；不删除运行中或结果尚待核对的任务。
        let row = sqlx::query("DELETE FROM harvest_jobs WHERE id=? AND user_id=? AND status IN ('succeeded','debugCompleted','failed','cancelled','interrupted') RETURNING source_id")
            .bind(id).bind(user).fetch_optional(&mut *tx).await?
            .ok_or_else(|| HarvestError::invalid("记录不存在或状态已变化，仅可删除已结束的任务，请刷新记录"))?;
        if let Some(source) = row.try_get::<Option<String>, _>("source_id")? {
            // 与历史清理采用相同引用规则，草稿仍需要的原文不会被删除。
            sqlx::query("DELETE FROM source_articles WHERE id=? AND id LIKE 'harvest-source-%' AND NOT EXISTS(SELECT 1 FROM drafts WHERE source_id=source_articles.id) AND NOT EXISTS(SELECT 1 FROM harvest_jobs WHERE source_id=source_articles.id)")
                .bind(source).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }
    pub(crate) async fn harvest_recover(&self) -> Result<(), HarvestError> {
        // 提交已发出但未记账的任务绝不自动恢复为排队，避免创建第二篇 CMS 文章。
        sqlx::query("UPDATE harvest_jobs SET status=CASE WHEN stage='submitting' THEN 'submissionUnknown' ELSE 'interrupted' END,error=CASE WHEN stage='submitting' THEN '应用在提交期间退出，请先核对 CMS 结果' ELSE '应用退出导致任务中断，可手动重试' END,updated_at=? WHERE status IN ('running','waitingUser')")
            .bind(now()).execute(&self.pool).await?;
        Ok(())
    }
    pub(crate) async fn harvest_cleanup(&self) -> Result<(), HarvestError> {
        let Some(days) = self.harvest_settings().await?.retention_days else {
            return Ok(());
        };
        let cutoff = Local::now()
            .date_naive()
            .checked_sub_days(Days::new(u64::from(days - 1)))
            .ok_or_else(|| HarvestError::invalid("历史保留天数无效"))?
            .to_string();
        let mut tx = self.pool.begin().await?;
        let rows=sqlx::query("DELETE FROM harvest_jobs WHERE collection_date<? AND status IN ('succeeded','debugCompleted','failed','cancelled') RETURNING source_id")
            .bind(cutoff).fetch_all(&mut *tx).await?;
        for row in rows {
            if let Some(id) = row.try_get::<Option<String>, _>("source_id")? {
                sqlx::query("DELETE FROM source_articles WHERE id=? AND id LIKE 'harvest-source-%' AND NOT EXISTS(SELECT 1 FROM drafts WHERE source_id=source_articles.id) AND NOT EXISTS(SELECT 1 FROM harvest_jobs WHERE source_id=source_articles.id)")
                    .bind(id).execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
        Ok(())
    }
    pub(crate) async fn harvest_model_in_use(
        &self,
        kind: &str,
        id: &str,
    ) -> Result<bool, HarvestError> {
        let sql = if kind == "provider" {
            "SELECT EXISTS(SELECT 1 FROM ai_models m WHERE m.provider_id=? AND (EXISTS(SELECT 1 FROM harvest_settings WHERE model_config_id=m.id) OR EXISTS(SELECT 1 FROM harvest_jobs WHERE json_extract(options,'$.modelConfigId')=m.id AND status NOT IN ('succeeded','debugCompleted','failed','cancelled'))))"
        } else {
            "SELECT EXISTS(SELECT 1 FROM harvest_settings WHERE model_config_id=?) OR EXISTS(SELECT 1 FROM harvest_jobs WHERE json_extract(options,'$.modelConfigId')=? AND status NOT IN ('succeeded','debugCompleted','failed','cancelled'))"
        };
        if kind == "provider" {
            Ok(sqlx::query_scalar(sql)
                .bind(id)
                .fetch_one(&self.pool)
                .await?)
        } else {
            Ok(sqlx::query_scalar(sql)
                .bind(id)
                .bind(id)
                .fetch_one(&self.pool)
                .await?)
        }
    }
}
