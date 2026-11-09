/* Design-only prototype. All settings, keys and mutations stay in memory. */
const $ = (s) => document.querySelector(s);
const esc = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const modules = [
  ["general", "常规设置"],
  ["harvest", "采集与 AI 处理"],
  ["image-presets", "图片预设"],
  ["services", "服务连接"],
  ["ai-models", "AI 模型"],
  ["ai-templates", "提示词模板"],
  ["about", "关于应用"],
];
let active = modules.some(([id]) => id === location.hash.slice(1))
  ? location.hash.slice(1)
  : "harvest";
let purpose = "title",
  selectedProvider = "demo-editorial",
  templateIds = { title: "title-standard", pagination: "page-standard" },
  theme = "light";
let errorMessage = "",
  autosaveTimer,
  toastTimer,
  dialogState = null,
  opener = null;
const dirty = new Set(),
  values = {
    source: "cdp",
    browser: "chrome",
    address: "",
    retention: "30",
    metadata: "meta",
    classify: true,
    tags: true,
    summary: true,
    paginate: true,
    developer: false,
    channel: "演示渠道",
    subchannel: "头条推荐",
  };
const providers = [
  {
    id: "demo-editorial",
    name: "编辑部网关 · 演示",
    url: "https://gateway.demo.invalid/v1",
    protocol: "responses",
    hasKey: true,
    tokens: "max_completion_tokens",
    role: "system",
    store: true,
  },
  {
    id: "demo-local",
    name: "本机网关 · 演示",
    url: "http://127.0.0.1:11434/v1",
    protocol: "chatCompletions",
    hasKey: false,
    tokens: "max_tokens",
    role: "system",
    store: true,
  },
];
const models = [
  {
    id: "page",
    provider: "demo-editorial",
    name: "文章分页 · 演示",
    model: "demo-pagination-model",
    context: 128000,
    output: 8192,
    effort: "medium",
  },
  {
    id: "meta",
    provider: "demo-local",
    name: "元数据处理 · 演示",
    model: "demo-metadata-model",
    context: 32768,
    output: 4096,
    effort: "",
  },
];
const templates = [
  {
    id: "title-standard",
    purpose: "title",
    name: "新闻标题优化 · 演示",
    model: "meta",
    count: 3,
    length: 30,
    isDefault: true,
    system:
      "保留新闻事实，使用准确简洁的中文标题。不夸大，不补充未经证实的信息。",
    user: "原标题：{{title}}\n参考内容：{{content}}\n\n生成 {{count}} 个候选标题，每个不超过 {{max_length}} 字。\n补充要求：{{requirements}}",
  },
  {
    id: "page-standard",
    purpose: "pagination",
    name: "常规文章分页 · 演示",
    model: "page",
    min: 100,
    target: 240,
    max: 400,
    isDefault: true,
    system:
      "判断相邻内容的语义绑定与自然边界。\n仅返回 bind_after、prefer_after 两个字符串数组。\n不重写正文，不改变图片顺序。",
    user: "文章标题：{{title}}\n编号内容块：{{blocks}}",
  },
];
let presets = {
  头条推荐: {
    width: 560,
    height: 248,
    bytes: 79,
    format: "jpeg",
    width2: 280,
    height2: 124,
    bytes2: "",
    format2: "jpeg",
  },
  轮播小图: {
    width: 280,
    height: 124,
    bytes: 60,
    format: "jpeg",
    width2: "",
    height2: "",
    bytes2: "",
    format2: "",
  },
};
const drafts = {};
let lastPrompt = "user",
  lastSelection = { start: null, end: null };
const btn = (text, action, cls = "", extra = "") =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
const field = (label, content, hint = "") =>
  `<div class="field">${content.includes('id="') ? `<label for="${content.match(/id="([^"]+)"/)[1]}">${label}</label>` : `<span class="field-label">${label}</span>`}${content}${hint ? `<small class="muted">${hint}</small>` : ""}</div>`;
const input = (key, val, extra = "") =>
  `<input id="f-${key}" data-store="${key}" value="${esc(val)}" ${extra}>`;
