# 全局配置同步协议 v1

日期：2026-11-07。协议 v1 已用于独立开发及正式 Worker/D1；原生缓存、密文队列、冷启动和差量上报已接入。验收范围与实机补充项见开发计划的交付记录。

## 版本与归属

每个部署环境只有一份配置，没有账号所有者。所有请求均先验证现有 CMS 会话，`deviceId`、`operationId` 和操作者 ID 都不是授权凭据。操作者只能由 Worker 从真实 CMS 响应取得。

`schemaVersion=1`。所有版本、revision、sequence 都是 JSON 安全整数，上限 `9007199254740991`；不发送字符串数字。收到不支持版本时停止落地/上报，保留有效本机缓存和队列，不剥掉未知字段后回写。

`revision` 由服务端产生，未初始化内部值为 0；初始化成功为 1，之后每个首次成功应用的操作加 1，包括只修改密钥的操作。不使用设备时间排序。HTTP 到达与并发重试可能交错，“最后收到生效”具体按服务端原子提交的接受顺序判断。

数组顺序没有业务含义，客户端以实体标识查找，不能用数组下标表达修改。提供商、模型、模板以 `id` 标识；图片预设以 `[channel, subChannel, field]` 三元组标识，字符串按原值比较，不分割 `/`、`~` 或中文。各列表只控制排序展示，不同步本机布局顺序。

## 字段映射与规范化

机器可读的逐字段映射见 [field-map-v1.json](field-map-v1.json)，覆盖现有提供商、保存请求、兼容选项、模型、模板、分页参数、渠道图片预设、尺寸及采集设置。Rust 测试将持久设置结构实际序列化后的字段与清单比较，新增字段必须重新决定同步范围。

| 现有数据                                               | 云端表达                                               | 规则                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------- |
| 提供商 `id/displayName/baseUrl/protocol/compatibility` | `config.providers[]`                                   | `id` 不可修改；兼容选项按子字段更新                                   |
| 模型全部 7 个字段                                      | `config.models[]`                                      | `id/providerId` 不可修改，其余独立更新；同一提供商的 `modelId` 唯一   |
| 模板除 `isDefault` 外的全部字段                        | `config.templates[]`                                   | `id/purpose` 不可修改；正文整体作为一个字段                           |
| 模板 `isDefault`                                       | `config.defaults.titleTemplateId/paginationTemplateId` | 每种用途至多一个默认模板；无默认为 `null`；原生读取时派生 `isDefault` |
| 提供商 `hasApiKey`                                     | 不进入云端快照                                         | 前端只根据本机安全凭据是否可用派生，不将云端存在误报为本机可用        |
| 保存提供商的 `apiKey`                                  | 独立 `setSecret/clearSecret`                           | 留空保留不生成修改；清除必须显式操作                                  |
| 渠道的 `titlePic/titlePic2`                            | 各自一条 `config.imagePresets[]`                       | 渠道、子渠道、图片字段不可修改；改标识需删除旧项并创建新项            |
| 图片 `size/maxBytes/format`                            | 同名字段                                               | 本机缺省 `undefined/None` 转为显式 `null`，表示不约束该项             |
| 采集 AI 的五个字段                                     | `config.harvest`                                       | `autoClassify/autoTags/autoSummary/aiAutoPaginate/modelConfigId`      |
| 采集来源、CDP、浏览器、开发者模式、保留天数            | 不进入协议                                             | 保存时从原本机设置合并，不能被云端默认值覆盖                          |

主题、导航、列宽/显隐、浏览器目录、CMS/来源会话、运行缓存、原文、草稿、任务、任务配置快照及临时 AI 参数也不进入协议。已运行任务保留自己的配置快照，不因同步重跑 AI 或 CMS 操作。

