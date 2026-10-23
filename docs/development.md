# 开发说明

## 环境

Node.js 24 或更新的兼容稳定版、npm、稳定版 Rust（rustfmt / clippy）。Windows 需要 MSVC C++ 工具链、Windows SDK、WebView2。macOS 需要 Xcode Command Line Tools。

当前机器的 Rust 安装在项目内 `.tools`，该目录不进入 Git，未修改系统 PATH。`npm run tauri ...` 会自动识别本地 Rust。PowerShell 中直接使用 cargo 前执行：

```powershell
. .\scripts\use-local-rust.ps1
cargo test --manifest-path src-tauri/Cargo.toml
```

其他机器安装普通稳定版 Rust 即可，脚本会回退使用系统 PATH；不要依赖本机 `.tools`。Cargo.lock 必须提交。

## 常用命令

```text
npm ci                         安装锁定的前端依赖
npm run dev                    Vite 登录页预览，localhost:1420
npm run tauri dev              桌面开发
npm run lint                   ESLint，警告也视为失败
npm test                       Vitest 单次执行
npm run test:watch             交互式测试
npm run build                  TypeScript 严格检查 + Vite 生产构建
npm run format                 Prettier 格式化
npm run format:check           Prettier 检查
npm run tauri build            当前平台安装包
```

Rust 检查在 `src-tauri` 中执行 `cargo fmt --check`、`cargo test --locked`、`cargo clippy --locked --all-targets -- -D warnings`。

如需本机代理，只设置当前终端进程环境，不修改全局 npm 或系统配置：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:npm_config_https_proxy = $env:HTTPS_PROXY
$env:npm_config_proxy = $env:HTTPS_PROXY
npm ci
```

## 增加业务功能

1. 在 `types` / `features` 定义模型、Zod 验证和业务约束。
2. 在 Rust 的对应业务模块实现能力与必要测试，commands 只转发。
3. 新命令在 `lib.rs` 注册、`build.rs` 声明，并显式增加 capability 权限。
4. 在 `services/tauri` 封装调用，在服务契约中暴露方法。
5. 页面调用业务服务，捕获错误并显示 Toast；不要把业务数据持久化到 Jotai。
6. 迁移新增编号 SQL 文件，已执行迁移不可修改，保持 LF 换行。

## UI 与测试

统一使用 Neutral CSS 变量、Tailwind 4、shadcn/ui 和 Lucide。禁止引入第二套大型 UI 或状态库，TypeScript 禁止 `any`。`@/*` 对应 `src/*`，由 TS / Vite 和 ESLint 的 TypeScript project service 共同识别。

基础组件由 shadcn 4.22.1 CLI 生成。官方 Tailwind 工具样式保留在 `src/styles/shadcn.css`，MIT 授权见 `docs/third-party/shadcn-LICENSE.md`。CLI 仅通过 npx 使用，不作为应用依赖安装，避免引入运行时不需要的代码生成工具链。

测试关注原文不可变、输入校验、发布错误、状态派生、页面和路由。Rust 测试使用独立临时数据库，验证迁移、关闭重开后的持久化、原文不可变、参数拒绝与演示导入；不会触碰实际应用数据。

CI 在 Windows、Apple Silicon macOS 和 Intel macOS runner 执行前端检查、测试、Rust 检查和 Tauri 构建。产物只作为工作流附件，不自动发布、签名、公证或推送。

Windows 打包工具缓存在 `src-tauri/target/.tauri`，不修改系统安装，也不进入版本库。首次打包需要下载 WiX / NSIS；本次 WiX 下载通过本地代理完成，并核对了 Tauri 官方配置的 SHA-256。
