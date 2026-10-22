# PressDock 架构

## 分层与数据流

```text
React 页面 / shadcn/ui
  → 业务服务（features）
  → CmsAdapter / LocalArticleRepository
  → 类型化 Tauri IPC（services/tauri）
  → Rust commands
  → database / SQLx / SQLite
```

组件不直接调用 `invoke`，不执行 SQL。IPC 返回值由 Zod 校验；Rust 同时校验保存请求及导入 URL。错误以 `{ code, message }` 序列化，前端统一以 Sonner 显示。数据库内部错误只写入本地诊断输出，不将 SQL 和路径暴露给用户。

## 目录职责

- `app`：Provider、Hash 路由和异常页面。
- `pages`：七个页面的视图与局部交互。
- `features`：文章统计、导入、编辑、图片和发布模型及服务。
- `components/ui`：由 shadcn CLI 安装的可访问基础组件；`common` 为业务通用展示，`layout` 为导航与工具栏。
- `atoms`：主题、导航、搜索与编辑会话；派生 atom 展示编辑状态。
- `services/cms`：可替换服务契约与 Mock；`storage`：本地持久化适配；`tauri`：唯一 IPC 出口。
- Rust `commands`：薄入口；`database`：事务、迁移与查询；`system`：平台信息；`cms` / `ai`：服务配置契约。

## 存储规则

SQLite 位于 `app.path().app_data_dir()/pressdock.db`。目录由 Tauri 按平台决定，与源码和安装位置无关。SQLx 迁移编译嵌入二进制，启用外键、WAL 与忙等待；所有参数通过绑定传入 SQL。

`source_articles` 保留标题、来源 URL、原文与导入时间；`drafts` 保存编辑内容和状态，以外键关联素材。保存命令只能更新草稿表。初始化内置四条明确标识的演示素材，重复启动仅执行幂等插入，不覆盖现有草稿。媒体和发布任务表将在具备真实业务需求后新增。

浏览器中 `MockCmsAdapter` 仅使用内存，刷新后重置。桌面中读取和保存真实 SQLite 数据。两种模式在状态栏与编辑器中明确区分。前端的主题和导航设置可写入 localStorage；正文、文章与密钥不得写入。

## 扩展边界

`CmsAdapter` 是业务服务契约，当前桌面实现仅管理本地稿件，发布始终返回未配置错误。真实 CMS 接入需要新增 Rust 客户端和 IPC 适配器，不得在页面中编造请求地址。采集工具没有确认协议前，导入只创建演示素材，绝不抓取或假装导入真实内容。

未来长任务使用任务 ID、事件或 Channel，并提供取消操作。凭据交给操作系统安全存储；前端配置只携带凭据引用。AI 排版不得修改事实或原句，原文始终独立保存。

## 安全与平台

Capabilities 只允许主窗口调用六个业务命令，没有文件系统、Shell、HTTP、通用 SQL 或远程页面权限。生产 CSP 限制脚本与连接来源。正文按纯文本渲染，不使用 `dangerouslySetInnerHTML`。图片通过浏览器文件选择与 blob URL 预览，不上传，退出时释放 URL。

桌面与移动布局独立，通过视口断点选择。路由采用 Hash 模式支持本地静态 WebView。Android 原生工具链和插件权限尚未初始化，见 `android-plan.md`。
