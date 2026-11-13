# 筛选区重复标题移除验收（2026-11-10）

## 调整范围

渠道素材、优质文章、一至三级待审核文章、桌面与 Android 素材导入已移除独立页内标题及介绍行。页面名称继续由导航和应用顶栏提供；桌面保留 `sr-only` 一级标题，不参与布局。文章页专用 `.article-page-heading` 样式已删除。

- 渠道素材：排序、取消排序、新增素材合并到筛选操作组，位于刷新和列配置之后。按钮显式设置 `type="button"`，位于筛选字段的禁用 `fieldset` 外，排序期间仍可保存或取消。操作组允许自然换行。
- 桌面素材导入：采集设置移到采集记录工具栏，位于刷新之后。
- Android 素材导入：移除“从来源文章开始”所在行，采集设置变为日期和刷新旁的 44px 图标链接，保留可访问名称“采集设置”和原有设置深链接。
- 保留筛选字段、文章标题、列表分区、弹框标题及必要业务提示。工作台、图片处理、发布管理、设置页与应用顶栏不在修改范围内。

本次仅调整四个页面组件和文章页标题样式，不变更 API、IPC、数据结构或 Rust 业务逻辑。

## 自动化回归

| 检查                                                                                | 结果                     |
| ----------------------------------------------------------------------------------- | ------------------------ |
| 渠道列表、渠道写入、文章工作区、文章审核、桌面导入、Android 导入和 Android 渠道测试 | 7 个文件、88 项通过      |
| `npm run lint`                                                                      | 通过                     |
| `npm run format:check`                                                              | 通过                     |
| 分页评估与 Android 构建脚本测试                                                     | 9 项通过                 |
| TypeScript 与 Vite 生产构建                                                         | Windows 打包前置步骤通过 |

复用现有测试，未为删除装饰新增测试。该次没有修改 Rust 业务代码，未重复执行 Rust fmt/test/clippy。

## ego 浏览器验收

使用真实页面组件和应用布局，在独立的本机演示宿主验收。页面显式标注“演示数据”，业务服务使用内存替身，外部请求和未声明 IPC 被阻止；未连接或写入真实 CMS，也未请求真实 AI。

共检查 25 个布局：六类页面分别覆盖桌面 1440×900、960×900，Android 360×844、390×844，另检查桌面素材导入 640×800 卡片布局。

- 内容区没有重复可见一级标题或标题空白占位；桌面隐藏标题为绝对定位的 `sr-only` 元素。
- 各尺寸文档宽度均等于视口宽度；测量的工具栏操作、设置入口及分页按钮没有超出视口。
- 渠道排序时筛选禁用，保存和取消按钮仍可用；实际演练下移、保存、再次开始和取消排序，以及打开新增素材弹框。保存仅作用于演示内存。
- 导入设置链接仍指向 `/settings?tab=harvest&returnTo=import`；Android 图标可通过键盘进入设置。通过模拟原生返回事件离开设置后，未提交的链接输入恢复。
- 演示采集入队后焦点返回输入框；手机采集记录滚动时日期、刷新和设置入口保持在顶部。
- 手机单条审核预览可打开，脚本、事件属性及危险链接已净化；模拟返回关闭预览后焦点回到审核按钮。没有提交审核请求。

尺寸与交互证据：

- [桌面测量](../artifacts/filter-headings-2026-11-10/desktop-layouts.json)
- [手机与窄窗口测量](../artifacts/filter-headings-2026-11-10/mobile-layouts.json)
- [交互记录](../artifacts/filter-headings-2026-11-10/interactions.json)

本机 ego 的截图接口此前持续超时，因此本次视觉证据使用同一 ego 页面以屏幕媒体样式打印 PDF，再渲染为 PNG，并逐一检查代表性页面；这些是浏览器渲染图，不是真机截图。

| 页面                      | 渲染图                                                                    |
| ------------------------- | ------------------------------------------------------------------------- |
| 渠道素材，1440px          | [查看](../artifacts/filter-headings-2026-11-10/channels-desktop-1440.png) |
| 渠道素材，960px           | [查看](../artifacts/filter-headings-2026-11-10/channels-desktop-960.png)  |
| 一级待审核，1440px        | [查看](../artifacts/filter-headings-2026-11-10/review-1-desktop-1440.png) |
| 桌面素材导入，960px       | [查看](../artifacts/filter-headings-2026-11-10/import-desktop-960.png)    |
| 桌面素材导入，640px       | [查看](../artifacts/filter-headings-2026-11-10/import-desktop-640.png)    |
| Android 素材导入，360px   | [查看](../artifacts/filter-headings-2026-11-10/import-android-360.png)    |
| Android 素材导入，390px   | [查看](../artifacts/filter-headings-2026-11-10/import-android-390.png)    |
| Android 一级待审核，360px | [查看](../artifacts/filter-headings-2026-11-10/review-1-android-360.png)  |

