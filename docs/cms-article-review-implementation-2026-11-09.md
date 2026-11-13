# 文章审核实施与验收 · 2026-11-09

桌面与 Android 的一、二、三级待审核页已增加单条审核、当前页选择及批量审核，依据 [审核调研](cms-article-review-research-2026-11-09.md) 实现。优质文章及角色包含 `editor` 的账号隐藏审核和勾选入口，Rust 同样校验角色。没有优先审核、撤回或全部搜索结果审核。

## 操作与数据保护

- 表格选择列固定在左侧，窄屏卡片与手机卡片提供勾选。全选仅选当前页；换页、提交筛选、刷新、认证变化清空选择，不持久化。
- 单条重新读取 CMS 详情，桌面用右侧抽屉，手机用全屏弹框，标题和正文只读。预览复用正文净化函数，提交使用未净化、未加预览样式的原始 HTML。
- 同意和拒绝均需要确认，确认弹框显示数量和标题。按用户最新要求，单条与批量拒绝均无需填写原因；两种决定固定提交 `comment=""`。
- 任一选中文章有未保存文章或转素材草稿时阻挡审核，可继续编辑或再次确认放弃。所有编辑与审核共用 `useArticleActions` 的一个路由 blocker，请求期间锁定选择、编辑、审核及关闭。
- 结果按文章显示成功、失败、结果待确认、未执行。使用“审核通过／已拒绝”，不声称发布成功。结果只按账号保存在运行内存，认证过期后同账号登录保留，显式退出或换号清除。
- 完成后使文章缓存失效并重新查询，页码超过最后一页时回退；不自动重发。结果待确认的文章还须显式刷新核对后才能再次进入审核。

## IPC 与 HTTP

调用链为组件 → `articleService` → 类型化 IPC → Rust `CmsService`。新增命令：

| 命令                  | 输入                                                   | 返回                   |
| --------------------- | ------------------------------------------------------ | ---------------------- |
| `cms_review_article`  | `{view, decision, comment, article: CmsArticleDetail}` | `ArticleReviewSummary` |
| `cms_review_articles` | `{view, decision, comment, articles: CmsArticleRow[]}` | `ArticleReviewSummary` |

`view` 只接受 `review-1/review-2/review-3`，`decision` 只接受 `accept/reject`。Rust 校验正 ID、批量 1–500 条且 ID 唯一；同意与拒绝均固定 `comment=""`，忽略旧客户端携带的原因，不再校验原因必填。保留 IPC 的 `comment` 字段以兼容现有请求类型。命令及自动生成权限在构建清单、处理器、桌面和 Android main 窗口注册；来源及未授权窗口不能调用。原有编辑命令仍固定 `action="edit"`。

单条在写入前重新 `GET /api/Article/{id}`，核对当前 `Status` 对应审核级别、预览字段、正文、标签及 `UpdatedAt`；变化或不符合接口约定时不写。`PUT /api/Article/{id}` 使用 camelCase：

```text
id, newsText, title, classId, className, writer,
titlePic, titlePic2, titlePic3, smallText, sourceUrl, action, comment
```

保留字段原始 null 和 HTML 字符串，不带 status 或缺省的 tags/nTags。详情读取要求 `msg="succ"`。

批量逐篇以 ID 和当前级别重新查询列表，再核对完整行快照（包括派生分发信息）；变化、消失或无法唯一匹配时跳过。仅从服务器新读取的快照编码调研确认的 PascalCase 字段：

```text
Id, Title, ClassId, ClassName, TitlePic, SourceUrl, NewsTime,
TitlePic2, TitlePic3, SmallText, Tags, Writer, Pages, NTags,
commentRecommand, commentPromote, action, comment
```

Tags/NTags 将归一化后的数组各 JSON 序列化一次；其余值保留 null。不携带正文、status 或未知扩展字段，每篇仍使用 `PUT /api/Article/{id}`。

Rust 批次固定会话代次和凭据，串行等待每篇完整响应。`msg="succ"` 且无业务错误才报告成功；普通明确拒绝可继续，401/A0230、403、会话变化、超时、中断、5xx 或非确认写响应会停止剩余请求。网络失败发生于只读复查阶段表示未写，发生于写入阶段表示结果待确认。没有自动重试，摘要仅包含固定安全错误说明，不回显服务器诊断。响应结果：

```text
{ authExpired: boolean, items: [{ id, title, status, code, message }] }
status = succeeded | failed | unconfirmed | notAttempted
```

认证过期的摘要先存入内存，再触发现有登录失效通知。单条与批量共用原生审核锁，防止同时提交。

