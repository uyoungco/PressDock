import icons from "./icons.js";

const params = new URLSearchParams(location.search);
const screens = {
  channels: "渠道素材",
  articles: "文章管理",
  editor: "编辑文章",
  import: "素材导入",
  image: "图片处理",
  settings: "系统设置",
  models: "模型配置",
};
let screen = location.hash.slice(1) || params.get("screen") || "channels";
if (!screens[screen]) screen = "channels";
let theme = params.get("theme") === "dark" ? "dark" : "light";
if (params.has("embed")) document.body.classList.add("embedded");
document.documentElement.dataset.theme = theme;
const app = document.querySelector("#app"),
  overlay = document.querySelector("#overlay"),
  toastBox = document.querySelector("#toast");
const icon = (name) =>
  `<span class="icon">${icons[name] || icons.Circle}</span>`;
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const button = (text, action, kind = "", name = "") =>
  `<button class="btn ${kind}" data-action="${action}"${name ? ` aria-label="${esc(name)}"` : ""}>${text}</button>`;
const ib = (name, action, label) =>
  `<button class="icon-btn" data-action="${action}" aria-label="${esc(label)}">${icon(name)}</button>`;
const titles = [
  "城市更新，让老街区焕发新活力",
  "公共图书馆延长开放时间",
  "周末去哪里？秋日城市漫步指南",
  "秋日田野里的丰收图景",
  "青年创作者走进社区",
  "社区食堂里的烟火气",
  "城市绿道串起家门口的风景",
  "老厂房的新故事",
];
const rows = Array.from({ length: 20 }, (_, i) => ({
  title: titles[i % titles.length],
  id: 8101 + i,
  picture: i % 3,
  category: ["社会", "文化", "生活"][i % 3],
  time: `${9 - Math.floor(i / 8)}:${String(42 - (i % 8) * 3).padStart(2, "0")}`,
}));
let applied = {
    channel: "演示渠道",
    subchannel: "头条推荐",
    date: "2026-11-06",
  },
  draft = { ...applied };
let articleCategory = "优质文章",
  sorting = false,
  editorTab = "body",
  selectedRow = 0,
  overlayMode = "",
  settingsSection = "";
let editorTitle = rows[0].title,
  materialTitle = rows[0].title;
let currentPage = 1;
let editorBodyHtml = null,
  editorBodyScroll = 0;
let sortOriginal = null,
  imageReturn = { screen: "channels", material: false, index: -1, title: "" };
const categories = [
  "优质文章",
  "一级待审核文章",
  "二级待审核文章",
  "三级待审核文章",
];
const sections = [
  ["general", "Monitor", "通用", "界面主题"],
  ["harvest", "Download", "采集与 AI 处理", "前台采集与自动处理"],
  ["presets", "Images", "渠道图片预设", "尺寸、格式与体积限制"],
  ["services", "Plug", "服务连接", "CMS 与本机服务"],
  ["models", "Bot", "模型配置", "提供商与模型"],
  ["templates", "FileText", "提示词模板", "标题优化与文章分页"],
  ["about", "Info", "关于", "版本与应用信息"],
];
const pic = (index = 0, cls = "thumb", alt = "演示新闻配图") =>
  `<img class="${cls}" src="./demo-street-${index % 3}.svg" alt="${alt}" width="720" height="480" />`;
