# PressDock 架构

## 分层与数据流

```text
React 页面 / shadcn/ui
  → 业务服务（features）
  → CmsAdapter / LocalArticleRepository
  → 类型化 Tauri IPC（services/tauri）
  → Rust commands（工作区命令检查会话）
  → database / SQLx / SQLite，或 cms / reqwest / 固定新闻后台，或 imaging / 本地图片编码
```

组件不直接调用 `invoke`，不执行 SQL。IPC 返回值由 Zod 校验；Rust 同时校验保存请求及导入 URL。错误以 `{ code, message }` 序列化，前端统一以 Sonner 显示。数据库内部错误只写入本地诊断输出，不将 SQL 和路径暴露给用户。

## 目录职责

- `app`：Provider、Hash 路由和异常页面。
- `pages`：工作区与登录页面的视图及局部交互。
- `features`：文章统计、导入、编辑、图片和发布模型及服务。
- `components/ui`：shadcn/ui 可访问基础组件，Select / Combobox 使用 Base UI，其余沿用 Radix；`common` 为业务通用展示，`layout` 为导航与工具栏。
- `atoms`：主题、导航、搜索与编辑会话；派生 atom 展示编辑状态。
- `services/cms`：可替换服务契约与 Mock；`storage`：本地持久化适配；`tauri`：唯一 IPC 出口。
- Rust `commands`：薄入口；`database`：事务、迁移与查询；`system`：平台信息；`cms` / `ai`：服务配置契约；`imaging`：本地解码、取景、色彩管理和编码。

业务下拉统一使用 Base UI Select；渠道、子渠道使用 `common/SearchableSelect`，由同系列 Combobox 实现弹层内搜索。搜索仅在内存中过滤已加载选项，中文按名称包含匹配、英文忽略大小写，不触发远程查询或改变选中值。选中后才通知业务层；关闭清空搜索，禁用时收起弹层。空字符串对应“全部”，配置中已移除的历史值仍可回显。调用方显式合并加载、错误、预设和页面操作锁定条件；普通短列表不显示搜索栏。新增选择控件时使用现有 Base UI 封装，不通过当前 Radix registry 配置覆盖这两个组件。

## 存储规则

SQLite 位于 `app.path().app_data_dir()/pressdock.db`。目录由 Tauri 按平台决定，与源码和安装位置无关。SQLx 迁移编译嵌入二进制，启用外键、WAL 与忙等待；所有参数通过绑定传入 SQL。

`source_articles` 保留标题、来源 URL、原文与导入时间；`drafts` 保存编辑内容和状态，以外键关联素材。保存命令只能更新草稿表。初始化内置四条明确标识的演示素材，重复启动仅执行幂等插入，不覆盖现有草稿。媒体和发布任务表将在具备真实业务需求后新增。

纯浏览器只预览登录界面，不能进入工作区。`MockCmsAdapter` 仍作为隔离的内存测试适配器。桌面中读取和保存真实 SQLite 数据。前端的主题和导航设置可写入 localStorage；正文、文章与密钥不得写入。

## 认证与远程素材

`features/auth` 管理会话状态、恢复、登录、退出和安全回跳；`services/tauri/cms` 是 CMS 命令的类型化出口。Rust `cms` 持有可复用 HTTP 客户端、会话版本和系统凭据引用，令牌不跨越 IPC。组件只获得用户、角色、权限和持久化状态。

启动恢复通过 CurrentUser 验证凭据，完成前不挂载工作区。认证操作串行执行；请求携带内部会话版本，版本变化后丢弃结果。401 / A0230 清理会话，403 保留会话，网络异常保留凭据供重试。原有稿件命令在 Rust 中也检查会话；应用信息和健康检查公开用于诊断。

系统安全存储使用 keyring，阻塞的凭据操作放入 spawn_blocking。退出先清除会话并写入非秘密禁用标记，再尽力删除凭据和请求远程退出；下次启动看到标记不会恢复旧凭据。安全保存失败时只保留内存会话并提示用户，不回退为明文文件或 SQLite。

渠道素材使用独立远程模型，已知 PascalCase 后台字段在 Rust 转换为 camelCase，前端 Zod 校验，未知业务字段原样保留以支持完整更新。渠道配置按 200 条分页并分组去重；素材页只按用户操作取一页，停止条件结合实际返回条数。素材不写入业务数据库，日期保持 YYYY-MM-DD，不转换时区。列表详情展示已有字段，修改前 GET 完整记录，以底稿覆盖九个表单字段后 PUT。

