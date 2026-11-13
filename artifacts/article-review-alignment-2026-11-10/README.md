# 审核选择列对齐复验

按用户确认移除选中行和卡片左侧的蓝色竖线，保留勾选与浅蓝背景。桌面表格的表头和行选择框均在 44px 选择列中居中，统一左右 14px 内边距；全选与各行方框的左边缘均为 14px，修复前分别为 8px 和 12px。

- `desktop.png`：1440px 桌面表头与行多选框对齐，选中行没有竖线。
- `android.png`：390px 手机选中卡片没有竖线，行方框与顶部全选保持对齐。
- `desktop-narrow.png`：550px 桌面卡片选中后保留普通边框，没有额外蓝色竖线。
- `browser-evidence.json`：ego-browser 的位置、尺寸、选中样式和交互测量。

ego-browser 使用实际业务组件、localhost 生产构建及明确标识的内存演示数据。桌面全选与清空正常；360px、390px 手机和 550px 桌面均无横向溢出。图像沿用同一 ego 页面的 `Page.printToPDF` 后经 Poppler 转 PNG，属于浏览器打印渲染，非真机截图。没有真实 CMS 写入。

16 项既有审核测试、lint、TypeScript／前端生产构建及修改文件格式检查通过。Windows 程序与 MSI／NSIS 安装包、正式配置 ARM64 调试签名 APK 已顺序重新构建成功，产物路径沿用[实施记录](../../docs/cms-article-review-implementation-2026-11-09.md)。此轮仅修改选择列布局和选中装饰，没有新增测试或改动 Rust／审核协议。
