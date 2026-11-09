-- 步骤 2 的设计草案。未加入 Wrangler migrations，未对本地/远程 D1 执行。
-- 单个 JSON 配置上限 1 MiB；密钥分行加密，操作账本不保存请求正文。
CREATE TABLE settings_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
    initialized INTEGER NOT NULL CHECK (initialized IN (0, 1)),
    config_json TEXT CHECK (config_json IS NULL OR (json_valid(config_json) AND length(CAST(config_json AS BLOB)) <= 1048576)),
    CHECK ((initialized = 0 AND revision = 0 AND config_json IS NULL) OR (initialized = 1 AND revision >= 1 AND config_json IS NOT NULL))
);
INSERT INTO settings_state VALUES (1, 1, 0, 0, NULL);

CREATE TABLE settings_devices (
    device_id TEXT PRIMARY KEY,
    last_sequence INTEGER NOT NULL CHECK (last_sequence BETWEEN 1 AND 9007199254740991),
    updated_revision INTEGER NOT NULL CHECK (updated_revision >= 1)
);
CREATE TABLE settings_operations (
    operation_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
    body_hmac TEXT NOT NULL CHECK (length(body_hmac) = 64),
    hmac_key_id TEXT NOT NULL,
    applied_revision INTEGER NOT NULL UNIQUE CHECK (applied_revision >= 1),
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    actor_user_id INTEGER NOT NULL,
    accepted_at TEXT NOT NULL,
    UNIQUE (device_id, sequence)
);
CREATE TABLE settings_secrets (
    provider_id TEXT PRIMARY KEY,
    encryption_version INTEGER NOT NULL CHECK (encryption_version = 1),
    key_id TEXT NOT NULL,
    nonce BLOB NOT NULL CHECK (length(nonce) = 12),
    ciphertext BLOB NOT NULL CHECK (length(ciphertext) BETWEEN 17 AND 8208),
    secret_revision INTEGER NOT NULL CHECK (secret_revision >= 1)
);
CREATE TABLE settings_deleted_entities (
    entity_key TEXT PRIMARY KEY CHECK (json_valid(entity_key)),
    deleted_revision INTEGER NOT NULL CHECK (deleted_revision >= 1)
);
-- 每个提交 batch 首先插入一行断言；revision/初始化/sequence 不符时 ok=0
-- 触发 CHECK 失败，使整个 batch 回滚。最后 DELETE 此行；不在事务外使用。
CREATE TABLE settings_commit_guard (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ok INTEGER NOT NULL CHECK (ok = 1)
);
