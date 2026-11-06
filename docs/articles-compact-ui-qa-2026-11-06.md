# 文章管理紧凑版：实施与验收

日期：2026-11-06。依据[已确认设计稿](articles-ui-design-2026-11-06.md)，已修改真实 React 页面；本记录中的 `final-*` 为实际应用截图，不是独立原型。

## 已实施

- 四类文章沿用现有查询、权限、服务端分页和列偏好。默认四列为新闻内容、配图、分发记录、操作；保留原 14 个列 ID、存储键、用户显式显隐和列宽。常用筛选集中排列，编号、作者和标记按需展开，输入不自动提交。
- 标题聚合编号、分类、作者、页数与简写时间，完整时间保留悬停。三张配图合并为缩略图组，预览仍显示实际尺寸和体积。完整信息展示全部推荐、分发位置、标签及摘要；编辑和优质文章的转素材留在行内。
- 列表通过记录区 ResizeObserver 适配侧栏变化：960px 起四列；640–959px 收拢分发；小于 640px 使用卡片。紧凑列的默认宽度放在列定义中，避免被误当成用户宽度而破坏标题伸展。
- 桌面编辑工作区最大宽 1184px，正文首屏可见；右侧 300px 文章信息可收起，1100px 及以下使用正文／文章信息页签。标题、工具栏、错误与保存栏固定，两侧内容分别滚动。页签保留编辑器实例，补全页签与面板的无障碍关联。
- 字数与页数仅在正文改变时重新计算，光标移动复用统计；保护模式不把空编辑文档的统计误当作原文字数。
- 分页助手改为 200px 目录与正文预览分栏，目录增加页首文本。导航、更多菜单、生成及应用操作固定；沿用当前文档、语义分页、取消、失效及单次撤销逻辑。390×400 时配置说明默认折叠，可展开查看原因和设置入口。
- HTML 源码中由文本框承担滚动，校验失败保留输入；手机桌面窗口的底部按钮并排。链接浮层限宽 448px，图片预览保持原比例，转素材显式启用已有 560px 紧凑抽屉。
- 修正 Android 页签滚动恢复中对尚未挂载 viewport 的非空断言；保留原 Android 列表、编辑及助手布局。CMS、类型化 IPC、Rust、数据库和依赖未修改。

## 改造前后

| 场景      | 改造前                                                                  | 改造后                                                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文章列表  | [原列表](../artifacts/articles-design-2026-11-06/before-list.png)       | [1440px](../artifacts/articles-implementation-2026-11-06/final-list-1440.png)、[1024px](../artifacts/articles-implementation-2026-11-06/final-list-1024.png)、[390px](../artifacts/articles-implementation-2026-11-06/final-list-390.png)                       |
| 编辑首屏  | [原编辑](../artifacts/articles-design-2026-11-06/before-editor.png)     | [1440px](../artifacts/articles-implementation-2026-11-06/final-editor-1440.png)、[1024px](../artifacts/articles-implementation-2026-11-06/final-editor-1024.png)、[390px](../artifacts/articles-implementation-2026-11-06/final-editor-390.png)                 |
| 分页助手  | [原助手](../artifacts/articles-design-2026-11-06/before-pagination.png) | [桌面](../artifacts/articles-implementation-2026-11-06/final-pagination-1440.png)、[390px](../artifacts/articles-implementation-2026-11-06/final-pagination-390.png)、[390×400](../artifacts/articles-implementation-2026-11-06/final-pagination-short-390.png) |
| HTML 源码 | [原源码](../artifacts/articles-design-2026-11-06/before-source.png)     | [桌面](../artifacts/articles-implementation-2026-11-06/final-source-1440.png)、[390px](../artifacts/articles-implementation-2026-11-06/final-source-390.png)                                                                                                    |
| 转素材    | [原表单](../artifacts/articles-design-2026-11-06/before-promote.png)    | [560px 抽屉](../artifacts/articles-implementation-2026-11-06/final-promote-1440.png)                                                                                                                                                                            |

## Ego 实页检查

使用同一个 Ego TaskSpace，桌面视口高度 900px，390px 视口高度 844px。独立演示宿主注入 10 篇明确标注的文章、3 页正文和示意配图；写命令在替身 IPC 入口拒绝。实际拦截到 `cms_update_article` 与 `cms_add_article_to_promote`，失败后均保留输入，不制造保存成功状态。

| 窗口宽度 | 列表形态 | 首行高度 | 正文滚动区高度 | 保存按钮底部 | 整页横向溢出 |
| -------- | -------- | -------- | -------------- | ------------ | ------------ |
| 1440px   | 四列     | 72px     | 558px          | 870px        | 0px          |
| 1280px   | 四列     | 72px     | 558px          | 870px        | 0px          |
| 1024px   | 三列     | 75px     | 509px          | 870px        | 0px          |
| 768px    | 卡片     | 按内容   | 509px          | 870px        | 0px          |
| 390px    | 卡片     | 按内容   | 460px          | 833px        | 0px          |

