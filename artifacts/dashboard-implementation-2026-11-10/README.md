# 工作台设计实施与验收

按已确认的 [设计稿](../dashboard-design-2026-11-10/index.html) 更新正式工作台。工作于 2026-11-10 开始，2026-11-11 完成。没有修改全局主题、其他业务页面、Rust 命令或数据库结构。

## 已实施

- 保留页头、四项概览、最近采集和快捷入口的区块顺序。
- 沿用现有主题与 Geist 字体，移除统计卡装饰图标，补充单位。需处理数量大于零时使用警示色，零值与读取失败保持中性。
- 日期旁增加统计口径按钮，点击使用项目现有 Dialog 展示说明；支持键盘关闭及关闭后返回焦点。
- 最近记录使用状态点与文字，排队为空心点，进行及等待处理为警示色，CMS 成功与异常沿用现有语义色；不以颜色替代状态名称。
- 分离日期和时分，桌面长标题单行省略，窄窗长标题最多两行；来源和长错误保留完整提示。
- 快捷入口移除重复外框。统计内容达到 960px 显示四列，否则两列；记录区域不足 640px 转纵向卡片。
- 保留现有账号隔离、跨日、通知、查询缓存、真实成功统计、部分请求失败与重试逻辑。列偏好继续使用 `dashboard-harvest`。

## 界面证据

| 文件                                   | 内容                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| [1280-light.png](1280-light.png)       | 正式组件，1280×720 浅色                                                                  |
| [1280-dark.png](1280-dark.png)         | 正式组件，1280×720 深色                                                                  |
| [390-light.png](390-light.png)         | 正式组件，390px 窄窗完整内容；常规视窗内纵向滚动                                         |
| [layouts.json](layouts.json)           | 1440×900、1280×720、960×720、820×720、390×844 布局测量                                   |
| [interactions.json](interactions.json) | 口径弹窗、焦点恢复、列开关、来源服务、缓存数据刷新失败、审核跳转、空数据、窄窗长错误检查 |

五种尺寸的工作台均无横向溢出。1280×720 中快捷入口底部为 664px，内容区域底部为 688px。390×844 深色下长错误没有横向溢出，滚动到底可访问全部快捷入口。

截图从导入正式 React 组件的本地隔离宿主生成，采用浏览器 screen 媒体渲染并转换为 PNG。账号、标题和错误均明确标注演示，禁止真实 CMS 网络和未声明 IPC；验收中未触发未声明 IPC，不读写真实 CMS。未执行线上账号或采集联调。

## 检查结果

- `npm run lint`：通过。
- `npm test -- --maxWorkers=1 --testTimeout=15000`：361 通过，1 跳过。
- `node --test scripts/pagination-eval.test.mjs scripts/build-android.test.mjs`：9 通过。
- `npm run build`：通过。
- `npm run format:check`：通过。
- `cargo fmt --check`：通过。
- `cargo test --locked`：135 通过，15 忽略。
- `cargo clippy --locked --all-targets -- -D warnings`：通过。
- `npm run tauri build`：通过，已生成 Windows 可执行程序、MSI 和 NSIS 安装包。

可直接运行 `src-tauri/target/release/pressdock.exe`；安装包位于 `src-tauri/target/release/bundle/`。本轮未提交或推送远程。

设计方法参考 Unslop，作者 Damir Sokolovsky（[@heydamir](https://x.com/heydamir)），[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
