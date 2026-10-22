# Android 后续计划

当前仅交付可以运行的移动网页布局，未生成 Android 工程或 APK。

## 初始化前提

安装 Android Studio、Android SDK / NDK、JDK，按 Tauri 2 当前官方文档设置开发环境和 Rust Android targets。随后执行 `npm run tauri android init`；设备调试使用 `npm run tauri android dev`。这些命令需在工具链具备后执行，本阶段没有运行。

## 兼容性工作

- 将桌面窗口尺寸配置与移动窗口分离，Android 不沿用桌面 900×600 最小尺寸。
- 保留独立 `MobileLayout`：单栏、抽屉导航、触控区域不小于 44px，避免 hover 独占行为。
- UI 继续使用共享业务服务，不在页面依赖 Shell、桌面绝对路径或 Windows API。
- 应用数据目录和 SQLx SQLite 需在真机验证，包括进程被杀后的草稿恢复、WAL、迁移和备份。
- 文件选择需验证 Android WebView 的 content URI；后续导出/裁剪使用正式移动插件适配，不把桌面路径传给手机。
- 密钥使用 Android Keystore 适配，确认权限后再扩展 capabilities。
- 限制网络权限和外部内容来源；为采集、AI 和发布任务提供取消及前后台恢复。

## 测试计划

覆盖模拟器与至少一台真机；测试窄屏、横竖屏、软键盘、安全区域、系统返回键、深浅色主题、大字体、图片选择、SQLite 重启持久化和低存储空间。对桌面与移动分别执行功能回归。

未来发布另行处理签名、包名正式化、隐私说明与应用商店流程。
