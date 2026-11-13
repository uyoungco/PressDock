# 正文整理验收

日期：2026-11-10。真实模型与样本统计见 [README](README.md) 和 [JSON 报告](evaluation-summary.json)。

## 已完成的验证

- V6：16 篇开发、4 篇独立留出、截图 4 篇各复跑 3 次、4 个演示边界全部通过；无候选跳过与真实请求分别计数。
- 数据与请求：结构输出拒绝截断、未知/重复编号、多余字段；Unicode、格式节点、图片和受保护分页边界检查；四种开关组合、快照固定、检查点、重试和取消后的存储边界。
- 20 篇真实结果通过现有 `prepareHtml → parseCompatible → Tiptap editorExtensions` 往返，全部可编辑，正文文字和图片数量一致；[脱敏结果](editor-compatibility.json)。本机 `editor-roundtrip.png` 已目视核对分段。图片网络加载关闭，未将正文加入 Git。
- 20 篇真实结果通过临时 SQLite 原文/格式化输入/organized/prepared 回放，最终 CMS payload 的 `newsText` 与整理结果一致，零网络请求。
- Windows 原生导入验收通过：正文整理、整理后分页、非法响应回退、整理检查点复用、原有分页、关闭、纯图片和取消。全部任务停在开发者调试结果；本地 CMS 替身确认无文章写入。
- 配置：默认用途隔离、模板新增/复制及草稿、500ms 自动保存、离开补存和同步锁定。旧缓存缺少新字段时安全补值，旧冻结队列保留且停止自动上传；排队正文任务引用的旧密钥不会被配置同步回收。
- 浏览器隔离界面：桌面设置跳转及开关独立保存；Android 设置入口、正文用途全屏编辑与一次保存。390px 容器（内部视口 388px）未横向溢出，未显示分页参数。全部替身均标注演示，只存在内存，无真实 CMS/AI 写入。

本机界面证据：调研目录中的 `desktop-template-fixed.png`、`mobile-template-390.png`。桌面正文用途新增后曾因 CSS 按控件序号定位导致系统指令错位，已改用字段语义选择器并复查。

## 构建与检查

| 检查                                      | 结果                                                         |
| ----------------------------------------- | ------------------------------------------------------------ |
| ESLint                                    | 通过                                                         |
| 前端完整测试 `npm test -- --maxWorkers=2` | 351 通过，1 个本机真实数据回放默认跳过；该回放已显式另跑通过 |
| 分页评测及 Android 构建脚本               | 9/9 通过                                                     |
| TypeScript / Vite 构建                    | 通过                                                         |
| Prettier / Cargo fmt                      | 通过                                                         |
| Rust 单元/集成测试                        | 130 通过，15 个显式环境验收入口默认跳过                      |
| Clippy `--all-targets -- -D warnings`     | 通过                                                         |
| Worker 测试、类型检查、打包 dry-run       | 129/129 通过，其余通过                                       |
| Android 演示 APK                          | 构建通过，`artifacts/PressDock-android-demo-arm64.apk`       |
| Windows Tauri 发布构建                    | 通过，已生成 EXE、MSI 与 NSIS 安装包                         |

并行构建期间一次前端全量运行发生测试超时及连带清理失败；限制为 2 个 worker 后完整通过。同步的“下载中退出”测试原先依赖固定休眠，改为等待 bootstrap 请求已到达后再退出，明确验证目标场景。原生演示宿主补齐当前配置边界替身，并更新已经变更的分页参数展示断言。

Windows 产物位于 `src-tauri/target/release/pressdock.exe`、`src-tauri/target/release/bundle/msi/PressDock_0.1.0_x64_en-US.msi` 和 `src-tauri/target/release/bundle/nsis/PressDock_0.1.0_x64-setup.exe`。

`adb devices -l` 没有设备，不宣称真机或模拟器验收完成。构建时发现现有演示 CMS 命令缺少审核注册占位，补充统一 `DEMO_ONLY` 拒绝入口，不提供模拟审核成功。

正文整理首轮验收时，Worker 仅做测试、类型检查、迁移回放及 dry-run；后续已在同日完成开发/正式迁移部署，见[同步修复记录](../settings-sync/protocol-repair-2026-11-10.md)。原生和 HTTP 替身验收不创建真实 CMS 文章，业务正文和密钥未进入仓库或 localStorage；未推送远程。
