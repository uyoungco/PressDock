# 渠道素材接口约定

基地址固定为 `https://newsadmin.nccontrol.com.cn`。接口来自已登录 Web 页 `/index.html#/test/promote` 的源码和拦截请求核对；调研时写请求均在发送前阻断。真实素材不用于自动化写测试。

## 命令与协议

所有 CMS 请求由 Rust 附加 Bearer，禁止重定向；HTTP 401 或业务码 `A0230` 清理会话，403 保留会话。写入不自动重试，连接中断或超时提示“结果未确认，请刷新核对”。成功写入统一返回 `{ succeeded: true }`，远端成功响应可以没有 `data`。

| IPC                                                            | 远端请求                       | 说明                                                                                  |
| -------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `cms_list_promote_channels`                                    | `GET /api/PromoteChannel`      | `current`、`pagesize=200`，继续取完配置并按首次出现顺序分组去重                       |
| `cms_list_promote_data({ query })`                             | `GET /api/PromoteData`         | 精确使用 `channel`、`subchannel`、`publishdate`、`current`、`pagesize`，中文 URL 编码 |
| `cms_get_promote_data({ id })`                                 | `GET /api/PromoteData/{id}`    | `data` 为完整 PascalCase 素材记录                                                     |
| `cms_create_promote_data({ input })`                           | `POST /api/PromoteData`        | `Id: 0` 及九个 PascalCase 表单字段                                                    |
| `cms_update_promote_data({ record })`                          | `PUT /api/PromoteData/{Id}`    | 完整 PascalCase 记录，保留非表单字段与扩展字段                                        |
| `cms_delete_promote_data({ id })`                              | `DELETE /api/PromoteData/{id}` | 无请求体，用户确认后提交                                                              |
| `cms_save_promote_order({ query, ids })`                       | `PUT /api/PromoteData`         | `{ promoteDataPutOrders: [{ id, order }] }`，只提交当前页、从 1 编号                  |
| `cms_upload_promote_image({ fileName, mimeType, dataBase64 })` | `POST /api/FileData`           | multipart 字段 `file`，取 `data[0].cloudurl` 返回 `{ url }`                           |
| `cms_load_promote_image({ url })`                              | 当前会话许可的 HTTPS 图片      | 返回 `{ mimeType, byteSize, dataBase64 }`；独立客户端不带 CMS 认证或 Cookie           |
| `open_external_link({ url })`                                  | 操作系统浏览器                 | 有会话且 HTTP/HTTPS、无嵌入凭据；无通用 Shell 权限                                    |

九个表单字段：`Channel`、`SubChannel`、`PublishDate`、`Url`、`Title`、`TitlePic`、`TitlePic2`、`SmallText`、`Writer`。必填字段为 **Channel、Title、TitlePic**；日期允许 null 或空字符串，非空为 `YYYY-MM-DD`。新增不复用编辑底稿。修改保留 `ArticleId`、`Order`、`Host`、`LandUrl` 和时间戳等未编辑字段。`SmallText` 是摘要，没有假定正文接口。

ArticleId 必须为正安全整数，链接为 `https://mini.jnnc.com/h/{articleId}.html?zn=mr`。Url、LandUrl 只允许以 HTTP/HTTPS 打开，也可复制原始值。

## 排序与会话

必须完整搜索渠道、子渠道、日期，输入条件与查询一致，成功加载至少两条记录。排序锁定筛选、分页及增删改；保存前 Rust 重新 GET 同一页，验证 ID 唯一、数量和集合一致，变化则拒绝提交。第二页仍编号为 `1…N`，不调整其他页或修正跨页重复排序值。

读写都验证会话版本，旧结果不能跨越退出或重新登录。素材表单与筛选只在运行内存中按账号保留；失效后同账号恢复，显式退出、换账号或关应用后清空。失效后取消排序并重新查询。图片地址许可集合及缓存随会话变化清理。

## 验收约束

本地服务器测试请求方法、路径、大小写、完整更新、multipart、排序、业务错误、超时及会话竞争；前端模拟业务服务。线上只读验收使用 `2345 / 右侧轮播小图_头条_280x124 / 2026-10-21`。新增、修改、删除、排序保存必须先拦截；可上传一张测试图片验证返回，但不保存素材。
