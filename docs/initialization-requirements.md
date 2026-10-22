下面整理成一份可以直接交给 **Codex CLI 执行的项目初始化需求文档**。

项目名称确定为 **PressDock**，技术栈采用 **Tauri 2 + React + TypeScript + Vite + shadcn/ui + Tailwind CSS 4 + Jotai + Rust + SQLite**。

文档不仅包含项目初始化，还规定了目录结构、架构约束、新闻 CMS 功能模块、UI 设计、跨平台兼容性及验收标准。Codex 可以按照文档直接创建工程。

初始化方式参考了 Tauri、shadcn/ui 和 Jotai 当前官方文档。[Tauri](https://v2.tauri.app/zh-cn/start/create-project/?utm_source=chatgpt.com)

以下内容可以完整复制给 Codex CLI。

# PressDock — 项目初始化执行文档

**文档版本：** 1.0  
**项目名称：** PressDock  
**项目类型：** 跨平台新闻 CMS 客户端  
**开发阶段：** 基础工程初始化  
**目标平台：** Windows、macOS，未来支持 Android

---

# 一、任务说明

你是一名资深跨平台桌面应用工程师。

请根据本文档，在当前开发环境中创建一个完整、规范、可运行、可扩展的跨平台新闻 CMS 客户端项目。

项目名称为 **PressDock**。

本次任务以项目初始化和基础架构搭建为主，不需要完整实现新闻 CMS 的全部业务功能。

但是必须完成：

1. 项目工程初始化。
2. 核心技术栈集成。
3. 合理的目录结构。
4. 基础 UI 布局。
5. 页面路由配置。
6. Jotai 状态管理。
7. Tauri 与 Rust 通信。
8. SQLite 数据持久化基础架构。
9. 业务模块接口定义。
10. 开发、构建与测试配置。
11. 基础项目文档。

**不要仅仅输出代码示例或实施方案，而是直接创建项目文件、安装依赖、编写代码并执行测试。**

在开发过程中，应优先采用当前稳定版本及官方推荐实践。

如果文档中的命令与当前工具版本存在差异，请以官方最新文档为准进行调整。

不要为了追求最新版本而使用 Alpha、Beta 或实验性依赖。

---

# 二、项目基本信息

## 2.1 项目标识

| 项目         | 配置                     |
| ------------ | ------------------------ |
| 应用名称     | PressDock                |
| 项目目录     | pressdock                |
| npm Package  | pressdock                |
| Rust Package | pressdock                |
| 应用描述     | News Editorial Workspace |
| 应用版本     | 0.1.0                    |
| Tauri 版本   | 2.x                      |
| 初始语言     | 简体中文                 |
| 默认主题     | 跟随系统                 |
| 开发平台     | Windows / macOS          |
| 后续目标     | Android                  |

Tauri 应用标识暂时使用：

`com.example.pressdock`

该标识仅用于开发，正式发布之前需要替换为组织拥有的唯一标识。

## 2.2 产品定位

PressDock 是一款服务于新闻编辑人员的跨平台 CMS 客户端。

主要解决新闻编辑工作中的重复性操作，包括：

- 新闻素材采集。
- 新闻文章导入。
- 新闻标题处理。
- 文章段落整理。
- 图片选择、裁剪及尺寸调整。
- 内容审核。
- 新闻稿件发布。
- 发布任务管理。
- AI 辅助编辑。

未来可能接入多个新闻 CMS 系统。

因此，必须采用模块化架构，避免将某个特定 CMS 的接口、字段或发布流程直接写死在 UI 组件中。

---

# 三、技术栈要求

## 3.1 核心技术栈

以下技术栈已经确定，原则上不要擅自替换。

| 层级       | 技术           |
| ---------- | -------------- |
| 跨平台框架 | Tauri 2        |
| 前端框架   | React          |
| 开发语言   | TypeScript     |
| 构建工具   | Vite           |
| UI 组件    | shadcn/ui      |
| CSS 框架   | Tailwind CSS 4 |
| 状态管理   | Jotai          |
| 路由       | React Router   |
| 图标       | Lucide React   |
| 原生后端   | Rust           |
| 异步运行时 | Tokio          |
| 本地数据库 | SQLite         |
| 数据库访问 | SQLx           |
| 数据验证   | Zod            |
| 包管理器   | npm            |

React 使用当前与依赖兼容的稳定版本。

TypeScript 开启严格类型检查。

禁止使用 `any` 逃避类型检查，确实无法避免时必须说明原因。

## 3.2 技术选择原则

优先选择：

- 官方维护的库。
- 稳定版本。
- 有 TypeScript 类型支持的库。
- 有持续维护记录的库。
- 可以在 Windows 和 macOS 上正常工作的库。
- 有利于后续 Android 兼容的方案。

避免：

- 不必要的第三方依赖。
- 重复实现已有成熟组件。
- 过度封装。
- 过度设计。
- 不必要的微服务化。
- 在前端直接执行敏感系统操作。

本项目不使用：

- Electron
- Vue
- Redux
- Zustand
- Next.js
- 服务端渲染

状态管理统一使用 **Jotai**。

---

# 四、项目初始化

## 4.1 环境检查

首先检查当前开发环境：

```bash
node --version
npm --version
rustc --version
cargo --version
```

同时检查操作系统及 Tauri 必需的系统依赖。

如果缺少依赖：

1. 明确指出缺少什么。
2. 根据当前操作系统提供安装方式。
3. 尽可能完成可自动执行的初始化步骤。
4. 不要擅自修改与项目无关的系统配置。

如果当前目录已经存在项目文件，先检查现有工程，避免覆盖用户文件。

## 4.2 创建 Tauri 项目

使用 Tauri 2 官方项目生成器：

```bash
npm create tauri-app@latest
```

创建项目时选择：

```text
Project name: pressdock

Identifier: com.example.pressdock

Language:
TypeScript / JavaScript

Package manager:
npm

UI template:
React

UI flavor:
TypeScript
```

创建完成后安装依赖。

项目最终应当能够使用以下命令启动：

```bash
npm run tauri dev
```

## 4.3 安装前端依赖

安装：

```bash
npm install jotai
npm install react-router-dom
npm install lucide-react
npm install zod
```

安装 Tailwind CSS：

```bash
npm install tailwindcss @tailwindcss/vite
```

配置 Vite：

- React 插件。
- Tailwind CSS 插件。
- `@` 路径别名。
- TypeScript 类型解析。
- Tauri 开发服务器兼容配置。

要求：

```typescript
import { Button } from "@/components/ui/button";
```

此类路径可以正常解析。

配置完成后，确保 TypeScript、Vite 和 ESLint 均识别 `@/*` 别名。

## 4.4 初始化 shadcn/ui

在现有 Tauri React + Vite 项目中执行：

```bash
npx shadcn@latest init
```

使用：

- Tailwind CSS 4
- TypeScript
- Lucide Icons
- Neutral 基础色
- CSS Variables

根据当前 shadcn/ui CLI 的实际选项完成初始化。

不要创建第二套独立的 Vite 项目。

安装初期需要的基础组件：

```bash
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add textarea
npx shadcn@latest add card
npx shadcn@latest add badge
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
npx shadcn@latest add select
npx shadcn@latest add tabs
npx shadcn@latest add sidebar
npx shadcn@latest add scroll-area
npx shadcn@latest add separator
npx shadcn@latest add tooltip
npx shadcn@latest add skeleton
npx shadcn@latest add sheet
npx shadcn@latest add sonner
```

如个别组件名称发生变化，请根据当前官方组件列表替换。

禁止同时引入 Ant Design、Mantine 或 MUI。

---

# 五、架构设计

采用以下分层架构：

```text
                    PressDock
                        │
               React + TypeScript
                        │
          ┌─────────────┴─────────────┐
          │                           │
       shadcn/ui                    Jotai
          │                           │
       页面展示                    状态管理
          │                           │
          └─────────────┬─────────────┘
                        │
                  Service Layer
                        │
                   Tauri IPC
                        │
                    Rust Core
                        │
          ┌─────────────┼─────────────┐
          │             │             │
       SQLite        CMS Adapter    AI Service
          │             │             │
          └─────────────┼─────────────┘
                        │
                 Platform Layer
                        │
             ┌──────────┴──────────┐
             │                     │
          Windows                macOS
                                   │
                          Future: Android
```

## 5.1 前端职责

React 主要负责：

- 页面布局。
- UI 交互。
- 表单管理。
- 数据展示。
- 编辑器界面。
- 图片处理界面。
- 路由管理。
- 状态展示。
- 用户操作反馈。

不要在 React 组件中直接实现复杂 CMS API 请求逻辑。

## 5.2 Rust 职责

Rust 主要负责：

- Tauri 原生能力。
- 本地数据库。
- 文件系统操作。
- CMS 网络请求。
- 敏感配置管理。
- AI API 请求。
- 后台任务。
- 错误处理。
- 跨平台系统能力封装。

Rust 功能按模块组织，不要将所有 Command 写入一个 `lib.rs` 文件。

## 5.3 前后端通信

前端通过 Tauri IPC 调用 Rust。

统一创建：

```text
src/services/tauri/
```

将 IPC 调用集中管理。

禁止在每个业务组件中随意直接调用 `invoke()`。

对于每个 Tauri Command：

- 定义 TypeScript 请求类型。
- 定义 TypeScript 响应类型。
- 明确错误处理。
- 使用统一的服务封装。

对于未来的长时间任务，采用任务 ID、事件或 Channel 实现进度更新和取消。

---

# 六、项目目录结构

请按照以下结构创建项目。

允许根据实际框架要求进行小范围调整，但必须保留分层思想。

```text
pressdock/
│
├── .github/
│   └── workflows/
│
├── docs/
│   ├── architecture.md
│   ├── development.md
│   └── android-plan.md
│
├── public/
│
├── src/
│   │
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   └── providers.tsx
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── common/
│   │   └── layout/
│   │
│   ├── layouts/
│   │   ├── DesktopLayout.tsx
│   │   └── MobileLayout.tsx
│   │
│   ├── pages/
│   │   ├── Dashboard/
│   │   ├── Articles/
│   │   ├── Import/
│   │   ├── Editor/
│   │   ├── Images/
│   │   ├── Publish/
│   │   └── Settings/
│   │
│   ├── features/
│   │   ├── articles/
│   │   ├── import/
│   │   ├── editor/
│   │   ├── images/
│   │   ├── publishing/
│   │   └── ai/
│   │
│   ├── atoms/
│   │   ├── app.ts
│   │   ├── theme.ts
│   │   ├── navigation.ts
│   │   └── editor.ts
│   │
│   ├── services/
│   │   ├── tauri/
│   │   ├── cms/
│   │   └── storage/
│   │
│   ├── hooks/
│   │
│   ├── lib/
│   │
│   ├── types/
│   │
│   ├── constants/
│   │
│   ├── styles/
│   │
│   └── main.tsx
│
├── src-tauri/
│   │
│   ├── capabilities/
│   │
│   ├── migrations/
│   │
│   ├── src/
│   │   ├── commands/
│   │   ├── database/
│   │   ├── cms/
│   │   ├── ai/
│   │   ├── system/
│   │   ├── error.rs
│   │   └── lib.rs
│   │
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── .editorconfig
├── .gitignore
├── components.json
├── eslint.config.js
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

要求：

1. 按业务模块组织代码。
2. UI 组件与业务组件分离。
3. 页面组件不直接操作数据库。
4. 业务层不依赖具体 UI 框架组件。
5. CMS 接口必须能够替换实现。
6. 文件命名、模块导入与类型命名保持统一。
7. 不创建大量没有用途的空文件。

---

# 七、UI 设计规范

## 7.1 整体风格

PressDock 是生产力工具，而不是宣传网站。

整体参考现代桌面管理软件的设计方式。

要求：

- 简洁。
- 专业。
- 现代化。
- 信息密度适中。
- 减少无意义动画。
- 优先考虑操作效率。
- 强调内容阅读和编辑体验。

UI 采用 shadcn/ui + Tailwind CSS。

默认使用 Neutral 色系。

支持：

- 浅色主题。
- 深色主题。
- 跟随系统主题。

## 7.2 桌面端布局

初始采用经典桌面工作台结构：

```text
┌───────────────────────────────────────────────────────┐
│ PressDock                        搜索  主题  设置     │
├─────────────┬─────────────────────────────────────────┤
│             │                                         │
│ 工作台      │                                         │
│             │                                         │
│ 素材导入    │                                         │
│             │              主内容区域                 │
│ 文章管理    │                                         │
│             │                                         │
│ 内容编辑    │                                         │
│             │                                         │
│ 图片处理    │                                         │
│             │                                         │
│ 发布管理    │                                         │
│             │                                         │
│ ─────────── │                                         │
│ 系统设置    │                                         │
│             │                                         │
├─────────────┴─────────────────────────────────────────┤
│ 就绪                                      v0.1.0     │
└───────────────────────────────────────────────────────┘
```

设计细节：

- 左侧导航宽度约 220–240px。
- 支持折叠。
- 顶部工具栏保持紧凑。
- 主内容区域根据窗口大小自适应。
- 使用清晰的页面标题与操作按钮。
- 不使用大量渐变色。
- 避免大面积无意义留白。
- 不要使用 Emoji 代替正式图标。

应用窗口建议：

```text
默认宽度：1280
默认高度：800

最小宽度：900
最小高度：600
```

以上约束仅适用于桌面端。

## 7.3 Android 兼容准备

虽然暂时不开发 Android 安装包，但前端架构必须考虑移动端。

创建：

```text
DesktopLayout.tsx
MobileLayout.tsx
```

移动端计划采用：

- 单栏布局。
- 抽屉式导航。
- 较大的触控区域。
- 自适应页面间距。
- 避免桌面端固定宽度。
- 避免仅依靠鼠标悬停完成操作。

不要将 Android 独有行为直接写入桌面组件中。

当前阶段只要求移动端布局基础框架可运行，不要求完成 Android 原生功能。

---

# 八、页面初始化

需要创建以下七个页面。

本次只实现基础 UI 和必要的演示交互。

真实 CMS 服务尚未接入，因此使用明确标识的 Mock 数据。

## 8.1 Dashboard — 工作台

路由：

`/dashboard`

内容：

- 今日处理文章数。
- 待编辑文章数。
- 待发布文章数。
- 已发布文章数。
- 最近处理文章。
- 快捷操作入口。

统计数据暂时使用 Mock 数据。

## 8.2 Import — 素材导入

路由：

`/import`

提供：

- 文章 URL 输入框。
- 导入按钮。
- 导入结果展示。
- 导入任务状态。

未来对接已经存在的文章采集工具。

本次不需要重新开发爬虫。

需要预留导入服务接口。

不得假设现有爬虫的具体 API 地址和请求格式。

## 8.3 Articles — 文章管理

路由：

`/articles`

展示文章列表。

字段：

- 标题。
- 来源。
- 创建时间。
- 更新时间。
- 状态。
- 操作。

文章状态：

```typescript
type ArticleStatus = "imported" | "draft" | "review" | "published" | "failed";
```

支持基础筛选与进入编辑页面。

可以使用 Mock 数据实现界面。

## 8.4 Editor — 内容编辑

路由：

`/editor/:id`

初始化基础编辑界面。

提供：

- 文章标题。
- 文章来源。
- 文章正文。
- 保存草稿。
- 编辑状态展示。

未来将支持：

- AI 标题建议。
- 自动段落整理。
- 图片插入。
- 正文排版。

**重要业务原则：自动排版不得擅自改写文章原文。**

段落整理功能只能按照用户指定规则调整段落结构和排版，不应擅自：

- 修改原句。
- 删除内容。
- 添加事实。
- 改写观点。
- 修改数字。
- 修改人名、地名。

需要在数据模型中区分原始素材与编辑稿件。

当前阶段无需实现 AI 自动排版。

## 8.5 Images — 图片处理

路由：

`/images`

初始化图片处理工作区。

预留：

- 本地图片选择。
- 图片预览。
- 裁剪比例。
- 输出尺寸。
- 图片质量。
- 保存结果。

未来将支持根据新闻栏目要求裁剪不同尺寸图片。

当前阶段可以先实现图片上传预览和比例选择界面。

不要为了初始化项目自行实现复杂图像算法。

## 8.6 Publish — 发布管理

路由：

`/publish`

提供：

- 待发布文章。
- 发布状态。
- 发布任务列表。
- 发布失败提示。

实际 CMS 发布接口暂时不实现。

不得模拟真实发布成功并误导用户。

Mock 数据必须明确标识为演示数据。

## 8.7 Settings — 系统设置

路由：

`/settings`

设置页面包含：

- 应用名称。
- 应用版本。
- 主题设置。
- CMS 连接配置占位区域。
- AI 服务配置占位区域。
- 关于应用。

主题切换需要真正生效并持久化。

---

# 九、Jotai 状态管理规范

必须使用 Jotai。

不引入 Redux、Zustand 或其他全局状态管理库。

## 9.1 状态分类

### 应用级状态

例如：

- 主题。
- 侧边栏展开状态。
- 当前导航状态。
- 全局提示。

### 编辑器状态

例如：

- 当前文章 ID。
- 当前编辑状态。
- 是否存在未保存修改。

### 临时交互状态

例如：

- 对话框开关。
- 表单输入。
- 当前选中的表格行。

优先使用 React 局部状态，不需要全部提升到 Jotai。

## 9.2 状态持久化

使用：

```typescript
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
```

存储规则：

| 数据        | 存储方式        |
| ----------- | --------------- |
| UI 临时状态 | React / Jotai   |
| 主题设置    | Jotai + Storage |
| 侧边栏设置  | Jotai + Storage |
| 文章数据    | SQLite          |
| 草稿内容    | SQLite          |
| 发布任务    | SQLite          |
| API Key     | 安全凭据存储    |

**不要将文章正文、CMS 密钥或 AI API Key 直接存入 localStorage。**

SQLite 是持久化业务数据的主要存储。

Jotai 不应承担数据库职责。

---

# 十、React Router 配置

使用 React Router 管理页面路由。

由于项目属于 Tauri 桌面客户端，优先选择适合本地 WebView 加载的路由方式。

建议初始化阶段使用 `HashRouter`，避免静态资源加载与页面刷新时产生路径解析问题。

需要配置：

```text
/dashboard
/import
/articles
/editor/:id
/images
/publish
/settings
```

默认进入：

`/dashboard`

未知路由跳转到工作台或显示 404 页面。

导航高亮应根据当前路由自动更新。

---

# 十一、Rust 后端初始化

Rust 后端必须实现最小可用功能。

## 11.1 基础 Command

至少创建：

```text
get_app_info
health_check
```

其中：

`get_app_info`

返回：

```typescript
interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
```

`health_check`

返回明确的后端就绪状态。

前端设置页面需要真实调用 Rust Command 展示应用信息，而不是写死所有数据。

## 11.2 Rust 模块结构

至少包含：

```text
commands/
database/
cms/
system/
```

其中：

- commands：Tauri IPC 入口。
- database：数据库操作。
- cms：未来 CMS 接口服务。
- system：系统能力。
- error.rs：统一错误定义。

未来 AI 模块可以扩展到：

```text
ai/
├── provider.rs
├── client.rs
└── stream.rs
```

本次不需要实现真实 AI 请求。

## 11.3 错误处理

Rust Command 统一返回可序列化的错误信息。

前端必须捕获 IPC 错误。

禁止静默吞掉异常。

用户可见的错误提示应使用统一 Toast 组件。

---

# 十二、SQLite 初始化

使用 SQLite 保存本地业务数据。

Rust 侧使用 SQLx。

不要将通用 SQL 执行能力直接暴露给 React 前端。

## 12.1 数据库位置

数据库必须保存在 Tauri 提供的应用数据目录下。

不要保存在：

- 项目源码目录。
- 安装目录。
- 临时构建目录。

数据库文件：

`pressdock.db`

使用 Tauri 应用数据目录 API 获取实际路径，不要硬编码 Windows 或 macOS 的绝对路径。

## 12.2 数据库迁移

建立数据库 Migration 机制。

初始设计至少包含：

```text
source_articles
drafts
```

预留：

```text
media_assets
publish_jobs
```

原始素材与编辑稿件必须分离。

原始素材保留：

- 原始标题。
- 来源 URL。
- 原始内容。
- 导入时间。

编辑稿件保留：

- 对应素材 ID。
- 编辑标题。
- 编辑正文。
- 草稿状态。
- 更新时间。

原则：

**原始素材不得因为编辑稿件的修改而被覆盖。**

## 12.3 初始数据库功能

至少验证：

- 数据库初始化。
- 数据表创建。
- 草稿保存。
- 草稿读取。

初期允许通过最小演示操作验证。

不要在尚无业务需求时创建大量数据库表。

---

# 十三、CMS 接口抽象

PressDock 未来需要连接真实新闻 CMS。

当前阶段只定义接口，不实现未经确认的外部 API。

建议提供：

```typescript
interface CmsAdapter {
  importArticle(url: string): Promise<Article>;

  getArticles(): Promise<Article[]>;

  getArticle(id: string): Promise<Article>;

  saveDraft(article: Article): Promise<void>;

  publishArticle(id: string): Promise<void>;
}
```

这是前端服务层的契约示意。

具体 TypeScript 类型可以根据数据模型细化。

Rust 侧应具备与之对应的业务模块设计。

需要将：

- CMS 连接信息。
- CMS 请求实现。
- 业务模型。
- UI 页面。

相互解耦。

当前可以提供 `MockCmsAdapter`。

未来接入真实后端时，可以增加 `HttpCmsAdapter`。

**禁止编造真实 CMS API 路径、认证协议或响应字段。**

---

# 十四、安全要求

本项目未来涉及新闻后台账号、CMS API、AI API 和本地文件，因此初始化时必须考虑安全边界。

## 14.1 密钥保护

- 不将 API Key 写入前端源码。
- 不将密钥提交到 Git。
- 不使用 `VITE_*` 环境变量保存需要保密的密钥。
- 不将密钥保存在普通 localStorage。
- 后续使用操作系统安全凭据服务存储密钥。

当前阶段没有真实密钥时，只保留配置接口及说明。

## 14.2 Tauri 权限

使用 Tauri 2 Capability 机制。

遵循最小权限原则。

不启用当前项目不需要的系统权限。

Rust Command 也必须验证参数和敏感操作授权，不可仅依赖前端按钮是否可见。

## 14.3 内容安全

新闻正文和外部 HTML 属于不可信内容。

禁止直接使用未处理的 HTML 注入页面。

如果未来需要富文本 HTML 预览，必须提供内容净化和安全渲染机制。

不要将不可信新闻正文作为可执行脚本处理。

---

# 十五、跨平台要求

## 15.1 Windows

确保支持：

- Windows 10/11。
- Tauri WebView2。
- 窗口缩放。
- 高 DPI 显示。
- 本地数据库。
- 文件选择。

## 15.2 macOS

确保支持：

- Intel macOS。
- Apple Silicon macOS。
- WKWebView。
- 系统深浅色模式。
- 正常的窗口尺寸和布局。

不要写死平台路径。

## 15.3 Android

未来计划支持 Android。

当前阶段要求：

1. UI 业务组件尽可能平台无关。
2. 桌面原生能力采用适配层。
3. 不在共享模块中直接依赖桌面专属功能。
4. 不假设手机可以执行桌面终端命令。
5. 移动端使用独立布局。
6. SQLite 数据结构考虑跨平台复用。

不要求当前阶段生成 Android APK。

在 `docs/android-plan.md` 中记录 Android 后续初始化、兼容性及测试计划。

---

# 十六、开发规范

## 16.1 TypeScript

要求：

- 启用 strict。
- 尽量使用明确类型。
- 避免滥用 any。
- 统一使用类型化业务模型。
- 所有外部数据经过必要验证。
- 统一代码格式。

## 16.2 React

要求：

- 使用函数组件。
- 使用 Hooks。
- 组件职责单一。
- 避免超大组件。
- 页面与业务逻辑分离。
- 适当使用自定义 Hooks。

不要无意义地使用 `useMemo` 和 `useCallback`。

## 16.3 Jotai

要求：

- Atom 按业务领域分类。
- 使用派生 Atom 管理派生状态。
- 不要构建庞大的单一全局 Atom。
- 不要重复保存可以计算得出的状态。

## 16.4 Rust

要求：

- 使用 Rust 标准错误处理。
- 避免不必要的 `unwrap()`。
- 使用清晰的模块结构。
- 异步任务避免阻塞 UI。
- 不在 Command 层堆积全部业务逻辑。

## 16.5 样式

要求：

- 优先使用 Tailwind CSS。
- 统一使用 shadcn/ui 组件。
- 避免大量内联 style。
- 统一颜色、间距、圆角和字体规范。
- 不自行复制另一套 UI 组件体系。

---

# 十七、开发工具配置

## 17.1 ESLint

配置 ESLint。

需要支持：

- React。
- TypeScript。
- React Hooks。

## 17.2 格式化

使用 Prettier 统一前端代码格式。

Rust 使用：

```bash
cargo fmt
```

## 17.3 测试

安装并配置 Vitest。

至少建立以下测试：

- 基础页面渲染。
- 路由切换。
- Jotai 状态变更。
- 文章数据模型相关逻辑。

Rust 侧编写必要的单元测试。

优先测试业务逻辑，不必为每个简单 UI 组件创建测试。

## 17.4 package.json Scripts

确保存在或补充：

```text
dev
build
lint
test
format
tauri
```

其中：

```bash
npm run dev
```

启动 Vite 前端。

```bash
npm run tauri dev
```

启动桌面应用。

```bash
npm run build
```

执行前端类型检查及生产构建。

```bash
npm run tauri build
```

构建当前操作系统的应用安装产物。

```bash
npm run lint
```

执行代码规范检查。

```bash
npm run test
```

执行单元测试。

不要为了增加脚本而覆盖官方模板必要的配置。

---

# 十八、构建与发布准备

## 18.1 本地构建

需要检查：

```bash
npm run build
```

以及：

```bash
npm run tauri build
```

要求在当前操作系统和已有构建环境允许的情况下成功。

Windows 预期可以构建 Windows 安装包。

macOS 预期可以构建 macOS 应用。

## 18.2 GitHub Actions

初始化基础 CI 配置。

要求：

- Windows Runner。
- macOS Runner。
- Node.js 安装。
- Rust Toolchain。
- npm ci。
- 前端构建检查。
- 基础测试。
- Tauri 构建。

当前不需要：

- 自动公开发布。
- 自动上传应用商店。
- 自动签名。
- 自动公证。
- 自动更新服务器。

这些功能预留后续扩展。

如果 CI 需要签名才能完成某些发行格式，优先生成可测试的未签名产物，并在文档中说明限制。

不得在代码中写入发布密钥。

---

# 十九、README 文档

请创建完整的 `README.md`。

内容至少包含：

1. 项目介绍。
2. 技术栈。
3. 环境要求。
4. 安装依赖。
5. 开发启动。
6. 项目目录。
7. 构建方式。
8. Windows / macOS 注意事项。
9. Android 后续计划。
10. 当前完成的功能。
11. 尚未完成的功能。

同时创建：

`docs/architecture.md`

说明前后端架构、数据流与模块职责。

`docs/development.md`

说明开发规范、常用命令及新增业务模块的方法。

`docs/android-plan.md`

说明未来 Android 兼容与迁移注意事项。

---

# 二十、本次任务实施顺序

请严格按照以下顺序实施。

## 第一阶段：环境检查

- 检查当前目录。
- 检查 Node.js。
- 检查 Rust。
- 检查系统构建依赖。
- 确认项目是否已经存在。

## 第二阶段：初始化基础工程

- 创建 Tauri 2 项目。
- 选择 React + TypeScript。
- 配置 Vite。
- 配置项目基本信息。
- 验证基础启动。

## 第三阶段：安装前端技术栈

- Tailwind CSS 4。
- shadcn/ui。
- Jotai。
- React Router。
- Lucide React。
- Zod。

## 第四阶段：创建基础架构

- 创建目录结构。
- 配置路由。
- 配置 Provider。
- 建立状态管理。
- 建立统一服务层。

## 第五阶段：开发基础 UI

- 主窗口布局。
- 左侧导航。
- 顶部工具栏。
- 主题切换。
- 状态栏。
- 七个业务页面。

## 第六阶段：初始化 Rust

- 模块化目录。
- 基础 Command。
- 前后端 IPC。
- 基础错误处理。

## 第七阶段：初始化 SQLite

- 创建数据库。
- 建立 Migration。
- 建立文章及草稿数据模型。
- 实现最小的草稿持久化能力。

## 第八阶段：代码质量

- ESLint。
- Prettier。
- TypeScript 类型检查。
- Vitest。
- Rust 测试。

## 第九阶段：构建验证

依次执行：

```bash
npm run lint
npm run test
npm run build
cargo fmt --check
cargo test
npm run tauri build
```

Rust 命令需要在正确的 Cargo 工程目录执行。

如环境具备条件，也应运行 `cargo clippy`。

必须处理项目自身导致的构建失败。

对于环境缺失造成的失败，应明确记录原因。

## 第十阶段：完成文档

- README。
- architecture.md。
- development.md。
- android-plan.md。

---

# 二十一、验收标准

完成项目初始化后，应当满足以下条件。

| 编号 | 验收内容                        |
| ---- | ------------------------------- |
| 1    | Tauri 2 项目创建成功            |
| 2    | React + TypeScript 可以正常运行 |
| 3    | Vite 构建成功                   |
| 4    | Tailwind CSS 样式生效           |
| 5    | shadcn/ui 组件正常显示          |
| 6    | Jotai 状态管理正常工作          |
| 7    | 页面路由切换正常                |
| 8    | 主窗口 UI 完整                  |
| 9    | 七个基础业务页面存在            |
| 10   | 深浅色主题切换正常              |
| 11   | 主题配置可以持久化              |
| 12   | Tauri IPC 可以正常调用 Rust     |
| 13   | SQLite 初始化成功               |
| 14   | 草稿可以保存和读取              |
| 15   | TypeScript 类型检查通过         |
| 16   | ESLint 检查通过                 |
| 17   | 已实现功能的测试通过            |
| 18   | 当前平台 Tauri 构建成功         |
| 19   | README 和架构文档完整           |
| 20   | 未引入无必要的大型依赖          |

最终必须提供一个真正可运行的项目。

不接受只有目录结构和大量空文件、没有可运行应用的初始化结果。

---

# 二十二、明确不属于本次任务的内容

以下功能暂时不需要完整实现：

- 真实新闻网站爬虫。
- 真实 CMS 登录。
- 真实 CMS API 对接。
- 新闻自动发布。
- AI 文章改写。
- AI 自动排版。
- AI 标题生成。
- 复杂富文本编辑器。
- 完整图片裁剪处理引擎。
- MCP Server。
- 多用户权限系统。
- 云端数据库。
- 自动更新系统。
- Android APK 发布。

但项目结构需要为未来增加这些功能保留合理的扩展空间。

不要为了完成初始化而提前实现大量复杂业务。

---

# 二十三、最终交付要求

完成所有操作后，请输出实施报告。

报告至少包含：

## 1. 项目初始化结果

说明项目是否成功创建。

## 2. 技术栈版本

列出实际安装的关键依赖版本。

## 3. 实际项目目录

输出核心目录结构。

## 4. 已实现功能

说明当前已经可以运行的功能。

## 5. 验证结果

列出执行的命令及结果，例如：

```text
npm run lint          PASS / FAIL
npm run test          PASS / FAIL
npm run build         PASS / FAIL
cargo fmt --check     PASS / FAIL
cargo test            PASS / FAIL
npm run tauri build   PASS / FAIL
```

没有执行的命令必须标为 `NOT RUN`。

不要将未执行的测试写成通过。

## 6. 启动说明

给出启动项目的准确命令。

## 7. 后续开发建议

只列出真正需要后续处理的事项。

---

# 二十四、Codex 执行要求

请直接开始执行本项目的初始化任务。

执行过程中遵守：

1. 优先使用官方脚手架。
2. 避免重复创建工程。
3. 实际安装依赖，不要只修改 package.json。
4. 保留 npm lockfile。
5. 不擅自删除现有用户文件。
6. 不擅自推送到远程仓库。
7. 不擅自增加超出需求的大型功能。
8. 不编造 CMS 接口。
9. 不在项目中写入真实密钥。
10. 发现可修复的编译错误应直接修复。
11. 完成后进行实际构建和测试。
12. 输出准确的项目状态。

如果遇到不影响初始化的细节问题，请采用合理的工程默认值继续执行。

**最终目标：创建一个具有完整工程基础、结构清晰、界面可用、能够持续扩展的 PressDock 新闻 CMS 客户端，为后续新闻采集、编辑、AI 辅助处理及发布功能开发提供稳定基础。**

这份文档的重点是让 Codex **完成真正可运行的工程初始化**，而不是一次性开发完整 CMS。它已经包含七个基础业务页面、Jotai 状态管理、Rust IPC、SQLite、测试及 Windows/macOS 构建要求。

建议初始化成功后，再单独交给 Codex 第二份需求文档，专门实现 **新闻 URL 导入 → 正文段落整理 → 图片裁剪 → 标题处理 → CMS 发布** 的完整工作流。这样可以避免基础架构和复杂业务同时开发，降低返工风险。
