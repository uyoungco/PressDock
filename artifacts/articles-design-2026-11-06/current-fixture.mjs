window.isTauri = true;
const titles = [
  "城市更新，让老街区焕发新活力",
  "公共图书馆延长开放时间",
  "周末去哪里？秋日城市漫步指南",
  "秋日田野里的丰收图景",
  "青年创作者走进社区",
  "社区食堂里的烟火气",
  "城市绿道串起家门口的风景",
  "老厂房的新故事",
  "演示保护模式的历史正文",
  "演示嵌套分页的历史正文",
];
const base = "http://127.0.0.1:18770/artifacts/articles-design-2026-11-06/";
const rows = titles.map((title, i) => ({
  snapshot: { Id: 8101 + i, Title: `【演示】${title}` },
  id: 8101 + i,
  classId: 1 + (i % 3),
  className: ["社会", "文化", "生活"][i % 3],
  title: `【演示】${title}`,
  titlePic: "https://demo.invalid/city.svg",
  titlePic2: i % 3 ? "https://demo.invalid/city-2.svg" : null,
  titlePic3: i % 2 ? "https://demo.invalid/city-3.svg" : null,
  writer: "演示编辑",
  smallText: "这是一篇用于界面调研的演示文章，不连接线上 CMS。",
  sourceUrl: `https://demo.invalid/news/${8101 + i}`,
  newsTime: "2026-11-06 09:42:00",
  pages: 3,
  tags: ["城市更新", "公共空间"],
  nTags: ["民生"],
  commentRecommand: i % 4 === 0 ? "头条推荐" : "",
  commentPromote:
    i % 4 === 0 ? ["演示渠道 / 头条推荐", "演示渠道 / 轮播推荐"] : [],
}));
const paragraph = [
  "清晨的老街，早餐铺陆续开门，街坊沿着新修的人行步道穿行。这条承载着几代人记忆的街巷，正在通过小规模、渐进式改造，让熟悉的生活与新的公共空间相互连接。",
  "此次更新保留原有街道肌理，把居民经常反映的出行、休憩和照明问题放在前面。修补后的路面衔接了社区书屋与口袋公园，沿街增设的座椅为老人和带孩子的家庭提供了歇脚的地方。",
  "居民参与了方案讨论。从绿化品种到夜间照明，设计团队把意见逐项整理，再带着调整后的方案回到社区。改造完成后，临街店铺的招牌保留各自特色，整体尺度也更适合步行者观看。",
  "午后，社区书屋里传来翻书声。新的空间没有追求统一的装饰，而是尽量利用现有房屋，增加通风和采光。靠窗的阅读桌与门前树荫相连，让原本匆忙经过的人愿意多停留一会儿。",
  "街区更新也为小店留下了经营空间。原有的修理铺、杂货店和理发店继续营业，施工期间通过分段围挡保持通行。居民熟悉的日常服务与新增的便民设施共同构成街道的生活底色。",
  "傍晚，路灯依次亮起。社区工作人员说，后续维护将由街道、居民与沿街商户共同参与，定期检查无障碍通道和公共设施，让更新后的街区在日常使用中持续完善。",
];
const body = `<p>【隔离演示正文】以下内容仅用于文章编辑与分页设计调研。</p><h2>把日常生活放在更新之前</h2><p>${paragraph[0]}</p><p>${paragraph[1]}</p><p>[!--empirenews.page--]</p><h2>让街坊一起参与</h2><p>${paragraph[2]}</p><p>${paragraph[3]}</p><p>[!--empirenews.page--]</p><h2>保留烟火气，延续街区记忆</h2><p>${paragraph[4]}</p><p>${paragraph[5]}</p>`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="248" viewBox="0 0 560 248"><rect width="560" height="248" fill="#e8ece8"/><path d="M0 175h560v73H0z" fill="#c3c9bd"/><path d="M40 160V66h78v94m32 0V30h65v130m28 0V80h96v80m29 0V47h65v113m24 0V91h70v69" fill="#9da99b"/><path d="M0 202h560" stroke="#f6f6ed" stroke-width="12"/><text x="20" y="232" fill="#435241" font-size="18">隔离演示配图</text></svg>';
const bytes = new TextEncoder().encode(svg);
let callback = 0;
window.__articleQa = { calls: [], blocked: [], base, rows, body };
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
window.__TAURI_INTERNALS__ = {
  transformCallback() {
    return ++callback;
  },
  unregisterCallback() {},
  async invoke(command, args = {}) {
    window.__articleQa.calls.push({ command, args });
    if (command === "cms_restore_session")
      return {
        user: {
          userId: 99999,
          nickname: "文章调研 · 隔离演示",
          roles: ["演示"],
          perms: [],
        },
        persistent: false,
      };
    if (command === "plugin:event|listen") return ++callback;
    if (command === "plugin:event|unlisten") return;
    if (command === "get_app_info")
      return { name: "PressDock", version: "0.1.0", platform: "隔离演示" };
    if (command === "health_check") return { ready: true };
    if (command === "cms_list_article_classes")
      return [
        { id: 1, name: "社会" },
        { id: 2, name: "文化" },
        { id: 3, name: "生活" },
      ];
    if (command === "cms_list_articles") {
      const q = args.query;
      const found = rows.filter(
        (row) =>
          (!q.id || row.id === q.id) &&
          (!q.classid || row.classId === q.classid) &&
          (!q.title || row.title.includes(q.title)) &&
          (!q.author || row.writer.includes(q.author)),
      );
      return {
        data: q.current === 1 ? found : [],
        total: found.length,
        current: q.current,
        pageSize: q.pagesize,
      };
    }
    if (command === "cms_get_article") {
      const row = rows.find((row) => row.id === args.id) ?? rows[0];
      return {
        ...row,
        status: 3,
        updatedAt: null,
        newsText:
          args.id === 8109
            ? "<table><tbody><tr><td>【演示】受保护的历史表格正文</td></tr></tbody></table>"
            : args.id === 8110
              ? `<p>【演示】嵌套分页</p><blockquote><p>嵌套段落</p><p>[!--empirenews.page--]</p></blockquote><p>保留历史正文</p>`
              : body,
      };
    }
    if (command === "cms_load_promote_image")
      return {
        mimeType: "image/svg+xml",
        byteSize: bytes.length,
        dataBase64: btoa(String.fromCharCode(...bytes)),
      };
    if (command === "cms_list_promote_channels")
      return [{ channel: "演示渠道", subchannels: ["头条推荐", "轮播推荐"] }];
    if (command === "ai_load_settings")
      return { providers: [], models: [], templates: [] };
    window.__articleQa.blocked.push({ command, args });
    throw {
      code: "DESIGN_READ_ONLY",
      message: "隔离设计演示：操作已拦截，不连接 CMS、AI 或外部站点",
    };
  },
};
await import("/src/main.tsx");
