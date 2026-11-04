# Android 首版开发与验收计划

本轮完成技术验证基础与渠道素材样板，按“技术验证 → 样板闭环 → 固化组件 → 文章管理 → 采集”推进。采用 Tauri + React + Rust + SQLx，要求 Android 7.0 / API 24 起的 ARM64 设备及系统 WebView 111+，compileSdk/targetSdk 36。文章管理、采集、AI 标题优化及正式签名发布留待后续迭代。

## 组件与状态边界

UI → 业务服务 → 类型化 IPC → Rust → SQLx。桌面和手机共享业务控制器；桌面窄窗口也可使用移动列表，Android 横屏始终使用移动视图。

- `useChannelController`：已应用查询、待应用筛选、分页、查询缓存、详情选择、滚动位置、写入刷新。
- `MobileChannelView`：单栏卡片、底部筛选、面板内部的渠道/子渠道选择、移动排序按钮。切换渠道清子渠道，取消恢复已应用值，应用后才查询。
- `useChannelActions` / `MaterialForm`：新增、编辑、删除、排序、离开拦截、全屏编辑和草稿恢复；明确保存才提交 CMS，上传图片不等于保存素材。
- `channelDraftService`：类型化草稿读写、快照、串行队列和认证切换隔离。正文不写 localStorage。
- Rust `channel_drafts` 与迁移 `0008`：按认证账号保存一个活动编辑会话，校验预期账号、字段结构和 256 KiB 上限；base 与 input 分离，不覆盖原素材。
- `platform.rs` / `PlatformPlugin.kt`：系统证书初始化、Keystore 加密凭据、content URI 导出与返回事件。秘密接口仅由 Rust 插件句柄调用，不向前端开放。

列表默认 20 条，可选 10/20/30/50；不依赖不可靠总数判断末页。查询保存在路由和本次会话中，返回恢复最近 30 个查询的滚动位置；应用新条件或主动翻页回顶部。Android 查询缓存空闲 5 分钟回收，图片缓存 24 MiB。

## 原生行为

