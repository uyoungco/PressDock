# 配置同步协议 v2：正文整理

日期：2026-11-10。本文件记录本次增量；认证、设备序列、操作身份、加密和账本沿用 v1。HTTP 路径仍为 `/api/v1/settings`，文档的 `schemaVersion` 升为 2，二者含义不同。

新增 `templates[].purpose = bodyOrganization`、`defaults.bodyOrganizationTemplateId` 和 `harvest.aiOrganizeBody`。正文模板仅接受 `{{title}}`、`{{blocks}}`，`paginationOptions` 必须为 null。默认引用必须指向相同用途模板。Rust、Worker、字段差量及默认项删除语义一致；共享字段目录与测试用例分别见 `field-map-v2.json`、`fixtures-v2.json`。

客户端能读取缺少新字段的旧本机缓存，补为 false/null；这不表示接受旧 wire 文档。v2 服务拒绝 `schemaVersion:1` 请求并返回 `UNSUPPORTED_VERSION`，旧客户端同样拒绝 v2 快照，防止覆盖新字段。本机 SQLite 0013 保留旧模板、外键和独立默认项，增加整理检查点和未绑定模型的内置模板；不恢复用户删除的模板。

0014 将旧 v1 待传操作标记为 `failedValidation / UNSUPPORTED_VERSION`，保留原始冻结请求、operationId、sequence、加密引用及本机修改。不能直接改写请求版本并重发。恢复时使用现有“保留本机恢复副本后采用云端”流程，再在新客户端核对并重新编辑；原冻结操作不自动重放。尚待确认的旧初始化请求也不猜测远端是否应用，须按明确错误核对后处理。

Worker D1 0002 将已有状态升级到 v2，整理开关初始 false。为已初始化的云快照加入 V6 内置正文模板及默认引用，避免客户端启动采用云配置时丢失本机新增模板。已有同 ID 的用户模板不覆盖；模板已满 128 项或追加后会超过 1 MiB 时只补 false/null，用户需释放容量后手动新增正文模板。秘密密文、设备和操作账本不变。未初始化云状态仍由首次初始化提交完整配置。

上线顺序：备份 D1 和客户端数据库、暂停配置写入 → 对目标环境应用 0002 → 部署 v2 Worker → 升级各客户端 → 验证读取、正文默认项及一次差量保存。切换窗口中旧客户端暂时无法同步，已保存的本机修改保留。若需要回退，应恢复同一备份和匹配的旧服务/客户端，不能仅回退 Worker 后让新客户端写旧状态。

## 协议不匹配后的补传

`SyncStatus.phase` 增加 `protocolMismatch`。v2 冻结操作被 `UNSUPPORTED_VERSION` 拒绝时仍以 `failedValidation` 持久化，重启后根据队列的协议版本及错误码恢复准确状态。后台停止上报，界面提供“手动同步”，不引导用户丢弃这些新版待传修改。

手动同步先读取、校验并安装 v2 云端快照，查询冻结请求的原始回执，再只解锁 `schema_version=2 / failedValidation / UNSUPPORTED_VERSION` 的操作。原 operationId、sequence、请求字节和加密引用不变；已提交的操作按回执移出队列，未提交的按原顺序补传，再回读云端。网络、登录、凭据或校验失败不会解锁旧请求，其他永久校验错误也不会被重置。旧 v1 操作继续使用上文的副本恢复路径。

`GET /health` 返回 `schemaVersion:2`，不访问 CMS 或 D1；实际兼容性检查仍使用鉴权后的完整 bootstrap，不以健康检查代替配置校验。

## 2026-11-10 上线结果

开发与正式 D1 已应用 0002，v2 Worker 已部署。正式库迁移前后保持 revision 18，后续补传本机两项原请求后推进到 revision 20，待传为 0，完整云端回读一致。开发环境真实原生验证包含正文开关、模板、默认引用、旧字段与密钥的增删改及恢复。安装包、设备范围和备份记录见[修复验收](protocol-repair-2026-11-10.md)。
