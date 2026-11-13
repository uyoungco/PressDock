-- 冻结的旧操作不可改写身份或请求正文；保留并明确阻止旧协议自动上传。
UPDATE sync_outbox SET status='failedValidation',last_error_code='UNSUPPORTED_VERSION',retry_at=NULL WHERE schema_version=1;
