# 图片处理弹框改版验收

日期：2026-11-06。按[已确认设计](image-processor-dialog-design-2026-11-06.md)实现桌面渠道素材图片处理弹框，包括使用共享素材表单的桌面入口；本轮未修改编码服务、类型化 IPC、Rust、CMS 或数据库协议。

## 实现

- 桌面最大宽 1120px、常规高 640px，随窗口收缩。标题、文件行和底部操作固定，左侧图片工作区自适应，右栏 272px；窄窗口右栏降为 248px，短窗口压缩间距。
- 去掉外层 ScrollArea；画布采用固定视口与图片平移，未用隐藏滚动条代替内容排布。所有设置及操作在已验证窗口中完整容纳。
- 格式、尺寸、体积上限各自判断锁定。锁定显示只读摘要与锁图标，未锁定显示 32px 控件；宽高并排，取消尺寸后按原图或选区像素输出，体积留空不限制业务体积。
- 复用原有预设约束、裁剪、质量搜索、结果校验和上传逻辑。参数或裁剪变化使旧预览失效；未生成结果时以“处理预览”为主操作，成功后以“确认结果”为主操作。
- 默认适应窗口；支持 100%、缩放、空格拖动、中键拖动及画布聚焦后的方向键平移。平移不改变裁剪提交坐标，适应窗口及切换预览后重新居中。
- 结果、处理中、错误复用右侧状态区。长错误保留完整原文，通过“查看完整错误”按需阅读。上传失败保留输入和已生成的结果，取消后恢复对应图片地址输入框的焦点。
- 配色限定在图片弹框，沿用中性色与校样蓝；控制字号、间距、数字对齐和状态过渡。手机、Android 和独立图片处理页继续使用默认布局。

## 前后对照

- [改版前：用户提供截图](../artifacts/image-dialog-design-2026-11-06/source.png)
- [改版后：锁定预设](../artifacts/image-dialog-implementation-2026-11-06/locked.png)
- [改版后：自由调参，1008×796](../artifacts/image-dialog-implementation-2026-11-06/editable.png)
- [改版后：自由调参，1008×640](../artifacts/image-dialog-implementation-2026-11-06/editable-short.png)

截图使用明确标注的隔离演示横幅，未使用或上传用户截图内的人像图片。

## ego-browser 交互检查

使用独立 TaskSpace 及[隔离宿主](../artifacts/image-dialog-implementation-2026-11-06/index.html)，导入真实组件、hook 和前端业务服务。宿主以浏览器 Canvas 提供测试编码结果，上传及所有其他写操作在 IPC 替身中抛错阻断。没有读取账号或凭据，没有修改线上素材。检查完成后已关闭临时页面与本机验收服务。

| 窗口                         | 验证状态                                  | 结果                                                                     |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| 1440×900、1280×800、1024×768 | 自由调参、JPEG、560×248、79 KiB、放大警告 | 页面无横向溢出，设置区无内部溢出，工具及底部按钮完整可见                 |
| 1008×796、1008×640、768×640  | 同上                                      | 无内容重叠，参数及固定底栏可达                                           |
| 1008×640                     | 长处理错误                                | 设置区 clientHeight 与 scrollHeight 均为 428px；底栏可见，完整错误可打开 |
| 390×844                      | 手机回归                                  | 未启用新桌面布局，原有画布 ScrollArea 保留                               |

交互结果：

- 实际打开格式菜单并选择 JPEG，输入宽高及体积，能够生成 560×248 结果并启用确认。
- 放大后实际空格拖动，图片视图横移 70px，裁剪百分比保持相同。
- 确认时上传被隔离宿主明确拒绝，结果与宽度输入保留，原主图地址未回填。
- 处理错误完整内容可阅读；关闭错误详情后主弹框仍可操作。
- 取消等待退出动画完成后弹框消失，焦点回到主图地址输入框。

原始结果：[布局](../artifacts/image-dialog-implementation-2026-11-06/layout-checks.json)、[交互](../artifacts/image-dialog-implementation-2026-11-06/interaction-checks.json)、[错误与手机](../artifacts/image-dialog-implementation-2026-11-06/error-mobile-checks.json)。布局 JSON 记录的是标题区最后减少 4px 之前的测量；最终截图及错误状态测量使用最终样式。

这些检查验证前端布局和交互，不代表 Rust 原生编码器、桌面 WebView、Android 真机或真实 CMS 上传已重新联调。

## 自动检查

- `npm run lint`：通过。
- `npm test -- --maxWorkers=2 --reporter=dot --reporter=json --outputFile=artifacts/image-dialog-implementation-2026-11-06/tests.json`：32 个文件、252 项测试通过。包含八种锁定组合、自由编辑、参数失效、平移坐标、长错误、桌面格式菜单，以及原有图片处理、上传失败、会话、手机/Android 和文章转素材相关回归。
- `node --test scripts/pagination-eval.test.mjs scripts/build-android.test.mjs`：9 项通过，Android 构建脚本用例使用替身，没有实际构建 APK。
- `npm run build`：通过 TypeScript 及 Vite 生产构建。
- `npm run format:check`：通过。
- `git diff --check`：通过。

没有修改 Rust 文件，本轮未运行 Rust 编码器测试或生成桌面安装包。

设计方法参考 Unslop，作者 Damir Sokolovsky（[@heydamir](https://x.com/heydamir)），许可 CC BY 4.0。[技能原文](../.agents/skills/unslop/SKILL.md)。
