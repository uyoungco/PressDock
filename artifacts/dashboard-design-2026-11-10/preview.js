// 独立视觉原型。所有数据均为演示，不连接 CMS、IPC 或采集服务。
const records = [
  {
    title: "城市更新，让老街巷焕发新活力",
    source: "百家号",
    host: "baijiahao.baidu.com",
    status: "排队中",
    kind: "queued",
    time: "10:41",
  },
  {
    title:
      "公共图书馆延长开放时间，社区阅读空间持续提升公共服务质量，多项便民举措让阅读融入市民日常生活",
    source: "百家号",
    host: "baijiahao.baidu.com",
    status: "采集中",
    kind: "active",
    time: "10:40",
  },
  {
    title: "秋日田野里的丰收图景",
    source: "百家号",
    host: "baijiahao.baidu.com",
    status: "已添加到 CMS",
    kind: "success",
    time: "10:39",
  },
  {
    title: "青年创作者走进社区，记录街坊的日常生活",
    source: "百家号",
    host: "baijiahao.baidu.com",
    status: "等待网页验证",
    kind: "waiting",
    time: "10:38",
  },
  {
    title: "历史街区保护与城市记忆",
    source: "百家号",
    host: "baijiahao.baidu.com",
    status: "提交结果待确认",
    kind: "danger",
    time: "10:37",
    error: "提交后连接中断，请先在 CMS 核对结果",
  },
];
const rows = document.querySelector("#record-rows");
for (const record of records) {
  const row = document.createElement("article");
  row.className = "record";
  row.setAttribute("role", "row");
  const titleCell = document.createElement("div");
  titleCell.className = "title-cell";
  titleCell.setAttribute("role", "cell");
  const title = document.createElement("a");
  title.className = "record-title";
  title.href = "#";
  title.textContent = record.title;
  title.title = record.title;
  title.dataset.preview = "通过现有业务服务打开来源原文";
  titleCell.append(title);
  const source = document.createElement("div");
  source.className = "record-source";
  source.textContent = record.host;
  titleCell.append(source);
  const status = document.createElement("div");
  status.className = "status-cell";
  status.setAttribute("role", "cell");
  const statusText = document.createElement("span");
  statusText.className = "record-status";
  statusText.dataset.kind = record.kind;
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  statusText.append(dot, record.status);
  status.append(statusText);
  if (record.error) {
    const error = document.createElement("p");
    error.className = "record-error";
    error.textContent = record.error;
    error.title = record.error;
    status.append(error);
  }
  const time = document.createElement("time");
  time.className = "time-cell";
  time.setAttribute("role", "cell");
  time.dateTime = `2026-11-10T${record.time}:00+08:00`;
  const day = document.createElement("span");
  day.className = "time-date";
  day.textContent = "11/10";
  const clock = document.createElement("span");
  clock.className = "time-clock";
  clock.textContent = record.time;
  time.append(day, clock);
  row.append(titleCell, status, time);
  rows.append(row);
}
let toastTimer;
function notify(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = `设计预览：${message}`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-preview]");
  if (target) {
    event.preventDefault();
    notify(target.dataset.preview);
  }
  if (!event.target.closest(".column-control")) {
    document.querySelector("#column-menu").hidden = true;
    document.querySelector("#columns").setAttribute("aria-expanded", "false");
  }
});
document.querySelector("#theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  const url = new URL(location.href);
  url.searchParams.set("theme", root.dataset.theme);
  history.replaceState(null, "", url);
});
document
  .querySelector("#refresh")
  .addEventListener("click", () => notify("刷新采集和三级审核概览"));
document
  .querySelector(".plain-info")
  .addEventListener("click", (event) => notify(event.currentTarget.title));
document
  .querySelector(".sidebar-toggle")
  .addEventListener("click", () => notify("沿用现有侧栏展开与收起行为"));
document.querySelector("#columns").addEventListener("click", () => {
  const menu = document.querySelector("#column-menu");
  menu.hidden = !menu.hidden;
  document
    .querySelector("#columns")
    .setAttribute("aria-expanded", String(!menu.hidden));
});
for (const name of ["status", "time"]) {
  document
    .querySelector(`#show-${name}`)
    .addEventListener("change", (event) => {
      document
        .querySelector(".record-table")
        .classList.toggle(`hide-${name}`, !event.target.checked);
    });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelector("#column-menu").hidden = true;
    document.querySelector("#columns").setAttribute("aria-expanded", "false");
  }
});
document.documentElement.dataset.ready = "true";
