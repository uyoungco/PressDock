# 批量审核施工验收

2026-11-09 开始，11-10 完成浏览器复验。使用实际业务组件和明确标识的演示数据，不连接真实 CMS。

- `android-list.png`：390px 选择条、选中卡片与底部审核栏
- `android-batch.png`：手机批量稿件核对面板
- `android-reject.png`：360px 无原因拒绝确认
- `android-reject-dark.png`：深色拒绝确认
- `desktop-list.png`：1440px 桌面工具栏与选中行
- `desktop-batch.png`：桌面批量审核抽屉
- `desktop-narrow.png`：550px 桌面卡片布局
- `browser-evidence.json`：尺寸、触控、内部滚动、焦点恢复及演示 IPC 记录

通过 ego-browser 加载独立本机生产构建，内存替身拦截所有审核操作，未知命令和外部 fetch 被阻止。`comment=""` 的真实服务端接受情况未实写验证。浏览器图使用同一 ego 页面 `Page.printToPDF` 后经 Poppler 转为 PNG；不是 Android 真机截图，也不代表原生系统返回键验收。

设计方法使用 [unslop by Damir Sokolovsky](https://heydamir.design/unslop)，CC BY 4.0。完整变更、检查及构建见[实施记录](../../docs/cms-article-review-implementation-2026-11-09.md)。
