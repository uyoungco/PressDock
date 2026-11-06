# 系统设置：紧凑版设计稿

日期：2026-11-06。交付范围为真实页面调研、独立交互原型和截图；本轮不修改生产页面。沿用渠道、素材导入和文章管理的中性色、校样蓝与紧凑尺寸。

[打开交互设计稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/index.html) · [原型源码](D:/Project/PressDock/artifacts/settings-design-2026-11-06/prototype.js) · [布局验证](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-layout-final.json) · [交互验证](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-interaction-checks.json)

原型可直接在浏览器打开，不依赖运行中的开发服务。七个模块均可切换；修改仅保存在原型内存中，刷新后恢复演示数据。默认先展示采集页便于审稿；生产页面的默认入口不在本轮变更范围。

## 设计方向

| 项目     | 方向                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 产品     | 新闻编辑工作站的配置台，让采集、图片和 AI 编辑工具按同一套规则运行         |
| 性格     | 紧凑、准确、便于核对；每个配置都能找到生效方式与影响范围                   |
| 所属场景 | 编辑部的校样与参数清单；白色工作面、中性分隔线、校样蓝标记当前选择         |
| 重点画面 | 分页模板与模型的绑定关系；两张图片各自的尺寸、体积和格式约束               |
| 识别细节 | 在采集配置旁直接显示“默认分页模板 → 绑定模型 → 页长”，而非只放一个跳转按钮 |

保留现有七个模块及顺序：常规设置、采集与 AI 处理、图片预设、服务连接、AI 模型、提示词模板、关于应用。全局导航仅作设计稿背景示意，不纳入实施范围。

## 调研范围与发现

调研使用 Ego，载入真实 React 页面及真实组件，以类型化 IPC 的隔离替身提供明确标注的演示配置。检查了主题选择、采集 CDP 字段、油猴入口、四项 AI 规则、保留时间、提供商与模型编辑、两类模板、图片预设、服务连接和关于应用。对模型测试发出的请求进行了拦截，观察了真实组件的失败反馈；未访问真实 CMS、凭据库或模型服务。

主要代码来源：

- [设置入口](D:/Project/PressDock/src/pages/Settings/index.tsx)
- [常规、服务与关于](D:/Project/PressDock/src/pages/Settings/sections.tsx)
- [采集设置](D:/Project/PressDock/src/features/import/HarvestSettings.tsx)
- [提供商与模型](D:/Project/PressDock/src/features/ai/ModelSettings.tsx)
- [提示词模板](D:/Project/PressDock/src/features/ai/TemplateSettings.tsx)
- [图片预设](D:/Project/PressDock/src/features/image-presets/ImagePresetSettings.tsx)
- [Android 设置分支](D:/Project/PressDock/src/pages/Settings/MobileSettings.tsx)

按 Unslop 的审查顺序，现状属于已有风格基础上的布局和信息组织问题：

| 位置           | 发现                                                                    | 设计处理                                                               |
| -------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 页头和模块卡片 | 页头描述与卡片说明重复，信息进入较慢                                    | 22px 标题、12px 副文案，模块工具栏只保留必要的生效说明                 |
| 采集页         | CDP 帮助、开发说明和多层表单占据首屏，关键 AI 配置在下方                | 宽屏两栏，说明按需展开；开关和参数使用紧凑分组行                       |
| AI 模型        | 提供商的长表单先于模型目录，查看模型也需要经过编辑字段                  | 默认显示连接摘要与模型目录；提供商、模型按需编辑                       |
| 提示词模板     | 模板名、模型、参数、变量与两块提示词依次堆叠                            | 左侧模板列表；中间提示词；右侧绑定、参数和变量；底部固定保存           |
| 图片预设       | TitlePic / TitlePic2 使用接口字段名作为主要标签，锁定后果需要读说明理解 | 主图、第二张图片为中文主标签；字段名作为副行，分别显示锁定和自由调整项 |
| 服务连接       | “只读素材”等旧说明与已实现的渠道编辑能力不一致；可配置与已连通容易混淆  | 展示本地状态、CMS 会话和 AI 配置，明确已配置不等于已测试               |
| 常规与关于     | 实际信息很少，大卡片标题与说明占比高                                    | 保持短小，不用额外统计卡或装饰内容填空                                 |
| 窄窗口         | 横向标签及多列配置需要更清楚的折行顺序                                  | 标签自然换行，内容依据工作区宽度切换单栏                               |

