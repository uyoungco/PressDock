# ArticleHarvest 爬虫迁移评估

评估日期：2026-10-25。本文仅评估迁移，不接入真实采集、AI 或后台写入。

详细实施拆分、数据模型、IPC 契约和验收标准见 [ArticleHarvest 详细迁移方案](articleharvest-migration-plan.md)。

评估基于 ArticleHarvest 当前源码（HEAD `6ce0d27`）与 PressDock 当前工作区（HEAD `aff3406`，含已有未提交修改）。PressDock 正在开发的 AI 配置与标题优化也计入可复用能力；它们不等同于已经发布的稳定接口。

## 建议

优先将采集能力迁入 PressDock 的 Rust 业务层，沿用现有 React、类型化 IPC、SQLx 和安装包体系。先做一次 HTTP 与 CDP 兼容性验证，再确定是否需要保留 Python 采集工作进程。

选择原生迁移的依据是：实际站点实现集中于百家号，CDP 客户端与页面读取边界清楚，现有终端、后台认证、AI SDK 和提交流程大部分不应进入 PressDock 的采集模块。迁移需要复用的是行为与测试案例，不是整个命令行程序。

唯一不能提前认定等价的主要依赖是 `curl_cffi` 的 Chrome 指纹模拟。若代表性样本证明 Rust HTTP 方案明显退化，且普通 HTTP 模式必须保持原有能力，再使用仅负责采集的 Python sidecar（随应用分发的工作进程）。不要在没有验证前承诺 `reqwest` 可以完全替代它。

首期交付范围建议为：**百家号链接 → HTTP / Chrome CDP / Edge CDP 采集 → 本地原始素材和可编辑草稿**。后台格式化、AI 元数据和文章提交作为后续独立阶段。

## 两个项目的实际状态

| 能力       | ArticleHarvest 当前实现                                                                         | PressDock 接入含义                                                                |
| ---------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 来源站点   | `config.py` 注册百家号、百度移动链接和两个示例域名；只有 `adapters/baidu.py` 实现真实 HTTP 抓取 | 首期明确支持 `baijiahao.baidu.com`、`mbd.baidu.com`；示例站点不能作为现有能力承诺 |
| HTTP 模式  | `curl_cffi.requests.get(..., impersonate="chrome")`，最多重试 3 次                              | 独立无 CMS 凭据的 HTTP 客户端；补充明确的超时、字节数和重定向边界                 |
| 浏览器模式 | 自建 WebSocket CDP 客户端，连接已运行的 Chrome / Edge，读取渲染后的 DOM                         | 保留用户浏览器会话，通过桌面界面完成连接、选标签页和人工验证                      |
| 来源分页   | 相对链接补全、去片段环路检测、最多 30 页                                                        | 复用行为；增加分页不完整的显式结果，不能把截断误报为完整成功                      |
| 文章工作流 | `collect → format → AI metadata → submit`，普通模式自动提交                                     | 必须拆开；采集成功首先表示本地保存成功                                            |
| 批量与队列 | CLI 逐个输入 URL；`QueueManager` 和并发配置没有接入主流程                                       | 批量采集、持久任务和并发调度属于新增开发                                          |
| 本地稿件   | CLI 没有 PressDock 所需的持久素材与编辑草稿体系                                                 | 复用 `source_articles` / `drafts` 分表，事务写入                                  |
| 当前导入   | PressDock 的 `LocalArticleRepository.importArticle()` 调用 `create_demo_article`                | 增加真实采集服务，演示入口仍须有独立标识                                          |
| 当前编辑器 | `Textarea` 纯文本编辑，原文以文本展示                                                           | 不能把采集 HTML 直接当作现有正文展示；需明确 HTML 与纯文本字段                    |
| AI 配置    | PressDock 工作区已实现模型配置、系统凭据库与 Rust `generate_text()`                             | 后续复用通用调用，不再带入 Python OpenAI SDK 和默认密钥                           |
| 后台连接   | 两项目使用同一新闻后台；PressDock 当前实现认证和 PromoteData 素材操作                           | 可复用认证设施；文章创建与渠道素材创建是不同业务接口                              |

