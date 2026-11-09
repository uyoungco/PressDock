-- 步骤 2 的设计草案。未放进 src-tauri/migrations，不会修改现有用户数据库。
CREATE TABLE sync_generations (
    id TEXT PRIMARY KEY,
    cloud_revision INTEGER NOT NULL CHECK (cloud_revision >= 1),
    config_json TEXT NOT NULL CHECK (json_valid(config_json)),
    secrets_ready INTEGER NOT NULL DEFAULT 0 CHECK (secrets_ready IN (0, 1))
);
CREATE TABLE sync_generation_secrets (
    generation_id TEXT NOT NULL REFERENCES sync_generations(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    credential_ref TEXT,
    PRIMARY KEY (generation_id, provider_id)
);
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    device_id TEXT NOT NULL,
    last_allocated_sequence INTEGER NOT NULL CHECK (last_allocated_sequence BETWEEN 0 AND 9007199254740991),
    active_generation TEXT REFERENCES sync_generations(id),
    pending_generation TEXT REFERENCES sync_generations(id),
    last_observed_revision INTEGER NOT NULL DEFAULT 0 CHECK (last_observed_revision >= 0)
);
-- 大型秘密值/冻结请求仅保存认证密文；小型随机解密密钥由平台安全存储管理。
CREATE TABLE sync_secure_payloads (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('request', 'secret')),
    encryption_version INTEGER NOT NULL CHECK (encryption_version = 1),
    credential_key_ref TEXT NOT NULL,
    nonce BLOB NOT NULL CHECK (length(nonce) = 12),
    ciphertext BLOB NOT NULL CHECK (length(ciphertext) > 16)
);
CREATE TABLE sync_outbox (
    operation_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
    schema_version INTEGER NOT NULL,
    safe_plan_json TEXT NOT NULL CHECK (json_valid(safe_plan_json)),
    wire_body TEXT,
    wire_body_payload_id TEXT REFERENCES sync_secure_payloads(id),
    status TEXT NOT NULL CHECK (status IN ('queued', 'uploading', 'waitingAuth', 'failedValidation')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    retry_at TEXT,
    last_error_code TEXT,
    CHECK ((wire_body IS NOT NULL AND wire_body_payload_id IS NULL) OR (wire_body IS NULL AND wire_body_payload_id IS NOT NULL)),
    UNIQUE (device_id, sequence)
);
CREATE TABLE sync_outbox_secret_refs (
    operation_id TEXT NOT NULL REFERENCES sync_outbox(operation_id) ON DELETE CASCADE,
    change_index INTEGER NOT NULL CHECK (change_index >= 0),
    payload_id TEXT NOT NULL REFERENCES sync_secure_payloads(id),
    PRIMARY KEY (operation_id, change_index)
);
CREATE INDEX sync_outbox_order ON sync_outbox(device_id, sequence);