除下述兼容性限制外，字段复用现有 Rust 业务校验：提供商 ID 为小写字母开头的 1—64 位字母数字/连字符；名称与模型配置 ID 最多 100 Unicode 字符；上游模型 ID 最多 200 字符；提示词各最多 20000 字符；候选数 1—10、标题长度 1—200；token 参数为空或 1—4294967295，输出不得超过上下文；推理强度为 `low/medium/high/null`。

提供商地址最多 2048 UTF-8 字节，HTTPS 或 loopback HTTP，无用户名、密码、查询参数或片段。此处只保存配置，不由 Worker 请求 AI 地址。`{{...}}` 变量沿用标题和分页各自的白名单；两端统一以 Unicode White_Space 修剪变量名。分页参数须满足 `1 ≤ minChars ≤ targetChars ≤ maxChars ≤ 10000`。

图片单边 1—16384、总像素最多 24000000、体积 1—20971520 字节，格式为 `jpeg/png/webp`；三个约束均可为空。协议新增渠道/子渠道各最多 1024 Unicode 字符的限制。采集模型引用沿用原生设置最多 100 UTF-8 字节的限制。导入现有值不符合这些限制时明确失败，禁止截断或静默丢项。

## 快照与秘密边界

普通快照结构为：

```json
{
  "schemaVersion": 1,
  "revision": 7,
  "config": {
    "providers": [],
    "models": [],
    "templates": [],
    "imagePresets": [],
    "defaults": { "titleTemplateId": null, "paginationTemplateId": null },
    "harvest": {
      "autoClassify": false,
      "autoTags": true,
      "autoSummary": true,
      "aiAutoPaginate": false,
      "modelConfigId": null
    }
  }
}
```

所有键明确列出，可空字段也不能省略；未知字段拒绝。完整的非空演示见 [fixtures-v1.json](fixtures-v1.json) 的 `base`。`systemPrompt` 可以是空串，`userPrompt` 不允许空白；可空字段用 `null`，不通过空串表达清除。

冷启动的 Rust 网络响应使用 `Bootstrap { snapshot, secrets }`，`secrets` 必须为每个提供商恰好提供一项 `{providerId, value}`：值为密钥明文或显式 `null`。漏项不是“保留旧密钥”，而是响应不完整，整份拒绝。快照与秘密在同一数据库读事务取得，保证同一 revision；不能分别查询后拼接可能跨版本的结果。

Bootstrap 只在 Rust 与 Worker 内处理，不成为普通 IPC 返回类型，不写 SQLite 或 localStorage。Rust 按 generation 准备安全凭据及非秘密配置，全部成功后切换有效版本；`null` 的提供商不继承旧密钥，已删除提供商的凭据从新有效配置中移除。前端继续只得到既有配置及本机密钥可用状态。

## 修改协议

```json
{
  "schemaVersion": 1,
  "operationId": "00000000-0000-4000-8000-000000000001",
  "deviceId": "00000000-0000-4000-8000-000000000002",
  "sequence": 1,
  "changes": [
    {
      "type": "set",
      "target": { "entity": "model", "id": "demo-model" },
      "field": "displayName",
      "value": "演示新名称"
    }
  ]
}
```

示例中的 UUID、模型及密钥样例均为演示数据。真实 `operationId/deviceId` 使用小写标准 UUID v4；deviceId 代表安装实例，重装或恢复旧备份时分配新 deviceId，避免倒退的 sequence 与其他安装冲突。

| 修改类型      | 内容                    | 精确语义                                                  |
| ------------- | ----------------------- | --------------------------------------------------------- |
| `create`      | `entity` 与完整 `value` | 仅新增；已存在报 `DUPLICATE_ENTITY`，不当作整份更新       |
| `set`         | `target/field/value`    | 只改允许字段；不存在报 `ENTITY_NOT_FOUND`，不自动创建     |
| `delete`      | `target`                | 删除指定项；不静默级联修改其他配置引用                    |
| `setSecret`   | `providerId/value`      | 新增或替换密钥，值不能为空/控制字符或超过 8192 UTF-8 字节 |
| `clearSecret` | `providerId`            | 显式清除当前密钥；不能以 `setSecret(value=null)` 代替     |