实测现状在 1440×900、导航展开时，提供商保存按钮约在 y=863，模型目录入口约在 y=1005；采集页历史保留字段约在 y=1379。以上为隔离配置下的页面测量，不代表所有用户数据长度。模型入口测量及调用记录见 [现状观察](D:/Project/PressDock/artifacts/settings-design-2026-11-06/current-observation.json)。

## 七个模块的设计

### 1. 常规设置

保留跟随系统、浅色、深色三种主题。改为紧凑的三项选择，显示当前选中项，即时生效，不出现额外保存按钮。此页保持短小，不人为扩充配置。

[浅色稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-general-1440.png) · [深色预览](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-general-dark-1440.png)

### 2. 采集与 AI 处理

宽屏左栏按原有顺序安排油猴入口、获取方式和开发者模式；右栏安排 AI 规则、分页配置引用、元数据模型与保留时间。

- 油猴状态与安装按钮处于同一行，使用说明折叠。
- WebView / CDP 用分段选择；CDP 才显示浏览器与调试地址。切换时保留已填地址。
- 浏览器开启步骤放在“如何开启浏览器连接”，支持展开阅读。
- 开发者模式明确只影响之后新入队的任务，保留“不创建 CMS 文章、已有任务不变、关闭不补交”的语义。
- 四个 AI 开关使用同一行高，说明失败时保留原内容。
- 分页配置直接显示当前默认模板、实际绑定模型及最少 / 目标 / 最多字数；从此跳到文章分页模板。
- 元数据模型与分页模型明确区分，不把一个模型选择器误当成控制全部 AI。
- 历史保留输入紧凑显示单位，留空永久保留；清理范围按需展开。
- 底部保留自动保存状态，沿用停止输入 500 毫秒后保存、离开时刷新待保存修改的逻辑。开发者模式继续即时单独保存。

![采集设置设计稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-harvest-1440.png)

[改造前](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-harvest-light-1440.png) · [1280px](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-harvest-1280.png) · [1024px](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-harvest-1024.png) · [768px](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-harvest-768.png) · [390px 网页适配稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-harvest-390.png)

### 3. 图片预设

渠道、子渠道组成顶部目标选择区，子渠道吸收剩余宽度，长名称在生产组件中允许换行。复制来源与复制按钮紧邻，明确“替换当前表单，保存后生效”。

主图与第二张图片并排，各自保留宽、高、体积上限、格式。中文为主标签，TitlePic / TitlePic2 仅供核对。底部直接说明保存后锁定哪些项，留空哪些项可自由调整；不增加独立“锁定”开关，避免制造现有协议没有的状态。

宽高成对校验；单边、总像素和体积限制沿用现有约束。底部保存固定可达。每个目标子渠道的未保存输入在切换时保留。

![图片预设稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-presets-1440.png)

[改造前](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-presets-1440.png) · [390px 网页适配稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-presets-390.png)

### 4. 服务连接

将三张较松散的卡片收为一张状态清单：服务名称、状态、当前信息和已有的配置入口。保留本地服务检查、CMS 账号和会话信息、AI 模型配置。状态文字伴随色点，颜色不能作为唯一信息。

AI 的“已配置”只表示存在配置，不展示未经真实测试的绿色连通结论。原型中的后端就绪、CMS 会话均明确属于演示状态。

[服务连接稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-services-1440.png) · [改造前](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-services-light-1440.png)

### 5. AI 模型

保留提供商列表，但将右侧默认内容从编辑表单改为已保存连接摘要和模型目录。模型名称、ID、上下文、输出上限优先展示；编辑、测试、删除保持明确。窄区收起能力数值列，完整参数可打开模型编辑查看。

提供商和模型分别按需打开弹框：

