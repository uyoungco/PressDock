# Responses 分页输出上限修复验收

日期：2026-10-31。分支：`codex/cms-pagination-assistant`。

## 定位与修复

只读检查实际应用配置，默认“新闻文章分页”模板绑定官方 DeepSeek 的 `deepseek-flash`，协议为 Responses，输出上限及推理强度均未填写。分页调用默认发送 4096 token；旧代码只在 Chat Completions 关闭默认推理，遗漏 Responses。[DeepSeek 官方文档](https://api-docs.deepseek.com/api/create-response/)说明 Responses 默认启用推理，且推理消耗计入 `max_output_tokens`。

现在官方 DeepSeek 分页在未设置推理强度时，Responses 显式发送 `reasoning.effort: none`，Chat Completions 继续发送 `thinking.type: disabled`。显式保存的推理强度和输出上限优先，不增加默认额度，不重试请求。其他提供商、标题优化和采集任务的参数保持原行为。

Chat Completions 先识别 `finish_reason: length`，再进行分页完成状态校验，确保返回 `AI_OUTPUT_LIMIT`。两种协议的上限错误均提示输出额度包含推理消耗，需检查模型参数后手动重试。IPC、数据库结构、提示词和分页算法未调整。

## 真实默认配置对照

通过显式运行的 `pagination_saved_config_live_smoke` 只读实际默认模板、模型、协议和参数，以系统凭据库认证；修复前后各请求一次，同为 `demo-explanation` 演示正文，不操作真实 CMS 正文。

| 指标                 | 修复前         | 修复后         |
| -------------------- | -------------- | -------------- |
| 协议                 | Responses      | Responses      |
| 模型                 | deepseek-flash | deepseek-flash |
| 输出额度             | 4096           | 4096           |
| 请求推理设置         | 未发送         | none           |
| 完成状态             | completed      | completed      |
| 输出 token（含推理） | 156            | 20             |
| 推理 token           | 132            | 0              |
| 有效分页编号         | 是             | 是             |

原始统计见 [responses-before.json](responses-before.json)、[responses-after.json](responses-after.json)。报告仅包含协议、模型、状态、token 数量等统计，不包含凭据、请求正文或推理文本。此演示用例在修复前也成功返回，不能声称复现了截图中的截断；它确认了原先默认启用推理，并验证修复后推理消耗为零。截图那次响应未保留，具体消耗无法追溯。

## 自动回归与原生桌面

- 前端 185 项、Rust 62 项、独立分页评估 4 项通过；3 项需要显式运行的联调/桌面测试默认忽略。本次已单独运行实际配置联调和原生桌面验收。
- 请求构造覆盖两种协议、两种 Chat token 字段、默认关闭推理、显式推理和额度优先，以及其他提供商、标题和采集任务不受影响。
- 截断测试断言两种协议均返回 `AI_OUTPUT_LIMIT` 且只有一次请求；界面测试确认已有分页、正文和加粗保留，失败后只能手动重试。
- 两种协议均通过真实生成 ACL 的 Webview 消息入口验证生成、取消及未授权窗口拒绝。
- Windows 原生 WebView2 使用实际构建前端、生产命令、真实 ACL、临时数据库及本地 Responses 演示接口。单页 682 字生成 223/234/225 字三页预览，第二页内容正确；应用后出现两个分页点，一次撤销恢复单页 682 字；第二次请求取消后无初稿，正文保留。
- 关闭隔离窗口后宿主断言通过：AI 请求 2 次、取消 IPC 1 次，全部请求使用 `/responses`、4096 token 和 JSON 输出参数，CMS 无写入。
- ESLint、TypeScript/Vite 构建、Rust fmt 和 Clippy 通过；全量 Prettier 仍有 `.agents/skills` 中原有 22 个文件的格式问题，本次变更文件单独检查。
