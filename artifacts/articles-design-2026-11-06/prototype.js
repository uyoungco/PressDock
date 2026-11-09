/* 独立设计原型：只操作当前页面内存，不连接 CMS、AI、IPC 或外部站点。
 * Unslop by Damir Sokolovsky (@heydamir), CC BY 4.0. */
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const paths = {
  newspaper:
    '<rect x="4" y="3" width="15" height="18" rx="2"/><path d="M4 7H2v12a2 2 0 0 0 2 2m3-14h8M7 11h8M7 15h3m3 0h2M7 18h8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  columns: '<path d="M4 4v16m5-16v16m6-16v16m5-16v16"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  files:
    '<rect x="7" y="3" width="13" height="16" rx="2"/><path d="M4 6H3v15h13v-1m-6-13h7m-7 4h7m-7 4h4"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  send: '<path d="m3 3 19 9-19 9 4-9-4-9zm4 9h15"/>',
  settings:
    '<path d="m10 3-1 3-3 1-3-1-1 4 2 2-1 4 3 2 3-1 2 3h3l1-3 3-1 3 1 1-4-2-2 1-4-3-2-3 1-2-3z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  monitor:
    '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6m-5 4a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/>',
  sliders:
    '<path d="M3 6h7m4 0h7M3 18h11m4 0h3"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="18" r="2"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  book: '<path d="M12 5c-3-2-6-2-10-1v16c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1v16"/>',
  code: '<path d="m7 5-6 7 6 7m10-14 6 7-6 7m-4-16-2 18"/>',
  bold: '<path d="M6 3h7a4.5 4.5 0 0 1 0 9H6zm0 9h8a4.5 4.5 0 0 1 0 9H6z"/>',
  italic: '<path d="M11 3h8M5 21h8M15 3 9 21"/>',
  underline: '<path d="M5 3v8a7 7 0 0 0 14 0V3M4 21h16"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  "list-ordered":
    '<path d="M9 5h12M9 12h12M9 19h12M3 3h1v5m-1 3h2v3H3v3h2m-2 3h2"/>',
  "align-left": '<path d="M3 4h18M3 9h12M3 14h18M3 19h12"/>',
  "align-center": '<path d="M3 4h18M6 9h12M3 14h18M6 19h12"/>',
  link: '<path d="m10 13 4-4m-7 5-2 2a4 4 0 0 0 6 6l4-4a4 4 0 0 0-1-6m3-2 2-2a4 4 0 0 0-6-6L9 6a4 4 0 0 0 1 6"/>',
  "image-plus":
    '<path d="M19 10v11H3V5h11m4-3v6m-3-3h6M3 17l5-5 4 4 3-3 4 4"/>',
  undo: '<path d="M3 10h11a7 7 0 0 1 0 14M3 10l5-5m-5 5 5 5" transform="translate(0 -3)"/>',
  redo: '<path d="M21 10H10a7 7 0 0 0 0 14m11-14-5-5m5 5-5 5" transform="translate(0 -3)"/>',
  separator: '<path d="M3 12h18M8 3l4 4 4-4M8 21l4-4 4 4"/>',
  "chevron-up": '<path d="m6 15 6-6 6 6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-left": '<path d="m15 6-6 6 6 6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.files}</svg>`;
}
function icons() {
  $$("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}
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
const paragraphs = [
  "清晨的老街，早餐铺陆续开门，街坊沿着新修的人行步道穿行。这条承载着几代人记忆的街巷，正在通过小规模、渐进式改造，让熟悉的生活与新的公共空间相互连接。",
  "此次更新保留原有街道肌理，把居民经常反映的出行、休憩和照明问题放在前面。修补后的路面衔接了社区书屋与口袋公园，沿街增设的座椅为老人和带孩子的家庭提供了歇脚的地方。",
  "居民参与了方案讨论。从绿化品种到夜间照明，设计团队把意见逐项整理，再带着调整后的方案回到社区。改造完成后，临街店铺的招牌保留各自特色，整体尺度也更适合步行者观看。",
  "午后，社区书屋里传来翻书声。新的空间没有追求统一的装饰，而是尽量利用现有房屋，增加通风和采光。靠窗的阅读桌与门前树荫相连，让原本匆忙经过的人愿意多停留一会儿。",
  "街区更新也为小店留下了经营空间。原有的修理铺、杂货店和理发店继续营业，施工期间通过分段围挡保持通行。居民熟悉的日常服务与新增的便民设施共同构成街道的生活底色。",
  "傍晚，路灯依次亮起。社区工作人员说，后续维护将由街道、居民与沿街商户共同参与，定期检查无障碍通道和公共设施，让更新后的街区在日常使用中持续完善。",
];
const initialPages = [
  `<p>【隔离演示正文】以下内容仅用于文章编辑与分页设计调研。</p><h2>把日常生活放在更新之前</h2><p>${paragraphs[0]}</p><p>${paragraphs[1]}</p>`,
  `<h2>让街坊一起参与</h2><p>${paragraphs[2]}</p><p>${paragraphs[3]}</p>`,
  `<h2>保留烟火气，延续街区记忆</h2><p>${paragraphs[4]}</p><p>${paragraphs[5]}</p>`,
];
const rows = titles.map((title, i) => ({
  id: 8101 + i,
  title: `【演示】${title}`,
  className: ["社会", "文化", "生活"][i % 3],
  writer: "演示编辑",
  time: `2026-11-06 09:${String(42 - i * 2).padStart(2, "0")}`,
  pages: 3,
  distribution:
    i % 4 === 0
      ? ["头条推荐", "演示渠道 / 头条推荐", "演示渠道 / 轮播推荐"]
      : [],
  images: [true, !!(i % 3), !!(i % 2)],
  tags: ["城市更新", "公共空间"],
  nTags: ["民生"],
}));
const viewNames = {
  quality: "优质文章",
  "review-1": "一级待审核文章",
  "review-2": "二级待审核文章",
  "review-3": "三级待审核文章",
};
let view = "quality",
  activeRow = rows[0],
  dirty = false,
  selected = 0,
  draft = null,
  assistantState = "current",
  generation = 0,
  generating = false,
  protectedMode = false,
  nestedMode = false,
  selectionRange = null,
  extraColumns = new Set(),
  filter = {};
const focusHistory = new Map();
const toastLog = [];
const writes = [];
window.__articleDesign = {
  get writes() {
    return writes;
  },
  get view() {
    return view;
  },
  get dirty() {
    return dirty;
  },
  get draft() {
    return !!draft;
  },
  get generating() {
    return generating;
  },
  get pages() {
    return readPages();
  },
  toastLog,
};
function notify(message) {
  toastLog.push(message);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 3000);
}
function openDialog(id) {
  const target = $(`#${id}`);
  if (target.open) return;
  focusHistory.set(
    id,
    document.activeElement?.closest("details")?.querySelector("summary") ||
      document.activeElement,
  );
  target.showModal();
  target.querySelector("h2")?.setAttribute("tabindex", "-1");
  target.querySelector("h2")?.focus({ preventScroll: true });
}
function closeDialog(id) {
  const target = $(`#${id}`);
  if (id === "editor" && dirty) {
    openDialog("leave");
    return;
  }
  if (id === "assistant") {
    generation++;
    generating = false;
    draft = null;
  }
  target.close();
  const previous = focusHistory.get(id);
  if (previous?.isConnected) previous.focus({ preventScroll: true });
}
function chars(html) {
  const dom = document.createElement("div");
  dom.innerHTML = html;
  return [...dom.textContent.replace(/\s/g, "")].length;
}
function plain(html) {
  const dom = document.createElement("div");
  dom.innerHTML = html;
  return dom.textContent;
}
function photo(empty = false, index = 1) {
  return empty
    ? `<span class="thumb empty" aria-label="第 ${index} 张图片未设置">未设置</span>`
    : `<button class="thumb" data-preview-image="${index}" aria-label="预览第 ${index} 张图片"><svg viewBox="0 0 560 248"><use href="#demo-photo"></use></svg></button>`;
}
function distribution(row) {
  return row.distribution.length
    ? `<span class="distributed" title="${esc(row.distribution.join("；"))}">已推荐 · 分发 ${Math.max(0, row.distribution.length - 1)} 处</span>`
    : '<span class="quiet">暂无分发记录</span>';
}
function titleCell(row) {
  const extra = [...extraColumns]
    .map(
      (field) =>
        ({
          tags: "标签：" + row.tags.join("、"),
          nTags: "扩展标签：" + row.nTags.join("、"),
          sourceUrl: `来源：https://demo.invalid/news/${row.id}`,
          comment: row.distribution.join("；") || "暂无分发记录",
        })[field],
    )
    .filter(Boolean)
    .map((value) => `<p class="prototype-extra">${esc(value)}</p>`)
    .join("");
  return `<a href="#" class="news-title" data-open-article="${row.id}" title="${esc(row.title)}">${esc(row.title)}</a><div class="news-meta"><a href="#" class="id" data-open-article="${row.id}" title="打开文章 ${row.id}">${row.id}</a><span>${row.className}</span><span>${row.writer}</span><span>${row.pages} 页</span><time datetime="${row.time.replace(" ", "T")}:00+08:00" title="${row.time}">${row.time.slice(5)}</time></div><div class="compact-distribution">${distribution(row)}</div>${extra}`;
}
function actions(row) {
  return `<div class="row-actions"><button data-edit="${row.id}">编辑</button>${view === "quality" ? `<button data-promote="${row.id}" title="添加到渠道素材">转素材</button>` : ""}<details class="row-menu"><summary aria-label="${esc(row.title)}，更多操作">${icon("more")}</summary><div class="menu"><button data-open-article="${row.id}">${view === "quality" ? "打开文章" : "打开预览"}</button><button data-open-source="${row.id}">打开来源</button><button data-detail="${row.id}">查看完整信息</button></div></details></div>`;
}
function renderList(force) {
  const found =
    force === "empty"
      ? []
      : rows.filter(
          (row) =>
            (!filter.title || row.title.includes(filter.title)) &&
            (!filter.className || row.className === filter.className) &&
            (!filter.id || row.id === filter.id) &&
            (!filter.author || row.writer.includes(filter.author)) &&
            (!filter.start || row.time.slice(0, 10) >= filter.start) &&
            (!filter.end || row.time.slice(0, 10) <= filter.end),
        );
  $("#article-rows").innerHTML = found
    .map(
      (row) =>
        `<tr data-id="${row.id}"><td>${titleCell(row)}</td><td class="pic-cell"><div class="thumbs">${row.images.map((shown, index) => photo(!shown, index + 1)).join("")}</div></td><td class="distribution-cell"><div class="distribution">${distribution(row)}${row.distribution.length ? `<p title="${esc(row.distribution.join("；"))}">${esc(row.distribution[1] || row.distribution[0])}</p>` : ""}</div></td><td class="action-cell">${actions(row)}</td></tr>`,
    )
    .join("");
  $("#article-cards").innerHTML = found
    .map(
      (row) =>
        `<article class="article-card" data-id="${row.id}" aria-label="${esc(row.title)}">${titleCell(row)}<div class="thumbs">${row.images.map((shown, index) => photo(!shown, index + 1)).join("")}</div><div class="card-bottom"><span class="distribution">${distribution(row)}</span>${actions(row)}</div></article>`,
    )
    .join("");
  $(".article-table").hidden = force === "error" || !found.length;
  $("#article-cards").hidden = force === "error" || !found.length;
  $("#list-empty").hidden = force === "error" || found.length > 0;
  $("#list-error").hidden = force !== "error";
  $("#result-total").textContent = found.length;
  $("#page-summary").textContent = `第 1 / 1 页 · 共 ${found.length} 条`;
  $("#filter-summary").textContent = Object.values(filter).some(Boolean)
    ? "已应用筛选"
    : "";
  icons();
}
function setView(next) {
  view = next;
  filter = {};
  $("#filters").reset();
  $("#page-title").textContent = viewNames[view];
  $("#breadcrumb-view").textContent = viewNames[view];
  $$("[data-view]").forEach((button) =>
    button.classList.toggle("selected", button.dataset.view === view),
  );
  $$(".author-filter").forEach(
    (node) => (node.hidden = view === "review-2" || view === "review-3"),
  );
  $$(".nubia-filter").forEach((node) => (node.hidden = view !== "quality"));
  renderList();
}
function setDirty() {
  dirty = true;
  $("#edit-status").textContent = "有未保存的修改";
  $("#save-feedback").textContent = "修改保留在当前编辑中";
}
function pageRule(index) {
  return `<div class="page-rule" contenteditable="false"><span>第 ${index} 页结束</span><button data-remove-page="${index - 1}" type="button">删除分页</button></div>`;
}
function writePages(pages) {
  $("#article-body").innerHTML = pages
    .map(
      (html, index) =>
        html + (index < pages.length - 1 ? pageRule(index + 1) : ""),
    )
    .join("");
  updateCount();
}
function readPages() {
  const pages = [""];
  [...$("#article-body").children].forEach((node) => {
    if (node.classList.contains("page-rule")) pages.push("");
    else pages[pages.length - 1] += node.outerHTML;
  });
  return pages;
}
function updateCount() {
  const pages = readPages();
  $("#body-count").textContent =
    `${pages.reduce((sum, html) => sum + chars(html), 0)} 字 · ${pages.length} 页`;
}
function imageFields() {
  $("#edit-images").innerHTML = activeRow.images
    .map(
      (shown, index) =>
        `<div class="edit-image">${photo(!shown, index + 1)}<div>${index ? `第${index === 1 ? "二" : "三"}张图` : '主图 <span class="required">*</span>'}<small>${shown ? "560 × 248 px" : "尚未设置"}</small></div><button data-upload="${index + 1}" type="button">${shown ? "更换" : "上传"}</button><input aria-label="${index ? `第${index + 1}张图片地址` : "主图地址"}" placeholder="粘贴图片地址" value="${shown ? "https://demo.invalid/city.svg" : ""}"></div>`,
    )
    .join("");
}
function openEditor(row = rows[0], mode = "normal") {
  activeRow = row;
  dirty = false;
  protectedMode = mode === "protected" || row.id === 8109;
  nestedMode = mode === "nested" || row.id === 8110;
  $("#editor").classList.remove("tab-info", "info-hidden");
  $("#edit-id").textContent = `· ${row.id}`;
  $("#edit-title").value = row.title;
  $("#edit-class").value = row.className;
  $("#edit-source").value = `https://demo.invalid/news/${row.id}`;
  $("#edit-status").textContent = "当前编辑中的内容，保存后写入 CMS";
  $("#save-feedback").textContent = "仅修改当前文章，保存不执行审核或发布";
  $("#body-protection").hidden = !protectedMode;
  $("#article-body").contentEditable = String(!protectedMode);
  $("#open-assistant").disabled = protectedMode;
  $("#body-upload").disabled = protectedMode;
  $("#article-body").innerHTML = "";
  writePages(
    protectedMode
      ? [
          "<h2>受保护的历史正文</h2><p>【演示】原始正文包含历史表格，保留原文，不进行重写。</p><p>文章信息仍可修改。</p>",
        ]
      : nestedMode
        ? [
            "<p>【演示】包含嵌套分页的历史正文</p><blockquote><p>原有引用中的分页需要先在 HTML 源码中调整。</p></blockquote>",
            "<p>保留当前正文与分页结构。</p>",
          ]
        : initialPages,
  );
  imageFields();
  openDialog("editor");
  $("#body-scroll").scrollTop = 0;
  selectEditTab("body");
  icons();
}
function selectEditTab(tab) {
  $("#editor").classList.toggle("tab-info", tab === "info");
  $$("[data-edit-tab]").forEach((button) =>
    button.classList.toggle("selected", button.dataset.editTab === tab),
  );
}
function openAssistant(mode = "current") {
  if (protectedMode) return;
  draft = null;
  selected = 0;
  assistantState = nestedMode ? "nested" : mode;
  generation++;
  generating = false;
  $("#assistant-title").textContent = activeRow.title;
  openDialog("assistant");
  if (mode === "draft") {
    draft = makeCandidate();
    assistantState = "draft";
  }
  renderAssistant();
}
function makeCandidate() {
  const container = document.createElement("div");
  container.innerHTML = readPages().join("");
  const groups = [];
  let html = "",
    count = 0;
  [...container.children].forEach((node, index, array) => {
    html += node.outerHTML;
    count += chars(node.outerHTML);
    const nextIsHeading = /^H[1-6]$/.test(array[index + 1]?.tagName || "");
    if (
      count >= 210 &&
      index < array.length - 1 &&
      (nextIsHeading || node.tagName === "P")
    ) {
      groups.push(html);
      html = "";
      count = 0;
    }
  });
  if (html) groups.push(html);
  return groups;
}
function renderAssistant() {
  const pages = draft || readPages(),
    total = pages.reduce((sum, html) => sum + chars(html), 0);
  selected = Math.min(selected, pages.length - 1);
  const html = pages[selected];
  $("#assistant-mode").textContent = draft ? "· 初稿预览" : "· 当前分页";
  $("#page-total").textContent = `${pages.length} 页`;
  $("#page-directory").innerHTML = pages
    .map(
      (html, index) =>
        `<button data-page="${index}" aria-current="${index === selected ? "page" : "false"}"><span>${String(index + 1).padStart(2, "0")}<small>${chars(html)} 字</small></span><span>${esc(plain(html).slice(0, 24))}</span></button>`,
    )
    .join("");
  $("#preview-label").textContent =
    `第 ${selected + 1} / ${pages.length} 页 · ${chars(html)} 字`;
  $("#page-preview").innerHTML =
    `<div class="proof-number">第 ${String(selected + 1).padStart(2, "0")} 页</div>${html}`;
  $("#prev-page").disabled = selected === 0;
  $("#next-page").disabled = selected === pages.length - 1;
  $("#locate-page").disabled = !!draft;
  $("#assistant-insert").disabled = !!draft || nestedMode || generating;
  $("#merge-page").disabled =
    selected === 0 || !!draft || nestedMode || generating;
  $("#remove-break").disabled =
    selected === pages.length - 1 || !!draft || nestedMode || generating;
  $("#apply-draft").hidden = !draft;
  $("#discard-draft").hidden = !draft;
  $("#generate-pages").disabled =
    generating || nestedMode || assistantState === "missing";
  $("#generate-pages").innerHTML =
    icon("book") + (generating ? "正在生成分页…" : "AI 生成分页");
  $("#cancel-generation").hidden = !generating;
  $("#apply-draft").disabled = generating;
  const notice = $("#assistant-notice");
  notice.className = "assistant-notice";
  if (assistantState === "missing") {
    notice.classList.add("warning");
    notice.innerHTML =
      '<span>尚未配置默认分页模板或绑定模型</span><button id="pagination-settings">配置分页模板</button>';
  } else if (nestedMode || assistantState === "nested") {
    notice.classList.add("warning");
    notice.innerHTML =
      "<span>存在嵌套分页，保留预览；请先在 HTML 源码中调整为顶层分页</span>";
  } else if (assistantState === "error") {
    notice.classList.add("error");
    notice.innerHTML =
      "<span>生成失败，当前正文和分页已保留；可手动重试</span>";
  } else if (draft) {
    notice.classList.add("draft");
    notice.innerHTML = `<span>演示初稿 · ${readPages().length} 页 → ${pages.length} 页</span><span>应用将替换全部现有分页，可一次撤销</span>`;
  } else {
    notice.innerHTML = `<span>共 ${pages.length} 页 · ${total} 字</span><span class="quiet">按页核对，应用初稿后仍需保存文章</span>`;
  }
  $("#assistant-footnote").textContent = draft
    ? "当前为隔离演示初稿，尚未应用到正文"
    : "关闭会丢弃未应用的初稿";
}
function generate() {
  if (generating) return;
  generating = true;
  const token = ++generation;
  renderAssistant();
  setTimeout(() => {
    if (token !== generation || !$("#assistant").open) return;
    generating = false;
    draft = makeCandidate();
    assistantState = "draft";
    selected = 0;
    renderAssistant();
  }, 700);
}
function insertBreak() {
  if (protectedMode || nestedMode) return;
  const body = $("#article-body");
  let block = selectionRange?.startContainer;
  while (block && block.parentNode !== body) block = block.parentNode;
  if (
    !block ||
    block === body ||
    !block.nextElementSibling ||
    block.classList?.contains("page-rule") ||
    block.nextElementSibling.classList.contains("page-rule")
  ) {
    notify("请先在正文中选择非末尾段落，再插入分页");
    return;
  }
  block.insertAdjacentHTML("afterend", pageRule(1));
  const pages = readPages();
  writePages(pages);
  setDirty();
  if ($("#assistant").open) renderAssistant();
}
function removeBreak(index) {
  const pages = readPages();
  if (index < 0 || index >= pages.length - 1) return;
  pages.splice(index, 2, pages[index] + pages[index + 1]);
  writePages(pages);
  setDirty();
  if ($("#assistant").open) renderAssistant();
}
function sourceHtml() {
  return readPages()
    .join("\n<p>[!--empirenews.page--]</p>\n")
    .replace(/<\/p>/g, "</p>\n")
    .replace(/<\/h2>/g, "</h2>\n");
}
function openSource() {
  const html = sourceHtml();
  $("#html-source").value = html;
  $("#html-source").readOnly = protectedMode;
  $("#source-count").textContent = `${[...html].length} 字符`;
  $("#source-description").textContent = protectedMode
    ? "正文处于保护模式，仅供查看和复制"
    : "应用到当前正文，保存文章后才写入 CMS";
  $("#apply-source").hidden = protectedMode;
  $("#source-error").hidden = true;
  openDialog("source");
}
function openPromote(row) {
  activeRow = row;
  $("#promote-title").value = row.title;
  $("#promote-article").textContent = `来自文章 ${row.id} · 优质文章`;
  $("#promote-feedback").textContent = "";
  $("#promote-images").innerHTML = [0, 1]
    .map(
      (index) =>
        `<div><label>${index ? "第二张图片" : '主图 <span class="required">*</span>'}</label>${photo(!row.images[index], index + 1)}<button type="button" data-upload="${index + 1}">更换图片</button><input aria-label="${index ? "第二张图片地址" : "素材主图地址"}" placeholder="粘贴图片地址" value="${row.images[index] ? "https://demo.invalid/city.svg" : ""}"></div>`,
    )
    .join("");
  openDialog("promote");
}
function restoreSelection() {
  if (selectionRange) {
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(selectionRange);
  }
}
document.addEventListener("selectionchange", () => {
  const selection = getSelection();
  if (selection.rangeCount && $("#article-body").contains(selection.anchorNode))
    selectionRange = selection.getRangeAt(0).cloneRange();
});
$("#filters").addEventListener("submit", (event) => {
  event.preventDefault();
  const start = $("#filter-start").value,
    end = $("#filter-end").value;
  if (start && end && start > end) {
    $("#filter-error").hidden = false;
    $("#filter-error").textContent = "开始日期不能晚于结束日期";
    return;
  }
  $("#filter-error").hidden = true;
  filter = {
    title: $("#filter-title").value.trim(),
    className: $("#filter-class").value,
    id: Number($("#filter-id").value) || null,
    author: $("#filter-author").value.trim(),
    start,
    end,
  };
  renderList();
  $(".list-scroll").scrollTop = 0;
});
function resetFilter() {
  $("#filters").reset();
  filter = {};
  $("#filter-error").hidden = true;
  renderList();
}
$("#reset-filter").onclick = resetFilter;
$("#empty-reset").onclick = resetFilter;
$("#retry-list").onclick = () => renderList();
$("#refresh").onclick = () => {
  renderList();
  notify("演示记录已刷新，当前筛选保留");
};
$("#more-filter").onclick = () => {
  const node = $(".filter-extra");
  node.hidden = !node.hidden;
  $("#more-filter").setAttribute("aria-expanded", String(!node.hidden));
};
$("#toggle-nav").onclick = () => $(".app").classList.toggle("nav-collapsed");
document.addEventListener("click", (event) => {
  const button = event.target.closest("button,a");
  if (!button) return;
  const data = button.dataset;
  if (button.matches('a[href="#"]')) event.preventDefault();
  if (data.view) setView(data.view);
  if (data.nav) notify("本稿只展示文章管理，其他导航沿用现有应用");
  if (data.edit) openEditor(rows.find((row) => row.id === Number(data.edit)));
  if (data.promote)
    openPromote(rows.find((row) => row.id === Number(data.promote)));
  if (data.openArticle || data.openSource) {
    event.preventDefault();
    notify(
      `隔离演示：${data.openSource ? "来源链接" : "文章链接"}未在外部打开`,
    );
  }
  if (data.detail) {
    openEditor(rows.find((row) => row.id === Number(data.detail)));
    selectEditTab("info");
  }
  if (data.previewImage) {
    $("#image-heading").textContent = `文章配图 · 第 ${data.previewImage} 张`;
    openDialog("image-preview");
  }
  if (data.close) closeDialog(data.close);
  if (data.editTab) selectEditTab(data.editTab);
  if (data.page !== undefined) {
    selected = Number(data.page);
    renderAssistant();
    $(".preview-scroll").scrollTop = 0;
  }
  if (data.removePage !== undefined) removeBreak(Number(data.removePage));
  if (data.removeTag !== undefined) {
    button.parentElement.remove();
    setDirty();
  }
  if (data.upload) {
    $("#image-file").dataset.target = data.upload;
    $("#image-file").click();
  }
  if (data.tool) {
    button.closest("details")?.removeAttribute("open");
    if (data.tool === "source") openSource();
    if (data.tool === "link") $("#open-link").click();
    if (data.tool === "undo") $("#undo").click();
    if (data.tool === "redo") $("#redo").click();
  }
  if (data.format) {
    if (protectedMode) return;
    restoreSelection();
    $("#article-body").focus({ preventScroll: true });
    document.execCommand(data.format);
    setDirty();
    button.closest("details")?.removeAttribute("open");
  }
  if (button.id === "pagination-settings")
    notify("设计说明：转到现有默认分页模板设置，离开前先处理未保存文章");
});
$$("dialog").forEach((dialog) => {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog(dialog.id);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      if (dialog.id !== "editor") closeDialog(dialog.id);
    }
  });
});
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") return;
    const details = $$("details[open]").at(-1);
    if (details) {
      event.preventDefault();
      event.stopPropagation();
      details.open = false;
      details.querySelector("summary").focus({ preventScroll: true });
    }
  },
  true,
);
$("#edit-title").oninput = setDirty;
$$(".article-info input,.article-info textarea,.article-info select").forEach(
  (node) => node.addEventListener("input", setDirty),
);
$("#article-body").oninput = () => {
  setDirty();
  updateCount();
  if (draft) {
    draft = null;
    assistantState = "error";
  }
};
$("#toggle-info").onclick = () => {
  const hidden = $("#editor").classList.toggle("info-hidden");
  $("#toggle-info").setAttribute("aria-expanded", String(!hidden));
};
$("#add-tag").onsubmit = (event) => {
  event.preventDefault();
  const value = $("#edit-tags").value.trim();
  if (!value) return;
  $("#edit-tags-list").insertAdjacentHTML(
    "beforeend",
    `<span>${esc(value)}<button aria-label="移除标签 ${esc(value)}" data-remove-tag>×</button></span>`,
  );
  $("#edit-tags").value = "";
  setDirty();
};
$("#open-assistant").onclick = () => openAssistant();
$("#protected-source").onclick = openSource;
$("#open-source").onclick = openSource;
$("#generate-pages").onclick = generate;
$("#cancel-generation").onclick = () => {
  generation++;
  generating = false;
  renderAssistant();
};
$("#discard-draft").onclick = () => {
  draft = null;
  assistantState = "current";
  renderAssistant();
};
$("#apply-draft").onclick = () => {
  if (!draft) return;
  window.__articleDesign.undoPages = readPages();
  writePages(draft);
  draft = null;
  assistantState = "current";
  setDirty();
  renderAssistant();
  notify("分页已应用到当前编辑；仍需保存文章");
};
$("#prev-page").onclick = () => {
  selected--;
  renderAssistant();
  $(".preview-scroll").scrollTop = 0;
};
$("#next-page").onclick = () => {
  selected++;
  renderAssistant();
  $(".preview-scroll").scrollTop = 0;
};
$("#merge-page").onclick = () => {
  removeBreak(selected - 1);
  selected = Math.max(0, selected - 1);
  $(".page-more").open = false;
  renderAssistant();
};
$("#remove-break").onclick = () => {
  removeBreak(selected);
  $(".page-more").open = false;
};
$("#assistant-insert").onclick = insertBreak;
$("#manual-insert").onclick = insertBreak;
$("#locate-page").onclick = () => {
  const position = selected;
  closeDialog("assistant");
  const target = position
    ? $$("#article-body .page-rule")[position - 1]?.nextElementSibling
    : $("#article-body").firstElementChild;
  target?.scrollIntoView({ block: "start", behavior: "instant" });
  $("#article-body").focus({ preventScroll: true });
};
$("#html-source").oninput = () => {
  $("#source-error").hidden = true;
  $("#source-count").textContent =
    `${[...$("#html-source").value].length} 字符`;
};
$("#apply-source").onclick = () => {
  const value = $("#html-source").value;
  if (
    /<\s*(script|iframe|table|object|style|svg)\b/i.test(value) ||
    /\son\w+\s*=|javascript:|data:image|blob:/i.test(value)
  ) {
    $("#source-error").hidden = false;
    $("#source-error").textContent =
      "未应用修改：包含暂不支持的结构或临时图片地址，请调整后再应用";
    return;
  }
  writePages(value.split(/<p>\s*\[!--empirenews\.page--\]\s*<\/p>/i));
  setDirty();
  closeDialog("source");
  notify("源码已应用到当前正文，可一次撤销；仍需保存文章");
};
$("#open-link").onclick = () => {
  openDialog("link");
  $("#link-error").hidden = true;
};
$("#link-form").onsubmit = (event) => {
  event.preventDefault();
  try {
    const url = new URL($("#link-url").value);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error();
    restoreSelection();
    $("#article-body").focus({ preventScroll: true });
    if (selectionRange && !selectionRange.collapsed)
      document.execCommand("createLink", false, url.href);
    else
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${esc(url.href)}">${esc($("#link-text").value || url.href)}</a>`,
      );
    setDirty();
    closeDialog("link");
  } catch {
    $("#link-error").hidden = false;
    $("#link-error").textContent = "请输入有效的 HTTP 或 HTTPS 链接";
  }
};
$("#unlink").onclick = () => {
  restoreSelection();
  document.execCommand("unlink");
  setDirty();
  closeDialog("link");
};
$("#undo").onclick = () => {
  if (window.__articleDesign.undoPages) {
    const current = readPages();
    writePages(window.__articleDesign.undoPages);
    window.__articleDesign.redoPages = current;
    window.__articleDesign.undoPages = null;
    setDirty();
  } else {
    $("#article-body").focus({ preventScroll: true });
    document.execCommand("undo");
    updateCount();
  }
};
$("#redo").onclick = () => {
  if (window.__articleDesign.redoPages) {
    writePages(window.__articleDesign.redoPages);
    window.__articleDesign.redoPages = null;
    setDirty();
  } else document.execCommand("redo");
};
$("#block-style").onchange = () => {
  restoreSelection();
  $("#article-body").focus({ preventScroll: true });
  document.execCommand("formatBlock", false, $("#block-style").value);
  setDirty();
};
$("#body-upload").onclick = () => {
  $("#image-file").dataset.target = "body";
  $("#image-file").click();
};
$("#image-file").onchange = () => {
  if (!$("#image-file").files.length) return;
  notify("隔离演示：文件上传已拦截，保留当前图片和正文");
  $("#image-file").value = "";
};
$("#save-article").onclick = () => {
  if (!$("#edit-title").value.trim()) {
    $("#save-feedback").textContent = "标题必填";
    $("#save-feedback").className = "field-error";
    return;
  }
  writes.push({
    action: "cms_update_article",
    id: activeRow.id,
    blocked: true,
  });
  $("#save-feedback").className = "field-error";
  $("#save-feedback").textContent = "演示保存已拦截，输入与正文均已保留";
  dirty = true;
};
$("#promote-form").onsubmit = (event) => {
  event.preventDefault();
  writes.push({
    action: "cms_add_article_to_promote",
    id: activeRow.id,
    blocked: true,
  });
  $("#promote-feedback").textContent = "演示保存已拦截，表单保留";
  $("#promote-feedback").className = "field-error";
};
$("#promote-ai").onclick = () =>
  notify("隔离演示：未发起标题优化请求，保留当前标题");
