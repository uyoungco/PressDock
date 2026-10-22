# PressDock

跨平台新闻编辑工作空间（News Editorial Workspace），面向素材导入、稿件整理、图片预览与发布流程。本阶段为可运行的基础工程，界面数据明确标识为演示；未连接真实 CMS、爬虫或 AI。

## 技术栈

Tauri 2、React 19、TypeScript 6、Vite 8、shadcn/ui（Radix）、Tailwind CSS 4、Jotai、React Router、Lucide、Zod、Rust、Tokio、SQLx 0.9 和 SQLite。实际解析版本以 package-lock.json / src-tauri/Cargo.lock 为准。

## 环境与启动

- Node.js 24、npm、稳定版 Rust，安装 rustfmt / clippy。
- Windows：MSVC C++ 编译工具、Windows SDK、WebView2。
- macOS：Xcode Command Line Tools；Intel 与 Apple Silicon 由对应架构构建。

```powershell
cd D:\Project\PressDock
npm ci
npm run tauri dev
```

仅查看前端演示：`npm run dev`，打开 `http://localhost:1420`。浏览器草稿仅暂存内存，刷新后重置；桌面草稿保存于应用数据目录的 SQLite。当前机器的 Rust 位于 `.tools`，启动脚本自动识别，不需要全局 PATH；其他机器使用正常安装的 Rust。

## 已实现

- 工作台统计与最近文章、素材导入演示、文章筛选、编辑草稿、图片预览、发布状态、系统设置。
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
  pages/                   七个业务页面
  features/                业务模型与服务
  services/{tauri,cms,storage}/
  types/ constants/ hooks/ styles/ test/
src-tauri/
  capabilities/ migrations/
  src/{commands,database,cms,ai,system}/
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

## 开发边界

真实采集、CMS 登录 / 发布、AI、富文本编辑、裁剪与导出、发布任务持久化、OS 凭据存储尚未实现。导入按钮只创建标识清晰的演示素材，不访问目标网址；发布检查始终返回未配置错误。原文独立保存，编辑不会自动改写事实。正文与密钥不写入 localStorage。

Android 尚未初始化 SDK / 原生工程或生成 APK，当前提供可运行的移动布局；后续见 [Android 计划](docs/android-plan.md)。不要直接将桌面尺寸和原生行为用于 Android。

详细说明：[架构](docs/architecture.md)、[开发指南](docs/development.md)、[初始化验收报告](docs/initialization-report.md)。官方参考：[Tauri 初始化](https://v2.tauri.app/start/create-project/)、[Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)、[shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)。