- 提供商弹框宽 640px；标识、显示名称并排，地址、协议、密钥单行排列，兼容项折叠。
- 标识保存后不可修改；密钥留空保留已保存值，本机免密服务可留空。不得读取或回填真实密钥。
- Chat Completions 才展示输出 token 参数和系统角色；Responses 保留已有发送 store: false 选项。
- 模型弹框保留模型 ID、显示名称、上下文、输出上限、推理强度。上下文与输出上限并排。
- 获取模型目录只获得 ID，不自动猜测能力参数；测试需要真实服务返回结果，失败就地显示。
- 头部与底部操作固定。标准高度下默认表单完整显示，展开兼容项、错误增高或窗口变矮时允许中间表单滚动。
- 删除二次确认；提供商级联影响及模板引用限制继续显示，不直接绕过业务校验。
- 有修改关闭前确认，返回编辑保留输入；Esc、Tab 焦点约束和关闭后焦点返回需要与现有组件能力保持一致。

[模型管理稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-models-1440.png) · [改造前](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-models-light-1440.png)

![提供商编辑](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-provider-dialog-1440.png)

[模型编辑](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-model-dialog-1440.png) · [768px 提供商弹框](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-provider-dialog-768.png) · [390px 提供商弹框](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-provider-dialog-390.png)

### 6. 提示词模板

标题优化和文章分页继续分开，每类独立设置默认模板。宽屏采用“模板列表 / 提示词 / 参数”布局：

- 中间提供主要编辑宽度，模板名称、系统指令、用户提示词清楚分组。
- 右侧模型显示短名称，提供商另起一行，避免组合长名称被截断后无法区分。
- 标题模板保留候选数量和最大字数；分页模板将最少、目标、最多字数并为一组，并显示大小关系。
- 变量靠近提示词，插入最近聚焦文本框的光标处；详细解释折叠。
- 底部固定默认模板勾选、保存状态和“保存模板”。复制与删除位于编辑标题行。
- 切换用途、条目或设置模块，输入保留在内存草稿中；不把正文、提示词输入或密钥写入 localStorage。
- 保留未知变量、未闭合变量、字数和页长校验。删除默认项后不自动设置其他默认模板。
- 保留模板文本区域独立滚动，长内容及小高度窗口不以缩小字号来容纳；保存按钮始终可达。

![分页模板稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-template-page-1440.png)

[标题模板稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-template-title-1440.png) · [改造前：标题](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-template-title-1440.png) · [改造前：分页](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-template-page-1440.png) · [390px 网页适配稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-template-page-390.png)

### 7. 关于应用

保留产品名、版本、平台与现有产品说明，压缩为一块信息区。版本来自现有应用信息接口，不新增检查更新、在线支持或其他未实现入口。

[关于应用稿](D:/Project/PressDock/artifacts/settings-design-2026-11-06/design-about-1440.png) · [改造前](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-about-light-1440.png)

## 尺寸和响应方式

| 项目               | 建议                                                     |
| ------------------ | -------------------------------------------------------- |
| 页面标题           | 22px / 500                                               |
| 模块标题           | 16px / 500                                               |
| 正文与标签         | 13–14px；副信息 12px                                     |
| 桌面控件           | 32px；设置行约 52–56px                                   |
| 区块               | 12–16px 间距、12–16px 内边距、8px 圆角                   |
| 强调               | 校样蓝 #3659d9；只用于当前选项、主按钮和分页绑定提示     |
| 页面滚动           | 标题与模块导航保持可达，内容区独立滚动，保存区固定可达   |
| 工作区宽于 920px   | 采集两栏；模板提示词与参数并排                           |
| 工作区不超过 920px | 采集单栏，模板参数重排，模型数值列按需收起               |
| 工作区不超过 620px | 提供商与模板列表移到内容上方；图片预设改为单栏           |
| 窄屏               | 标签换行，常规按钮增加触控高度，弹框保留头尾、中间可滚动 |

断点以设置内容容器计算，随侧栏展开、收起响应。全局侧栏样式、主题基础和导航行为沿用现有实现。390px 图仅表示这套网页方案的窄区适配；Android 已有独立导航、返回层级、草稿保护、前后台采集策略，本轮未替换、未做原生验收。

## 状态及实施边界

自动保存：常规主题、采集处理设置；开发者模式沿用已有即时保存。显式保存：提供商、模型、提示词模板、图片预设。不能用一个“保存全部”按钮混合两类语义。

