# PressDock

跨平台新闻编辑工作空间（News Editorial Workspace），面向渠道素材管理、稿件整理、图片处理与发布流程。桌面端已连接新闻后台登录、素材增删改、图片上传和当前页排序，并提供本地图片裁剪、压缩、格式转换与另存为；本地稿件保留演示标识，未连接真实采集、发布或 AI。

## 技术栈

Tauri 2、React 19、TypeScript 6、Vite 8、shadcn/ui（下拉选择使用 Base UI，其余组件使用 Radix）、Dice UI Data Table（Radix / Nova，TanStack Table 9）、Tailwind CSS 4、Jotai、React Router、Lucide、Zod、Rust、Tokio、SQLx 0.9 和 SQLite。实际解析版本以 package-lock.json / src-tauri/Cargo.lock 为准。

## 环境与启动

- Node.js 24、npm、稳定版 Rust，安装 rustfmt / clippy。
- Windows：MSVC C++ 编译工具、Windows SDK、WebView2。
- macOS：Xcode Command Line Tools；Intel 与 Apple Silicon 由对应架构构建。

```powershell
cd D:\Project\PressDock
npm ci
npm run tauri dev
```

仅预览登录界面：`npm run dev`，打开 `http://localhost:1420`。纯浏览器不提供工作区或真实登录入口；使用 `npm run tauri dev` 进入桌面端。桌面草稿保存于应用数据目录的 SQLite。当前机器的 Rust 位于 `.tools`，启动脚本自动识别，不需要全局 PATH；其他机器使用正常安装的 Rust。

## 已实现

- 整个工作区的登录保护、当前用户、退出和系统凭据库会话恢复；密码不保存，令牌不进入前端或 localStorage。
- 渠道素材真实筛选、服务端分页、详情、新增、修改、删除、图片上传和拖动排序；列表列顺序对齐 Web，独立双图列显示实际文件大小及解码尺寸，操作列固定，单图失败可重试。
- ArticleId、Url、LandUrl 通过系统浏览器打开，支持链接复制；外链协议限制为 HTTP/HTTPS。
- 本次运行内记住已提交筛选、页码及每页条数，离开页面后返回自动恢复；重置清空条件并保留每页条数。
- 工作台统计与最近文章、素材导入演示、文章筛选、编辑草稿、图片预览、发布状态、系统设置。
- 可复用图片处理组件：左侧拖动 / 键盘裁剪及缩放查看，右侧逐字段预设锁定；Rust 编码 JPG / PNG / WebP，严格核对实际尺寸、格式和体积上限，系统另存为且不覆盖已有文件。
- 可折叠桌面导航、移动抽屉布局、Hash 路由、浅色 / 深色 / 跟随系统，主题与导航偏好持久化。
- 类型化 IPC、Rust 应用信息及数据库健康检查、统一 Toast 错误反馈。
- SQLx 迁移、原始素材与草稿分表、本地保存读取、重复启动不覆盖已编辑稿件。
- 前端与 Rust 测试、ESLint、Prettier、Windows/macOS CI。

## 核心目录

```text
src/
  app/                     路由与 Provider
  atoms/                   Jotai 状态
  components/{ui,common,layout}/
  layouts/                 桌面 / 移动布局
  pages/                   工作区与登录页面
  features/                业务模型与服务
  services/{tauri,cms,storage}/
  types/ constants/ hooks/ styles/ test/
src-tauri/
  capabilities/ migrations/
  src/{commands,database,cms,ai,system,imaging}/
scripts/                   本地工具链适配
docs/                      架构、开发、Android 计划
.github/workflows/         跨平台 CI
```

## 检查与构建

```powershell
npm run lint
npm test
npm run build
npm run format:check
. .\scripts\use-local-rust.ps1
cd src-tauri
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cd ..
npm run tauri build
```

Windows 安装包输出到 `src-tauri/target/release/bundle/`（MSI / NSIS）；macOS 生成 app / dmg。当前未配置签名、公证、自动发布或自动更新；未签名产物用于开发测试，正式分发前需配置组织标识和签名。

