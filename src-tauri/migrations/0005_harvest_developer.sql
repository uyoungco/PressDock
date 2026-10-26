-- 新终态明确表示只调试未提交；旧任务 options 缺少 developerMode 时视为 false。
CREATE TABLE harvest_jobs_next (
    id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    final_url TEXT,
    title TEXT,
    writer TEXT NOT NULL DEFAULT '',
    collection_date TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','waitingUser','waitingLogin','succeeded','debugCompleted','failed','cancelled','interrupted','submissionUnknown')),
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
INSERT INTO harvest_jobs_next(id,user_id,url,normalized_url,final_url,title,writer,collection_date,timezone,status,stage,options,source_id,partial_raw,formatted,prepared,warnings,error,attempts,created_at,updated_at,finished_at,submitted_at,cms_article_id) SELECT id,user_id,url,normalized_url,final_url,title,writer,collection_date,timezone,status,stage,options,source_id,partial_raw,formatted,prepared,warnings,error,attempts,created_at,updated_at,finished_at,submitted_at,cms_article_id FROM harvest_jobs;
DROP TABLE harvest_jobs;
ALTER TABLE harvest_jobs_next RENAME TO harvest_jobs;
CREATE INDEX harvest_jobs_day ON harvest_jobs(user_id,collection_date,created_at DESC);
CREATE INDEX harvest_jobs_queue ON harvest_jobs(user_id,status,created_at);
-- 同一模式继续查重；调试与正常任务可以分别拥有同一来源。
CREATE UNIQUE INDEX harvest_jobs_source ON harvest_jobs(user_id,normalized_url,COALESCE(json_extract(options,'$.developerMode'),0));