没有提交的字段保持原值。`null` 只清除允许为空的字段；删除实体与置空字段不同。清除默认模板必须提交其默认 ID 为 `null`；删除仍作为默认项的模板时也须在同次修改中清除或替换该默认引用。

允许的 `set.field`：

| target.entity | 可修改字段                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `provider`    | `displayName/baseUrl/protocol/compatibility.maxTokensField/compatibility.systemRole/compatibility.sendStore` |
| `model`       | `modelId/displayName/contextWindow/maxOutputTokens/reasoningEffort`                                          |
| `template`    | `name/systemPrompt/userPrompt/modelConfigId/candidateCount/maxLength/paginationOptions`                      |
| `imagePreset` | `size/maxBytes/format`                                                                                       |
| `defaults`    | `titleTemplateId/paginationTemplateId`                                                                       |
| `harvest`     | `autoClassify/autoTags/autoSummary/aiAutoPaginate/modelConfigId`                                             |

前三类 target 为 `{entity,id}`；图片为 `{entity,channel,subChannel,field}`；单例为 `{entity}`。`paginationOptions` 和图片 `size` 是有联合约束的原子字段，整组更新；提供商 compatibility 三个选项分别更新。同一操作对同一实体同一字段只允许一次；创建/删除不能和该实体的其他非秘密修改混用。可在创建提供商的同一操作中设置其密钥。

先在副本应用全部修改，再校验最终值、唯一性、默认项用途和引用关系；任何一项失败，整批不产生有效结果。允许在同次操作解除模板/采集引用并删除模型；提供商下的模型也须显式删除或解除，不以隐式级联覆盖其他设备新建的模型。开关启用但尚未绑定 AI 模型仍可保存，实际任务入口沿用已有缺配置错误，不自动选择模型或付费调用。

提供商/模型/模板的删除标识持久保留墓碑，禁止用同一 ID 创建另一个实体；旧 `set` 也不会复活删除项。图片预设的业务三元组可在删除后显式重新创建，不写入永久 ID 墓碑；迟到的字段修改仍遵循该三元组的最后有效提交规则。全空图片约束可保留一条规范化记录；落地到现有预设表时没有约束的字段可不存行，有效同步快照仍保留其身份。

## 初始化、幂等与顺序

初始化结构为 `Initialize {schemaVersion, operationId, deviceId, sequence, config, secrets}`，没有客户端 revision。秘密列表同 Bootstrap 一样须覆盖所有提供商；读取某个已有本机密钥失败时不冒充 `null`。只有指定当前电脑执行初始化，其他设备只读取或等待。Worker 对未初始化状态原子创建；云端已有数据时新初始化返回 `ALREADY_INITIALIZED`，不覆盖。原初始化操作的重试仍可取回原 receipt。

成功回执为 `Receipt {schemaVersion, operationId, deviceId, sequence, revision}`，无配置正文、密钥或操作者信息。Rust 必须核对回执身份与正在发送的操作一致才能出队；回执不是最新配置快照，也不触发运行中整份读取。重复回执的 revision 可以小于当前云端版本，不得用它回退本机观察到的版本。

以下顺序是步骤 3 服务端的强制约定：

1. 校验登录、版本、请求大小与信封；不能以旧操作 ID 绕过当前鉴权。
2. 查永久成功账本。相同 operationId、deviceId、sequence 及原始请求字节指纹，返回原 receipt，不重复写入、不递增 revision；ID 相同但内容变化返回 `OPERATION_ID_REUSED`。
3. 未成功记录的操作要求 sequence 大于该 device 的最后成功 sequence。允许间隙，禁止倒退或复用已成功序号；同一设备客户端单线程按序上报，前一个结果不确定时不发送下一个。
4. 基于最新云端状态仅合并本次字段，校验最终配置，用 revision 条件保护的原子事务提交配置、密钥、设备序号、墓碑和成功账本。CAS 竞争失败重新读取并合并同一修改，不使用旧整份快照重试。

