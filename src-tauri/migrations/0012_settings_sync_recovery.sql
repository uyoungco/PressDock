-- 永久拒绝后的本机恢复副本；原始请求继续保持密文及稳定 operationId。
CREATE TABLE sync_recovery_batches (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    config_json TEXT NOT NULL CHECK (json_valid(config_json))
);
CREATE TABLE sync_recovery_credentials (
    batch_id TEXT NOT NULL REFERENCES sync_recovery_batches(id),
    provider_id TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    PRIMARY KEY(batch_id, provider_id)
);
CREATE TABLE sync_recovery_operations (
    operation_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES sync_recovery_batches(id),
    device_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    safe_plan_json TEXT NOT NULL CHECK(json_valid(safe_plan_json)),
    wire_body TEXT,
    wire_body_payload_id TEXT REFERENCES sync_secure_payloads(id),
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    last_error_code TEXT,
    CHECK((wire_body IS NOT NULL AND wire_body_payload_id IS NULL) OR
          (wire_body IS NULL AND wire_body_payload_id IS NOT NULL)),
    UNIQUE(batch_id, sequence)
);
