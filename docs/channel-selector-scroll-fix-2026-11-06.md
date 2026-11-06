# 渠道选择器打开位移修复

日期：2026-11-06。

## 问题与修复

“修改素材”中的渠道、子渠道搜索菜单挂在素材弹层内部。原先弹层外壳使用 `overflow: hidden`：虽然不显示滚动条，但聚焦或 `scrollIntoView` 仍可改变其滚动位置。

排查发现两个触发点：首次自动聚焦搜索框会请求浏览器滚动；存在选中值时，Base UI 还会对选中项调用 `scrollIntoView({ block: "nearest", inline: "nearest" })`，滚动链会到达外层抽屉。初次排查曾复现外壳 `scrollLeft` 从 0 变为 344px；宽窗口中也复现过更大横移。

最终修复包含两部分：

- 搜索菜单通过现有 `initialFocus` 回调聚焦输入框，并设置 `preventScroll: true`。触摸打开时保持聚焦菜单容器，避免主动聚焦搜索输入框。
- 素材弹层外壳改用 `overflow: clip`，只负责裁剪，表单仍由原有 ScrollArea 滚动。这同时处理首次聚焦和选中项滚动，维持抽屉、手机弹层及共享表单的尺寸、外观、Portal 挂载方式和业务行为。
- 键盘回归发现 Radix 的捕获阶段会先关闭外层表单。素材弹层现在将打开中的渠道菜单交给 Base UI 处理 Esc：第一次关闭菜单并返回选择器，第二次才关闭表单。

外壳不再是滚动容器的行为依据见 [CSS Overflow 规范](https://www.w3.org/TR/css-overflow-3/#valdef-overflow-clip)。实现没有覆盖 DOM 原型、增加滚动复位或修改依赖库，没有新增组件公开参数及业务接口。

## 自动检查

- `npm run lint`：通过。
- `npm test -- --maxWorkers=2 --reporter=dot --reporter=json --outputFile=artifacts/selector-scroll-fix-2026-11-06/tests.json`：32 个文件、257 项测试通过。
- 新增鼠标、键盘打开时的无滚动聚焦测试、触摸打开不聚焦输入框，以及抽屉和共享 Dialog 的 Esc 分层关闭测试；原有搜索、中文输入法、键盘选择、关闭、焦点返回及素材表单回归保留。
- `npm run build`：通过 TypeScript 和 Vite 生产构建。
- `npm run format:check`、`git diff --check`：通过。

## 浏览器验收

使用 ego-browser 的独立 TaskSpace，测试真实 `MaterialForm` 与 `SearchableSelect`。隔离宿主包含 24 个演示渠道，每个渠道含 24 个子渠道及长名称；新增、修改与文章转素材的共享表单只改变内存状态，保存及所有 IPC 均被阻断。

验收服务关闭 HMR，避免开发热更新打断采样。以 CDP 注入真实鼠标、键盘和触摸事件；采样前完成弹层进入动画，将用户主动滚动与菜单触发的位移分开记录。每次打开连续记录 6 个渲染帧，比较弹层、表单滚动位置、触发器坐标及页面滚动位置，容差 1px，并检查菜单仍位于弹层内部且完整可见。

最终 **40/40 组通过，所有测量位移均为 0px**。矩阵覆盖新增、修改、渠道、子渠道、顶部及已滚动状态，并回归共享文章转素材表单。

| 窗口     | 组合数 | 结果           |
| -------- | ------ | -------------- |
| 1440×900 | 8      | 通过，0px 位移 |
| 1024×768 | 12     | 通过，0px 位移 |
| 768×900  | 8      | 通过，0px 位移 |
| 390×844  | 12     | 通过，0px 位移 |

键盘补充检查：抽屉及共享 Dialog 均能先关闭菜单、返回选择器焦点，再按 Esc 才关闭素材表单。触摸补充检查：菜单获得焦点，搜索输入框不自动获得焦点；菜单内的选项仍可选择。补充检查的位移也均为 0px。

最终结果见[布局原始记录](../artifacts/selector-scroll-fix-2026-11-06/layout-checks.json)、[键盘与触摸原始记录](../artifacts/selector-scroll-fix-2026-11-06/interaction-checks.json)、[自动测试原始报告](../artifacts/selector-scroll-fix-2026-11-06/tests.json)。临时验收页面和本机服务已关闭。

[用户提供的原截图](../artifacts/selector-scroll-fix-2026-11-06/before.png) · [修复后隔离演示截图](../artifacts/selector-scroll-fix-2026-11-06/after.png)

这是浏览器响应式和触摸事件验收，未执行 Windows 原生 WebView 或 Android 真机验收；没有操作真实 CMS 素材。

## 本地复查

在仓库根目录执行 `node artifacts/selector-scroll-fix-2026-11-06/serve.mjs`，打开终端中的隔离地址。桌面点“修改演示素材”，打开渠道和子渠道菜单；滚动表单后重复。页面中的“文章转素材共享入口”直接使用相同的共享表单模式，不代表重新执行了一次真实文章提交。