1440px 下列表表头起点约 y=240，固定分页起点 y=807。1024px 的记录区实际为 760px；紧凑模式仍由标题吸收剩余宽度。768px 的记录区为 504px，因此按设计切换卡片。

额外验证：

- 搜索输入不提交，点击搜索筛选到单条，重置恢复十条；更多菜单打开完整信息，包含第二个分发位置。
- 文章保存被拦截后保留标题；未保存关闭出现继续编辑／放弃确认。源码拒绝临时图片地址且保留输入，取消不修改正文；有效源码应用后一次撤销恢复原三页。
- 1024px 内部页签切换保持同一个正文 DOM 节点及 `scrollTop=100`。目录切换到第二页，合并后页数减少，关闭助手并撤销恢复三页。
- 嵌套分页保留预览与说明，禁止段后插入；历史表格正文仍显示保护模式。
- 桌面源码文本区高 558px，390px 下高 614px，外层滚动容器溢出均为 0px。390×400 分页预览高 132px，关闭栏底部 y=400，配置说明可以展开。
- 转素材抽屉宽 560px，选择渠道和子渠道后提交仍到独立文章转素材命令，拒绝后输入保留。

原始量测：[五宽度布局](../artifacts/articles-implementation-2026-11-06/final-layouts.json)、[紧凑列与源码补验](../artifacts/articles-implementation-2026-11-06/final-refinements.json)、[短窗口及嵌套分页最终结果](../artifacts/articles-implementation-2026-11-06/final-edge-cases.json)、[拦截的演示写入](../artifacts/articles-implementation-2026-11-06/blocked-writes.json)。`final-edge-cases.json` 是短窗口修正后的结果；早期量测中的 21px 预览已修正为 132px。

## Android 回归

重启同一隔离 Vite 宿主并启用原 Android 平台分支，在 Ego 390×844 下检查：

- [卡片列表](../artifacts/articles-implementation-2026-11-06/final-android-list-390.png)、[基本信息](../artifacts/articles-implementation-2026-11-06/final-android-info-390.png)、[正文](../artifacts/articles-implementation-2026-11-06/final-android-body-390.png)。页签切换保留同一个编辑器；保存按钮外框高 44px，底部 y=828，无整页横向溢出。
- [分页助手](../artifacts/articles-implementation-2026-11-06/final-android-pagination-390.png)与[源码](../artifacts/articles-implementation-2026-11-06/final-android-source-390.png)继续使用原有分支，底部操作区到 y=844；源码初始焦点在弹框容器，未自动激活文本输入。
- [量测记录](../artifacts/articles-implementation-2026-11-06/android-regression.json)中 Android 写入拦截列表为空，本轮未在 Android 分支提交写请求。

## 自动检查

新增文章工作区回归测试，覆盖默认列、完整分发信息、旧偏好恢复、紧凑标题伸展、类别动作、菜单关闭焦点、卡片、筛选提交、编辑器节点保留、元数据不改原 HTML、源码失败／取消／应用／撤销。分页目录增加首句后，原有正文断言改为定位实际预览段落，避免与目录文字重复。

交付检查：`npm run lint`、`npm test`（34 个文件、276 项）、`npm run build`、`npm run format:check`；README 两项 Node 测试分别为 4 项和 5 项。具体最终退出状态见[检查记录](../artifacts/articles-implementation-2026-11-06/checks.json)。

完整测试独立运行用时约 29 秒，276 项通过。曾与生产构建并行运行时，两项原有交互测试触发 5 秒超时；单独重跑全部通过，未修改测试超时阈值。

## 边界

- 使用隔离数据与现有测试验证交互，没有连接真实 CMS 或 AI；浏览器中的 AI 分页为缺配置状态。生成、取消、失效、应用及迟到结果由现有分页测试回归，不将其写成真实模型调用成功。
- Android 为浏览器平台分支检查，未构建 APK、安装真机或实测软键盘；未重新打包 Windows exe，也未运行与此次纯前端改造无关的 Rust 测试。
- 全局 Workspace 在跨过 768px 时仍会切换整个布局并重挂载文章路由，可能关闭未修改的编辑框或重建撤销历史；脏表单继续沿用运行内存恢复。本次未调整全局导航架构。“保留编辑器实例”的验证范围是编辑框内部页签及 1100px 的双栏／页签重排。
- 在已有未提交修改上增量实施，未提交或推送远程；锁文件保持原状。

设计整理采用 Unslop 方法，作者 Damir Sokolovsky（[出处](https://heydamir.design/unslop)），遵循 CC BY 4.0。实施复用项目已有 shadcn / Radix 组件。