## 构建交付

按 Windows、Android 顺序构建，避免共用 `dist` 时混入另一平台资源。具体产物时间、大小及校验值见[构建记录](../artifacts/filter-headings-2026-11-10/build-manifest.json)。

首次 Windows 构建已完成编译，但旧程序占用 `pressdock.exe`，导致产物替换失败。将旧文件改名为同目录的 `pressdock-running-20261110-0052.exe` 后重新打包，未关闭正在运行的旧窗口。当前窗口仍运行旧版，需要退出后打开新程序查看此次调整。

- Windows 程序：`src-tauri/target/release/pressdock.exe`。
- Windows 安装包：`src-tauri/target/release/bundle/nsis/PressDock_0.1.0_x64-setup.exe`、`src-tauri/target/release/bundle/msi/PressDock_0.1.0_x64_en-US.msi`。
- Android：`artifacts/PressDock-android-debug-arm64.apk`，正式业务配置、ARM64、调试签名。

Windows 重建成功并生成 MSI、NSIS 两类安装包；随后 Android 构建成功，APK 已归档。Android 沿用 Windows 无符号链接权限时的原生库复制打包流程，未修改系统权限。

未安装新包或执行 Android 真机验收。二、三级真实审核写入及真实发布效果仍未验证。本次没有提交或推送远程，保留既有工作区修改及两份锁文件。

## 补充：全选入口去重（2026-11-10）

宽表格和紧凑表格现在仅保留表头全选，工具栏中的“全选本页”及对应分隔线已移除。桌面卡片和 Android 保留原有全选入口，文章总数、已选数量、清空与批量审核继续提供。所有保留的全选控件统一使用可访问名称“全选当前页文章”，审核弹层沿用原有焦点回退逻辑。

`ReviewToolbar` 增加默认开启的 `showSelectAll` 显示开关，由桌面根据卡片布局控制；不改变选择状态的生命周期、审核规则、服务接口、IPC 或 Rust 业务代码。

本轮相关文章回归测试为 2 个文件、37 项通过，包含新增的三种桌面布局选择交互，以及布局切换保留选择和原审核触发器卸载后的焦点回退用例；原有 Android、角色限制与审核流程测试一并通过。lint、格式检查及 TypeScript/Vite 生产构建通过。

ego 使用同一本机隔离宿主和明确标识的演示数据，检查一至三级页面的桌面宽表格（1440px）、紧凑表格（960px）、卡片（900px）和 Android（360／390px），加上两端优质文章页，共 17 个组合：

- 待审核页每种布局恰好一个全选入口，表格全选位于表头，卡片与手机位于原工具栏。
- 各组合均验证全选、取消单篇后的半选和清空；桌面在宽表格、紧凑表格、卡片间来回切换时保留选择。
- 批量预览包含选中的三篇演示文章，关闭后焦点回到批量审核按钮；卡片单条预览打开后切回表格，关闭时焦点回到现有的表头全选框。
- 未发现文档横向溢出，手机底部分页及批量审核仍可达；优质文章页继续隐藏选择入口。
- 全程没有提交审核或请求真实 CMS。视觉证据沿用上述 ego 打印 PDF 后渲染 PNG 的方式，未执行真机安装。

本轮证据与构建记录：

- [桌面效果](../artifacts/article-single-select-2026-11-10/desktop-wide-1440.png)、[桌面卡片](../artifacts/article-single-select-2026-11-10/desktop-cards-900.png)、[Android 360px](../artifacts/article-single-select-2026-11-10/android-android-360.png)、[Android 390px](../artifacts/article-single-select-2026-11-10/android-android-390.png)。
- [17 个布局组合](../artifacts/article-single-select-2026-11-10/layouts.json)、[交互与焦点记录](../artifacts/article-single-select-2026-11-10/interactions.json)。
- [本轮 Windows／Android 构建及 SHA-256](../artifacts/article-single-select-2026-11-10/build-manifest.json)，按 Windows → Android 顺序生成，沿用前述交付路径。APK 为正式业务配置、ARM64、调试签名。

本轮未修改两份锁文件，未提交或推送远程。
