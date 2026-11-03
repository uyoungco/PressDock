CREATE TABLE channel_edit_drafts (
    user_id INTEGER PRIMARY KEY NOT NULL CHECK (user_id > 0),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
