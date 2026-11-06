# 系统设置紧凑版实施与验收

日期：2026-11-06。按[已确认设计稿](D:/Project/PressDock/docs/settings-ui-design-2026-11-06.md)及图片预设裁切修订实施，修改真实 React 页面。原有未提交修改保留，未提交或推送远程。

## 已实施

- 桌面设置使用 22px 页头、32px 常规控件和可换行的七模块标签。默认仍为常规设置，模块及模板用途支持链接定位和历史返回，重复激活不会写入重复历史。
- 采集设置按容器宽度在双栏与单栏之间切换；保留油猴状态、安装、CDP 参数与折叠帮助、四项 AI 规则、开发者模式、元数据模型和保留时间。默认分页模板、绑定模型与页长直接串联显示。继续复用原有 500ms 自动保存及开发者模式即时保存逻辑。
- AI 模型默认展示已保存的提供商摘要、模型目录及能力参数。提供商和模型按需打开编辑弹框；头尾固定，中间表单可滚动。保留协议联动、空密钥保留旧值、目录获取、测试、删除确认和接口引用限制。失败保留输入，关闭可继续编辑、保留草稿或丢弃修改，焦点返回编辑入口。
- 模板编辑采用列表、提示词及参数的布局，固定底部默认项和保存操作。草稿按 ID 缓存在组件内存，切条目、用途和模块不丢失输入；从采集入口定位分页配置时不重新挂载模板组件。变量插入最近聚焦文本框的选区，复制不沿用默认标记。
- 图片预设使用中文主图／第二张图片标签，并保留接口字段名副行。目标渠道、子渠道和复制来源保持自然高度，不能被 flex 压缩后裁切；低窗口在正文内滚动，保存始终可达。提示当前尺寸、体积、格式的锁定或自由状态，保存和校验复用原有逻辑。
- 常规主题改为三项选择；服务连接收为状态清单，修正只读素材旧说明，AI 已配置与已连通明确区分；关于页保留必要信息。
- 网页窄区保留 40px 按钮。Android 继续使用原有独立导航、编辑容器、返回层级和采集策略，没有启用桌面紧凑分支。

样式限定在设置工作区及其编辑弹框。CMS、类型化 IPC、Rust、数据库协议、依赖和锁文件均未修改。草稿和密钥不写入 localStorage，离开设置前检查未保存或正在处理的状态。

## 前后截图

[查看完整前后对比](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/comparison.html)

| 页面     | 改造前                                                                                           | 改造后                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 常规     | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-general-light-1440.png)  | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-general-1440x900.png)        |
| 采集     | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-harvest-light-1440.png)  | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-harvest-1440x900.png)        |
| 图片预设 | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-presets-1440.png)        | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-presets-1440x900.png)        |
| 模型     | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-models-light-1440.png)   | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-models-1440x900.png)         |
| 标题模板 | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-template-title-1440.png) | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-template-title-1440x900.png) |
| 分页模板 | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-template-page-1440.png)  | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-template-page-1440x900.png)  |
| 服务     | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-services-light-1440.png) | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-services-1440x900.png)       |
| 关于     | [截图](D:/Project/PressDock/artifacts/settings-design-2026-11-06/before-about-light-1440.png)    | [截图](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-about-1440x900.png)          |

其他截图：[提供商弹框](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-provider-dialog-1440.png)、[模型弹框](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-model-dialog-1440.png)、[深色主题](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-general-dark-1440.png)、[1280×720 预设](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-presets-1280x720.png)、[390×600 预设](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-presets-390x600.png)、[390×600 模板](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/after-template-title-390x600.png)。

## Ego 验证

同一 Ego TaskSpace 完成真实页面、弹框和 Android 分支的隔离验收，结束后已关闭。宿主直接加载生产入口，所有 IPC 均由[隔离替身](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/fixture.mjs)处理。浏览器标题及账号明确标注隔离演示；未知命令、写入、模型请求和外部操作均被拒绝，不连接真实 CMS、AI 或凭据库。

检查尺寸：1440×900、1280×720、1024×600、768×600、390×844、1440×600、1024×480、390×600。

- [64 个页面状态](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/layout-final.json)：七模块加分页用途，整页及工作区横向溢出均为 0；未发现控件被不可滚动祖先裁切，模板和图片预设保存栏均可达。390px 状态在选择目标后检查，包含实际预设字段。
- [16 个弹框状态](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/dialog-layout-final.json)：两类编辑框覆盖上述尺寸，提供商展开兼容项；等待动画完成后测量，边界和保存操作均在视口内，内容必要时滚动。
- [21 项桌面交互](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/interactions-final.json)：初始焦点、Tab 约束、关闭后焦点返回、协议兼容项、失败保留、保留／丢弃草稿、模板变量插入与缓存、删除取消、预设复制和切换恢复、选择器打开无位移、离页保护、localStorage 无业务草稿。提供商保存、模型测试、目录、模板保存和预设保存请求全部被拦截；成功写入通过单元测试的内存替身验证。
- [9 项 Android 布局检查](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/android-layout-final.json)：七个模块保持独立布局，保留前台采集说明，图片预设保存按钮高 44px 且可达。
- [8 项 Android 交互检查](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/android-interactions-final.json)：通过 CDP 触摸事件点击提供商及输入框，验证手动聚焦、返回恢复、失败保留和离页保护。对应[预设](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/android-presets-390.png)及[编辑](D:/Project/PressDock/artifacts/settings-implementation-2026-11-06/android-provider-390.png)截图。

实现检查中发现并修复：标签鼠标／焦点通知造成重复路由历史；窄区低窗口模板列表与说明挤压编辑卡片，导致底部操作越界。普通卡片保持自然高度，模板则缩减窄区顶部占用并在字段区滚动。极低窗口的模板编辑区域会变短，底部操作继续保留。

## 自动检查

| 命令                                                                          | 最终结果                      |
| ----------------------------------------------------------------------------- | ----------------------------- |
| `npm run lint`                                                                | 通过，0 警告                  |
| `npm test -- --maxWorkers=2`                                                  | 35 个文件、286 项测试全部通过 |
| `npm run build`                                                               | TypeScript 与 Vite 构建通过   |
| `npm run format:check`                                                        | 通过                          |
| `node --test scripts/pagination-eval.test.mjs scripts/build-android.test.mjs` | 9 项全部通过                  |
| `git diff --check`                                                            | 通过                          |

完整测试使用 2 个 worker 控制资源占用，测试范围不变。更新了新布局对应的主题、中文标签和异步路由断言；新增或扩展的测试覆盖模型弹框、未保存草稿、请求防重复、失败重试、密钥保留、协议联动、模板缓存与变量、默认模板删除、图片预设及采集自动保存。全量测试也回归文章、渠道、导入和手机编辑组件。

本轮为前端实现及浏览器回归，没有运行真实 CMS／付费模型联调，没有重新构建 exe／APK，也没有执行 Android 真机安装验收。Node 的 Android 构建脚本测试使用隔离替身，不等于生成了本轮 APK。

## 设计方法

沿用 [Unslop 技能](D:/Project/PressDock/.agents/skills/unslop/SKILL.md) 与现有 shadcn 组件。Unslop 由 Damir Sokolovsky（[@heydamir](https://x.com/heydamir)）创作，采用 CC BY 4.0 许可。
