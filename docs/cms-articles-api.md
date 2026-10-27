# CMS 文章管理

本次迁移以 Ego 对原站真实查询响应及被阻断的写请求为依据。原站入口：<https://newsadmin.nccontrol.com.cn/index.html#/article/article-review-quality>。线上写接口未实写验证；后续实写须另行授权测试数据。

## 查询与导航

| 路由                 | 页面       | status | quality | 可选筛选                                              |
| -------------------- | ---------- | ------ | ------- | ----------------------------------------------------- |
| `/articles/quality`  | 优质文章   | 3      | 1       | id、classid、title、start、end、author、editor、nubia |
| `/articles/review-1` | 一级待审核 | 0      | 0       | id、classid、title、start、end、author、editor        |
| `/articles/review-2` | 二级待审核 | 1      | 0       | id、classid、title、start、end                        |
| `/articles/review-3` | 三级待审核 | 2      | 0       | id、classid、title、start、end                        |

`/articles` 跳转优质文章。四页共用 `GET /api/Article`，状态由 Rust 根据页面枚举固定映射，不能从 IPC 指定审核动作。公共参数 `priority=0`、`current`、`pagesize`；布尔参数为 0/1，日期为 YYYY-MM-DD，空可选条件省略。隐藏条件强制清空。分类来自 `GET /api/ArticleClass`。

默认每页 50 条，支持 10、20、30、50、100、200、500 条，使用服务端 total/current/pageSize。搜索回第一页；重置清除可选条件并保留条数。各页面分别在运行内存记住已提交条件及分页，显式 URL 优先；退出、换号或关闭应用清空，同账号认证恢复保留。

列表保留 ID、分类、标题、三张标题图、作者、分页数、Comment、Tags、NTags、新闻时间、来源链接及固定操作列。Comment 在 Rust 读取响应时根据 `recommand[].ArticleId` 和 `promote[].ArticleId/Channel/SubChannel` 一次构造，支持多渠道。标签允许后台返回 JSON 字符串、数组、空字符串或 null，统一为数组。

优质文章 ID/标题打开 `https://mini.jnnc.com/h/{id}.html?zn=mr`；待审核打开 `https://mini.jnnc.com/preview/{id}.html?zn=mr`。来源通过系统浏览器打开，仅允许 HTTP/HTTPS。

## 编辑

`GET /api/Article/{id}` 读取真实详情，右侧抽屉编辑标题、TitlePic/2/3、标签、分类、摘要、作者、来源 URL 和 HTML 正文。富文本采用 wangEditor 原生内核，图片复用 Rust 的 `POST /api/FileData` 上传服务。

`NewsTime` 在列表中为日期字符串，在详情中为秒级整数时间戳。Rust 仅对该字段兼容字符串、整数、null 和缺省：字符串原样保留，整数转为十进制字符串，null / 缺省转为 null，维持 IPC 的 `newsTime: string | null` 约定；浮点数、布尔值、对象和数组仍拒绝。该时间字段不参与编辑保存。

保存 `PUT /api/Article/{id}`，字段为 camelCase：`id/title/classId/className/titlePic/titlePic2/titlePic3/tags/smallText/writer/sourceUrl/newsText`，固定 `action="edit"`，`tags` 转 JSON 字符串。不会提交审核动作。正文渲染和 HTML 粘贴边界用 DOMPurify 清理可执行内容，保留 `[!--empirenews.page--]`；只修改元数据时发送详情原始正文，撤销到初始正文也恢复原始字节。

未保存表单按账号仅放运行内存，关闭和离开确认；同账号登录恢复，显式退出或换号清空。上传及保存期间锁定关闭，写请求不自动重试；超时或断连提示“结果未确认，请刷新核对”。403 保留会话，401/A0230 进入现有认证失效流程。

## 添加到渠道素材

仅优质文章提供。复用素材表单和图片处理，独立保存回调提交 `POST /api/PromoteData`。带入标题、双图、摘要和作者；日期默认本地当天，Url 留空；真实配置提供渠道及联动子渠道，有子渠道时必须选择。

请求以文章行快照的 PascalCase 字段为基础，再覆盖用户素材字段。`Id` 必须保留原文章 ID，日期字段为 **`Publishdate`**，派生字段保留原站 `commentRecommand/commentPromote`。该协议与普通素材新增的 `Id=0`、`PublishDate` 独立，不能自行替换为 ArticleId 关联。成功仅表示添加素材，并刷新当前文章列表以更新 Comment。

## IPC 与边界

新增 `cms_list_articles`、`cms_list_article_classes`、`cms_get_article`、`cms_update_article`、`cms_add_article_to_promote`，同时注册命令和最小调用权限。调用遵循 UI → articleService → 类型化 IPC → Rust，会话和令牌复用现有服务。

协议相对图片仅在展示及图片许可登记时补 HTTPS，提交保留原始字段。文章三图扩展既有会话图片许可、懒加载、并发和缓存机制；无效地址显示占位。

旧内容编辑菜单、路由、页面、缓冲和单篇本地草稿读写链路已移除，工作台/发布历史只读，不删除 SQLite 历史记录。未迁移新增文章、审核、优先审核、热点推荐、增删优质文章、日志、勾选和批量操作。

## 验收边界

现有检查不新增测试用例。Ego 可用临时离线生产构建和带演示标识的 IPC 数据进行交互检查，写操作只记录并拦截，不连接线上写接口。此检查不代替桌面端凭据、原生 IPC 和服务端真实保存验收。未获授权不启动开发服务器、不提交代码。

2026-10-27 核验：真实只读分类响应包含全部 14 类，字段为 Id/Name；列表返回 data/total/current/pageSize 及 recommand/promote，空 Tags/NTags 为 null；详情正文 NewsText 为字符串、Status 为数字。Ego 离线验收覆盖四类筛选/操作差异、100/200/500 条、下一页和页面恢复、空列表、无效图片与多渠道 Comment、桌面/移动导航、元数据修改保留原文、未保存确认、同账号失效恢复、403 保留表单、渠道联动和子渠道必填。演示写入均被 IPC 替身拦截，没有线上保存。

检查结果：`npm run lint`、`npm run build`、Rust fmt/test/clippy 均通过；前端现有用例以 `npm test -- --maxWorkers=1 --testTimeout=15000` 串行运行，21 个文件共 148 项通过，Rust 54 项通过。未新增测试用例，删除旧编辑功能对应的失效用例并更新现有路由断言。全仓 `npm run format:check` 被 `.agents/skills` 下 22 个既有文件阻挡，本次修改文件的 Prettier 检查全部通过。发布编译成功，DMG 首次打包受环境 C.UTF-8 locale 影响，使用 `LC_ALL=C LANG=C npm run tauri bundle` 重试成功，生成 `.app` 与 `.dmg`。