无需安装即可运行 Windows 程序：双击 `D:\Project\PressDock\src-tauri\target\release\pressdock.exe`。修改代码后重新执行 `npm run tauri build`；开发时可直接运行 `npm run tauri dev`。

## 开发边界

真实采集、CMS 发布、AI、富文本编辑、发布任务持久化尚未实现。导入按钮只创建标识清晰的演示素材，不访问目标网址；发布检查始终返回未配置错误。原文独立保存，编辑不会自动改写事实。正文与密钥不写入 localStorage。

## 表格列配置

表格列显隐、鼠标 / 触控调整列宽及页面独立偏好的使用说明见 [Data Table](docs/data-tables.md)；渠道排序或保存期间锁定列配置。

## 本地图片处理

桌面登录后进入“图片处理”，选择静态 JPG、PNG 或 WebP，设置裁剪、输出宽高、体积上限和格式，点击“处理预览”查看实际编码结果；“确认结果”打开系统另存为，保存成功后才提示完成。取消不会上传图片或改动原图。已有同名文件不覆盖，请另取文件名。

输入最大 20 MiB，解码 / 输出单边最大 16384 像素、总像素最多 2400 万。默认保留源格式和像素尺寸，缩放查看与屏幕 DPI 不改变导出尺寸。JPG / WebP 根据体积搜索质量（最低 60），PNG 优先无损优化，必要时尝试通过色差检查的减色；无法满足体积上限时禁止确认。透明图片转 JPG 合成白底。支持 EXIF 方向与 RGB / 灰度 ICC 转 sRGB；拒绝动画、CMYK 和损坏的色彩配置，统一输出 8 位颜色。详细接口及验收记录见 [图片处理说明](docs/image-processing.md)。

无需登录和 CMS 的隔离交互验收：`npm run image:qa`，打开终端给出的本机地址。它只连接 Rust 测试编码器，明确标注验收，不提供系统另存为，也不改变纯浏览器工作区的认证限制。

## 新闻后台连接

“系统设置 → 子渠道图片预设”可分别配置 TitlePic、TitlePic2 的固定宽高（px）、体积上限（KiB）和一种输出格式（JPG、PNG 或 WebP）。宽高须成对填写，各项可留空；点击保存后写入本机 SQLite，同一工作区账号共用，重启保留。清空某个图片字段的预设后也需保存，不根据子渠道名称推断规则。

子渠道选择器完整显示长名称，空间不足时自动换行。选定目标子渠道后，可在“复制来源”中搜索任意渠道下已保存的其他子渠道预设，点击“复制预设”同时替换 TitlePic、TitlePic2 的表单值（含留空项）；检查或修改后点击“保存图片预设”才生效。未保存的修改不作为复制来源。

新增、修改素材时选择图片会打开处理弹框，并应用当前表单渠道、子渠道及对应图片字段的预设；已配置项锁定，未配置项可调整。仅 TitlePic 或 TitlePic2 地址输入框获得焦点时，粘贴图片才触发处理，纯文本照常粘贴。源图片支持静态 JPG、PNG、WebP，最大 20 MiB，输出可转换成预设格式。没有匹配规则时仍可自由处理，读取预设失败须重试。

点击“处理预览”后确认结果，上传成功才回填对应地址；失败保留结果供手动重试。处理及上传期间禁止保存素材、切换渠道或启动另一个图片操作。取消保留原地址，取消回填不能撤销已发出的上传；已上传文件不会自动删除。仍需保存素材才关联图片。手填地址不自动处理，之后修改渠道也不会自动重传图片。

接口固定为 `https://newsadmin.nccontrol.com.cn`，通过 Rust 请求 Login、CurrentUser、Logout、PromoteChannel 和 PromoteData。首次使用在桌面端输入后台账号密码；保留 PressDock 静态导航，不加载原站动态路由。HTTP 401 或业务码 A0230 要求重新登录，403 只提示无权限；网络失败可重试，不删除已保存会话。