其他已确认的边界：`extract_time()` 虽存在于适配器，当前 `RawArticle` 和 `collect()` 并未传递发布时间。若要保留该字段，属于本次明确新增，而非现成功能搬运。

## 方案比较

| 方案                | 优点                                                                      | 成本与风险                                                             | 适用判断                                                |
| ------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Rust 原生迁移       | 保持单一桌面后端；复用现有认证、取消、存储与构建体系；最终用户无需 Python | 重写 DOM 解析与 CDP 行为；HTTP 指纹兼容性需验证                        | **推荐主线**，适合当前只有一个实际站点适配器的规模      |
| Python 采集 sidecar | 保留 BeautifulSoup / lxml / curl_cffi 的现有行为，缩短兼容性迁移距离      | 要新增机器协议、进程管理、取消和多平台 Python 打包；形成双语言维护成本 | HTTP 兼容性验证不通过，或交付更重视与旧采集链一致时采用 |
| 常驻本机 HTTP 服务  | 可供多个客户端调用                                                        | 新增端口、服务生命周期、鉴权和安装运维问题                             | 当前单机桌面场景没有足够收益，不作为首期方案            |

Tauri 官方支持通过 `bundle.externalBin` 分发 sidecar，并从 Rust 启动、读写子进程；不同目标架构需要相应二进制。PyInstaller 也需在目标操作系统上构建。来源：[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)、[PyInstaller](https://pyinstaller.org/en/stable/)。

本机现有 `dist/article_crawler.exe` 为 46,634,674 字节，约 44.5 MiB，仅用于说明当前完整 Python 产物规模；精简采集 worker 和最终安装包的增量需要重新构建测量。现有 ArticleHarvest CI 只启用了 Windows，不能据此认为 macOS 两种架构已获得相同打包验证。

## 推荐的接入结构

```text
React 素材导入 / 采集任务界面
  → features/import（业务编排与运行内状态）
  → services/tauri/collection（类型化请求与 Zod 校验）
  → commands/collection（认证、参数与权限边界）
  → collection::CollectionService
       → 来源适配器（首期 baidu）
       → HTTP fetcher / CDP fetcher
       → 提取结果校验与正文转换
  → database / SQLx
       → 原始素材 + 初始草稿，事务提交
```

建议新增 Rust `collection/{service,models,adapters,http,cdp}`，保持命令入口薄、适配器不依赖 React 或数据库。现有本地稿件 CRUD 可以保留，但应把采集职责从命名为 `CmsAdapter` 的稿件契约中拆出，避免继续混合本地存储、采集和远程发布。

建议的业务命令包括开始、取消、继续人工验证，以及浏览器连接和候选标签页选择；具体名称在实施时统一。每个采集任务携带稳定 `jobId`，后端保持权威状态，前端通过类型化进度消息或 Channel 接收阶段变化。切换页面后的状态查询与订阅恢复要有明确约定，不能只依赖可能丢失的通知。

任务状态建议为：

```text
queued → fetching → extracting → saving → succeeded
                 ↘ waiting_for_user → fetching
任一未完成阶段 → failed / cancelled
```

任务状态独立于现有 `ArticleStatus`。失败任务不能伪造成已经导入的文章。首期可限定同一浏览器连接一次采集一篇，后续再增加批量调度；应用重启时不自动恢复浏览器连接或重新发送外部请求。

CMS 登录状态、来源站浏览器登录状态应保持两套独立生命周期：CMS 令牌仅由现有 Rust 服务管理，来源站 Cookie 留在浏览器，不导出、不相互转发。退出或切换账号时取消任务并阻止旧结果提交和回填；提交临界区需处理会话变化与取消的竞态。

### 若采用 Python sidecar

新建无终端问答的采集 worker，仅保留 `adapters`、采集数据模型、HTTP / CDP 页面获取和提取逻辑。排除旧 CLI、后台客户端、AI 插件、默认凭据和 `.env`。

Rust 固定启动随安装包分发的 worker，以 UTF-8 JSON Lines 双向通信。消息需包含协议版本、任务 ID 和明确类型，例如 `collect`、`progress`、`choose_tab`、`needs_user_action`、`resume`、`cancel`、`result`、`error`。stdout 只写协议，诊断走脱敏 stderr；需限制消息大小、检测协议错误、实现握手超时与退出清理。

不能只把阻塞 CLI 包一层 JSON 输出：等待验证码时，worker 必须仍能处理继续与取消消息。Rust 校验 worker 返回结果并独占 SQLite 写入；worker 不直接读写 PressDock 数据库，也不接收 CMS 令牌和 AI 密钥。前端只获得采集业务命令，不获得通用 Shell 能力。

Windows 使用隐藏的受控子进程；macOS 分别构建 Apple Silicon / Intel 产物。退出时断开调试连接，保留用户浏览器和标签页。

## 数据与正文设计

首期延续现有纯文本编辑体验，同时保留 HTML 来源信息，避免一次迁移扩展为完整富文本编辑器项目。

| 数据                                   | 建议用途                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| 原始输入 URL、最终 URL、来源域名       | 保留来源溯源，处理移动链接和重定向                                                |
| 原始标题、作者、来源正文 HTML          | 保存为不可被编辑器覆盖的采集结果；HTML 指文章正文片段，不默认持久化整个浏览器页面 |
| 原文纯文本                             | 原文查看、搜索和 AI 输入；为当前 `source.content` 保持明确语义                    |
| 初始草稿纯文本                         | 交给现有编辑器修改，保存仍只更新 `drafts`                                         |
| 采集方式、适配器版本、时间、页数与警告 | 支持排查站点改版、重采和分页不完整                                                |
| 来源发布时间、媒体引用                 | 有可靠提取结果时独立保存，不把采集时间当发布时间                                  |

通过新增 SQLx 迁移扩展来源元信息或建立关联明细表，不覆盖既有迁移；迁移编号按实施时工作区最新状态分配。真实素材使用 `is_demo = 0`，已有演示数据保留标识。

来源 URL 规范化应保留影响文章身份的查询参数；不能沿用仅忽略片段的“标签页匹配键”作为所有站点的去重规则。重复导入默认提示已存在并打开已有稿件；显式重新采集创建新的来源版本或快照，不能覆盖已编辑草稿。服务端或数据库需处理重复点击与并发提交，不能只靠前端禁用按钮。

当前数据库的 `drafts.source_id` 是唯一关联；多版本来源应通过新的来源行或版本表表达，不能在现有来源行上反复改写原文。

后续接入后台格式化时，单独保存格式化 HTML。纯文本草稿编辑后，不能继续将修改前的 HTML 当作最新稿件发布；届时必须确定 HTML 编辑、纯文本转 HTML 或明确重新格式化的策略。

## 需要在迁移时处理的问题

1. **HTTP 兼容性不能按语法替换。** 旧采集依赖 Chrome 指纹模拟。`curl_cffi` 的能力涉及 TLS / HTTP/2 指纹，不只是 User-Agent；应使用代表性链接比较响应、提取结果与验证页比例。[官方项目说明](https://github.com/lexiforest/curl_cffi)
2. **HTML 清理不等于安全渲染。** 旧逻辑删除部分属性和注释，没有形成完整的标签、事件属性与 URL 协议白名单。首期按纯文本展示；以后显示 HTML 时，使用独立清理和受限预览，不把远程 HTML 放进具有应用 IPC 权限的页面执行。
3. **网络与分页需补齐边界。** 每一跳重定向和下一页都校验协议、允许域名及地址，生产抓取限制回环、内网和本机服务访问；CDP 调试入口作为明确的本机连接单独处理。增加单页大小、整篇大小、页数、总时长与取消限制。
4. **不能静默接受缺页。** 当前基类遇到空的后续页面会结束循环；达到 30 页也没有完整性提示。新结果应明确标识未完成，默认不按完整文章保存成功，或由用户明确选择保留部分内容。
5. **提取失败需要结构化错误。** 旧实现可能返回 `No title found` / `No author found` / `No content found`；拼接后的正文也不能靠一次字符串等值判断保证完整。标题、正文和分页逐页校验，作者缺失则保存为空并提示。
6. **普通 HTTP 模式丢失最终地址。** 当前 `fetch()` 只返回 HTML，基类把请求 URL 当最终 URL；重定向后的相对分页可能解析错误。新 fetcher 应统一返回 HTML 和真实最终 URL。
7. **分类配置存在冲突。** 当前 `plugins/ai_metadata.py` 提示词写的是“1 国内、2 国际、3 社会……”；2026-08-10 的后台契约研究记录则为“1 社会、2 娱乐、3 军事……”。二者矛盾已经确认，但本次没有重新查询线上分类，因此不能直接断言哪份代表当前后台。实施 AI 分类前需用实际分类接口核对并生成提示词，不复制旧映射。
8. **不带入默认凭据。** 旧入口存在固定登录参数，AI 模块存在源码默认配置，PyInstaller spec 将 `.env` 打包。新模块复用 PressDock 登录和系统凭据库，源码、安装资源、日志和前端存储不携带这些默认秘密。
9. **演示文案要按数据与功能区分。** 编辑页目前写死“演示素材”，Dashboard 和导入页也有演示描述。真实采集落地时需同步调整，已有演示记录仍显示标识；尚未接入的发布继续明确提示未配置。
10. **现有模型有正文容量边界。** 前端草稿限制 1,000,000 个 JavaScript 字符，Rust 保存限制 4,000,000 字节。引入原始 HTML 后需独立定义 HTML、纯文本、IPC 和 SQLite 的一致上限，不直接沿用某一侧长度计算。

## 后台格式化、AI 和提交的迁移范围

旧 `core/backend_client.py` 已给出真实客户端调用：`POST /api/Util/FormatContent`、`POST /api/Article`。这说明不必编造接口，但也不表示当前 PressDock 已实现这些接口，或已验证今天的线上契约。

旧格式化行为不仅是发送 HTML：先执行 `clean_html_aggressive()`，读取顶层 `content` / `smallText` / `titlePic`，再给段落与图片追加换行。若要求与旧格式化一致，应为这些步骤保存固定样本并分别验证，格式化结果不能覆盖采集原文。

AI 元数据只生成简介、分类和标签，后续复用 PressDock 的模型与密钥配置以及 `generate_text()`。现有 `PromptTemplate` 具有候选数量、标题长度和标题变量校验，属于标题业务模板，不能直接承载所有元数据工作流。建议增加有明确用途的元数据配置或模板类型，并保留逐字段校验、无效字段不覆盖有效值的规则。AI 失败不应丢弃已经采集并保存的原文。

文章创建必须与渠道 `PromoteData` 操作区分。旧客户端将内部标签数组在提交边界序列化为小写 `tags` 的 JSON 字符串；响应的 `Tags` 命名不能直接用于创建请求。该约定在真正实现提交前仍需重新核对。

“创建后台文章”也不应未经核实就显示为“已公开发布”。发布阶段需确认创建结果、远程文章 ID、真实发布状态、去重及超时后的查询核对方式。网络结果不明时禁止自动重复 POST。

特别注意：旧 CLI 的 `--dev` 只跳过最后提交，仍会登录、调用后台格式化并请求 AI。本次评估没有运行该入口；它不适合作为无外部副作用的迁移验证工具。

## 分阶段实施与验收

| 阶段                  | 工作                                                                                  | 完成判据                                                                             |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0：兼容性验证         | 固定脱敏文章样本，验证 Rust DOM 提取、HTTP 响应与 CDP 连接；普通模式与 CDP 分别评估   | 对代表性链接说明结果差异，决定纯 Rust 或采集 sidecar；不调用旧完整工作流             |
| 1：本地真实导入       | 适配器、来源分页、任务与取消、类型化 IPC、数据库事务、导入界面和演示标识调整          | 首期支持域名能产生真实原文和独立草稿；失败、取消不创建伪成功记录；重复导入不覆盖草稿 |
| 2：浏览器体验与打包   | 将 CDP 连接、选标签、验证码暂停、继续、断线重连完整接入界面；Windows / macOS 构建验收 | 读取已有登录态；取消或退出不关闭浏览器；新连接不接受旧任务响应；最终安装包可运行     |
| 3：格式化与 AI 元数据 | 接入真实格式化契约、分类来源和元数据专用配置                                          | 原文保持不变；网络或 AI 失败保留本地采集结果；不同 AI 字段独立校验                   |
| 4：后台文章提交       | 重新核对文章 API、状态与结果核对；单独设计用户提交入口                                | 只有真实可确认结果才显示成功；超时提示结果未确认；不会误调用渠道素材接口             |

阶段 1 可先交付 HTTP 模式，完整替代现有采集能力则必须完成阶段 2。CDP 核心可在阶段 0 验证，完整交互在阶段 2 完成。

粗略工作量：在一名熟悉现有项目的开发者、样本与测试环境齐备的前提下，阶段 0–2 原生方案约 6–10 个开发日，采集 sidecar 方案约 4–7 个开发日。此处是静态评估，必须在阶段 0 后修正；不包含新增站点、富文本编辑器、生产签名、Android 或后台发布。HTTP 指纹与站点改版是最大的估算不确定项。

## 验证记录与后续测试

本次使用 ArticleHarvest 自带虚拟环境执行：

```powershell
$env:ARTICLEHARVEST_BROWSER_TESTS='0'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONIOENCODING='utf-8'
& .\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

结果：共 47 项，45 项通过，2 项真实 Chrome / Edge 测试按配置跳过。现有测试主要覆盖分页、CDP 协议、标签页复用与 CLI 编排；工作流测试对后台与 AI 使用 Mock，不能据此证明真实站点、线上格式化或真实提交成功。

迁移时优先移植现有测试的行为约束，再补充缺页、错误标题、重定向后分页、正文大小、HTML 处理、取消与提交竞态、重复导入、数据库回滚和保存草稿不改原文等验收。浏览器验收使用本机测试站点及临时浏览器资料目录，避免自动化控制日常浏览器或操作线上内容。

本次未请求真实 AI、未登录 CMS、未写入线上素材、未启动或连接日常浏览器。PressDock 业务代码未修改；实施阶段需执行 README 所列前端、Rust 和打包检查。

## 主要本地证据

- ArticleHarvest：`config.py`、`main.py`、`adapters/base.py`、`adapters/baidu.py`、`core/html_fetcher.py`、`core/browser_fetcher.py`、`core/cdp_client.py`、`core/workflow.py`、`core/models.py`、`core/backend_client.py`、`plugins/ai_metadata.py`、`article_crawler.spec`、`.github/workflows/build.yml` 与 `tests/`。
- ArticleHarvest 的 `docs/research/backend-metadata-submission-contract.md` 为 2026-08-10 的历史证据；其中部分文件引用已随重构过时，本文以当前代码为实现依据。
- PressDock：`src/features/import/service.ts`、`src/services/storage/articles.ts`、`src/services/cms/adapter.ts`、`src/types/article.ts`、`src/pages/Import/index.tsx`、`src/pages/Editor/index.tsx`、`src-tauri/src/commands/articles.rs`、`src-tauri/src/database/repository.rs`、`src-tauri/migrations/0001_initial.sql`、`src-tauri/src/ai/client.rs`、`src-tauri/src/ai/models.rs`、`docs/architecture.md`。
