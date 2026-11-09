# Cloudflare D1 全局设置：步骤 1 验收记录

日期：2026-11-07（Asia/Shanghai）。范围：[开发计划第一步](cloudflare-d1-settings-development-plan.md#第一步验证连接与身份校验)。

## 结论

开发 Worker 与隔离 D1 已创建并部署，真实 Worker→CMS→D1 链路通过。有效 CMS 会话可以验证身份并执行连接查询；真实缺失和篡改会话均被拒绝。失效响应、超时及上游不可用通过故障注入验证，模拟不会访问线上 CMS/D1。

当前只交付连接与身份验证；尚未实现应用启动读取、配置保存上报或密钥同步，也未导入当前电脑的配置和 AI 密钥。真实自然过期会话未取得，其端到端验证保留为补充项，不将篡改令牌冒充自然过期令牌。

## 实际资源

| 项目               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| Cloudflare 账户    | `227d58ddf76b97d47968d3443e1aa726`                       |
| Worker             | `pressdock-settings-dev`                                 |
| 开发入口           | `https://pressdock-settings-dev.i9543.workers.dev`       |
| 部署版本           | `90439914-a3f4-4d37-ba66-2d585b1354ee`                   |
| 部署时间           | `2026-11-06T17:02:13.625089Z`，北京时间 2026-11-07 01:02 |
| D1                 | `pressdock-settings-dev`                                 |
| D1 ID              | `84b54ef9-7393-4de9-b5b5-03579e42f050`                   |
| D1 绑定            | `DB`                                                     |
| compatibility_date | `2026-11-06`                                             |

通过 ego 完成 Cloudflare 控制台操作和 Wrangler OAuth 授权，无需用户手工介入。控制台核对到版本就绪、D1 绑定正确，Workers Logs 与 Workers Traces 均已禁用。Wrangler 使用 Windows 系统凭据库保护授权，未将 OAuth 凭据写入项目。

开发 D1 独立创建，本轮仅执行 `SELECT 1 AS connected`，没有业务表迁移和数据导入。代码和锁文件位于 `workers/settings-sync`；真实会话探针位于 `src-tauri/examples/settings_sync_probe.rs`。

## 逐项结果

| 用例           | 验证方式                                                                            | 实际结果                                                                                                  | 判定                                                 |
| -------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| S1-01 真实身份 | 从原有系统凭据库读取实际 CMS 会话，直接访问 CMS 后，再请求已部署 Worker             | 直接 CMS 200；Worker 200，`cmsVerified=true`，`d1Connected=true`                                          | 通过，真实链路                                       |
| S1-02 非法凭据 | 已部署 Worker 分别接收缺失、篡改凭据；本地注入 CMS HTTP 401 与业务 `A0230` 失效响应 | 真实缺失返回 401 `AUTH_REQUIRED`；真实篡改返回 401 `AUTH_EXPIRED`；失效模拟返回 401，数据库调用次数为 0   | 通过当前实测与失效响应测试；自然过期会话端到端待补充 |
| S1-03 校验故障 | 单测注入超时、网络异常、HTTP 503、重定向、非法 JSON、超大正文及畸形用户             | 503 且错误码可识别；所有故障均未调用 D1；不返回原始异常或 CMS 正文                                        | 通过，故障注入                                       |
| S1-04 D1 连接  | 真实有效会话经已部署 Worker 执行固定连接查询                                        | 返回 200，`database.connected=true`，部署绑定为独立开发 D1                                                | 通过，真实 D1                                        |
| S1-05 脱敏     | 检查 Worker/Rust 输出、错误测试、部署配置与控制台日志状态                           | Worker 无 `console`；返回及探针日志仅含固定状态字段；异常文本中的演示秘密未泄露；没有向前端返回凭据的 IPC | 通过                                                 |

无凭据/篡改凭据的线上响应本身不证明“数据库从未被调用”；该顺序通过测试中的数据库调用记录明确验证，线上代码使用同一鉴权路径。公开 `/health` 不查询 D1，也不能代替 S1-04 的证据。

最近一次真实请求的脱敏状态如下（北京时间 01:11）；带时间戳和部署版本的记录保存在[实测结果](../artifacts/d1-settings-step1-2026-11-07/live-probe.json)。

```jsonl
{"authenticated":true,"check":"direct-cms-current-user","httpStatus":200}
{"check":"worker-valid-session","cmsVerified":true,"code":null,"d1Connected":true,"elapsedMs":1056,"httpStatus":200}
{"check":"worker-missing-session","cmsVerified":false,"code":"AUTH_REQUIRED","d1Connected":false,"elapsedMs":111,"httpStatus":401}
{"check":"worker-tampered-session","cmsVerified":false,"code":"AUTH_EXPIRED","d1Connected":false,"elapsedMs":114,"httpStatus":401}
```

## 自动化与构建检查

Worker：`npm test` 23 项通过，`npm run typecheck` 通过，`npm run build` 部署预演通过。覆盖正常链路、缺失/畸形凭据、CMS HTTP 与业务失效、无效身份、网络与超时、正文限制、D1 故障、固定上游和路由限制。

Rust：`cargo fmt --check` 通过；`cargo test --locked` 73 项通过、4 项按原定义忽略；`cargo clippy --locked --all-targets -- -D warnings` 通过。真实探针使用已存在的 keyring/reqwest 依赖，无新增 Rust 依赖或 Cargo.lock 变化。

根前端：`npm run lint` 通过；`npm test` 最终 36 个文件、290 项通过；`node --test scripts/pagination-eval.test.mjs` 4 项通过；`node --test scripts/build-android.test.mjs` 5 项通过；`npm run build` 通过。

`npm run format:check` 全仓库通过。`npm run tauri build` 通过，生成 `src-tauri/target/release/bundle/msi/PressDock_0.1.0_x64_en-US.msi` 和 `src-tauri/target/release/bundle/nsis/PressDock_0.1.0_x64-setup.exe`。本轮完成构建检查，未将构建成功作为跨平台实机验收结果。

初次根测试发现 Vitest 自动收集了使用 Node 原生测试器的 Worker 测试，已在 `vite.config.ts` 排除独立的 `workers/**`；Worker 仍由自己的 `npm test` 执行。初次并行回归还出现两项现有界面测试 5 秒超时；修正收集范围后按原命令复测，290 项全部通过，未提高超时或修改界面测试。

## 复现与后续边界

命令见 [Worker README](../workers/settings-sync/README.md)。探针固定 CMS 与开发 Worker 地址，不接受任意目标 URL，不打印令牌、不跟随重定向、不修改系统凭据、不主动注销当前会话。

本阶段确认现有 CMS 会话可被 Worker 远程验证；后续业务接口必须继续采用同一路径鉴权。步骤 2—8 尚未开始。自然过期会话可在后续会话自然失效时补测，当前不为制造样本而注销或破坏用户会话。

参考 Cloudflare 官方文档：[D1 绑定](https://developers.cloudflare.com/d1/tutorials/build-a-comments-api/)、[Workers 日志配置](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)。