只保留成功应用的账本；权限、验证和临时失败不递增 revision/设备成功序号。修正失败操作必须分配新 operationId/sequence；服务端不对失败验证做永久幂等保证。客户端永久验证失败会阻止该待传项自动重试，后续修正可跳过该序号，不能让新内容冒用旧 ID。

客户端第一次发送前冻结 UTF-8 请求字节。非秘密请求可保存完整字节到 SQLite；含密钥请求的完整冻结正文和稳定密钥副本经 AES-256-GCM 加密，密文保存到独立 `sync_secure_payloads`，每份随机解密密钥放原生安全存储，队列表仅记录引用与无秘密计划。完整大请求不作为系统凭据条目的明文密码；SQLite 和日志均无秘密明文。AAD 绑定本机安装、payloadId、用途和加密版本，所有解密失败明确报错，不替换成空值。重试必须发送完全相同的解密后字节，空白或键顺序变化也视为不同内容。账本只保存原始字节的 HMAC-SHA-256 及 keyId，不保存请求正文或裸密钥摘要；HMAC Secret 与加密 Secret 分开，旧指纹密钥须保留以核对历史重试。

成功账本、设备高水位和 ID 墓碑不按历史保留天数删除、不设有限 TTL，避免长期离线的旧操作重新生效。客户端时钟、创建时间和账号不参与顺序判断。

## 大小与错误

原始 JSON 最大 2097152 UTF-8 字节，解析前限制；配置以紧凑 JSON 编码最大 1048576 字节，解析后的整数按规范化整数编码计量。JSON 最大嵌套深度 32，UTF-8 无 BOM、无孤立代理项，拒绝非有限数字。Unicode 字符数不等于字节数；超限整体报错，不截断。

单操作 1—128 个修改；提供商最多 64、模型 1024、模板 128、图片预设 2048 条。配置和数量上限同时适用，达到某项数量上限不保证仍能放入最大长度正文。加密密钥分行保存，不把完整 Bootstrap 存进一条 D1 记录。

业务错误响应约定为 `{schemaVersion:1,error:{code,retryable,operationId}}`，operationId 仅在有效信封中返回，否则 `null`。不携带原始值、密钥、CMS 原文或底层异常。

| HTTP | code                                                                                            | 客户端处理                                                      |
| ---- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 400  | `INVALID_DOCUMENT`                                                                              | 修正编码/JSON；不自动重试                                       |
| 401  | `AUTH_REQUIRED/AUTH_EXPIRED`                                                                    | 保留缓存与队列，暂停并等待登录                                  |
| 403  | `CMS_FORBIDDEN`                                                                                 | 暂停，提示权限问题                                              |
| 409  | `NOT_INITIALIZED`                                                                               | 首次读取等待指定设备初始化；已有有效缓存可继续使用              |
| 409  | `ALREADY_INITIALIZED`                                                                           | 禁止覆盖；初始化界面转为已存在状态                              |
| 409  | `DUPLICATE_ENTITY/ENTITY_DELETED/ENTITY_NOT_FOUND/REFERENCE_NOT_FOUND`                          | 保留本机修改并提示修正，不自动整份拉取                          |
| 409  | `OPERATION_ID_REUSED/SEQUENCE_STALE`                                                            | 保留队列并提示协议/设备状态错误，禁止改 ID 盲目重发不确定旧操作 |
| 413  | `PAYLOAD_TOO_LARGE`                                                                             | 明确超限，修正后新操作，不截断                                  |
| 422  | `VALIDATION_FAILED/UNKNOWN_FIELD/DUPLICATE_CHANGE`                                              | 修正数据后新操作                                                |
| 426  | `UNSUPPORTED_VERSION`                                                                           | 提示升级，保留缓存，不写云端                                    |
| 429  | `RATE_LIMITED`                                                                                  | 退避，遵守 Retry-After，不换 operationId                        |
| 503  | `CMS_TIMEOUT/CMS_UNAVAILABLE/CMS_INVALID_RESPONSE/D1_UNAVAILABLE/WRITE_BUSY/SECRET_UNAVAILABLE` | 有上限退避，同字节重试；启动无缓存提供重试                      |
| 500  | `INTERNAL_ERROR`                                                                                | 结果不确定，保留操作并退避重试，不显示上报成功                  |