- Android 版本与网页组件版本分别检查。Tauri 使用设备的系统 WebView；Tailwind v4 的最低 Chromium 版本为 111，Android 构建也显式以 chrome111 为目标。原生层在业务脚本加载前检测当前提供方；版本过旧时停用脚本并显示中文更新提示，提供应用商店入口与退出，避免白屏。参考 [Tauri WebView 说明](https://v2.tauri.app/reference/webview-versions/#android-webview-android)、[Tailwind 浏览器兼容性](https://tailwindcss.com/docs/compatibility#browser-support)。
- Keystore AES-GCM 加密登录凭据，密文在 noBackupFilesDir；退出禁用凭据，不回退明文。HTTPS 使用 Android 系统证书验证。
- 编辑停顿 500ms 自动保存 SQLite，进入后台补存；重进页面提示恢复/丢弃，读取失败可重试或明确清除。保留草稿并返回/离开会等待写入完成。
- 明确退出清除此设备素材草稿；会话过期保留草稿，重新登录后按账号读取。异步写入校验认证版本和预期账号，避免跨账号回填。
- WebView 系统文件选择器读取用户选择的图片，复用 Rust 裁剪/处理和真实 CMS 上传。导出使用系统创建文档选择器与 content resolver，不传递桌面路径，不申请整盘存储权限。
- 原生窗口处理系统栏、刘海和 IME；触控目标至少 48px。返回先关闭顶部浮层，其他页回渠道页，根页面将应用放到后台。
- 独立 Android capability 仅开放本轮渠道、图片及草稿；不授权文章写入、AI、采集桥接或通用文件访问。桌面采集工作器和本机桥接不在 Android 启动。

## 构建与安装

保留 npm/Cargo 锁文件和 Gradle wrapper。首次配置参考 [Tauri Android 前置条件](https://v2.tauri.app/start/prerequisites/#android)。本工作区的 `.tools/android` 已配置 JDK 21、SDK 36、Build Tools 36.0.0、NDK 28.2.13676358；工具链和缓存不提交。

```powershell
npm ci
. .\scripts\use-local-android.ps1
npm run android:build
# 交互验收使用独立 Mock 包：
npm run android:build:demo
adb devices -l
adb install -r .\artifacts\PressDock-android-debug-arm64.apk
```

脚本先走标准 Tauri ARM64 debug APK 构建。仅遇到 Windows 符号链接权限错误时，复制本次原生库、移除调试信息后由 Gradle 打包；不跳过前端/Rust 编译，不修改系统开发者模式。其他错误直接失败，完整日志见 `.tools/android/build.log`。标准环境也可运行 `npm run tauri android build -- --debug --target aarch64 --apk`。

本机临时 Maven 镜像及下载缓存均位于 `.tools/android`，项目保留官方依赖源。证书验证器 Kotlin 版本从 Cargo.lock 读取，升级后须验证 Android 构建。

## 验收门槛

2026-11-03 构建记录：调试 APK 已生成于 `artifacts/PressDock-android-debug-arm64.apk`，43,232,965 字节，补充 WebView 检查后的 SHA-256 为 `f9f3398b2058efbc95695845cf33ca184ce25ff405c4847c422b31fcb6982f95`。签名 v2、ARM64、API 24/36、APK 与 ELF 16 KiB 对齐检查通过；该包仅用于调试验收。

检查结果：前端 225 项通过；横屏调整后相关 11 项复测通过；Rust 68 项通过、4 项原有人工/配置验收用例忽略；ESLint、TypeScript/Vite 构建、分页脚本 4 项、Prettier、cargo fmt、Clippy 及 Windows MSI/NSIS 构建通过。格式检查排除随仓库提供的技能文件，避免改动其既有格式。360px、390px 与 844×390 浏览器截图已检查。

一加 5（ONEPLUS_A5000，Android 10 / API 29，ARM64）已接入并成功安装。初次启动因系统 WebView 81.0.4044.138 无法解析前端脚本而白屏；修复后已在同一设备验证原生中文版本提示。随后按用户授权通过正常 `adb install -r` 更新同签名 WebView 至 156.0.8078.47，无需 root；系统已选中该提供方，relro 初始化完成，登录页显示正常，启动日志无前端脚本错误。用户已在正式版完成登录，渠道列表与图片加载成功；随后按用户最新要求停止正式版验收，未执行任何真实 CMS 写入。

WebView 更新包来自用户下载的 [APKMirror Android 10 / ARM64 稳定版本](https://www.apkmirror.com/apk/google-inc/android-system-webview/android-system-webview-156-0-8078-47-release/android-system-webview-156-0-8078-47-2-android-apk-download/)，安装前本机验证 APK 签名、包名、minSdk 29 与 ARM64。签名证书 SHA-256 与从设备原安装包读取的 `6faf3c4140407473400934d117815a21af1cfefc5c0bee61c858bc3d72ba6fe5` 一致；更新 APK 文件 SHA-256 为 `e8d07d54142686ea4452386120961ca32f14c350b9711562c3770cbea577d9ed`。未改动系统分区或签名校验。

WebView 修复后 Android 构建、APK 签名校验、ESLint、前端构建与相关文件格式检查通过；真机截图位于本地忽略目录 `.tools/android/device`，包括旧版本提示与更新后的空白登录表单。

自动化覆盖筛选取消/应用、渠道依赖、草稿恢复/自动保存/保留返回、列表位置、当前页排序和草稿队列认证隔离。Rust 覆盖 SQLite 关闭重开、错账号拒绝、退出清理。浏览器 QA 使用明确演示数据的隔离页面，不编入正式应用，不写真实 CMS。

交互验收使用独立 Mock APK。已完成筛选、分页、详情、编辑、杀进程恢复草稿、新增、排序持久化、JPEG/PNG/WebP 选择、取消、触控裁剪、双图回填、SAF 导出并由图库打开，以及 360/390dp、横屏、键盘、返回和 1.3 倍字体检查。2026-11-04 按用户要求停止真机测试；删除、退出清草稿、主题、低空间及其他设备适配尚未完成。结果与修复证据见 [Android Mock 真机测试记录](android-device-qa.md)。真实 CMS 写入与正式版会话重启恢复不属于本轮测试范围。

## 独立演示 APK

按用户要求，测试包与正式版分开。执行 `npm run android:build:demo`，产物为 `artifacts/PressDock-android-demo-arm64.apk`，应用名称“PressDock 演示版”，包名 `com.example.pressdock.demo`。可与正式版同时安装，系统应用目录、SQLite 数据和凭据空间独立。

2026-11-03 真机修复后的演示包：42,633,205 字节，SHA-256 为 `0cca8bfb515c5a882bcb72caf1a184aa64887590da56b71602315ffe5ba53a4c`。APK v2 签名及 16 KiB ZIP 对齐检查通过；最终 APK 清单与设备安装记录均没有 `INTERNET` 权限。一加 5 上已覆盖安装并验证本机业务闭环；两个包同时安装。演示版未创建 CMS 安全凭据文件，演示 SQLite 位于其独立应用目录。

- 前端构建标识 `VITE_PRESSDOCK_DEMO=1`，Rust 功能 `android-demo`，Gradle 打包标识 `PRESSDOCK_DEMO=1`。Android Rust 构建检查功能与打包标识一致，错误组合直接失败。
- 演示包合并清单移除 `INTERNET` 权限；渠道 IPC 编译为独立的 `demo_cms` 处理器，不调用正式 CMS。外部链接和文章命令返回演示范围错误。
- `cms::demo::DemoCms` 经 SQLx 创建演示表，首次初始化 80 条带 `[演示]` 前缀的素材、两组渠道、两个子渠道及两张本机 PNG。每次重启保留修改，避免自动重置掩盖持久化问题。
- 入口只提供“进入演示工作区”，不索取真实账号；演示会话仅持久化本机开关。页面横幅、底栏、编辑和图片处理提示明确标注演示，保存/删除/排序提示明确说明本机结果。
- 演示图片使用 `.invalid` 地址作为本机记录键，由 Rust 从演示 SQLite 返回字节；不会访问该域名。选择的图片存入演示数据库，不上传外部服务器。图片处理与 SAF 导出仍走真实原生能力。
- 原有类型化 IPC、筛选/列表/详情/编辑、SQLite 草稿、返回与恢复逻辑继续复用。演示结果不能作为真实登录、Keystore 或 CMS 接口验收结果。

重新开始演示可在系统设置中仅清除“PressDock 演示版”的应用数据；这会清除演示素材修改和草稿。不要清除正式版数据。

演示数据源的 3 项 Rust 测试覆盖登录范围、增删改、重启持久化、排序页成员校验与其他数据不受影响、本机图片存取及拒绝外部图片；演示入口测试确认不显示真实账号密码表单。演示功能的 Clippy 检查通过。真机已验证的交互与未完成项以 [测试记录](android-device-qa.md) 为准。

提交前复核：默认 Rust 回归 68 项通过、4 项原有人工/配置用例忽略。前端使用 `npm test -- --maxWorkers=2` 完整复核，227 项全部通过；分页评估脚本 4 项通过。演示入口、Android 渠道和草稿测试均通过。ESLint、完整格式检查、前端构建、默认功能与演示功能的 Clippy 检查通过。Android 构建、签名与 16 KiB APK 对齐检查通过；Windows MSI / NSIS 安装包构建通过。

真实登录、Keystore、系统选择器、Android 杀进程恢复和触摸裁剪必须依据设备结果验收，不能由桌面测试或浏览器截图代替。正式包名、release 签名及商店发布另行处理。