`MaterialTable` 对齐 Web 列顺序，图片各占一列，操作列固定。`useChannelActions` 管理新增、修改、删除确认、排序、重复提交锁和离开确认。排序仅当前页且每页从 1 编号；拖放或键盘移动仅改内存。Rust 保存前重查同一页，严格核对唯一 ID 集合后提交小写 `{ promoteDataPutOrders: [{ id, order }] }`。写操作使用同一认证客户端，禁止重定向且不自动重试，网络错误提示结果未确认；成功和后续刷新失败分别反馈。

主窗口设 `dragDropEnabled: false`，使 Windows WebView2 将 HTML5 拖放事件交给前端；手柄同时支持指针落点移动，补齐未启动 HTML5 拖放的输入路径。文件通过标准选择器上传。配置依据 [Tauri WindowConfig](https://v2.tauri.app/reference/config/#dragdropenabled)。

工作区布局默认由主内容区滚动，渠道路由单独启用 `contentScroll="contained"`。渠道卡片填满剩余高度，筛选、操作栏和分页不参与滚动，列表区域独占双向滚动；表头和操作列在同一容器内 sticky，避免嵌套滚动条。新筛选或翻页成功后回到列表顶部，图片加载及内存排序不重置滚动位置。

图片上传在业务服务中验证大小和实际解码，Rust 复核 20 MiB 上限、文件名及图片 MIME，通过 reqwest multipart 的 `file` 字段提交。只回填 `data[0].cloudurl`，不随上传保存素材，不在取消时删除远程文件。详情及上传返回的 HTTPS 图片加入当前会话许可集合。外链经自定义 IPC 校验 HTTP/HTTPS，再由 Rust opener 打开；不开放通用 opener 前端能力。

`features/channels/query-memory` 只存当前运行已提交的查询。进入 `/channels` 时，显式查询参数优先；无查询参数时先替换为记忆中的地址，再挂载列表取数。路由变化、重置与空页回退更新记忆，输入框未提交内容不进入记忆。认证接受用户时校验所属账号；同账号重新登录保留，显式退出或换账号清空。

列表和详情共用 `MaterialImage`。IntersectionObserver 提前 240 px 触发图片业务服务，服务按 URL 合并请求并限制最多四个并发，缓存解码后的 Blob 和实际尺寸，按 LRU 限制 64 MiB。预览 URL 采用引用计数，最后一个消费者释放时撤销；认证版本变化取消排队任务、丢弃旧响应、撤销 URL 和清空缓存。图片不持久化。

`cms_load_promote_image({ url })` 返回 `{ mimeType, byteSize, dataBase64 }`，Zod 校验后转换为 Blob，用同一份数据解码与预览。Rust 按会话登记素材页中出现过的 HTTPS 图片地址，认证变化清空许可集合，下载完成再次校验会话版本。图片使用独立无认证、无 Cookie 存储的客户端，手动处理最多三次 HTTPS 重定向、整体 30 秒超时及实际流式字节数的 20 MiB 上限，不依赖 Content-Length。图片失败不触发 CMS 认证失效。

编辑缓冲只保存在进程内，本地稿件按用户 ID 和稿件 ID 区分，素材表单由 `channelEditBuffers` 按用户 ID 保存完整底稿与输入。会话失效后同账号登录可恢复，显式退出或换账号清空；排序在页面卸载时丢弃，重新登录后查询服务端顺序。SQLite 仍为现有共享本地工作区。

## 扩展边界

图片处理采用 `ImageProcessor → features/images/service → services/tauri/images → commands/images → imaging`。组件只接收 File / Blob，不接收任意远程地址；尺寸、体积和格式分别锁定传入的预设，业务层再次检查预设与返回结果。百分比裁剪映射到经 EXIF 校正的原图像素，不使用 DOM 尺寸或 devicePixelRatio 导出。

子渠道图片预设采用 `features/image-presets → services/tauri/image-presets → commands/image_presets → database/image_presets → SQLx`，本机 SQLite 按渠道、子渠道、图片字段唯一保存，不按账号隔离。素材表单通过局部焦点粘贴事件或文件选择启动处理弹框，每次读取最新规则，确认后经业务服务验证结果并调用现有 CMS 上传；成功仅回填地址。图片工作流与保存素材共用操作锁，会话变化和关闭后丢弃旧结果。

Rust 通过内容签名识别格式并复核 MIME，限制 20 MiB 输入、2400 万像素及解码器分配；动画明确拒绝。Little CMS 将嵌入的 RGB / 灰度 ICC 转为 sRGB 后去除原始方向和元数据，保持 Alpha。尺寸调整采用预乘 Alpha 的 Lanczos3；只有取景和显式输出宽高可改变尺寸，压缩搜索始终复用同一份处理后像素。`image` 编码 JPG、`libwebp` 编码 WebP、`png + oxipng` 无损优化，必要时 `exoquant` 减色并检查色差。细节见 [图片处理说明](image-processing.md)。

图片 CPU 工作放到 `spawn_blocking`，编码并发上限为 1，最多登记 8 个任务。任务 ID 对应取消标记；取消、卸载、参数变化及认证版本变化会中止或丢弃旧结果，RAII 清理任务。前端为预览 Blob 创建 URL，并在替换或卸载时撤销。输入与结果不进入数据库或 localStorage。另存为只由 Rust 调用 dialog 插件，未开放通用文件系统和前端 dialog 权限；保存前复核真实字节格式、扩展名和会话，使用 `create_new` 禁止覆盖已有文件，写入失败或写入期间取消时清理新建的半成品。

`scripts/image-qa.mjs` 仅作为显式启动的本机隔离验收工具，通过 Rust 单元测试执行真实检查和编码。该测试入口受 `cfg(test)` 限制，不存在于桌面产物，也不提供登录绕过、CMS 请求或导出命令。

`CmsAdapter` 继续承担旧本地稿件读写，其发布方法仍返回未配置错误。真实采集走独立的 `features/import → services/tauri/harvest → commands/harvest → harvest`，返回持久任务而非伪装成已完成的文章。后台 worker 复用 CMS 会话，经 FormatContent 和 Article 创建接口自动提交；文章创建与正式发布分别表述。

### 采集任务

`0004_harvest.sql` 新增单行设置与 `harvest_jobs`。入队请求 ID 保证幂等；迁移 `0005_harvest_developer.sql` 将唯一约束扩展为账号/规范化 URL/任务模式分别去重；配置快照在入队时固定，五项开关、所选模型和 developerMode 分离于清理保留天数；旧 JSON 缺少 developerMode 时按 false 读取。来源 URL、时间戳及入队本地日期固定保存，列表按当前账号和日期读取轻量字段，不回传正文/payload。前端先订阅刷新通知再读取数据库，离页只释放订阅，不停止 worker。

一个 Rust worker 原子领取当前账号的排队任务，处理期间复核 CMS 会话版本。原生采集窗口独立 label，业务 capability 只允许 main；通过 eval_with_callback 获取 DOM，不给远程页面开放 invoke。导航前标记旧文档，避免异步 navigate 读取上一页；只允许百度来源/登录导航，最终文章来源重新匹配适配器。标题就绪即更新，分页检查点保存在任务，采全后原文只插入一次到 source_articles；不自动创建 drafts。

采集处理复用原 HTML 清理、元数据逐字段校验、布局编号引用与原本地分页规则。正文整理和分页拆成四种组合；只分页保留段落 HTML，不触发 AI 清理。分类清单来自后台；AI 请求复用提供商/凭据客户端并使用 JSON 输出约定，关闭的元数据字段不生成。付费请求不自动网络重试，完整布局结构错误最多纠正一次。

最终待提交数据先入库，再标记 submitting 发出创建文章请求。明确成功后记为 succeeded；网络/异常响应或提交期间取消/退出记为 submissionUnknown，保留核对记录，不自动重发。启动先将旧运行状态恢复为 interrupted/unknown，再执行保留期清理，仅清理明确终态及不再被稿件引用的采集原文。模型删除前同时检查采集设置与未完成任务引用，防止删除凭据后才被外键拒绝。

开发者模式不改变 FormatContent、分类或 AI 链，最终分支返回独立 DebugCompleted 结果，不调用 Article，也不写 submitting。数据库提交意图更新额外限定任务模式为正常；调试终态加入历史清理和模型引用释放规则，关闭设置不重新提交已有调试结果。迁移以事务重建带扩展 CHECK 的任务表，完整保留旧列和记录，再重建索引。

调试数据由 Rust `harvest-debug` 类型化事件仅发到 main，携带 userId/jobId/attempt/timestamp/step/kind/data。Context 按任务模式惰性构建业务日志，正常任务不序列化完整 HTML；事件失败不影响采集。工作区统一订阅并按当前会话账号过滤，卸载释放监听。开发者开关通过 harvest_set_developer_mode 原子更新 options 中的 JSON boolean，与入队共用配置操作锁；前端以保存返回值更新勾选状态，不提交其他未保存表单。F12 经业务服务和类型化 IPC 调用 harvest_open_devtools；Rust 核对 main 窗口、有效 CMS 会话和已保存设置后调用原生 DevTools。桌面 release 启用 tauri/devtools，采集窗口显式禁用 DevTools，不增加远程业务权限。

### AI 配置与标题优化

`features/ai → services/tauri/ai → commands/ai → ai / database/ai` 是 AI 的唯一调用路径。`AiService` 复用独立 HTTP 客户端、凭据适配器及可取消任务；通用文本生成负责提供商和协议适配，标题服务负责模板展开、输出约定及候选过滤。新增模块可复用模型配置与通用文本调用，不需要依赖标题组件。

迁移 `0003_ai_settings.sql` 建立提供商、模型、提示词模板；本机工作区共用。模型在提供商下唯一，模板使用稳定的模型配置 ID 外键；被引用的模型或提供商不可删除。设置默认模板使用事务清除旧默认，部分唯一索引保证至多一个默认模板。内置模板只在迁移时创建，重启不覆盖用户修改。

提供商保存连接信息和协议兼容设置，模型保存可选容量、输出上限和推理强度。参考 deepseek-harness 的提供商/模型职责划分，Chat Completions 可选择输出限制字段及 system/developer 角色；可按服务商能力省略 `store`，默认发送 `store: false`。不引入外部插件运行时、凭据环境变量解析或自动模型目录。手动获取列表只读取标准 `data[].id`，不凭 ID 猜测上下文能力。

API 密钥仅在用户保存时经 IPC 交给 Rust，以随机凭据引用存入独立 keyring 服务 `com.example.pressdock.ai`；SQLite 只存引用，设置读取仅返回 `hasApiKey`。凭据操作经 `spawn_blocking`，写配置操作串行化。安全存储失败不落明文；AI 错误不携带上游原始正文、URL、密钥或平台错误。HTTP 不自动重试、不跟随重定向，连接超时 10 秒、整体 120 秒，响应最多 2 MiB。

标题弹窗捕获当前未保存的编辑快照。默认模板只在首次成功读取后自动调用一次，后续修改参数需显式重新生成。模板通过单次扫描展开变量，正文中的模板语法不会再次执行；两种协议统一提取文本，追加纯 JSON 字符串数组约定。去空、去重、过滤超长和控制字符，不自动补齐或截断。候选、正文及临时参数只保留在本次弹窗内，“采用”只进入现有编辑缓冲与未保存状态。

前端任务使用 UUID 和 AbortController，失效事件统一取消；Rust 用 watch 与 RAII 清理任务，最多同时运行四个，处理先取消后登记的竞态。工作区命令检查 CMS 会话，返回前复核版本，旧响应不能回填。AI 鉴权、限流、上下文和超时使用独立的 `AI_*` 错误码，不触发 CMS 认证失效；用户手动决定重试。

AI 配置与模板标签 forceMount 保留未保存表单，激活时更新可用配置。标题弹窗中的 Base UI Select 将菜单挂载到最近的 Radix DialogContent 内，以兼容嵌套模态、指针事件和焦点管理；其他 Select 的默认挂载不变。配置引导使用 `/settings?tab=ai-models` 或 `ai-templates`，沿用未保存编辑的离开保护。

未来长任务可继续采用任务 ID、事件或 Channel。AI 排版不得修改事实或原句，原文始终独立保存。

## 安全与平台

Capabilities 只允许主窗口调用明确列出的本地与 CMS 业务命令，没有文件系统、Shell、通用 HTTP、通用 SQL 或远程页面权限。生产 CSP 限制脚本与连接来源，远程请求只在 Rust 客户端执行；CMS 基地址固定，图片地址受当前会话素材许可集合限制。正文按纯文本渲染，不使用 `dangerouslySetInnerHTML`。素材图片和本地图片使用 blob URL 预览，退出时释放 URL；只有素材表单明确选择的文件通过上传命令发送。

桌面与移动布局独立，通过视口断点选择。路由采用 Hash 模式支持本地静态 WebView。Android 原生工具链和插件权限尚未初始化，见 `android-plan.md`。