const select = (key, options, val, extra = "") =>
  `<select id="f-${key}" data-store="${key}" ${extra}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const modelOptions = () => [
  ["", "未绑定模型"],
  ...models.map((m) => [m.id, m.name]),
];
const toggle = (key, label) =>
  `<button type="button" class="switch" role="switch" aria-label="${label}" aria-checked="${!!values[key]}" data-action="toggle" data-key="${key}"></button>`;
const segment = (key, options, val) =>
  `<div class="segment" role="group" aria-label="${key === "source" ? "素材获取方式" : "连接的浏览器"}">${options.map(([v, l]) => btn(l, "segment", v === val ? "active" : "", `data-key="${key}" data-value="${v}" aria-pressed="${v === val}"`)).join("")}</div>`;
const statusStrip = (manual = false, label = "保存设置", action = "") =>
  `<div class="save-strip"><span id="save-status" role="status">${manual ? (dirty.has(active) ? "有未保存修改" : "当前为已保存的演示配置") : "修改后自动保存 · 仅演示"}</span>${manual ? btn(label, action, "primary") : "<span>新任务使用已保存的设置</span>"}</div>`;
function showToast(text) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function saveStatus(text, kind = "") {
  const n = $("#save-status");
  if (n) {
    n.textContent = text;
    n.className = kind;
  }
}
function queueAutosave() {
  saveStatus("待保存 · 仅演示");
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (
      values.retention !== "" &&
      (!Number.isInteger(+values.retention) ||
        +values.retention < 1 ||
        +values.retention > 36500)
    ) {
      saveStatus("保留天数须为 1–36500，或留空永久保留", "error-text");
      return;
    }
    saveStatus("演示设置已暂存 · 未写入应用", "saved");
  }, 500);
}
function renderTabs() {
  $(".tabs").innerHTML = modules
    .map(
      ([id, label]) =>
        `<button role="tab" id="tab-${id}" aria-controls="workspace" aria-selected="${active === id}" tabindex="${active === id ? 0 : -1}" data-action="tab" data-tab="${id}">${label}${dirty.has(id) ? " ·" : ""}</button>`,
    )
    .join("");
  $("#workspace").setAttribute("role", "tabpanel");
  $("#workspace").setAttribute("aria-labelledby", `tab-${active}`);
}
function harvest() {
  const pagination = templates.find(
      (t) => t.purpose === "pagination" && t.isDefault,
    ),
    model = models.find((m) => m.id === pagination?.model);
  return `<div class="section-head"><div><h2>采集与 AI 处理</h2><p class="muted">新任务采用入队时的设置，已排队任务保持原快照</p></div><span class="muted">修改后自动保存</span></div>
 <div class="harvest-grid"><div class="stack">
 <div class="panel"><div class="setting-row"><div><h3>油猴一键导入</h3><p><span class="dot"></span> 本机连接已就绪 · 演示状态</p></div>${btn("安装脚本", "install")}</div><div class="panel-body" style="padding-top:0"><details><summary>安装与使用说明</summary><p>安装脚本后，在百家号或 mbd.baidu.com 点击“导入 PressDock”。保持软件运行并登录，无需配对，结果在“素材导入”查看。</p></details></div></div>
 <div class="panel"><div class="panel-title"><h3>素材获取方式</h3></div><div class="panel-body source-body">${segment(
   "source",
   [
     ["webview", "内置 WebView"],
     ["cdp", "浏览器 CDP"],
   ],
   values.source,
 )}
 ${
   values.source === "cdp"
     ? `<div class="source-browser"><span class="field-label">连接的浏览器</span>${segment(
         "browser",
         [
           ["chrome", "Chrome"],
           ["edge", "Edge"],
         ],
         values.browser,
       )}</div>${field("数据目录或 CDP 地址", input("address", values.address, 'placeholder="留空自动发现已运行的浏览器"'))}<details><summary>如何开启浏览器连接？</summary><p>在 ${values.browser}://inspect/#remote-debugging 开启远程调试，保持浏览器打开并允许连接。支持数据目录、DevToolsActivePort、HTTP/HTTPS 及 WS/WSS 调试地址。</p><p>Chrome 需为 144 或更新版本；找不到选项时先检查浏览器更新。</p></details>`
     : `<p class="muted">在应用内打开来源页面，按需完成登录或验证</p>`
 }
 <p class="muted">手动重试采用最新获取配置，AI 规则和开发者模式沿用原快照</p></div></div>
 <div class="panel"><div class="setting-row"><div><h3>开发者模式</h3><p>仅影响之后新入队的任务</p></div>${toggle("developer", "开发者模式")}</div><div class="panel-body" style="padding-top:0"><p class="muted">${values.developer ? "已开启：新任务仅保留本地结果，不创建 CMS 文章。" : "开启后可按 F12 查看调试信息；仍调用 CMS 格式化，但不创建 CMS 文章。"}已有正常任务仍提交 CMS，关闭后不补交调试任务。</p></div></div>
 </div><div class="stack"><div class="panel"><div class="panel-title"><h3>AI 处理规则</h3><span class="muted">失败时保留原内容</span></div>
 ${[
   ["classify", "判断分类", "根据原文生成分类，校验后覆盖默认分类"],
   ["tags", "生成标签", "生成 3～5 个标签"],
   ["summary", "生成摘要", "生成不超过 130 字符的简介"],
   ["paginate", "自动分页", "与文章编辑器的分页助手共用配置"],
 ]
   .map(
     ([key, title, desc]) =>
       `<div class="setting-row"><div><h3>${title}</h3><p>${desc}</p></div>${toggle(key, title)}</div>`,
   )
   .join("")}
 <div class="binding"><span class="muted">默认分页模板 → 绑定模型 → 页长</span><strong>${esc(pagination?.name || "尚未设置默认分页模板")}</strong><span class="muted">${esc(model?.name || "未绑定模型")} · ${pagination ? `${pagination.min} / ${pagination.target} / ${pagination.max} 字` : "请先配置"}</span>${btn("配置分页模板 →", "pagination-link", "link")}</div></div>
 <div class="panel"><div class="panel-body stack">${field("元数据处理模型", select("metadata", [["", "未配置，保留后台结果"], ...models.map((m) => [m.id, m.name])], values.metadata))}
 <div class="inline-field"><label for="f-retention" class="field-label">历史保留</label><div style="width:120px">${input("retention", values.retention, 'inputmode="numeric" placeholder="永久"')}</div><span class="muted">天 · 留空永久保留</span></div><details><summary>模型用途与清理规则</summary><p>元数据模型用于分类、标签和摘要；自动分页使用模板绑定模型。所有 AI 项关闭时不发出 AI 请求。</p><p>保留时间包含启动当天。下次启动清理过期终态记录；未完成及提交结果待确认的任务保留，不删除 CMS 文章。</p></details></div></div>
 </div></div>${statusStrip()}`;
}
function aiModels() {
  const p = providers.find((p) => p.id === selectedProvider) || providers[0];
  if (p) selectedProvider = p.id;
  const rows = models.filter((m) => m.provider === p?.id);
  return `<div class="section-head"><div><h2>AI 模型</h2><p class="muted">提供商管理连接，模型供采集和提示词模板复用</p></div>${btn("新增提供商", "new-provider", "primary")}</div>
 ${errorMessage ? `<div class="error" role="alert">${esc(errorMessage)} ${btn("收起", "clear-error", "link")}</div>` : ""}
 <div class="provider-layout"><div class="panel"><div class="panel-title"><h3>提供商</h3><span class="muted">${providers.length}</span></div><div class="item-list">${providers.map((p) => btn(`${esc(p.name)}<small>${models.filter((m) => m.provider === p.id).length} 个模型 · ${p.hasKey ? "密钥已配置" : "本机免密"}</small>`, "provider", `list-item ${p.id === selectedProvider ? "active" : ""}`, `data-id="${p.id}"`)).join("") || '<p class="empty">尚未配置提供商</p>'}</div></div>
 <div class="stack">${
   p
     ? `<div class="panel"><div class="panel-title"><h3>${esc(p.name)}</h3><div class="actions">${btn("编辑连接", "edit-provider", "", `data-id="${p.id}"`)}${btn("删除", "delete-provider", "link danger", `data-id="${p.id}"`)}</div></div><div class="panel-body"><dl class="provider-summary"><dt>API 地址</dt><dd class="mono">${esc(p.url)}</dd><dt>协议</dt><dd>OpenAI ${p.protocol === "responses" ? "Responses" : "Chat Completions"}</dd><dt>API 密钥</dt><dd>${p.hasKey ? "已保存在系统凭据库，编辑时留空保留" : "未配置 · 本机免密服务可留空"}</dd></dl></div></div>
 <div class="panel"><div class="panel-title"><h3>模型目录 <span class="muted">${rows.length}</span></h3><div class="actions">${btn("获取可用模型", "catalog")}${btn("添加模型", "new-model")}</div></div><div class="table-head"><span>模型名称 / ID</span><span class="token-col">上下文</span><span class="token-col">输出上限</span><span style="text-align:right">操作</span></div>${rows.map((m) => `<div class="model-row"><div><strong>${esc(m.name)}</strong><small class="mono">${esc(m.model)}</small></div><span class="mono token-col">${m.context ? Number(m.context).toLocaleString("en-US") : "服务端默认"}</span><span class="mono token-col">${m.output ? Number(m.output).toLocaleString("en-US") : "服务端默认"}</span><div class="actions">${btn("编辑", "edit-model", "link", `data-id="${m.id}"`)}${btn("测试", "test-model", "link", `data-id="${m.id}"`)}${btn("删除", "delete-model", "link danger", `data-id="${m.id}"`)}</div></div>`).join("") || '<p class="empty">尚未添加模型，可手动填写或从目录选择</p>'}<div class="panel-body muted">目录仅返回模型 ID；上下文、输出上限和推理强度按服务商说明填写</div></div>`
     : '<div class="panel empty">新增提供商后可添加模型</div>'
 }</div></div>`;
}
function getTemplate() {
  return templates.find((t) => t.id === templateIds[purpose]);
}
function templateDraft() {
  const t = getTemplate();
  return t ? (drafts[t.id] ??= structuredClone(t)) : null;
}
function templatePage() {
  const list = templates.filter((t) => t.purpose === purpose),
    t = templateDraft(),
    vars =
      purpose === "title"
        ? ["title", "content", "count", "max_length", "requirements"]
        : ["title", "blocks"];
  return `<div class="section-head"><div><h2>提示词模板</h2><p class="muted">每类用途独立设置默认模板，生成时可临时切换模型</p></div><div class="actions"><div class="segment" role="group" aria-label="模板用途">${btn("标题优化", "purpose", purpose === "title" ? "active" : "", `data-purpose="title"`)}${btn("文章分页", "purpose", purpose === "pagination" ? "active" : "", `data-purpose="pagination"`)}</div>${btn("新增模板", "new-template", "primary")}</div></div>
 <div class="template-layout"><div class="panel"><div class="panel-title"><h3>${purpose === "title" ? "标题模板" : "分页模板"}</h3><span class="muted">${list.length}</span></div><div class="item-list">${list.map((item) => btn(`${esc(item.name)}<small>${item.isDefault ? "默认模板" : "备选模板"}${drafts[item.id] && JSON.stringify(drafts[item.id]) !== JSON.stringify(item) ? " · 未保存" : ""}</small>`, "template", `list-item ${t?.id === item.id ? "active" : ""}`, `data-id="${item.id}"`)).join("") || '<div class="empty">暂无模板</div>'}</div></div>
 ${
   t
     ? `<div class="panel template-editor"><div class="panel-title"><h3>编辑${purpose === "title" ? "标题" : "分页"}模板</h3><div class="actions">${btn("复制", "copy-template", "link")}${btn("删除", "delete-template", "link danger")}</div></div><div class="template-body"><div class="prompt-fields">${field("模板名称", input("template-name", t.name))}${field("系统指令", `<textarea id="template-system" data-prompt="system">${esc(t.system)}</textarea>`)}${field("用户提示词", `<textarea id="template-user" data-prompt="user">${esc(t.user)}</textarea>`)}</div><aside class="template-options">${field("绑定模型", select("template-model", modelOptions(), t.model))}
 <p class="muted" id="model-provider-hint">${esc(providers.find((p) => p.id === models.find((m) => m.id === t.model)?.provider)?.name || "请选择绑定模型")}</p>
 ${purpose === "title" ? `<div class="fields-two">${field("候选数量", input("template-count", t.count, 'type="number" min="1" max="10"'))}${field("最大字数", input("template-length", t.length, 'type="number" min="1" max="200"'))}</div>` : `<div class="field"><span class="field-label">每页字数（建议）</span><div class="fields-three">${field("最少", input("template-min", t.min, 'type="number" min="1" max="10000"'))}${field("目标", input("template-target", t.target, 'type="number" min="1" max="10000"'))}${field("最多", input("template-max", t.max, 'type="number" min="1" max="10000"'))}</div><small class="muted">最少 ≤ 目标 ≤ 最多</small></div>`}
 <div class="field"><span class="field-label">插入变量</span><div class="variable-chips">${vars.map((v) => btn(`{{${v}}}`, "variable", "", `data-var="${v}"`)).join("")}</div><p class="muted">插入当前光标位置</p><details><summary>变量说明</summary><p>${purpose === "title" ? "title：当前标题；content：正文或摘要；count：候选数量；max_length：最大字数；requirements：补充要求。" : "title：文章标题；blocks：编号内容块。页长以上方参数为准，不受提示词中的字数要求控制。"}</p></details></div><div class="notice">${purpose === "title" ? "候选标题需核对事实后使用" : "AI 判断语义关系，本地计算分页点；正文和图片不会由 AI 重写"}</div></aside></div><div id="template-error" class="error" role="alert" hidden></div><div class="editor-footer"><label class="check-label"><input type="checkbox" data-store="template-default" ${t.isDefault ? "checked" : ""}>设为默认模板</label><div class="actions"><span id="template-status" class="muted">${dirty.has(active) ? "有未保存修改" : "已保存的演示配置"}</span>${btn("保存模板", "save-template", "primary")}</div></div></div>`
     : '<div class="panel empty">选择模板编辑，或新增模板</div>'
 }</div>`;
}
function presetDraft() {
  const key = values.subchannel;
  return (drafts[`preset-${key}`] ??= structuredClone(presets[key]));
}
function presetPage() {
  const p = presetDraft();
  return `<div class="section-head"><div><h2>子渠道图片预设</h2><p class="muted">已填写的参数在图片处理中锁定；留空项可自由调整</p></div><span class="muted">保存后生效</span></div><div class="panel"><div class="panel-body preset-selector">${field("渠道", select("channel", [["演示渠道", "演示渠道"]], values.channel))}${field(
    "子渠道",
    select(
      "subchannel",
      [
        ["头条推荐", "头条推荐"],
        ["轮播小图", "轮播小图"],
      ],
      values.subchannel,
    ),
  )}</div></div><div class="copy-bar"><span class="field-label">复制来源</span>${select(
    "copy-source",
    [
      ["", "选择其他已保存预设"],
      ...Object.keys(presets)
        .filter((k) => k !== values.subchannel)
        .map((k) => [k, `演示渠道 / ${k}`]),
    ],
    values["copy-source"] || "",
  )}${btn("复制预设", "copy-preset")}<span class="muted">替换当前表单，保存后生效</span></div>
 <div class="preset-grid">${["", "2"]
   .map(
     (suffix, i) =>
       `<div class="panel"><div class="preset-summary"><div class="ratio-swatch" aria-hidden="true"></div><h3>${i ? "第二张图片" : "主图"}<small class="mono">${i ? "TitlePic2" : "TitlePic"}</small></h3></div><div class="panel-body stack"><div class="fields-two">${field("宽度", `<div class="input-unit">${input("preset-width" + suffix, p["width" + suffix], 'type="number" min="1" placeholder="不限制"')}<span>px</span></div>`)}${field("高度", `<div class="input-unit">${input("preset-height" + suffix, p["height" + suffix], 'type="number" min="1" placeholder="不限制"')}<span>px</span></div>`)}</div>${field("体积上限", `<div class="input-unit">${input("preset-bytes" + suffix, p["bytes" + suffix], 'type="number" min="0.001" step="any" placeholder="不限制"')}<span>KiB</span></div>`)}${field(
         "输出格式",
         select(
           "preset-format" + suffix,
           [
             ["", "不限制 · 默认源格式"],
             ["jpeg", "JPG / JPEG"],
             ["png", "PNG"],
             ["webp", "WebP"],
           ],
           p["format" + suffix],
         ),
       )}<p class="notice" id="lock-summary${suffix}">${lockSummary(p, suffix)}</p></div></div>`,
   )
   .join(
     "",
   )}</div><div id="preset-error" class="error" role="alert" hidden></div>${statusStrip(true, "保存图片预设", "save-preset")}`;
}
function lockSummary(p, s = "") {
  const locked = [],
    free = [];
  (p["width" + s] && p["height" + s] ? locked : free).push("尺寸");
  (p["bytes" + s] ? locked : free).push("体积");
  (p["format" + s] ? locked : free).push("格式");
  return `${locked.length ? `保存后锁定：${locked.join("、")}` : "未设置限制"}${free.length ? `<br>可自由调整：${free.join("、")}` : ""}`;
}
function services() {
  return `<div class="section-head"><div><h2>服务连接</h2><p class="muted">本地服务、CMS 会话与 AI 配置</p></div></div><div class="panel"><div class="service-row"><div><h3>本地服务</h3><p>Windows · 本机数据</p></div><span class="status"><span class="dot"></span>已就绪 · 演示</span><div><strong>后端与数据库已就绪</strong><p>SQLite 位于应用数据目录</p></div></div><div class="service-row"><div><h3>CMS 连接</h3><p>新闻管理后台</p></div><span class="status"><span class="dot"></span>演示会话</span><div><strong>隔离演示账号 · 演示角色</strong><p>会话仅本次运行有效，重启后需重新登录</p><p>账号和权限以当前登录会话为准</p></div></div><div class="service-row"><div><h3>AI 服务</h3><p>按任务调用</p></div><span class="status"><span class="dot off"></span>已配置</span><div><strong>${providers.length} 个提供商 · ${models.length} 个模型</strong><p>已配置不代表连接已测试；密钥由系统安全凭据库管理</p></div>${btn("管理 AI 模型 →", "models-link", "link")}</div></div><div class="notice">AI 的“已配置”仅表示存在连接配置，可在模型目录中执行测试。</div>`;
}
function general() {
  return `<div class="section-head"><div><h2>常规设置</h2><p class="muted">外观修改即时生效并自动保存</p></div></div><div class="panel"><div class="panel-title"><h3>界面主题</h3><span class="muted">当前：${{ light: "浅色", dark: "深色", system: "跟随系统" }[theme]}</span></div><div class="panel-body"><div class="theme-options">${[
    ["light", "浅色"],
    ["dark", "深色"],
    ["system", "跟随系统"],
  ]
    .map(([id, label]) =>
      btn(
        `<span class="theme-swatch ${id}"></span><span>${label}${theme === id ? " · 已选" : ""}</span>`,
        "theme",
        `theme-option ${theme === id ? "active" : ""}`,
        `data-theme="${id}" aria-pressed="${theme === id}"`,
      ),
    )
    .join(
      "",
    )}</div><p class="hint">设计稿仅临时切换预览主题，不修改应用设置</p></div></div>`;
}
function about() {
  return `<div class="section-head"><h2>关于应用</h2></div><div class="panel"><div class="panel-body about-body"><div><h2>PressDock <span class="muted">v0.1.0 · 演示版本</span></h2><p class="muted">News Editorial Workspace</p></div><div class="muted">本地优先 · 原文保留 · 模块化编辑流程<br>运行平台：Windows · 演示</div></div></div>`;
}
function render() {
  renderTabs();
  $("#workspace").innerHTML = {
    general,
    harvest,
    "image-presets": presetPage,
    services,
    "ai-models": aiModels,
    "ai-templates": templatePage,
    about,
  }[active]();
}
function go(tab) {
  active = tab;
  errorMessage = "";
  history.replaceState(null, "", `#${tab}`);
  render();
  $("#workspace").scrollTop = 0;
}
function markDirty() {
  dirty.add(active);
  renderTabs();
  saveStatus("有未保存修改");
  if ($("#template-status")) $("#template-status").textContent = "有未保存修改";
}
function captureTemplate() {
  const t = templateDraft();
  document.querySelectorAll('[data-store^="template-"]').forEach((n) => {
    let k = n.dataset.store.slice(9);
    if (k === "default") k = "isDefault";
    if (k === "name" || k === "model" || k === "isDefault")
      t[k] = n.type === "checkbox" ? n.checked : n.value;
    else t[k] = +n.value;
  });
  ["system", "user"].forEach((k) => {
    const n = $(`#template-${k}`);
    if (n) t[k] = n.value;
  });
  return t;
}
function openDialog(kind, data = {}, title = "") {
  opener = document.activeElement;
  dialogState = { kind, data: structuredClone(data), changed: false };
  $("#dialog-title").textContent = title;
  $("#dialog-hint").textContent = "";
  $("#dialog-error").hidden = true;
  $("#dialog-save").hidden = false;
  $("#dialog-save").textContent = "保存";
  $("#dialog-cancel").textContent = "取消";
  $("#dialog-close").hidden = false;
  renderDialog();
  $("#editor").showModal();
  const first = $(
    "#dialog-fields input:not([disabled]),#dialog-fields select,#dialog-fields button",
  );
  if (first) first.focus({ preventScroll: true });
}
function dInput(key, val, extra = "") {
  return `<input name="${key}" id="d-${key}" value="${esc(val ?? "")}" ${extra}>`;
}
function dSelect(key, opts, val) {
  return `<select name="${key}" id="d-${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}
function renderDialog() {
  const { kind, data: p } = dialogState;
  if (kind === "provider") {
    $("#dialog-title").textContent = p.existing ? "编辑提供商" : "新增提供商";
    $("#dialog-hint").textContent =
      "连接配置与模型目录分开管理，保存后可添加模型";
    $("#dialog-save").textContent = "保存提供商";
    $("#dialog-fields").innerHTML =
      `<div class="fields-two">${field("提供商标识", dInput("id", p.id, p.existing ? "disabled" : 'required pattern="[a-z][a-z0-9-]{0,63}"'), "小写字母开头；保存后不可修改")}${field("显示名称", dInput("name", p.name, 'required maxlength="100"'))}</div>${field("API 地址", dInput("url", p.url, 'required type="url" placeholder="https://gateway.example/v1"'), "HTTPS；本机服务允许 HTTP")}${field(
        "API 协议",
        dSelect(
          "protocol",
          [
            ["chatCompletions", "OpenAI Chat Completions"],
            ["responses", "OpenAI Responses"],
          ],
          p.protocol,
        ),
      )}${field("API 密钥", dInput("key", p.key || "", 'type="password" autocomplete="new-password" placeholder="' + (p.hasKey ? "已配置，留空保留原密钥" : "本机免密服务可留空") + '"'), "密钥由系统凭据库保存；本设计稿仅在弹框内存中暂存")}<details ${p.compatOpen ? "open" : ""}><summary>网关兼容设置</summary><div class="fields-two" id="chat-compat" ${p.protocol === "responses" ? "hidden" : ""}>${field(
        "输出 token 参数",
        dSelect(
          "tokens",
          [
            ["max_completion_tokens", "max_completion_tokens"],
            ["max_tokens", "max_tokens"],
          ],
          p.tokens,
        ),
      )}${field(
        "系统指令角色",
        dSelect(
          "role",
          [
            ["system", "system"],
            ["developer", "developer"],
          ],
          p.role,
        ),
      )}</div><label class="check-label"><input name="store" type="checkbox" ${p.store ? "checked" : ""}>发送 store: false</label><p class="muted">仅在服务商不接受该字段时关闭；关闭后由服务商决定响应保存策略</p></details>`;
  } else if (kind === "model") {
    $("#dialog-title").textContent = models.some((m) => m.id === p.id)
      ? "编辑模型"
      : "添加模型";
    $("#dialog-hint").textContent =
      `所属提供商：${providers.find((v) => v.id === p.provider)?.name || ""}`;
    $("#dialog-save").textContent = "保存模型";
    $("#dialog-fields").innerHTML =
      `${field("模型 ID", dInput("model", p.model, 'required maxlength="200"'))}${field("模型显示名称", dInput("name", p.name, 'required maxlength="100"'))}<div class="fields-two">${field("上下文窗口", dInput("context", p.context, 'type="number" min="1" max="4294967295" placeholder="可选"'), "token")}${field("最大输出", dInput("output", p.output, 'type="number" min="1" max="4294967295" placeholder="服务端默认"'), "token，不可超过上下文窗口")}</div>${field(
        "推理强度",
        dSelect(
          "effort",
          [
            ["", "不设置 · 使用模型默认"],
            ["low", "低"],
            ["medium", "中"],
            ["high", "高"],
          ],
          p.effort,
        ),
      )}<p class="notice">模型目录仅提供 ID，以上能力参数由你按服务商说明填写</p>`;
  } else if (kind === "delete") {
    $("#dialog-hint").textContent = "此操作需要确认";
    $("#dialog-save").textContent = "确认删除";
    $("#dialog-save").className = "danger";
    $("#dialog-fields").innerHTML =
      `<p>删除“${esc(p.name)}”？</p><p class="muted">${p.entity === "provider" ? "将同时删除所属模型及已保存密钥。被模板引用时，须先解除引用。" : p.entity === "model" ? "模型被模板引用时须先解除绑定；删除不影响历史文章。" : "删除后不影响已有文章；删除默认模板后，不会自动设置其他默认项。"}</p>`;
  } else if (kind === "catalog") {
    $("#dialog-hint").textContent = "以下为隔离演示目录，未向服务商发出请求";
    $("#dialog-save").hidden = true;
    $("#dialog-cancel").textContent = "关闭";
    $("#dialog-fields").innerHTML =
      ["demo-editor-model", "demo-general-model"]
        .map(
          (id) =>
            `<div class="setting-row"><code>${id}</code>${btn("添加", "catalog-add", "", `data-id="${id}"`)}</div>`,
        )
        .join("") +
      '<p class="muted">选择后填写显示名称与能力参数，再保存为模型配置</p>';
  } else if (kind === "discard") {
    $("#dialog-title").textContent = "放弃未保存的修改？";
    $("#dialog-hint").textContent = "关闭后，本次编辑内容将被丢弃";
    $("#dialog-save").textContent = "放弃修改";
    $("#dialog-cancel").textContent = "返回编辑";
    $("#dialog-fields").innerHTML = "<p>有未保存的修改，确定关闭？</p>";
  } else if (kind === "install") {
    $("#dialog-hint").textContent = "真实应用会在系统浏览器打开脚本安装页面";
    $("#dialog-save").hidden = true;
    $("#dialog-cancel").textContent = "知道了";
    $("#dialog-fields").innerHTML =
      '<p>安装油猴脚本后，保持 PressDock 运行并登录，在来源页点击“导入 PressDock”。</p><p class="notice">设计演示已拦截外部打开操作，不安装脚本、不发起采集</p>';
  }
  if (kind !== "delete") $("#dialog-save").className = "primary";
}
function dialogValues() {
  const data = { ...dialogState.data };
  new FormData($("#editor-form")).forEach((v, k) => (data[k] = String(v)));
  if (dialogState.kind === "provider")
    data.store = $("#editor-form [name=store]").checked;
  return data;
}
function closeDialog(force = false) {
  if (
    !force &&
    dialogState?.changed &&
    ["provider", "model"].includes(dialogState.kind)
  ) {
    dialogState = {
      kind: "discard",
      data: { previous: { ...dialogState, data: dialogValues() } },
      changed: false,
    };
    renderDialog();
    return;
  }
  $("#editor").close();
  dialogState = null;
  $("#dialog-fields").innerHTML = "";
  opener?.focus?.({ preventScroll: true });
}
function showError(text, id = "#dialog-error") {
  const n = $(id);
  n.textContent = text;
  n.hidden = false;
}
document.addEventListener("input", (e) => {
  const n = e.target;
  if (n.closest("#editor")) {
    dialogState.changed = true;
    if (n.name === "protocol")
      $("#chat-compat").hidden = n.value === "responses";
    return;
  }
  if (n.dataset.prompt) {
    lastPrompt = n.dataset.prompt;
    lastSelection = { start: n.selectionStart, end: n.selectionEnd };
    captureTemplate();
    markDirty();
    return;
  }
  if (!n.dataset.store) return;
  const k = n.dataset.store;
  if (k.startsWith("template-")) {
    const t = captureTemplate();
    markDirty();
    if (k === "template-model")
      $("#model-provider-hint").textContent =
        providers.find(
          (p) => p.id === models.find((m) => m.id === t.model)?.provider,
        )?.name || "请选择绑定模型";
  } else if (k.startsWith("preset-")) {
    presetDraft()[k.slice(7)] = n.value;
    markDirty();
    ["", "2"].forEach(
      (s) => ($("#lock-summary" + s).innerHTML = lockSummary(presetDraft(), s)),
    );
  } else {
    values[k] = n.value;
    if (active === "harvest") queueAutosave();
  }
});
document.addEventListener("change", (e) => {
  const k = e.target.dataset.store;
  if (k === "subchannel") {
    values.subchannel = e.target.value;
    values["copy-source"] = "";
    render();
  } else if (k === "copy-source") values[k] = e.target.value;
  else if (k === "template-default") {
    captureTemplate();
    markDirty();
  }
});
document.addEventListener("focusin", (e) => {
  if (e.target.dataset.prompt) lastPrompt = e.target.dataset.prompt;
});
document.addEventListener("selectionchange", () => {
  const n = document.activeElement;
  if (n?.dataset.prompt)
    lastSelection = { start: n.selectionStart, end: n.selectionEnd };
});
document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-action]");
  if (!n) return;
  const action = n.dataset.action,
    id = n.dataset.id;
  if (action === "tab") {
    go(n.dataset.tab);
    $(`#tab-${active}`).focus({ preventScroll: true });
  } else if (action === "toggle") {
    values[n.dataset.key] = !values[n.dataset.key];
    n.setAttribute("aria-checked", values[n.dataset.key]);
    if (n.dataset.key === "developer") {
      render();
      showToast("开发者模式演示状态已切换；已有任务不受影响");
    }
    queueAutosave();
  } else if (action === "segment") {
    values[n.dataset.key] = n.dataset.value;
    render();
    queueAutosave();
  } else if (action === "pagination-link") {
    purpose = "pagination";
    go("ai-templates");
  } else if (action === "models-link") go("ai-models");
  else if (action === "provider") {
    selectedProvider = id;
    errorMessage = "";
    render();
  } else if (action === "edit-provider" || action === "new-provider")
    openDialog(
      "provider",
      action === "edit-provider"
        ? { ...providers.find((p) => p.id === id), existing: true }
        : {
            id: "",
            name: "",
            url: "",
            protocol: "chatCompletions",
            tokens: "max_completion_tokens",
            role: "system",
            store: true,
          },
      action === "edit-provider" ? "编辑提供商" : "新增提供商",
    );
  else if (action === "edit-model" || action === "new-model")
    openDialog(
      "model",
      action === "edit-model"
        ? models.find((m) => m.id === id)
        : {
            id: crypto.randomUUID(),
            provider: selectedProvider,
            name: "",
            model: "",
            context: "",
            output: "",
            effort: "",
          },
      action === "edit-model" ? "编辑模型" : "添加模型",
    );
  else if (action === "test-model") {
    errorMessage =
      "隔离演示：未发出模型测试请求。真实测试结果应在此显示，并允许重试。";
    render();
  } else if (action === "clear-error") {
    errorMessage = "";
    render();
  } else if (action === "catalog") openDialog("catalog", {}, "获取可用模型");
  else if (action === "catalog-add") {
    closeDialog(true);
    openDialog(
      "model",
      {
        id: crypto.randomUUID(),
        provider: selectedProvider,
        name: id,
        model: id,
        context: "",
        output: "",
        effort: "",
      },
      "添加模型",
    );
  } else if (action === "delete-provider" || action === "delete-model") {
    const entity = action === "delete-provider" ? "provider" : "model",
      p = (entity === "provider" ? providers : models).find((v) => v.id === id);
    openDialog(
      "delete",
      { entity, id, name: p.name },
      `删除${entity === "provider" ? "提供商" : "模型"}？`,
    );
  } else if (action === "purpose") {
    purpose = n.dataset.purpose;
    render();
  } else if (action === "template") {
    templateIds[purpose] = id;
    render();
  } else if (action === "new-template") {
    const t = {
      id: crypto.randomUUID(),
      purpose,
      name: "未命名模板",
      model: "",
      isDefault: false,
      system: "",
      user:
        purpose === "title"
          ? "原标题：{{title}}\n参考内容：{{content}}"
          : "标题：{{title}}\n内容块：{{blocks}}",
      count: 3,
      length: 30,
      min: 100,
      target: 240,
      max: 400,
    };
    templates.push(t);
    templateIds[purpose] = t.id;
    markDirty();
    render();
  } else if (action === "copy-template") {
    const t = structuredClone(captureTemplate());
    t.id = crypto.randomUUID();
    t.name += "（副本）";
    t.isDefault = false;
    templates.push(t);
    templateIds[purpose] = t.id;
    markDirty();
    render();
  } else if (action === "delete-template") {
    const t = getTemplate();
    openDialog(
      "delete",
      { entity: "template", id: t.id, name: t.name },
      "删除提示词模板？",
    );
  } else if (action === "variable") {
    const node = $("#template-" + lastPrompt),
      v = "{{" + n.dataset.var + "}}",
      start = lastSelection.start ?? node.value.length,
      end = lastSelection.end ?? start;
    node.setRangeText(v, start, end, "end");
    captureTemplate();
    markDirty();
    node.focus({ preventScroll: true });
    lastSelection = { start: node.selectionStart, end: node.selectionEnd };
  } else if (action === "save-template") {
    const t = captureTemplate(),
      allowed =
        purpose === "title"
          ? ["title", "content", "count", "max_length", "requirements"]
          : ["title", "blocks"];
    if (!t.name.trim() || !t.user.trim())
      return showError("请填写模板名称和用户提示词", "#template-error");
    for (const text of [t.user, t.system]) {
      const matches = [...text.matchAll(/\{\{([\s\S]*?)\}\}/g)];
      if (
        [...text].length > 20000 ||
        matches.some((m) => !allowed.includes(m[1].trim())) ||
        text.replace(/\{\{([\s\S]*?)\}\}/g, "").includes("{{")
      )
        return showError(
          "存在未知、未闭合的变量，或提示词超过 20000 字符",
          "#template-error",
        );
    }
    if (
      purpose === "pagination" &&
      (![t.min, t.target, t.max].every(
        (v) => Number.isInteger(v) && v >= 1 && v <= 10000,
      ) ||
        t.min > t.target ||
        t.target > t.max)
    )
      return showError(
        "页长须满足：1 ≤ 最少字数 ≤ 目标字数 ≤ 最多字数 ≤ 10000",
        "#template-error",
      );
    if (
      purpose === "title" &&
      (!Number.isInteger(t.count) ||
        t.count < 1 ||
        t.count > 10 ||
        !Number.isInteger(t.length) ||
        t.length < 1 ||
        t.length > 200)
    )
      return showError(
        "候选数量为 1–10，标题最大字数为 1–200",
        "#template-error",
      );
    if (t.isDefault)
      templates
        .filter((v) => v.purpose === purpose)
        .forEach((v) => (v.isDefault = false));
    Object.assign(getTemplate(), t);
    delete drafts[t.id];
    dirty.delete(active);
    render();
    showToast("演示模板已暂存，未写入应用");
  } else if (action === "copy-preset") {
    const source = values["copy-source"];
    if (!source) return showToast("请先选择复制来源");
    drafts["preset-" + values.subchannel] = structuredClone(presets[source]);
    markDirty();
    render();
    showToast("已复制到演示表单，保存后生效");
  } else if (action === "save-preset") {
    const p = presetDraft();
    for (const s of ["", "2"]) {
      const w = p["width" + s],
        h = p["height" + s],
        b = p["bytes" + s];
      if (!!w !== !!h) return showError("宽、高必须成对填写", "#preset-error");
      if (
        w &&
        (!Number.isInteger(+w) ||
          !Number.isInteger(+h) ||
          +w < 1 ||
          +h < 1 ||
          +w > 16384 ||
          +h > 16384 ||
          +w * +h > 24000000)
      )
        return showError(
          "尺寸须为正整数，单边 ≤ 16384 px，总像素 ≤ 2400 万",
          "#preset-error",
        );
      if (b !== "" && (!Number.isFinite(+b) || +b <= 0 || +b > 20480))
        return showError("体积上限须大于零且不超过 20480 KiB", "#preset-error");
    }
    presets[values.subchannel] = structuredClone(p);
    dirty.delete(active);
    render();
    saveStatus("演示图片预设已暂存 · 未写入应用", "saved");
  } else if (action === "theme") {
    theme = n.dataset.theme;
    document.body.classList.toggle(
      "is-dark",
      theme === "dark" ||
        (theme === "system" &&
          matchMedia("(prefers-color-scheme:dark)").matches),
    );
    render();
    showToast("主题仅在设计稿中临时生效");
  } else if (action === "install") openDialog("install", {}, "安装油猴脚本");
});
$("#editor-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const { kind, data } = dialogState;
  if (kind === "discard") return closeDialog(true);
  if (kind === "delete") {
    const refs = templates.filter((t) =>
      kind && data.entity === "provider"
        ? models.some((m) => m.provider === data.id && m.id === t.model)
        : data.entity === "model" && t.model === data.id,
    );
    if (refs.length)
      return showError(
        `仍被“${refs.map((t) => t.name).join("、")}”引用，请先解除绑定`,
      );
    const list =
      data.entity === "provider"
        ? providers
        : data.entity === "model"
          ? models
          : templates;
    list.splice(
      list.findIndex((v) => v.id === data.id),
      1,
    );
    if (data.entity === "provider")
      for (let i = models.length - 1; i >= 0; i--)
        if (models[i].provider === data.id) models.splice(i, 1);
    if (data.entity === "template")
      templateIds[purpose] = templates.find((t) => t.purpose === purpose)?.id;
    closeDialog(true);
    render();
    showToast("仅从演示数据删除，真实配置未修改");
    return;
  }
  const v = dialogValues();
  if (kind === "provider") {
    let u;
    try {
      u = new URL(v.url);
    } catch {
      return showError("请输入有效的 API 地址");
    }
    if (
      (u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
        )) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return showError(
        "API 地址须为 HTTPS（本机允许 HTTP），不能包含认证信息、查询参数或片段",
      );
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(v.id) || !v.name.trim())
      return showError("请填写有效标识和显示名称");
    if (!data.existing && providers.some((p) => p.id === v.id))
      return showError("提供商标识已存在");
    const p = { ...v, hasKey: !!v.key || !!v.hasKey };
    delete p.key;
    delete p.existing;
    if (data.existing)
      Object.assign(
        providers.find((p) => p.id === data.id),
        p,
      );
    else providers.push(p);
    selectedProvider = p.id;
  } else if (kind === "model") {
    if (v.output && v.context && +v.output > +v.context)
      return showError("最大输出 token 数不能超过上下文窗口");
    const m = {
      ...v,
      context: v.context ? +v.context : null,
      output: v.output ? +v.output : null,
    };
    const existing = models.find((x) => x.id === m.id);
    if (existing) Object.assign(existing, m);
    else models.push(m);
  }
  closeDialog(true);
  render();
  showToast("演示配置已暂存，未写入应用");
});
$("#dialog-cancel").addEventListener("click", () => {
  if (dialogState?.kind === "discard") {
    dialogState = dialogState.data.previous;
    renderDialog();
  } else closeDialog();
});
$("#dialog-close").addEventListener("click", () => closeDialog());
$("#editor").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDialog();
});
$("#sidebar-toggle").addEventListener("click", () =>
  $(".shell").classList.toggle("collapsed"),
);
$(".tabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const i = modules.findIndex(([id]) => id === active),
    next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? modules.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + modules.length) %
            modules.length;
  go(modules[next][0]);
  $(`#tab-${active}`).focus({ preventScroll: true });
});
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (modules.some(([key]) => key === id)) {
    active = id;
    render();
  }
});
render();