复查与 PUT 之间仍存在服务端并发变化的时间窗口；调研没有发现可用的原子版本条件协议，本次没有编造 ETag、版本锁或目标状态。实际审核流转由 CMS 决定。

## 自动检查

- Rust 新增 10 组本地 HTTP 测试，覆盖两种请求体、原文/null、三级状态、标签、快照变化、顺序等待、普通部分失败、认证失效、权限、响应不确定、会话变化、超时、输入与角色校验，以及禁止自动重试。
- 使用实际生成的 Tauri ACL 测试两个审核命令：main 到达类型校验，未授权来源窗口被拒绝；Android main 权限清单也纳入检查。
- 前端审核测试共 16 项，覆盖两端三级入口、角色与优质文章限制、全选、清空、筛选/分页/刷新、草稿与再次确认、净化和原文分离、单条与批量无原因拒绝、取消不提交、防重复、逐篇结果、页码恢复、摘要账号隔离、待确认刷新保护与专用 IPC。
- 全量前端使用 `npm test -- --maxWorkers=2`。首次默认并发运行遇到部分 5 秒测试超时；修复旧角色替身缺字段问题后降低并发重跑，未放宽超时或跳过用例。最终计数见下方构建记录。
- lint、前端构建、全仓 Prettier、9 项 Node 脚本测试通过。Rust fmt/test/clippy 和原生产物结果在下方构建记录中列出。

## ego-browser 隔离验收

使用实际文章页面与组件，独立注入带“演示数据／演示结果”标识的内存 IPC 替身，连接 localhost，分别启用桌面及 Android 构建环境。初始 Vite 开发页重载时曾停留在未加载完成状态，剩余手机交互改用独立静态构建完成。所有审核响应均来自内存，外部 fetch 被阻止；没有使用线上令牌、正文或实际审核写请求。

截图保存在 [artifacts/article-review-2026-11-09](../artifacts/article-review-2026-11-09/)：桌面宽屏列表、单条预览和结果、批量混合结果、550px 卡片；390px 手机列表、全屏预览、拒绝、草稿阻挡及逐篇结果。检查确认焦点进入确认框、正文净化、内部滚动及返回关闭。

### Android 多选框尺寸复验

初轮截图中的多选框确有异常：Android 通用按钮的最小尺寸将视觉方框撑到 44×44px，初轮验收漏掉了这一问题。本次先用 ego-browser 复现，再将 Android 多选框的视觉尺寸设为 20×20px，使用居中的 44×44px 伪元素保留触控范围。普通按钮的最小触控尺寸不变；同时将 Checkbox 选中样式改为 Radix 实际输出的 `data-state`，恢复选中与部分选中颜色。

ego-browser 使用同一组明确标识的本机演示数据复验：360px、390px 均无横向溢出；全选当前页、清空、单选正常；在视觉方框右侧 8px 处实际点击仍能勾选。桌面方框保持 16×16px。未发送审核写请求。

- [修复前截图](../artifacts/article-review-2026-11-09/android-checkbox-before.png)
- [390px 修复后截图](../artifacts/article-review-2026-11-09/android-checkbox-after.png)（同步更新原 `android-list.png`）
- [360px 修复后截图](../artifacts/article-review-2026-11-09/android-checkbox-360.png)
- [桌面复验截图](../artifacts/article-review-2026-11-09/desktop-checkbox-after.png)
- [尺寸与交互测量记录](../artifacts/article-review-2026-11-09/checkbox-size-evidence.json)

该轮尺寸修复的 14 项审核前端测试、lint、TypeScript、生产前端构建、全仓格式检查及 `git diff --check` 通过，并重新构建正式配置的 ARM64 调试签名 APK；当时 Windows 安装程序仍为初轮产物。后续视觉改版的构建记录以下方最新记录为准。浏览器复验不代表 Android 真机安装验收。

### 按设计稿施工与无原因拒绝（11 月 9 日至 10 日）

依据[批量审核设计稿](../artifacts/article-review-design-2026-11-09/README.md)落地实际 React 组件。手机将全选和清空留在顶部，数量与 48px 主按钮固定在底部；批量核对改为底部面板，标题、清单和操作区分层，内容内部滚动。桌面保留原表格、配图、分发与列配置，增加浅蓝选中行、左侧 2px 批注线和统一稿件清单，抽屉与确认框沿用校样蓝。新增拒绝确认的实色语义红按钮，其他删除按钮样式不变。

用户随后明确要求“拒绝没有原因”，因此原设计的原因表单不进入正式界面。单条和批量拒绝均显示稿件数量、标题及二次确认；取消不发请求。前端移除原因输入和必填校验，Rust 固定空 `comment`，本地 HTTP 测试覆盖空、空白与旧客户端原因均编码为空。草稿阻挡、请求锁、逐篇结果和禁止自动重试保持有效。

