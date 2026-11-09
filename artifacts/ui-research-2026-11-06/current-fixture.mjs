const articles = (await import("/src/features/articles/demo-articles.json"))
  .default;
window.isTauri = true;
const session = {
  user: {
    userId: 99999,
    nickname: "界面调研 · 演示账号",
    roles: ["演示"],
    perms: [],
  },
  persistent: false,
};
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="124"><rect width="280" height="124" fill="#e5e7e3"/><path d="M0 110 70 35 150 105 220 50 280 110v14H0" fill="#a4aca1"/><text x="12" y="114" font-size="14">演示配图</text></svg>';
const bytes = new TextEncoder().encode(svg);
const rows = Array.from({ length: 12 }, (_, index) => ({
  id: 100 + index,
  articleId: 800 + index,
  channel: "演示渠道",
  subChannel: "头条推荐",
  title: articles[index % articles.length].title,
  smallText: "演示素材，仅用于评估当前界面的阅读和操作层级",
  writer: "演示编辑",
  titlePic: "https://example.invalid/main.svg",
  titlePic2: "https://example.invalid/second.svg",
  host: "example.invalid",
  url: "https://example.invalid/news",
  landUrl: "",
  publishDate: "2026-11-06",
  order: index + 1,
  createdAt: "2026-11-06T09:00:00",
  updatedAt: null,
  deletedAt: null,
}));
let cb = 0;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
window.__TAURI_INTERNALS__ = {
  transformCallback() {
    return ++cb;
  },
  unregisterCallback() {},
  async invoke(command, args = {}) {
    if (command === "cms_restore_session") return session;
    if (command === "list_articles") return articles;
    if (command === "get_app_info")
      return { name: "PressDock", version: "0.1.0", platform: "隔离演示" };
    if (command === "health_check") return { ready: true };
    if (command === "plugin:event|listen") return ++cb;
    if (command === "plugin:event|unlisten") return;
    if (command === "cms_list_promote_channels")
      return [{ channel: "演示渠道", subchannels: ["头条推荐", "轮播推荐"] }];
    if (command === "cms_list_promote_data")
      return {
        data: rows,
        total: rows.length,
        current: args.query.current,
        pageSize: args.query.pagesize,
      };
    if (command === "cms_get_promote_data")
      return rows.find((row) => row.id === args.id);
    if (command === "cms_load_promote_image")
      return {
        mimeType: "image/svg+xml",
        byteSize: bytes.length,
        dataBase64: btoa(String.fromCharCode(...bytes)),
      };
    throw {
      code: "RESEARCH_READ_ONLY",
      message: "调研演示：此操作未执行，不连接 CMS 或 AI",
    };
  },
};
await import("/src/main.tsx");
