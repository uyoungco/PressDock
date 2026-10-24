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

`CmsAdapter` 是本地稿件业务服务契约，发布始终返回未配置错误。CMS 发布接入仍需确认接口，不得在页面中编造请求地址。采集工具没有确认协议前，导入只创建演示素材，绝不抓取或假装导入真实内容。

未来长任务使用任务 ID、事件或 Channel，并提供取消操作。凭据交给操作系统安全存储；前端配置只携带凭据引用。AI 排版不得修改事实或原句，原文始终独立保存。

## 安全与平台

Capabilities 只允许主窗口调用明确列出的本地与 CMS 业务命令，没有文件系统、Shell、通用 HTTP、通用 SQL 或远程页面权限。生产 CSP 限制脚本与连接来源，远程请求只在 Rust 客户端执行；CMS 基地址固定，图片地址受当前会话素材许可集合限制。正文按纯文本渲染，不使用 `dangerouslySetInnerHTML`。素材图片和本地图片使用 blob URL 预览，退出时释放 URL；只有素材表单明确选择的文件通过上传命令发送。

桌面与移动布局独立，通过视口断点选择。路由采用 Hash 模式支持本地静态 WebView。Android 原生工具链和插件权限尚未初始化，见 `android-plan.md`。
