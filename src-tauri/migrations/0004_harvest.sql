-- 采集配置与任务独立持久化；原始素材沿用 source_articles，不自动创建编辑草稿。
CREATE TABLE harvest_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    options TEXT NOT NULL CHECK(json_valid(options)),
    model_config_id TEXT REFERENCES ai_models(id) ON DELETE RESTRICT,
    retention_days INTEGER CHECK(retention_days > 0)
);
INSERT INTO harvest_settings VALUES (1, '{"autoClassify":false,"autoTags":true,"autoSummary":true,"autoOrganize":false,"autoPaginate":false,"modelConfigId":null}', NULL, NULL);
CREATE TABLE harvest_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    final_url TEXT,
    title TEXT,
    writer TEXT NOT NULL DEFAULT '',
    collection_date TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','waitingUser','waitingLogin','succeeded','failed','cancelled','interrupted','submissionUnknown')),
    stage TEXT CHECK(stage IN ('collecting','formatting','metadata','organizing','paginating','submitting')),
    options TEXT NOT NULL CHECK(json_valid(options)),
    source_id TEXT REFERENCES source_articles(id),
    partial_raw TEXT CHECK(partial_raw IS NULL OR json_valid(partial_raw)),
    formatted TEXT CHECK(formatted IS NULL OR json_valid(formatted)),
    prepared TEXT CHECK(prepared IS NULL OR json_valid(prepared)),
    warnings TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings)),
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT,
    submitted_at TEXT,
    cms_article_id TEXT
);
CREATE INDEX harvest_jobs_day ON harvest_jobs(user_id,collection_date,created_at DESC);
CREATE INDEX harvest_jobs_queue ON harvest_jobs(user_id,status,created_at);
-- 保留期内同一来源只保留一条任务，重试更新原任务，不新建可能重复提交的记录。
CREATE UNIQUE INDEX harvest_jobs_source ON harvest_jobs(user_id,normalized_url);
