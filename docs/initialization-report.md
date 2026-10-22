# PressDock 项目初始化实施报告

实施日期：2026-10-22 至 2026-10-23。项目位置：`D:\Project\PressDock`。

## 1. 初始化结果

已使用 Tauri 2 官方 React + TypeScript 模板创建可运行项目，并按需求接入 shadcn/ui、Tailwind CSS 4、Jotai、React Router、Rust 和 SQLite。项目为单一 Tauri + Vite 工程，版本 `0.1.0`，开发标识 `com.example.pressdock`。

已安装 npm 依赖并保留 `package-lock.json`、`src-tauri/Cargo.lock`。Git 已初始化为 `main`；远程推送状态以本次任务的最终回复为准。需求原文保存在 `docs/initialization-requirements.md`。

当前机器原先没有 Rust，现已将稳定工具链安装到项目 `.tools`，包含 rustfmt、clippy；启动脚本自动识别本地工具链，未修改全局 PATH。已检查 Windows MSVC、SDK 和 WebView2 环境。

## 2. 实际技术版本

| 技术                       | 安装版本                     |
| -------------------------- | ---------------------------- |
| Node.js / npm              | 24.4.0 / 11.4.2              |
| Rust / Cargo               | 1.99.1 / 1.99.1              |
| Tauri Rust / tauri-build   | 2.12.5 / 2.7.4               |
| Tauri JS API / CLI         | 2.12.4 / 2.12.4              |
| React / React DOM          | 19.3.1 / 19.3.1              |
| TypeScript / Vite          | 6.0.3 / 8.3.5                |
| Tailwind CSS               | 4.3.3                        |
| shadcn/ui 组件生成 CLI     | 4.22.1，组件源码保留在项目中 |
| Jotai                      | 3.0.1                        |
| React Router DOM           | 7.18.4                       |
| Lucide React / Zod         | 1.61.0 / 4.6.7               |
| SQLx / Tokio               | 0.9.0 / 1.54.1               |
| Vitest / ESLint / Prettier | 5.0.5 / 10.13.0 / 3.9.10     |

SQLite 由 SQLx 的 `sqlite-bundled` 特性编译集成，无需另行安装数据库服务。TypeScript 选择与当前 lint 工具链兼容的稳定 6.x；锁文件记录完整解析版本。shadcn CLI 只用于生成组件，未保留为应用依赖；官方工具样式和 MIT 许可证分别保存在 `src/styles/shadcn.css` 与 `docs/third-party/shadcn-LICENSE.md`。

## 3. 实际核心目录

```text
D:\Project\PressDock
├── .github/workflows/ci.yml
├── docs/
│   ├── architecture.md
│   ├── development.md
│   ├── android-plan.md
│   ├── initialization-requirements.md
│   └── third-party/shadcn-LICENSE.md
├── public/pressdock.svg
├── scripts/
│   ├── tauri.mjs
│   └── use-local-rust.ps1
├── src/
│   ├── app/                     路由、入口和 Provider
│   ├── atoms/                   app、theme、navigation、editor
│   ├── components/              ui、common、layout
│   ├── layouts/                 DesktopLayout、MobileLayout
│   ├── pages/                   Dashboard、Import、Articles、Editor
│   │                           Images、Publish、Settings
│   ├── features/                articles、import、editor、images、publishing、ai
│   ├── services/                tauri、cms、storage
│   └── types/ constants/ hooks/ lib/ styles/ test/
├── src-tauri/
│   ├── capabilities/ migrations/ icons/
│   ├── src/                     commands、database、cms、ai、system、error
│   ├── Cargo.toml
│   ├── Cargo.lock
│   └── tauri.conf.json
├── components.json
├── eslint.config.js
├── vite.config.ts
├── tsconfig.json
├── package.json
├── package-lock.json
└── README.md
```

`.tools`、`node_modules`、`dist`、Rust `target` 和本地环境文件均已忽略。

## 4. 已实现功能

| 功能     | 当前行为                                                         |
| -------- | ---------------------------------------------------------------- |
| 工作台   | 演示文章统计、最近文章、快捷操作                                 |
| 素材导入 | 验证 HTTP(S) URL，创建明确标识的演示素材，展示任务结果           |
| 文章管理 | 标题搜索、状态筛选、来源及时间展示、进入编辑                     |
| 内容编辑 | 标题与纯文本正文、原文只读查看、真实 SQLite 保存、未保存离开提示 |
| 图片处理 | 本地图片选择、类型与大小校验、预览及比例工作区                   |
| 发布管理 | 待发布文章与演示任务展示；未连接 CMS 时明确返回未配置错误        |
| 系统设置 | 主题持久化、应用信息、Rust 与 SQLite 健康检查、CMS/AI 扩展入口   |

桌面布局包含 232px 可折叠导航、顶部搜索与主题菜单、底部状态栏。移动布局采用单栏和抽屉导航；已在 390px 宽度验证。主题支持浅色、深色、跟随系统，主题和导航偏好通过 Jotai 持久化，正文和凭据不写入 localStorage。

Rust 已按模块提供 6 个类型化 IPC 命令：`get_app_info`、`health_check`、`list_articles`、`get_article`、`save_draft`、`create_demo_article`。前端统一服务层调用、Zod 校验响应、统一错误反馈；Capability 仅开放所需命令。

