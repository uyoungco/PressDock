-- 升级时先固定旧任务依赖，随后冷启动替换全局设置也不会改动它们的执行配置。
-- 仅保存 OS 安全库引用；此视图和任务 JSON 均不包含密钥值。
CREATE VIEW migration_ai_execution_snapshots AS
SELECT m.id,
json_object(
  'model',json_object('id',m.id,'providerId',m.provider_id,'modelId',m.model_id,
    'displayName',m.display_name,'contextWindow',m.context_window,
    'maxOutputTokens',m.max_output_tokens,'reasoningEffort',m.reasoning_effort),
  'provider',json_object('id',p.id,'displayName',p.display_name,'baseUrl',p.base_url,
    'protocol',p.protocol,'hasApiKey',json(CASE WHEN p.credential_ref IS NULL THEN 'false' ELSE 'true' END),
    'compatibility',json(p.compatibility)),
  'credentialRef',p.credential_ref
) AS snapshot
FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id;

UPDATE harvest_jobs SET options=json_set(options,'$.metadataSnapshot',json(
  (SELECT snapshot FROM migration_ai_execution_snapshots WHERE id=json_extract(harvest_jobs.options,'$.modelConfigId'))
))
WHERE json_extract(options,'$.metadataSnapshot') IS NULL
  AND (json_extract(options,'$.autoClassify')=1 OR json_extract(options,'$.autoTags')=1 OR json_extract(options,'$.autoSummary')=1)
  AND EXISTS(SELECT 1 FROM migration_ai_execution_snapshots WHERE id=json_extract(harvest_jobs.options,'$.modelConfigId'));

UPDATE harvest_jobs SET options=json_set(options,'$.paginationSnapshot.execution',json(
  (SELECT snapshot FROM migration_ai_execution_snapshots WHERE id=json_extract(harvest_jobs.options,'$.paginationSnapshot.modelConfigId'))
))
WHERE json_extract(options,'$.paginationSnapshot') IS NOT NULL
  AND json_extract(options,'$.paginationSnapshot.execution') IS NULL
  AND EXISTS(SELECT 1 FROM migration_ai_execution_snapshots WHERE id=json_extract(harvest_jobs.options,'$.paginationSnapshot.modelConfigId'));

DROP VIEW migration_ai_execution_snapshots;