网络中断/超时同样视为结果不确定，保留稳定操作。新业务端点采用此错误信封；步骤 1 `/api/v1/verify` 仍保留现有 `{ok,code}`，不把两种响应混用。

## 计划端点

| 入口                               | 输入 / 输出                             | 调用时机                                              |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `GET /api/v1/settings/bootstrap`   | Bootstrap；未初始化返回 NOT_INITIALIZED | Rust 冷启动成功读取一次；失败允许重试；用户可手动同步 |
| `POST /api/v1/settings/initialize` | Initialize → Receipt                    | 指定电脑的一次性初始化                                |
| `POST /api/v1/settings/operations` | Operation → Receipt                     | 保存后上报、恢复网络或下次启动补传                    |

均经 Rust 发起、HTTPS Bearer 鉴权，POST 为 `application/json`，无查询参数，响应 `Cache-Control: no-store`。没有任意 SQL、任意上游地址或允许跳过鉴权的故障入口。运行中上报不额外 GET Bootstrap。

## 存储及迁移设计

可执行语法草案：[D1](d1-v1.draft.sql)、[本地 SQLite](local-v1.draft.sql)。两者只在测试专用内存 SQLite 中检查，不加入自动迁移目录；步骤 3/4 实施时再编号和应用。

D1 使用一个非秘密配置 JSON 行及 revision，而非为账号建立配置表。密钥独立行采用 AES-256-GCM、每次随机 12 字节 nonce、密文含 16 字节 tag，版本及 keyId 随行保存；AAD 绑定部署环境、提供商 ID、secret_revision 和加密版本。主密钥放 Worker Secret；轮换时保留解密旧版本能力。删除提供商时在同一提交删除对应密文；clearSecret 删除该密钥行并递增全局 revision。

D1 不依赖跨请求 `BEGIN/COMMIT`。步骤 3 采用事务性 `batch()`：先插入 `settings_commit_guard`，在 SQL 中比较预期 revision、初始化状态及设备序号；断言失败触发 CHECK 异常，让全 batch 回滚，不能把 UPDATE 影响 0 行当成功继续记账。随后更新配置、批量密钥/墓碑、设备序号、回执，最后移除 guard。事务竞争有界重试，耗尽返回 WRITE_BUSY。数据量变化通过 JSON 参数批量处理，不能按 128 个修改逐项发 SQL 超过免费环境的查询预算；单次处理预算控制在 30 个 D1 查询以内，竞争预算不足则返回临时失败。

Bootstrap 在一条 SELECT 中取配置和密钥密文，避免查询间其他写入造成混合版本；采用 `UNION ALL` 分别返回一条配置行和各密钥行，不用 JOIN 重复大配置或把所有密文聚合成一个可能超过 D1 单行上限的值。读取会话从 `first-primary` 开始，满足冷启动获取当时主库最新已提交状态。写入前读取也以主库为起点；CAS 始终在提交事务内再次校验。

本地新增 sync_generations、sync_generation_secrets、sync_state、sync_outbox、sync_secure_payloads 及稳定密钥引用表。非秘密设置保存、序号分配与待传入队使用同一个 SQLx 事务；秘密先写原生安全存储，再保存密文及引用，失败补偿。下载先准备 generation 的配置和安全凭据，全部就绪后在事务中切换有效 generation，并把共享字段投影到现有设置表，合并原有本机字段。待传修改在新云快照上重放成本机视图；旧 generation/凭据、密文及解密密钥只能在无有效配置、待传项和运行任务引用时清理。