令牌通过 Windows Credential Manager / macOS Keychain 保存，安全存储不可用时明确提示仅本次运行有效。退出时清除内存会话并禁用已保存凭据；应用数据目录中的 `cms-session-disabled` 仅为非秘密的禁用标记。后台退出可能不即时撤销旧令牌，应用不会宣称已完成服务端撤销。

渠道素材支持真实新增、修改、删除和排序，不提供全文抓取或转存本地草稿。摘要取自 SmallText。渠道配置超过 200 条会继续分页；素材总数仅作服务端参考，仅日期筛选时隐藏不可靠总数。下一页返回空列表时保留上一页，避免依据错误总数持续翻页。

渠道页筛选和操作区固定在顶部，分页固定在底部，只有中间列表滚动；横向滚动条位于分页上方，表头与右侧操作列保持可见。窄屏自动换行，详情及编辑弹层独立滚动。

排序必须完整搜索渠道、子渠道和日期，输入与已提交条件一致且当前页至少两条记录。开始后可拖动手柄或使用上移、下移按钮，期间锁定筛选、分页及增删改。只提交当前页全部 ID，每页排序值均从 1 开始；不调整其他页。保存前会重新查询当前页核对 ID 集合，变化时要求刷新。取消还原原顺序，保存失败保留调整结果。

新增和修改表单与 Web 保持相同字段，Channel、Title、TitlePic 必填；修改先读取完整详情并保留其他字段。保存成功刷新当前筛选和页码；删除需要二次确认，删除后空页退回前一页。图片可手填地址，或选择、粘贴后处理并上传；上传先验证实际解码和 MIME，成功只回填地址，保存素材后才关联；取消不会删除已上传文件。写请求不自动重试，超时或连接中断显示“结果未确认，请刷新核对”。

登录回跳与素材筛选保留路由查询参数。未保存的草稿与素材表单仅按账号保存在运行内存，同账号在会话失效后重新登录可恢复；显式退出或更换账号清除。离开未保存表单或排序前会确认，失效后重新进入页面时取消排序并重新查询。现有 SQLite 稿件属于共享本地工作区，本次未增加多账号数据库隔离。

筛选仅记住已提交条件；未点击搜索的修改在离开页面后丢弃。显式 URL 查询优先，前进后退同步记忆。筛选记忆在会话失效后同账号登录时保留，显式退出、更换账号或关闭应用后清空。

图片通过 `cms_load_promote_image` 获取，仅允许本次会话素材列表、详情或上传返回过的 HTTPS 图片地址。请求不带后台令牌或 Cookie，最多跟随 3 次 HTTPS 重定向，单图上限 20 MiB、超时 30 秒；图片服务器的 401 不影响登录。前端接近可视区域才加载，最多 4 个并发，同 URL 合并请求，Blob 内存缓存最多 64 MiB。大小按实际读取字节数计算，尺寸从图片解码获取；预览与元信息共用下载数据，图片和元信息不写入 SQLite 或 localStorage。离开页面释放预览 URL，认证状态变化清理图片缓存。

真实联调需在桌面端运行时登录，使用历史筛选 `2345 / 右侧轮播小图_头条_280x124 / 2026-10-21` 检查展示和筛选恢复。新增、修改、删除和排序保存的验收必须先拦截请求，禁止实际修改线上素材；上传协议可使用单张测试图片验证，不保存素材。不要将真实凭据或令牌加入测试、代码或日志。自动化测试使用本地 HTTP 服务器和凭据库替身，不操作真实素材。接口约定见 [渠道素材接口说明](docs/cms-promote-api.md)。

Android 尚未初始化 SDK / 原生工程或生成 APK，当前提供可运行的移动布局；后续见 [Android 计划](docs/android-plan.md)。不要直接将桌面尺寸和原生行为用于 Android。

详细说明：[架构](docs/architecture.md)、[开发指南](docs/development.md)、[初始化验收报告](docs/initialization-report.md)。官方参考：[Tauri 初始化](https://v2.tauri.app/start/create-project/)、[Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)、[shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)。