通过 ego-browser 的独立 localhost 静态构建验收实际桌面与 Android 组件，只有明确标识的内存演示数据。检查包括：

- 390px 手机列表、360px 确认框和 550px 桌面卡片均无横向溢出；手机 20px 方框保留 44px 触控区，方框外 8px 的实际点击可勾选，桌面方框为 16px。
- 20 篇演示稿件的底部面板最高占据视口减 56px；实际滚动至末尾时 footer 位置不变，背景页面不滚动。
- Esc 关闭批量面板后焦点回到“批量审核”，取消决定后回到“拒绝”；新增显式焦点恢复并在两端测试中回归。
- 同意、批量拒绝和单条拒绝的演示 IPC 均只调用一次且 `comment=""`；提交时确认、取消及关闭按钮锁定。混合结果按篇显示，并保留结果待确认提示。
- 手机单条预览为完整视口，正文净化后无脚本、iframe 或事件属性，长正文内部滚动。

验收图与测量记录保存在 [article-review-polish-2026-11-09](../artifacts/article-review-polish-2026-11-09/)；ego 截图接口此前在最小空白页也超时，本轮使用同一 ego 页面 `Page.printToPDF` 经 Poppler 转 PNG，并目视检查，属于浏览器打印渲染证据，不是真机截图。

设计方法使用 [unslop by Damir Sokolovsky](https://heydamir.design/unslop)，CC BY 4.0，保留作者署名。

### 移除选中竖线并对齐多选框（11 月 10 日）

按用户后续确认，移除选中表格行、桌面卡片和 Android 卡片左侧的蓝色竖线，保留浅蓝选中背景。表格选择列保持 44px，表头与行单元格统一左右 14px 内边距，将 16px 方框居中；此前表头 8px、行 12px 的内边距造成 4px 错位。修改仅作用于文章审核选择列，不改变通用表格或审核流程。

ego-browser 已核对表头及各行方框左边缘均为 14px，桌面全选和清空正常；360px、390px 手机方框与顶部全选左边缘均为 16px，选中卡片无额外竖线；550px 桌面卡片仅保留原中性边框。截图及测量见[选择列对齐复验](../artifacts/article-review-alignment-2026-11-10/README.md)。16 项审核回归测试、lint、前端生产构建及修改文件格式检查通过，Windows 程序、MSI／NSIS 和正式配置 ARM64 调试签名 APK 均已重新构建成功，无真实 CMS 写入。

## 构建与未验证范围

`cargo test --locked`：120 项通过，12 项既有付费、原生手动或真实云环境用例保持 ignored；未增加跳过项。Rust fmt 和 `cargo clippy --locked --all-targets -- -D warnings` 通过。原生 Webview IPC/ACL 审核用例已在本地执行通过。

前端全量回归：38 文件、345 项全部通过，其中审核测试 16 项；焦点恢复调整后再次运行这 16 项并全部通过。lint、TypeScript、生产前端构建、全仓格式检查及 9 项 Node 脚本测试通过。

| 构建命令                | 产物                                                                                                                                                                | 结果                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `npm run tauri build`   | [Windows 程序](../src-tauri/target/release/pressdock.exe)                                                                                                           | 成功                     |
| 同上                    | [MSI](../src-tauri/target/release/bundle/msi/PressDock_0.1.0_x64_en-US.msi)、[NSIS 安装程序](../src-tauri/target/release/bundle/nsis/PressDock_0.1.0_x64-setup.exe) | 成功                     |
| `npm run android:build` | [正式配置 ARM64 APK](../artifacts/PressDock-android-debug-arm64.apk)                                                                                                | 成功，调试签名，非演示包 |

11 月 10 日已使用视觉改版、无原因拒绝及焦点恢复后的最新代码，顺序重新执行上述 Windows 和 Android 构建，均成功；表中的程序、安装包和 APK 已更新。

Android 沿用脚本在 Windows 缺少符号链接权限时的文件复制回退，Gradle `assembleArm64Debug` 成功。日志中的既有 SDK 安装位置和 Java/Kotlin 废弃 API 警告未阻止构建。构建不包含安装或真实 CMS 登录写入。

本次不实写线上审核。一、二、三级真实审核状态变化、二／三级真实记录实写及真实发布效果仍未验证。调研确认原站前端没有拒绝原因必填限制，服务端是否接受空原因仍未实写验证；若服务端拒绝，按现有失败或待确认规则显示，不自动重试。Android 浏览器验收不等于真机安装、系统返回键、软键盘或 WebView 全流程验收；本次不宣称已完成这些设备检查。
