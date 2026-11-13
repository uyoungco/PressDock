# 配置手动同步验收（2026-11-09）

已实现顶部缓存通知条、桌面和 Android 系统设置的手动同步入口。系统设置保留同步诊断；首次无缓存的阻塞页面保留重试读取。

## 自动验证

- `npm run lint`、`npm run format:check`、`npm run build` 通过。
- `npm test -- --maxWorkers=2`：37 个文件、329 项测试通过。
- README 指定的两个脚本测试：9 项通过。
- `cargo fmt -- --check` 通过；`cargo test --locked`：109 项通过、12 项忽略。
- 最后补充会话回执保护后，同步运行时测试 18 项通过，`cargo clippy --all-targets -- -D warnings` 通过。
- `npm run tauri build` 通过，生成 Windows EXE、NSIS 和 MSI。
- 桌面及 Android capability 均包含 `allow-settings-sync-manual`，Android ACL 回归覆盖新增命令。

测试覆盖读取成功后再次同步、补传和读取顺序、临时失败仍读取并叠加待传字段、永久拒绝与鉴权停止、版本防倒退、凭据准备失败保留配置和密钥、上传互斥，以及前端合并请求、编辑拦截、各设置刷新和会话切换丢弃旧响应。

## 布局与交互

截图使用本机隔离的演示数据和模拟 IPC，不连接真实 CMS、AI 或配置服务，不表示真实云端同步成功。

- 桌面：缓存提示显示手动同步；点击后两个入口均禁用，设置编辑受保护；完成后通知消失、模型配置刷新。
- Android：以 Android 前端分支在浏览器模拟 390 × 844 视口；两个入口均显示“同步中…”并禁用，完成后设置入口仍常驻；无横向溢出，按钮和诊断可正常排列。
- Android 验证范围为浏览器模拟和权限静态检查，本轮未构建或执行 Android 真机验收。

截图：`desktop-cache.png`、`desktop-syncing.png`、`desktop-synced.png`、`android-cache.png`、`android-synced.png`。

未推送远程，保留工作区其他未提交修改。