如果待传修改因远端删除等原因无法重放为完整有效配置，保留原有效本机配置及待传操作并显示具体错误，不切换到半份新配置，不自动改绑或上传整份旧缓存。修正引用后以新操作继续；原生下载准备的秘密也不得提前替换仍在使用的凭据。

本地 0010 迁移新增同步元数据；0011 将已有任务的非秘密模型、提供商和凭据引用补成执行快照，保留原文、草稿、任务状态和业务正文。新任务入队时固定这些配置；原生凭据的垃圾回收同时检查任务引用。回退期间不能继续云同步，重新升级时依据已存 operationId、generation 和队列恢复，不能重新导入旧设置或复用备份中的旧 deviceId/sequence。实际可执行 SQL 以 migrations 为准，文件名含 draft 的 SQL 仅记录步骤 2 的设计基线。

## 已提交操作查询与本机落地

`POST /api/v1/settings/check` 接收与 operations 相同的冻结原始请求字节。鉴权后核对永久账本和请求 HMAC，已提交返回原 Receipt，未知返回 `404 OPERATION_NOT_FOUND`，同 ID 不同原文仍返回 `409 OPERATION_ID_REUSED`。该入口不修改配置、不分配新 revision。

冷启动先取得一致 bootstrap，再查询本机每个待传操作。只有回执 revision 不大于所取快照 revision 时才移除该项，其余在快照上重放；避免服务器已接受的 create/delete 因响应丢失被本机重复重放。正常上报只确认精确匹配的队列项，不把服务端回执当作新配置覆盖本机后续编辑，不额外 GET 快照。

用户可通过 `settings_sync_manual` 主动同步：与后台上报串行，先补传可重试队列，再读取一次 bootstrap 并事务安装。临时补传失败仍尝试读取，未确认字段差量继续叠加并显示待传数量；鉴权失效、永久拒绝或要求重启时停止普通同步。快照版本不得低于本机已确认版本，失败保留有效配置、凭据与剩余队列。状态轮询、聚焦和网络恢复不触发读取。前端阻止未保存或处理中设置同步，先完成采集设置自动保存；同步时暂停设置编辑，安装成功后统一刷新设置及保存基线，不重建文章和草稿页面。该入口复用现有 API 和数据结构，无协议版本或数据库迁移。

每个待传请求整体使用随机 AES-GCM 密钥加密存入 SQLite，解密密钥仅放系统凭据库；避免 Windows 单条凭据大小限制。字段计划删除 setSecret.value，普通 IPC 只返回 hasApiKey。初始化采用同样的冻结机制，成功后仅保留初始化回执。在写入每份原生凭据之前，sync_credential_gc 先持久记录候选引用；事务切换成功且没有配置、队列、恢复副本或任务引用时才清理，清理失败可稍后重试。准备、提交、确认与回收使用同一数据库旁的进程间文件锁，避免另一应用进程提前清理准备中的密钥；进程退出自动释放锁，启动时可清理未提交引用。

本地 0012 迁移增加恢复副本。永久拒绝的队列由用户确认后，通过原生 `settings_sync_resolve` IPC 原子保留当前共享配置、全部待传密文及凭据引用，再移出待传队列并取消有效代际。当前进程进入 `restartRequired`，停止上传，不额外读取快照；完全退出后新进程冷启动读取云端，不重放副本。取消或事务失败保留原队列。此操作不新增云端 API，不撤销已接受的云端修改，也不改动业务数据和本机偏好。副本目前仅保留在原安装，尚无浏览或导出入口。

设置表单保存初次编辑时的基线，只对比本次编辑字段。采集规则仍沿用 500 毫秒防抖；主题、保留天数、采集方式和 CDP 等本机偏好不会生成云端操作。演示构建完全保存在本机，不访问真实云端、不保存真实密钥。

官方依据：[D1 batch 原子性](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[Sessions 与 first-primary](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession)、[D1 大小及查询限制](https://developers.cloudflare.com/d1/platform/limits/)。