function note() {
  return `<div class="preview-note"><span>设计预览 · 演示数据</span><a href="./overview.html" target="_top">查看全览</a></div>`;
}
function header(title, { back = false, action = "" } = {}) {
  return `<header class="topbar">${ib(back ? "ArrowLeft" : "Menu", back ? "back" : "nav", back ? "返回" : "打开主导航")}<h1>${title}</h1>${action || ib("UserRound", "account", "账号与外观")}</header>`;
}
function pagination(type = "channels") {
  return `<footer class="pagination"><span class="page-number mono">第 ${currentPage} 页</span><span class="grow"></span><select aria-label="每页条数"><option>${type === "articles" ? 50 : 20} 条/页</option><option>10 条/页</option><option>30 条/页</option></select>${ib("ChevronLeft", "previous", "上一页")}${ib("ChevronRight", "next", "下一页")}</footer>`;
}
function channels() {
  return `${header("渠道素材")}<main class="screen"><div class="toolbar">${sorting ? button("保存排序", "save-sort", "primary") + button("取消", "cancel-sort", "quiet") : button(`${icon("SlidersHorizontal")}筛选 <span class="count">${Object.values(applied).filter(Boolean).length}</span>`, "channel-filter", "outline") + ib("RefreshCw", "refresh", "刷新素材") + button("排序", "sort", "quiet") + button(`${icon("Plus")}新增`, "new-material", "primary")}</div><div class="context-line"><strong>${esc(applied.channel || "全部渠道")}</strong>${applied.subchannel ? `<span>/</span><span>${esc(applied.subchannel)}</span>` : ""}<span class="spacer"></span><span class="mono">${applied.date ? applied.date.slice(5).replace("-", " / ") : "全部日期"}</span></div><div class="scroll material-list" aria-label="渠道素材列表">${rows.map((r, i) => `<article class="material ${i === 0 ? "selected" : ""}"><button class="material-title" data-action="material-detail:${i}">${esc(r.title)}</button><div class="material-meta"><span class="mono">#${r.id}</span><span>演示编辑</span><span class="mono">${r.time}</span></div><div class="material-actions">${sorting ? `<span class="position-label">第 ${i + 1} 位</span>${ib("ArrowUp", `move-up:${i}`, `上移第 ${i + 1} 条素材`)}${ib("ArrowDown", `move-down:${i}`, `下移第 ${i + 1} 条素材`)}` : button(`${icon("Pencil")}编辑`, `material-edit:${i}`, "quiet", `编辑素材 ${r.title}`) + ib("MoreHorizontal", `material-more:${i}`, `素材 ${i + 1} 更多操作`)}</div><div class="thumb-stack"><button class="image-button" data-action="image-detail:${i}" aria-label="查看主图规格">${pic(r.picture)}</button><button class="image-button" data-action="image-detail:${i}" aria-label="查看第二张图片规格">${pic((r.picture + 1) % 3, "thumb secondary-image")}</button></div></article>`).join("")}</div>${pagination()}</main>`;
}
function articles() {
  return `${header("文章管理")}<main class="screen"><div class="toolbar"><button class="category-button" data-action="categories">${articleCategory}${icon("ChevronDown")}</button><span class="spacer"></span>${ib("SlidersHorizontal", "article-filter", "筛选文章")}${ib("RefreshCw", "refresh", "刷新文章")}</div><div class="context-line"><span>全部分类</span><span>·</span><span>全部作者</span><span class="spacer"></span><span>第 1 页 · 演示列表</span></div><div class="scroll article-list" aria-label="文章列表">${rows
    .slice(0, 10)
    .map(
      (r, i) =>
        `<article class="article-row"><div class="article-core"><div><button class="article-title" data-action="article-edit:${i}">${r.title}</button><div class="material-meta"><span>${r.category}</span><span class="mono">#${r.id}</span><span>3 页</span></div></div><button class="image-button" data-action="article-detail:${i}" aria-label="查看文章配图">${pic(r.picture)}</button></div><div class="material-meta"><span>演示编辑</span><span>11 月 6 日 ${r.time}</span></div><div class="article-footer">${button(`${icon("Pencil")}编辑`, `article-edit:${i}`, "quiet", `编辑文章 ${r.title}`)}${button("转渠道素材", `promote:${i}`, "quiet")}<span class="spacer"></span>${ib("MoreHorizontal", `article-detail:${i}`, `文章 ${i + 1} 更多信息`)}</div></article>`,
    )
    .join("")}</div>${pagination("articles")}</main>`;
}
function editor() {
  return `${header("编辑文章", { back: true, action: ib("MoreHorizontal", "editor-more", "文章编辑更多操作") })}<main class="screen"><div class="tabs" role="tablist" aria-label="文章编辑内容"><button class="tab" role="tab" aria-selected="${editorTab === "info"}" data-action="editor-tab:info">基本信息</button><button class="tab" role="tab" aria-selected="${editorTab === "body"}" data-action="editor-tab:body">正文</button><span class="spacer"></span><span class="page-track">#8101</span></div>${editorTab === "body" ? `<div class="formatbar" aria-label="正文工具栏">${ib("Undo2", "format:undo", "撤销")}${ib("Redo2", "format:redo", "重做")}${ib("Bold", "format:bold", "加粗")}${ib("Italic", "format:italic", "斜体")}${ib("List", "format:insertUnorderedList", "无序列表")}${ib("Image", "insert-image", "插入图片")}${ib("MoreHorizontal", "format-more", "更多正文操作")}</div><div class="scroll"><article class="document"><div class="doc-meta"><span>社会</span><span>·</span><span>演示编辑</span><span class="spacer"></span><span class="mono">11-06</span></div><h2>${esc(editorTitle)}</h2><div contenteditable="true" role="textbox" aria-multiline="true" aria-label="文章正文" spellcheck="false"><p>清晨的老街，早餐铺陆续开门，街坊沿着新修的人行步道穿行。承载几代人记忆的街巷，正在以渐进的方式重新连接日常生活。</p><h3>把日常生活放在更新之前</h3><p>此次更新保留原有街道肌理，把居民关心的出行、休憩和照明问题放在前面。社区书屋与口袋公园被步道串联起来。</p><figure contenteditable="false">${pic(0, "doc-image", "演示配图：老街区的步行空间")}<figcaption>演示配图 · 老街区的步行空间</figcaption></figure><div class="page-break" contenteditable="false"><span>第 2 页</span></div><h3>让街坊一起参与</h3><p>从绿化品种到夜间照明，居民参与了方案讨论。设计团队整理意见，再带着调整后的方案回到社区。</p><p>临街小店保留各自特色，新的公共空间也让人愿意多停留一会儿。</p><div class="page-break" contenteditable="false"><span>第 3 页</span></div><h3>延续街区记忆</h3><p>后续维护由街道、居民与沿街商户共同参与，让街区在日常使用中持续完善。</p></div></article></div>` : articleInfo()}<footer class="footer"><div class="footer-meta"><div>修改尚未提交</div><div class="page-track"><span>3 页</span><i></i><i></i><i></i></div></div>${button("取消", "leave-editor", "outline")}${button("保存修改", "save-article", "primary")}</footer></main>`;
}
function articleInfo() {
  return `<div class="scroll"><form class="form" onsubmit="return false"><div class="field"><label for="article-title">标题</label><textarea id="article-title" rows="2">${esc(editorTitle)}</textarea></div><div class="form-grid"><div class="field"><label for="article-class">分类</label><select id="article-class"><option>社会</option><option>文化</option><option>生活</option></select></div><div class="field"><label for="article-author">作者</label><input id="article-author" value="演示编辑" /></div></div><div class="field"><label for="article-time">新闻时间</label><input id="article-time" type="datetime-local" value="2026-11-06T09:42" /></div><div class="field"><label>文章配图</label><div class="image-fields">${[0, 1, 2].map((v) => `<button type="button" data-action="open-image">${pic(v, "", "演示文章配图")}<span>${v === 0 ? "主图" : `配图 ${v + 1}`}</span></button>`).join("")}</div></div><div class="field"><label for="article-tags">标签</label><input id="article-tags" value="城市更新、公共空间" /><span class="hint">保留现有标签与扩展标签的区别</span></div><div class="field"><label for="article-summary">摘要</label><textarea id="article-summary">从街坊的日常需求出发，让老街区焕发新活力。</textarea></div><div class="field"><label for="article-source">原文链接</label><input id="article-source" value="https://demo.invalid/news/8101" readonly /></div></form></div>`;
}
function importScreen() {
  const jobs = [
    ["running", "格式化中", 0, "09:42", ""],
    ["waiting", "等待网页验证", 1, "09:40", "请在来源窗口完成验证，再继续采集"],
    ["queued", "排队中", 2, "09:38", ""],
    ["succeeded", "已添加到 CMS", 3, "09:36", "演示记录 · 文章 #8104"],
    ["failed", "采集失败", 5, "09:32", "来源页面暂时无法读取，请检查后重试"],
    ["unknown", "提交结果待确认", 6, "09:30", "先核对 CMS，避免重复添加"],
  ];
  return `${header("素材导入", { action: ib("Settings", "harvest-settings", "采集设置") })}<main class="screen"><form class="import-form" id="import-form"><label for="source-link">文章链接</label><div class="row"><input class="input" id="source-link" placeholder="粘贴百家号或 mbd 文章链接" inputmode="url" autocomplete="off"/><button class="btn primary" type="submit" aria-label="开始采集">${icon("Plus")}采集</button></div><p class="import-hint">${icon("Info")}保持应用前台运行，退到后台将中断当前任务</p></form><div class="recordbar"><h2>采集记录</h2><button class="date-button" data-action="record-date">11 月 6 日${icon("ChevronDown")}</button>${ib("RefreshCw", "refresh", "刷新采集记录")}</div><div class="scroll" aria-label="采集记录列表">${jobs.map(([kind, status, i, time, sub]) => `<article class="job ${kind === "waiting" || kind === "unknown" ? "needs-action" : ""}"><div class="job-status ${kind === "waiting" || kind === "failed" || kind === "unknown" ? "warning" : kind === "succeeded" ? "good" : ""}">${kind === "succeeded" ? icon("Check") : kind === "waiting" || kind === "unknown" ? icon("TriangleAlert") : `<span class="status-dot ${kind === "running" ? "accent" : ""}"></span>`}<span>${status}</span><span class="spacer"></span><span class="mono muted">${time}</span></div><h3 class="job-title">${rows[i].title}</h3>${sub ? `<p class="job-subtext">${sub}</p>` : ""}${kind === "running" ? '<div class="progress-line" aria-label="演示处理阶段"><span></span></div>' : ""}<div class="job-actions">${kind === "waiting" ? button("打开来源窗口", "source-window", "link") + button("验证完成，继续", "continue-harvest", "quiet") : kind === "failed" ? button("重试", "retry-harvest", "link") : kind === "unknown" ? button("核对结果", "check-submission", "link") : ""}<span class="spacer"></span>${kind === "running" || kind === "queued" || kind === "waiting" ? button("取消", `cancel-job:${i}`, "quiet") : ib("MoreHorizontal", `job-more:${kind}`, "采集记录更多操作")}</div></article>`).join("")}</div></main>`;
}
function imageScreen() {
  return `${header("图片处理", { back: true, action: ib("CircleHelp", "image-help", "图片处理说明") })}<main class="screen"><div class="scroll"><div class="canvas-wrap"><div class="image-canvas" aria-label="演示裁剪画布">${pic(0, "", "演示新闻配图")}<div class="crop-window">${pic(0, "", "裁剪范围示意")}<i class="crop-corner"></i></div></div><div class="canvas-tools"><span>拖动调整裁剪范围</span><div class="row">${ib("RotateCcw", "reset-crop", "重置裁剪")}${ib("ZoomIn", "zoom-image", "放大预览")}</div></div></div><div class="image-params"><div class="section-label"><span>输出设置</span><span>演示渠道 / 头条推荐</span></div><div class="tip">${icon("LockKeyhole")}渠道预设已锁定尺寸、格式与体积上限</div><div class="form-grid" style="margin-top:16px"><div class="field"><label for="image-width">宽度 <span class="muted">px</span></label><input id="image-width" value="560" readonly /></div><div class="field"><label for="image-height">高度 <span class="muted">px</span></label><input id="image-height" value="248" readonly /></div></div><div class="form-grid" style="margin-top:16px"><div class="field"><label for="image-format">格式</label><select id="image-format" disabled><option>JPG</option></select></div><div class="field"><label for="image-size">体积上限 <span class="muted">KB</span></label><input id="image-size" value="79" readonly /></div></div><div class="field" style="margin-top:20px"><label for="image-quality">编码质量</label><div class="range-row"><input id="image-quality" type="range" min="60" max="100" value="86"/><span id="quality-value">86</span></div><span class="hint">体积以实际编码结果为准，超出限制时无法应用</span></div><div class="output-summary">${icon("Crop")}<strong class="mono">560 × 248</strong><span>JPG · 不超过 79 KB</span></div></div></div><footer class="footer">${button("取消", "image-back", "outline")}${button("处理并使用", "process-image", "primary")}</footer></main>`;
}
function settings() {
  return `${header("系统设置")}<main class="screen"><div class="scroll"><div class="settings-identity"><div class="identity-mark">${icon("Newspaper")}</div><div><h2>PressDock</h2><p>新闻编辑工作空间</p></div><span class="spacer"></span><span class="small muted mono">0.1.0</span></div><div class="page-pad"><div class="section-label">界面</div><div class="settings-group">${settingsRow(sections[0])}</div><div class="section-label">编辑工作</div><div class="settings-group">${sections.slice(1, 6).map(settingsRow).join("")}</div><div class="section-label">应用</div><div class="settings-group">${settingsRow(sections[6])}</div><p class="settings-foot">演示账号 · 预览中的设置不会写入应用</p></div></div></main>`;
}
function settingsRow([id, glyph, title, description]) {
  return `<button class="settings-row" data-action="setting:${id}">${icon(glyph)}<span class="settings-copy"><span class="title">${title}</span><span class="meta">${description}</span></span>${icon("ChevronRight")}</button>`;
}
function models() {
  return `${header("模型配置", { back: true, action: button(`${icon("Plus")}提供商`, "provider-add", "link") })}<main class="screen"><div class="section-intro"><h2>提供商与模型</h2><p>先配置提供商，再添加用于标题和分页的模型</p></div><div class="scroll page-pad"><div class="settings-group"><button class="settings-row" data-action="provider-edit">${icon("Plug")}<span class="settings-copy"><span class="title">本机网关 · 演示</span><span class="meta">Chat Completions · 未保存密钥</span></span>${icon("ChevronRight")}</button><button class="settings-row" data-action="model-edit">${icon("Bot")}<span class="settings-copy"><span class="title">元数据处理 · 演示</span><span class="meta">32,768 上下文 · 4,096 输出</span></span>${icon("ChevronRight")}</button></div><div class="section-label">其他提供商</div><div class="settings-group"><button class="settings-row" data-action="provider-edit">${icon("Plug")}<span class="settings-copy"><span class="title">编辑部网关 · 演示</span><span class="meta">Responses · 密钥已配置（演示）</span></span>${icon("ChevronRight")}</button></div><div class="tip" style="margin-top:20px">${icon("ShieldCheck")}预览不读取或保存真实密钥，也不会发起模型请求</div></div></main>`;
}
function switcher() {
  return `<aside class="prototype-switcher"><strong>PressDock</strong><p>手机端设计稿 · 2026.11.06</p>${Object.entries(
    screens,
  )
    .map(
      ([id, title]) =>
        `<a class="${screen === id ? "active" : ""}" href="#${id}">${title}</a>`,
    )
    .join(
      "",
    )}<a href="./overview.html" class="board-link">查看设计全览 ${icons.ArrowRight}</a><a href="#" data-action="toggle-theme">切换浅色 / 深色</a><p style="margin-top:20px">演示数据 · 操作仅在预览内<br/>unslop by @heydamir</p></aside>`;
}
function render() {
  const previousBody = app.querySelector('[aria-label="文章正文"]');
  if (previousBody) {
    editorBodyHtml = previousBody.innerHTML;
    editorBodyScroll = previousBody.closest(".scroll").scrollTop;
  }
  document.querySelector(".prototype-switcher")?.remove();
  const renderers = {
    channels,
    articles,
    editor,
    import: importScreen,
    image: imageScreen,
    settings,
    models,
  };
  app.innerHTML = note() + renderers[screen]();
  if (screen === "editor" && editorTab === "body" && editorBodyHtml !== null) {
    const body = app.querySelector('[aria-label="文章正文"]');
    body.innerHTML = editorBodyHtml;
    body.closest(".scroll").scrollTop = editorBodyScroll;
  }
  document.body.insertAdjacentHTML("beforeend", switcher());
  document.title = `PressDock · ${screens[screen]}设计预览`;
  if (currentPage === 1)
    app.querySelector('[data-action="previous"]')?.setAttribute("disabled", "");
}
function go(next) {
  if (overlay.open) overlay.close();
  screen = next;
  location.hash = next;
  render();
}
function notify(text) {
  clearTimeout(notify.timer);
  toastBox.textContent = text;
  toastBox.classList.add("visible");
  notify.timer = setTimeout(() => toastBox.classList.remove("visible"), 3200);
}
function panel(
  title,
  body,
  { footer = "", mode = "full-dialog", back = "close", subtitle = "" } = {},
) {
  overlay.className = mode;
  overlay.innerHTML = `${mode === "modal-card" ? "" : `<header class="dialog-header">${ib("ArrowLeft", back, "返回上一级")}<h2 id="panel-title">${title}</h2>${ib("X", "close", "关闭面板")}</header>`}${subtitle ? `<p class="dialog-subtitle">${subtitle}</p>` : ""}${body}${footer ? `<footer class="footer">${footer}</footer>` : ""}`;
  overlay.setAttribute("aria-label", title);
  overlayMode = title;
  if (!overlay.open) overlay.showModal();
}
function close() {
  overlay.close();
}
function imageBack() {
  go(imageReturn.screen);
  if (imageReturn.material) {
    materialForm(imageReturn.index);
    materialTitle = imageReturn.title;
    overlay.querySelector("#material-title").value = materialTitle;
  }
}
function nav() {
  panel(
    "导航",
    `<div class="drawer-brand">${icon("Newspaper")}<strong>PressDock</strong>${ib("X", "close", "关闭导航")}</div><p class="drawer-subtitle">新闻编辑工作空间</p><nav aria-label="主导航">${[
      ["channels", "Newspaper", "渠道素材管理"],
      ["import", "Download", "素材导入"],
      ["articles", "FileText", "文章管理"],
      ["image", "Images", "图片处理"],
      ["settings", "Settings", "系统设置"],
    ]
      .map(
        ([key, glyph, label]) =>
          `<button class="nav-item ${screen === key ? "selected" : ""}" data-action="go:${key}">${icon(glyph)}${label}</button>`,
      )
      .join(
        "",
      )}</nav><div class="drawer-foot"><div class="row">${icon("UserRound")}<span>演示编辑</span><span class="spacer"></span>${button("退出登录", "logout", "quiet")}</div><div class="theme-choices">${[
      ["light", "Sun", "浅色"],
      ["dark", "Moon", "深色"],
      ["system", "Monitor", "系统"],
    ]
      .map(
        ([value, glyph, label]) =>
          `<button class="theme-choice ${theme === value ? "selected" : ""}" data-action="theme:${value}">${icon(glyph)}${label}</button>`,
      )
      .join(
        "",
      )}</div><p class="small muted" style="margin-top:16px">设计预览 · 账号与操作均为演示</p></div>`,
    { mode: "drawer" },
  );
  overlay.querySelector(".dialog-header").remove();
}
function filter(kind = "channel", fresh = true) {
  if (fresh) draft = { ...applied };
  if (kind === "article") {
    panel(
      "筛选文章",
      `<form class="form scroll" onsubmit="return false"><div class="field"><label for="filter-title">文章标题</label><input id="filter-title" placeholder="输入标题关键词" /></div><div class="form-grid"><div class="field"><label for="filter-id">文章编号</label><input id="filter-id" inputmode="numeric" placeholder="全部" /></div><div class="field"><label for="filter-writer">作者</label><input id="filter-writer" placeholder="全部作者"/></div></div><div class="field"><label for="filter-class">分类</label><select id="filter-class"><option>全部分类</option><option>社会</option><option>文化</option><option>生活</option></select></div><div class="field"><label>时间范围</label><div class="form-grid"><input class="input" type="date" aria-label="开始日期"/><input class="input" type="date" aria-label="结束日期"/></div></div></form>`,
      {
        footer:
          button("重置", "reset-article-filter", "outline") +
          button("应用筛选", "apply-article-filter", "primary"),
      },
    );
    return;
  }
  panel(
    "筛选素材",
    `<form class="form scroll" onsubmit="return false"><div class="field"><label>渠道</label><button class="selection-field" data-action="choose:channel">${esc(draft.channel || "全部渠道")}${icon("ChevronRight")}</button></div><div class="field"><label>子渠道</label><button class="selection-field" data-action="choose:subchannel">${esc(draft.subchannel || "全部子渠道")}${icon("ChevronRight")}</button><span class="hint">切换渠道后重新选择子渠道</span></div><div class="field"><label for="filter-date">发布日期</label><input id="filter-date" type="date" value="${draft.date}"/></div></form>`,
    {
      footer:
        button("重置", "reset-channel-filter", "outline") +
        button("应用筛选", "apply-channel-filter", "primary"),
      subtitle: "仅在点击“应用筛选”后更新列表",
    },
  );
}
function choose(field) {
  const values =
    field === "channel"
      ? ["全部渠道", "演示渠道", "演示频道二"]
      : ["全部子渠道", "头条推荐", "轮播推荐"];
  panel(
    field === "channel" ? "选择渠道" : "选择子渠道",
    `<div class="page-pad"><div class="field"><label class="small" for="option-search">搜索选项</label><input id="option-search" placeholder="搜索${field === "channel" ? "渠道" : "子渠道"}"/></div></div><div class="option-list">${values.map((v, i) => `<button class="option ${draft[field] === v ? "selected" : ""}" data-option="${v}" data-action="selected:${field}:${i}"><span>${v}</span>${draft[field] === v ? icon("Check") : ""}</button>`).join("")}</div>`,
    { back: "filter-return" },
  );
}
function materialForm(index = -1) {
  selectedRow = index >= 0 ? index : 0;
  materialTitle = index >= 0 ? rows[index].title : "";
  panel(
    index >= 0 ? "编辑素材" : "新增素材",
    `<form class="form scroll" onsubmit="return false"><div class="form-grid"><div class="field"><label>渠道</label><select aria-label="素材渠道"><option>演示渠道</option></select></div><div class="field"><label>子渠道</label><select aria-label="素材子渠道"><option>头条推荐</option><option>轮播推荐</option></select></div></div><div class="field"><div class="form-line"><label for="material-title">标题</label>${button(`${icon("Type")}优化标题`, "title-ai", "link")}</div><textarea id="material-title" rows="2" placeholder="输入素材标题">${esc(materialTitle)}</textarea></div><div class="field"><label for="material-date">发布日期</label><input id="material-date" type="date" value="2026-11-06"/></div><div class="field"><label>素材配图</label><div class="image-fields" style="grid-template-columns:1fr 1fr">${[0, 1].map((v) => `<button data-action="open-image" type="button">${pic(v, "", "演示素材图片")}<span>${v ? "第二张图片" : "主图"} · 560 × 248</span></button>`).join("")}</div><span class="hint">图片处理完成后回填，保存素材时才提交</span></div><div class="field"><label for="material-summary">摘要</label><textarea id="material-summary" rows="3">从日常需求出发，更新街区公共空间。</textarea></div><div class="field"><label for="material-writer">作者</label><input id="material-writer" value="演示编辑"/></div><div class="field"><label for="material-url">来源链接</label><input id="material-url" value="https://demo.invalid/news/8101"/></div></form>`,
    {
      footer:
        '<span class="footer-meta">演示草稿 · 尚未提交</span>' +
        button("取消", "leave-material", "outline") +
        button("保存素材", "save-material", "primary"),
    },
  );
}
function detail(index, kind = "素材详情") {
  const r = rows[index];
  selectedRow = index;
  panel(
    kind,
    `<div class="scroll page-pad stack"><h2>${r.title}</h2><p class="small muted">演示编辑 · 2026-11-06 ${r.time}</p>${pic(r.picture, "detail-image")}<p class="small muted">演示配图 · JPG · 560 × 248 px · 68.4 KB</p><dl class="detail-grid"><dt>素材编号</dt><dd class="mono">#${r.id}</dd><dt>渠道</dt><dd>演示渠道 / 头条推荐</dd><dt>第二张图片</dt><dd>JPG · 280 × 124 px · 23.6 KB</dd><dt>来源</dt><dd>demo.invalid</dd><dt>摘要</dt><dd>从居民的日常生活出发，更新街区公共空间。</dd></dl><div class="tip">${icon("Info")}以上配图规格为演示值，用于评估信息层级</div></div>`,
    {
      footer:
        button("查看来源", "source-window", "outline") +
        button("编辑素材", `material-edit:${index}`, "primary"),
    },
  );
}
function paginationAssistant() {
  panel(
    "分页助手",
    `<div class="dialog-subtitle">示例建议 · 3 页 · 原有分页标记可保留</div><div class="scroll">${["把日常生活放在更新之前", "让街坊一起参与", "延续街区记忆"].map((t, i) => `<article class="pagination-item ${i === 0 ? "active" : ""}"><div class="row"><span class="small muted">第 ${i + 1} 页</span><span class="page-count mono">${[318, 286, 265][i]} 字（演示）</span></div><h3>${t}</h3><p>${["街巷更新从出行、休憩和照明问题开始，保留日常生活的尺度。", "居民参与方案讨论，绿化、照明和店铺保留在同一段叙述中。", "维护与共建构成完整结尾，不在文末添加空页。"][i]}</p></article>`).join("")}<div class="page-pad"><div class="tip">${icon("Info")}分页只回填编辑器，保存文章时才提交 CMS</div></div></div>`,
    {
      footer:
        button("生成建议", "generate-pagination", "outline") +
        button("应用示例", "apply-pagination", "primary"),
    },
  );
}
function setting(id) {
  settingsSection = id;
  if (id === "models") {
    go("models");
    return;
  }
  const section = sections.find((s) => s[0] === id);
  let body = "";
  if (id === "general")
    body = `<div class="form scroll"><div class="field"><label>界面主题</label><div class="theme-choices">${[
      ["light", "Sun", "浅色"],
      ["dark", "Moon", "深色"],
      ["system", "Monitor", "系统"],
    ]
      .map(
        ([v, g, l]) =>
          `<button class="theme-choice ${theme === v ? "selected" : ""}" data-action="theme-setting:${v}">${icon(g)}${l}</button>`,
      )
      .join(
        "",
      )}</div><span class="hint">设计预览内切换，不修改手机上的应用主题</span></div></div>`;
  else if (id === "harvest")
    body = `<div class="form scroll"><div class="field"><label>获取方式</label><div class="selection-field">内置 WebView <span class="small muted">Android</span></div><span class="hint">手机端保持应用前台执行采集</span></div>${["自动识别分类", "自动生成标签", "自动生成摘要", "文章自动分页"].map((t) => `<div class="field-switch"><span>${t}</span><button class="switch" role="switch" aria-label="${t}" aria-checked="true" data-action="switch"></button></div>`).join("")}<div class="field"><label for="harvest-model">处理模型</label><select id="harvest-model"><option>元数据处理 · 演示</option></select></div><div class="field"><label for="retention-days">记录保留天数</label><input id="retention-days" type="number" value="30"/></div><div class="tip warning">${icon("Info")}前台处理不等于发布成功；提交结果未知时需先核对 CMS</div></div>`;
  else if (id === "presets")
    body = `<div class="form scroll"><div class="field"><label>渠道 / 子渠道</label><select aria-label="预设渠道"><option>演示渠道 / 头条推荐</option></select></div><h2>主图预设</h2><div class="form-grid"><div class="field"><label for="preset-width">宽度</label><input id="preset-width" value="560"/></div><div class="field"><label for="preset-height">高度</label><input id="preset-height" value="248"/></div></div><div class="form-grid"><div class="field"><label for="preset-format">格式</label><select id="preset-format"><option>JPG</option><option>PNG</option><option>WebP</option></select></div><div class="field"><label for="preset-size">体积上限 KB</label><input id="preset-size" value="79"/></div></div><div class="subtle-divider"></div><h2>第二张图片预设</h2><p class="small muted">280 × 124 px · JPG</p></div>`;
  else if (id === "services")
    body = `<div class="form scroll"><div class="settings-group"><div class="settings-row">${icon("Plug")}<span class="settings-copy"><span class="title">CMS 会话</span><span class="meta">演示账号，不连接真实 CMS</span></span></div><div class="settings-row">${icon("Database")}<span class="settings-copy"><span class="title">Rust 与 SQLite</span><span class="meta">浏览器设计预览不执行原生检查</span></span></div></div>${button("配置模型", "go:models", "outline")}</div>`;
  else if (id === "templates")
    body = `<div class="form scroll"><div class="tabs" role="tablist">${button("标题优化", "template-title", "link")}${button("文章分页", "template-pagination", "quiet")}</div><div class="field"><label for="template-name">模板名称</label><input id="template-name" value="新闻标题优化 · 演示"/></div><div class="field"><label for="template-system">系统提示词</label><textarea id="template-system" rows="5">保留新闻事实，使用准确简洁的中文标题。不添加未经原文支持的信息。</textarea></div><div class="field"><label for="template-model">关联模型</label><select id="template-model"><option>元数据处理 · 演示</option></select></div></div>`;
  else
    body = `<div class="form scroll"><h2>PressDock</h2><p class="secondary">跨平台新闻编辑工作空间</p><dl class="detail-grid"><dt>版本</dt><dd>0.1.0</dd><dt>设计稿日期</dt><dd>2026-11-06</dd><dt>设计方法</dt><dd>unslop by <a href="https://x.com/heydamir" target="_blank" rel="noreferrer">@heydamir</a> · CC BY 4.0</dd></dl><div class="tip">${icon("Info")}当前为可交互设计稿，不代表正式应用已修改</div></div>`;
  panel(section[2], body, {
    footer: ["presets", "templates"].includes(id)
      ? button("取消", "close", "outline") +
        button("保存设置", "save-settings", "primary")
      : "",
  });
}
function confirmation(title, text, action, label = "确认") {
  panel(
    title,
    `<h2>${title}</h2><p>${text}</p><div class="modal-actions">${button("取消", "close", "outline")}${button(label, action, "primary")}</div>`,
    { mode: "modal-card" },
  );
}
function providerForm(model = false) {
  panel(
    model ? "编辑模型" : "编辑提供商",
    `<form class="form scroll" onsubmit="return false">${model ? `<div class="field"><label for="model-display">显示名称</label><input id="model-display" value="元数据处理 · 演示"/></div><div class="field"><label for="model-id">模型标识</label><input id="model-id" value="demo-metadata-model"/></div><div class="form-grid"><div class="field"><label for="model-context">上下文窗口</label><input id="model-context" value="32768"/></div><div class="field"><label for="model-output">最大输出</label><input id="model-output" value="4096"/></div></div>` : `<div class="field"><label for="provider-name">显示名称</label><input id="provider-name" value="本机网关 · 演示"/></div><div class="field"><label for="provider-url">服务地址</label><input id="provider-url" value="http://127.0.0.1:11434/v1" inputmode="url"/></div><div class="field"><label for="provider-protocol">协议</label><select id="provider-protocol"><option>Chat Completions</option><option>Responses</option></select></div><div class="field"><label for="provider-key">API Key</label><input type="password" id="provider-key" autocomplete="off" placeholder="设计预览请勿输入真实密钥"/><span class="hint">预览不连接服务、不保存输入</span></div>`}</form>`,
    {
      footer:
        button("取消", "close", "outline") +
        button("保存", "save-settings", "primary"),
    },
  );
}
document.addEventListener("click", (event) => {
  const node = event.target.closest("[data-action]");
  if (!node) return;
  event.preventDefault();
  const [action, value, extra] = node.dataset.action.split(":");
  switch (action) {
    case "nav":
    case "account":
      nav();
      break;
    case "go":
      go(value);
      break;
    case "back":
      if (screen === "image") imageBack();
      else go(screen === "models" ? "settings" : "articles");
      break;
    case "close":
      close();
      break;
    case "refresh":
      notify("设计预览：展示演示数据，未请求真实服务");
      break;
    case "channel-filter":
      filter();
      break;
    case "article-filter":
      filter("article");
      break;
    case "choose":
      choose(value);
      break;
    case "selected":
      draft[value] =
        Number(extra) === 0
          ? ""
          : (value === "channel"
              ? ["全部渠道", "演示渠道", "演示频道二"]
              : ["全部子渠道", "头条推荐", "轮播推荐"])[Number(extra)];
      if (value === "channel") draft.subchannel = "";
      filter("channel", false);
      break;
    case "filter-return":
      filter("channel", false);
      break;
    case "reset-channel-filter":
      draft = { channel: "", subchannel: "", date: "" };
      filter("channel", false);
      break;
    case "apply-channel-filter":
      applied = { ...draft };
      close();
      render();
      break;
    case "reset-article-filter":
      overlay.querySelectorAll("input").forEach((n) => (n.value = ""));
      break;
    case "apply-article-filter":
      close();
      notify("设计预览：筛选条件仅用于演示");
      break;
    case "sort":
      sortOriginal = rows.slice();
      sorting = true;
      render();
      break;
    case "cancel-sort":
      if (sortOriginal) rows.splice(0, rows.length, ...sortOriginal);
      sortOriginal = null;
      sorting = false;
      render();
      break;
    case "save-sort":
      sorting = false;
      render();
      notify("设计预览：未保存排序到 CMS");
      break;
    case "move-up":
    case "move-down": {
      const i = Number(value),
        j = i + (action === "move-up" ? -1 : 1);
      if (j >= 0 && j < rows.length) {
        [rows[i], rows[j]] = [rows[j], rows[i]];
        render();
      }
      break;
    }
    case "material-detail":
    case "image-detail":
      detail(Number(value));
      break;
    case "material-edit":
      materialForm(Number(value));
      break;
    case "new-material":
      materialForm();
      break;
    case "material-more":
      selectedRow = Number(value);
      panel(
        "素材操作",
        `<div class="option-list"><button class="option" data-action="material-detail:${value}">${icon("Info")}查看详情与图片规格</button><button class="option" data-action="material-edit:${value}">${icon("Pencil")}编辑素材</button><button class="option" data-action="delete-material:${value}" style="color:var(--danger)">${icon("Trash2")}删除素材</button></div>`,
      );
      break;
    case "delete-material":
      confirmation(
        "删除素材？",
        "删除会影响 CMS 中的素材。当前是设计预览，不会执行删除。",
        "delete-demo",
        "查看演示说明",
      );
      break;
    case "delete-demo":
      close();
      notify("设计预览：未删除任何素材");
      break;
    case "leave-material":
      confirmation(
        "保留当前草稿？",
        "正式应用可保存本机素材草稿；当前预览仅演示离开流程。",
        "close",
        "离开预览",
      );
      break;
    case "save-material":
      notify("设计预览：未提交素材，也未上传图片");
      break;
    case "categories":
      panel(
        "文章类别",
        `<div class="option-list">${categories.map((c, i) => `<button class="option ${c === articleCategory ? "selected" : ""}" data-action="category:${i}">${c}${c === articleCategory ? icon("Check") : ""}</button>`).join("")}</div>`,
      );
      break;
    case "category":
      articleCategory = categories[Number(value)];
      close();
      render();
      break;
    case "article-edit":
      selectedRow = Number(value);
      editorTitle = rows[selectedRow].title;
      editorTab = "body";
      editorBodyHtml = null;
      editorBodyScroll = 0;
      go("editor");
      break;
    case "article-detail":
      detail(Number(value), "文章更多信息");
      break;
    case "editor-tab":
      editorTab = value;
      render();
      break;
    case "save-article":
      notify("设计预览：修改未提交到 CMS");
      break;
    case "leave-editor":
      confirmation(
        "离开文章编辑？",
        "当前修改尚未提交。预览只保留在本次页面内，不写入设备草稿。",
        "go:articles",
        "离开编辑",
      );
      break;
    case "promote":
      selectedRow = Number(value);
      panel(
        "添加到渠道素材",
        `<div class="form scroll"><h2>${rows[selectedRow].title}</h2><div class="field"><label for="promote-channel">渠道</label><select id="promote-channel"><option>演示渠道</option></select></div><div class="field"><label for="promote-subchannel">子渠道</label><select id="promote-subchannel"><option>头条推荐</option><option>轮播推荐</option></select></div><div class="field"><label for="promote-date">发布日期</label><input id="promote-date" type="date" value="2026-11-06"/></div><div class="tip">${icon("Info")}图片及其他字段沿用现有转素材流程</div></div>`,
        {
          footer:
            button("取消", "close", "outline") +
            button("添加到素材", "save-material", "primary"),
        },
      );
      break;
    case "format":
      document.execCommand(value);
      break;
    case "editor-more":
    case "format-more":
      panel(
        "正文操作",
        `<div class="option-list"><button class="option" data-action="pagination">${icon("Scissors")}分页助手</button><button class="option" data-action="source-code">${icon("FileText")}HTML 源码</button><button class="option" data-action="insert-image">${icon("Image")}插入图片</button></div>`,
      );
      break;
    case "pagination":
      paginationAssistant();
      break;
    case "apply-pagination":
      close();
      notify("设计预览：已展示分页位置，未提交 CMS");
      break;
    case "generate-pagination":
      notify("设计预览：没有发起 AI 请求");
      break;
    case "source-code":
      panel(
        "HTML 源码",
        `<div class="form scroll"><div class="field"><label for="html-source">文章正文</label><textarea id="html-source" rows="18" spellcheck="false">${esc("<h2>把日常生活放在更新之前</h2>\n<p>清晨的老街，早餐铺陆续开门。</p>\n<p>[!--empirenews.page--]</p>\n<h2>让街坊一起参与</h2>")}</textarea><span class="hint">编辑源码只影响当前编辑器，保存文章时才提交</span></div></div>`,
        {
          footer:
            button("取消", "close", "outline") +
            button("应用到正文", "apply-pagination", "primary"),
        },
      );
      break;
    case "insert-image":
      notify("设计预览：插图沿用系统图片选择器");
      break;
    case "title-ai":
      panel(
        "优化标题",
        `<div class="form scroll"><div class="field"><label>当前标题</label><p>${esc(materialTitle || rows[0].title)}</p></div><div class="tip">${icon("Info")}生成前确认发送内容；以下为演示候选</div>${["老街区焕新，日常生活更便利", "从日常需求出发，老街区迎来新变化", "保留街巷记忆，城市更新走进居民生活"].map((t) => `<button class="option" data-action="use-title" data-title="${t}">${t}${icon("ChevronRight")}</button>`).join("")}</div>`,
        { footer: button("生成标题", "generate-pagination", "primary") },
      );
      break;
    case "use-title":
      materialForm(selectedRow);
      overlay.querySelector("#material-title").value = node.dataset.title;
      notify("演示标题已回填预览，未保存素材");
      break;
    case "open-image":
      imageReturn = {
        screen,
        material:
          overlay.open && ["编辑素材", "新增素材"].includes(overlayMode),
        index: overlayMode === "新增素材" ? -1 : selectedRow,
        title: materialTitle,
      };
      close();
      go("image");
      break;
    case "image-back":
      imageBack();
      break;
    case "process-image":
      notify("设计预览：未编码图片、未上传或导出");
      break;
    case "image-help":
      confirmation(
        "图片处理",
        "尺寸、格式和体积按渠道预设校验。此画布展示裁剪设计，实际编码继续使用 Rust 原生服务。",
        "close",
        "知道了",
      );
      break;
    case "reset-crop":
    case "zoom-image":
      notify("设计预览：此处展示画布工具位置");
      break;
    case "record-date":
      panel(
        "采集记录日期",
        `<div class="form"><div class="field"><label for="records-date">日期</label><input id="records-date" type="date" value="2026-11-06"/></div></div>`,
        { footer: button("查看记录", "close", "primary") },
      );
      break;
    case "harvest-settings":
      setting("harvest");
      break;
    case "source-window":
      notify("设计预览：未打开外部来源或进行网页验证");
      break;
    case "continue-harvest":
    case "retry-harvest":
    case "cancel-job":
      notify("设计预览：采集状态未改变，未执行真实任务");
      break;
    case "check-submission":
      panel(
        "核对提交结果",
        `<div class="form"><h2>先检查 CMS 中是否已有该文章</h2><p class="secondary">未收到提交确认不代表失败。核对后再选择，避免重复添加。</p><div class="tip warning">${icon("TriangleAlert")}此处是演示记录，不代表真实提交结果</div>${button("已核对：CMS 已添加", "demo-confirmation", "outline")}${button("已核对：CMS 未添加", "demo-confirmation", "outline")}</div>`,
      );
      break;
    case "demo-confirmation":
      notify("设计预览：未核对 CMS，也未更新记录");
      break;
    case "job-more":
      panel(
        "记录操作",
        `<div class="option-list"><button class="option" data-action="source-window">${icon("ExternalLink")}查看来源</button><button class="option" data-action="delete-demo">${icon("Trash2")}删除演示记录</button></div>`,
      );
      break;
    case "setting":
      setting(value);
      break;
    case "switch":
      node.setAttribute(
        "aria-checked",
        String(node.getAttribute("aria-checked") !== "true"),
      );
      break;
    case "theme":
    case "theme-setting":
      theme =
        value === "system"
          ? matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : value;
      document.documentElement.dataset.theme = theme;
      action === "theme" ? nav() : setting("general");
      break;
    case "toggle-theme":
      theme = theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      break;
    case "provider-edit":
    case "provider-add":
      providerForm();
      break;
    case "model-edit":
      providerForm(true);
      break;
    case "save-settings":
      notify("设计预览：设置与密钥均未保存");
      break;
    case "logout":
      confirmation(
        "退出登录？",
        "正式应用退出时会清除本机活动草稿。当前为演示账号，未执行真实退出。",
        "close",
        "返回预览",
      );
      break;
    case "template-title":
    case "template-pagination":
      notify("设计预览：标题与分页使用独立模板");
      break;
    default:
      notify("设计预览 · 此操作没有连接真实服务");
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "filter-date") draft.date = event.target.value;
  if (event.target.id === "article-title") editorTitle = event.target.value;
  if (event.target.id === "material-title") materialTitle = event.target.value;
  if (event.target.id === "image-quality")
    document.querySelector("#quality-value").textContent = event.target.value;
  if (event.target.id === "option-search") {
    const term = event.target.value;
    overlay
      .querySelectorAll("[data-option]")
      .forEach((n) => (n.hidden = !n.dataset.option.includes(term)));
  }
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "import-form")
    notify("设计预览：没有创建采集任务或请求外部网站");
});
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (screens[next] && next !== screen) {
    screen = next;
    close();
    render();
  }
});
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.data?.type === "theme") {
    theme = event.data.value;
    document.documentElement.dataset.theme = theme;
  }
});
render();
