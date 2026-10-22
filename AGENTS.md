# PressDock 开发约定

- 始终使用简体中文交流。
- 使用 npm，保留 package-lock.json 和 Cargo.lock。
- UI → 业务服务 → 类型化 IPC → Rust → SQLx；组件不得直接调用 invoke 或 SQL。
- 原始素材与编辑草稿分离，保存草稿不得覆盖原文。
- Mock 数据必须有演示标识，不得模拟真实发布成功。
- 不编造 CMS / AI 接口，不将业务正文或密钥写入 localStorage。
- 提交前运行 README 中的检查；未经用户要求不推送远程。