SQLite 启动时自动创建、执行 SQLx Migration，并幂等插入演示文章。原始素材与草稿分表，保存只更新草稿；数据库使用应用数据目录、WAL 和外键。当前 Windows 数据库位于 `%APPDATA%\com.example.pressdock\pressdock.db`，代码通过 Tauri 路径 API 获取，未写死平台路径。浏览器预览使用内存适配器，刷新后重置，不冒充桌面持久化。

## 5. 验证结果

| 命令或检查                                           | 结果    | 说明                                                                         |
| ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `npm run lint`                                       | PASS    | ESLint，0 警告                                                               |
| `npm run test`                                       | PASS    | 2 个测试文件、7 个测试通过                                                   |
| `npm run build`                                      | PASS    | TypeScript 严格检查、Vite 生产构建                                           |
| `npm run format:check`                               | PASS    | Prettier 检查                                                                |
| `cargo fmt --check`                                  | PASS    | Rust 格式检查                                                                |
| `cargo test --locked`                                | PASS    | 2 个 Rust 测试通过                                                           |
| `cargo clippy --locked --all-targets -- -D warnings` | PASS    | 无 Clippy 警告                                                               |
| `npm audit --audit-level=low`                        | PASS    | 0 个已报告漏洞                                                               |
| `npm run tauri dev`                                  | PASS    | Windows 原生桌面应用实际启动                                                 |
| 原生 IPC 与 SQLite 冒烟检查                          | PASS    | 保存、回读、原文不变，发布返回未配置                                         |
| 原生 UI 冒烟检查                                     | PASS    | 七页面、主题及刷新持久化、移动抽屉、无横向溢出                               |
| 编辑页实际操作                                       | PASS    | 输入、未保存提示、继续编辑、点击保存、重新加载回读；测试后恢复演示正文和标题 |
| Release 程序冒烟检查                                 | PASS    | 独立启动内嵌生产资源，七路由和数据库正常，未捕获运行时异常                   |
| `npm run tauri build`                                | PASS    | Windows x64 MSI / NSIS 均生成成功                                            |
| 远程 GitHub Actions                                  | NOT RUN | 已配置 Windows、macOS、Intel macOS 工作流，未推送执行                        |
| macOS 实机构建与运行                                 | NOT RUN | 当前环境为 Windows                                                           |
| Android 原生构建 / APK                               | NOT RUN | 本阶段仅完成布局及迁移计划                                                   |
| 安装程序实际安装 / 卸载                              | NOT RUN | 未向系统安装应用；已直接测试 Release 程序                                    |

前端测试覆盖页面渲染、路由、Jotai 状态、业务模型及输入验证。Rust 测试使用临时磁盘数据库，覆盖关闭重开后的草稿持久化、原文不可变、重复种子初始化以及非法请求拒绝。

Vite 有入口包体积提示：压缩后约 512.59 kB、gzip 约 162.34 kB；页面已按需加载，当前构建通过，后续可继续优化公共依赖拆分。

## 6. 启动与构建

已生成以下未签名 Windows x64 安装包，原始产物位于项目 `src-tauri/target/release/bundle/`，并复制到本次交付目录：

| 格式 | 文件                            | 大小                       |
| ---- | ------------------------------- | -------------------------- |
| NSIS | `PressDock_0.1.0_x64-setup.exe` | 2,504,084 字节（2.39 MiB） |
| MSI  | `PressDock_0.1.0_x64_en-US.msi` | 3,395,584 字节（3.24 MiB） |

交付目录同时包含安装包 SHA-256 校验清单、原生冒烟验证 JSON 和工作台 / 深色 / 移动布局截图。Release 可执行程序为 `src-tauri/target/release/pressdock.exe`。安装与卸载尚未执行，Release 程序已独立运行验证。

当前机器直接运行：

```powershell
cd D:\Project\PressDock
npm run tauri dev
```

全新克隆后先运行 `npm ci`，并安装对应平台的稳定 Rust / Tauri 系统依赖。本机启动脚本会自动识别 `.tools`；其他机器回退使用系统 Rust。

只查看前端：`npm run dev`，访问 `http://localhost:1420`。生成当前平台安装包：`npm run tauri build`。PowerShell 直接运行 Rust 检查前：

```powershell
cd D:\Project\PressDock
. .\scripts\use-local-rust.ps1
cd src-tauri
cargo test --locked
```

需要网络代理时，只设置当前终端：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:npm_config_https_proxy = $env:HTTPS_PROXY
$env:npm_config_proxy = $env:HTTPS_PROXY
$env:CARGO_HTTP_PROXY = $env:HTTPS_PROXY
```

Windows 构建工具缓存在 `src-tauri/target/.tauri`；WiX 已通过代理下载，并核对 Tauri 官方提供的 SHA-256。本次测试启动的应用与服务已关闭，开发端口已释放。

## 7. 后续开发事项

1. 确认现有采集工具和真实 CMS 的契约、认证与发布流程，再实现对应适配器。当前没有编造外部 API，导入不会抓取目标网站，也不会自动发布。
2. 按下一阶段需求实现富文本、图片实际裁剪与导出、持久化发布任务、AI 服务及操作系统安全凭据存储。
3. 在 macOS Intel / Apple Silicon 上实际运行 CI 和应用；正式分发前替换开发标识、模板打包图标并配置签名 / 公证。
4. 按 `docs/android-plan.md` 初始化 Android 工具链及原生工程，验证文件选择、键盘、返回导航和移动数据库。

参考文档：[Tauri 初始化](https://v2.tauri.app/start/create-project/)、[Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)、[shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)。
