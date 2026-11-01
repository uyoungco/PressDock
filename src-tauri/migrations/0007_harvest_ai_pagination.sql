-- 旧的免费本地分页不可静默升级为付费 AI 请求。原文和处理检查点保持原样。
UPDATE harvest_settings SET options=json_set(json_remove(options,'$.autoOrganize','$.autoPaginate'),'$.aiAutoPaginate',json('false'));
UPDATE harvest_jobs SET options=json_set(json_remove(options,'$.autoOrganize','$.autoPaginate'),'$.aiAutoPaginate',json('false'));