加载、读取失败、保存失败、模型测试失败、缺少模型、缺少默认模板、无提供商和无模型均使用已有业务状态。保存失败保留输入；请求期间锁定相关动作；所有关闭确认和删除确认需可通过键盘操作。

后续落地只重组展示和交互，不修改 CMS、类型化 IPC、Rust、数据库协议或依赖。继续复用采集自动保存队列、AI service、图片预设 service、现有表单校验及 Android 分支。图中新增的摘要、状态和锁定说明从现有配置派生，不增加业务字段。

建议先实施设置容器与采集页，再调整提供商 / 模型编辑，随后调整模板与图片预设，最后整理常规、服务及关于。实施时补充真实 React 测试，并回归素材导入的设置入口、标题优化、分页助手、渠道图片处理与 Android 返回和草稿行为。

## 设计验证

使用同一 Ego TaskSpace 完成调研和原型验证，按 Unslop 限制完成三轮视觉检查，最终在 1440、1280、1024、768px（高 900px）及 390×844 下检查。

- 8 个页面状态 × 5 种宽度，共 40 个布局记录：没有整页横向溢出。
- 提供商、模型两类弹框 × 5 种宽度，共 10 个弹框记录：保存按钮均在视口内；默认表单内容区无滚动溢出。
- 1440×900 下，采集页工作区 clientHeight 与 scrollHeight 均为 632px；默认配置完整显示，无内容区滚动。
- 模板编辑区保留独立滚动；1440px 默认稿中正文容器为 456px、内容为 469px，底部保存操作固定可达。此处不以“完全无滚动”作为设计目标。
- 29 项原型交互检查通过：获取方式切换及输入保留、开关、自动保存校验、分页直达、页长校验、变量插入、用途切换、协议联动、地址校验、未保存关闭确认、焦点返回、引用限制、测试拦截、目录添加、能力参数校验、预设复制及成对尺寸校验等。
- 检查中发现标签切换后焦点丢失，已在原型修复，并验证方向键、Esc 与焦点返回。
- 所有写入和外部操作都限定在隔离替身或原型内存。原型不表示真实 CMS、AI 或凭据服务已连通。
- `npm run lint`、`npm run format:check`、原型及隔离宿主脚本语法检查、`git diff --check` 均通过。设置相关生产文件未修改。

这些结果验证的是设计原型与浏览器布局，不等于生产组件、原生桌面端或 Android 的实施验收。本轮仅交付设计，未重跑完整生产测试或重新打包 exe / APK。

## 裁切问题修订

用户指出图片预设的渠道、子渠道控件被卡片裁掉。复现确认：原型的内容区采用纵向 Flex，普通配置卡片可被压缩，同时卡片设置了 `overflow: hidden`。低高度窗口中，目标选择卡片会从正常的 89px 缩至 2px，控件仍占原高度，却被卡片边界遮住。之前的检查侧重宽度和整页溢出，未检查这一层卡片裁切。

已修正原型：普通配置区保留内容高度，由设置工作区滚动；提示词编辑器继续使用原有填充布局和内部滚动。更新了图片预设 1440、1024、390px 截图，生产设置页面未修改。

补查 1440×900、1440×600、1280×720、1024×600、768×600、390×844、390×600、1024×480，共 8 种尺寸：控件均未被卡片裁切，无整页横向溢出，保存操作可达；实际验证了选择器获得焦点、切换目标、输入变更、演示保存及切回后值保留。另外回归七个模块的 3 组窗口尺寸，共 21 次布局检查，通过。

[修正后 1280×720](D:/Project/PressDock/artifacts/settings-design-2026-11-06/preset-clipping-fix/after-1280x720.png) · [修正后 390×600](D:/Project/PressDock/artifacts/settings-design-2026-11-06/preset-clipping-fix/after-390x600.png) · [修订验证记录](D:/Project/PressDock/artifacts/settings-design-2026-11-06/preset-clipping-fix/validated.json)

## 方法与署名

使用 [Unslop 技能](D:/Project/PressDock/.agents/skills/unslop/SKILL.md) 的审查与九遍整理方法。Unslop 由 Damir Sokolovsky（[@heydamir](https://x.com/heydamir)，[项目网站](https://heydamir.design/unslop)）创作，采用 CC BY 4.0 许可。
