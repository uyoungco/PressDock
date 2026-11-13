# PressDock 全局配置 Worker

所有已登录 PressDock CMS 的用户共用一份配置；身份只用于鉴权和审计。Worker 验证固定 CMS 的 CurrentUser 后访问 D1，客户端不能传入用户身份、SQL、上游地址或加密主密钥。

## 资源与部署

| 环境 | Wrangler 配置               | Worker / D1 名称         | 访问地址                                           |
| ---- | --------------------------- | ------------------------ | -------------------------------------------------- |
| 开发 | `wrangler.jsonc`            | `pressdock-settings-dev` | `https://pressdock-settings-dev.i9543.workers.dev` |
| 正式 | `wrangler.production.jsonc` | `pressdock-settings`     | `https://pressdock-settings.uyoung.co`             |

两套 D1、主密钥及幂等密钥相互独立。迁移按 `0001_settings.sql`、`0002_body_organization.sql` 执行；当前开发和正式环境均已升级为协议 v2。正式库已初始化，不能删除重建或再次用本机设置覆盖。

正式自定义子域名已通过 Cloudflare 控制台绑定，DNS 与证书由 Cloudflare 管理；保留 workers.dev 作为运维入口。Android 实测其当前网络无法连接原 workers.dev，自定义域名的 IPv4 HTTPS 健康检查通过；客户端使用自定义域名，不写死边缘 IP。

原生同步请求携带 `PressDock/<版本>` User-Agent。当前自定义域名曾对缺少客户端标识的请求返回页面挑战；使用原生工具验证正常访问后保留 Cloudflare 原有安全规则，未关闭 WAF 或 TLS 校验。

使用 Node.js 24+、npm 及本目录的 package-lock.json：

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run deploy:dev
# 正式部署：npm run deploy:production
```

build 只执行部署预演。Cloudflare 授权使用 Wrangler OAuth 系统凭据库，已有授权直接复用，不将 token 写入项目。

必须先设置 Worker Secrets：`SETTINGS_ENCRYPTION_KEYRING` 和 `SETTINGS_HMAC_KEYRING`。两者都是 `{ "current": "v1", "keys": { "v1": "<独立的随机32字节Base64>" } }`。加密使用 AES-256-GCM，幂等请求校验使用独立 HMAC-SHA256。轮换时添加新版本并保留旧版本；直接覆盖或删除旧密钥会破坏历史密文或重试校验。`SETTINGS_ENVIRONMENT` 是非秘密环境标识，参与密文 AAD。

## HTTP 接口

除 health 外，所有入口要求现有 CMS Bearer 会话；无 CORS 放行，无查询参数，无重定向。JSON 响应均为 no-store，请求原文最多 2 MiB。

| 入口                               | 用途                                                   |
| ---------------------------------- | ------------------------------------------------------ |
| `GET /health`                      | 公开环境及阶段检查，不访问 CMS/D1                      |
| `GET /api/v1/verify`               | 早期链路诊断：CMS 鉴权后固定 D1 查询                   |
| `GET /api/v1/settings/bootstrap`   | 返回一致的完整快照及授权原生客户端所需密钥             |
| `POST /api/v1/settings/initialize` | 仅向空库初始化；稳定请求重试返回原回执                 |
| `POST /api/v1/settings/operations` | 原子应用字段差量、记录永久幂等回执                     |
| `POST /api/v1/settings/check`      | 以冻结操作原文查已提交回执；未知操作返回 404，不写配置 |

完整请求类型、约束及错误码见[协议 v2 增量说明](../../docs/settings-sync/protocol-v2.md)及其引用的 v1 基线。HTTP 路径仍为 `/api/v1/settings`，wire `schemaVersion` 为 2；旧客户端需升级。D1 batch 内比较 revision/设备序号，再一并更新配置、密文、墓碑和回执。不同字段合并，同字段按服务端有效提交顺序决定；旧请求重试不能覆盖较新的修改。

CMS 固定为 `https://newsadmin.nccontrol.com.cn/api/Account/CurrentUser`。AI 密钥不回传给普通前端 IPC，不写日志。Workers Logs、invocation logs、Traces 均关闭；没有线上故障注入或任意管理员写入口。

CMS 鉴权 GET 遇到网络中断、超时、HTTP 408/429/5xx 时最多重试一次，每次最多 8 秒。401、403、过期业务码、重定向和无效身份不重试；两次均失败时不访问 D1。重试只发生在鉴权步骤，不重复执行 D1 读取或配置写入。

## 原生验证与首次导入

在项目根目录使用现有 Windows PressDock CMS 会话，无需提供密码或令牌：

```powershell
. ./scripts/use-local-rust.ps1
cargo run --locked --manifest-path src-tauri/Cargo.toml --example settings_sync_admin -- inspect
cargo run --locked --manifest-path src-tauri/Cargo.toml --example settings_sync_admin -- verify-development
# 指定电脑首次导入；正式环境已经完成，重复执行只检查本机回执：
cargo run --locked --manifest-path src-tauri/Cargo.toml --example settings_sync_admin -- initialize
# 隔离本机库仅下载正式配置，输出读取次数及版本，不发送 AI 请求：
cargo run --locked --manifest-path src-tauri/Cargo.toml --example settings_sync_admin -- verify-download
# 新的隔离本机库下载正式设置和密钥，并明确发起一次真实 AI 连接测试（可能计费）：
cargo run --locked --manifest-path src-tauri/Cargo.toml --example settings_sync_admin -- verify-fresh
```

显式维护命令 `repair-protocol` 要求先退出目标客户端并设置 `PRESSDOCK_SETTINGS_SYNC_DB` 为实际安装数据库。它拒绝旧版队列及可运行采集任务，先备份，再调用原生手动同步恢复当前 v2 请求，最后检查队列及完整云端回读；不改写冻结请求或密钥，不调用 AI 或 CMS 写接口。常规用户直接使用新版客户端的“手动同步”。

inspect 只输出数量。导入先备份原 SQLite，读取密钥失败则整体停止；请求先持久化为密文，以同一 operationId/原字节重试，确认后删除请求密文及解密密钥，保留回执。其他客户端只读取云端，不自动导入旧配置。

测试证据须区分本地 SQLite/模拟 CMS、真实 D1、真实原生设备及真实账号；模拟身份不能充当第二个真实账号。前两步的历史记录保留在 docs 下，后续验收见开发计划的交付记录。

永久校验错误会保留队列头并暂停，避免无限重试或误报成功。客户端“恢复同步”经确认后，在原安装内保留配置、全部待传密文和密钥引用的副本，停止当前进程同步；完全退出后重启读取云端，不重放副本，也不撤销已接受的云端修改。取消或本机事务失败保留原队列，副本目前没有浏览/导出界面。不可清空安全凭据库、重置 D1 或把完整旧快照重新上传。macOS 和第二真实账号等未验项目见[后续验收记录](../../docs/cloudflare-d1-settings-step3-8-qa-2026-11-07.md)。