$("#discard-edit").onclick = () => {
  dirty = false;
  closeDialog("leave");
  closeDialog("editor");
};
$("#keep-draft").onclick = () => {
  window.__articleDesign.savedDraft = {
    title: $("#edit-title").value,
    pages: readPages(),
  };
  dirty = false;
  closeDialog("leave");
  closeDialog("editor");
  notify("演示草稿留在当前页面内存");
};
const columnOptions = [
  ["title", "新闻内容", true],
  ["titlePic", "三张配图", true],
  ["comment", "分发记录", true],
  ["actions", "操作", true],
  ["tags", "标签", false],
  ["nTags", "扩展标签（NTags）", false],
  ["sourceUrl", "来源链接", false],
];
function columns() {
  $("#column-choices").innerHTML = columnOptions
    .map(
      ([id, label, enabled]) =>
        `<label><input type="checkbox" data-column="${id}" ${enabled || extraColumns.has(id) ? "checked" : ""} ${id === "title" || id === "actions" ? "disabled" : ""}>${label}</label>`,
    )
    .join("");
}
$("#column-settings").onclick = () => {
  columns();
  openDialog("columns");
};
$("#column-choices").onchange = (event) => {
  const input = event.target,
    id = input.dataset.column;
  if (id === "titlePic") {
    $$(".pic-cell").forEach((node) => (node.hidden = !input.checked));
    notify("设计预览已调整配图列显示");
    return;
  }
  if (input.checked) extraColumns.add(id);
  else extraColumns.delete(id);
  renderList();
};
$("#reset-columns").onclick = () => {
  extraColumns.clear();
  renderList();
  columns();
};
function scene(name) {
  $$("dialog[open]")
    .reverse()
    .forEach((dialog) => dialog.close());
  draft = null;
  dirty = false;
  generation++;
  generating = false;
  $("#scene").value = name;
  renderList(
    name === "empty" ? "empty" : name === "error" ? "error" : undefined,
  );
  if (["list", "empty", "error"].includes(name)) return;
  if (name === "promote") {
    openPromote(rows[0]);
    return;
  }
  openEditor(
    rows[0],
    name === "protected"
      ? "protected"
      : name === "nested"
        ? "nested"
        : "normal",
  );
  if (["pagination", "draft", "missing", "nested"].includes(name))
    openAssistant(name === "pagination" ? "current" : name);
  if (name === "source") openSource();
  if (name === "link") openDialog("link");
  if (name === "leave") {
    setDirty();
    openDialog("leave");
  }
}
$("#scene").onchange = () => scene($("#scene").value);
new ResizeObserver(() => {
  document.documentElement.dataset.workspaceLayout =
    $(".list-workspace").getBoundingClientRect().width < 640
      ? "cards"
      : "table";
}).observe($(".list-workspace"));
const params = new URLSearchParams(location.search);
if (params.get("capture") === "1") document.body.classList.add("capture");
icons();
setView("quality");
scene(params.get("scene") || "list");
