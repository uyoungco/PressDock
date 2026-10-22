CREATE TABLE source_articles (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    content TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0, 1))
);

CREATE TABLE drafts (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL UNIQUE REFERENCES source_articles(id),
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('imported', 'draft', 'review', 'published', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX drafts_updated_at ON drafts(updated_at DESC);
