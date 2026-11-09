window.isTauri = true;
const entries = [
  ["城市更新，让老街区焕发新活力", "running", "formatting", null],
  [
    "公共图书馆延长开放时间",
    "waitingUser",
    null,
    "请在来源窗口完成网页验证，然后继续采集。",
  ],
  ["周末去哪里？秋日城市漫步指南", "queued", null, null],
  ["秋日田野里的丰收图景", "succeeded", null, null],
  ["青年创作者走进社区", "succeeded", null, null],
  [
    "社区食堂里的烟火气",
    "failed",
    null,
    "来源页面暂时无法读取，请打开原文检查后重试。",
  ],
  [
    "城市绿道串起家门口的风景",
    "submissionUnknown",
    null,
    "提交后未收到确认，请先到 CMS 核对，避免重复添加。",
  ],
  ["老厂房的新故事", "debugCompleted", null, null],
];
let jobs = entries.map(([title, status, stage, error], i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  url: `https://baijiahao.baidu.com/s?id=demo${i + 1}`,
  title: `【演示】${title}`,
  collectionDate: "2026-11-06",
  status,
  stage,
  warnings: [],
  error,
  sourceMode: "webview",
  sourceInteraction: status === "waitingUser" ? { kind: "verification" } : null,
  developerMode: status === "debugCompleted",
  attempts: 1,
  createdAt: `2026-11-06T01:${String(42 - i * 2).padStart(2, "0")}:00Z`,
  updatedAt: "2026-11-06T01:42:00Z",
  cmsArticleId: status === "succeeded" ? `demo-${i}` : null,
}));
window.__importQa = {
  calls: [],
  blocked: [],
  getJobs: () => jobs,
  setJobs: (next) => {
    jobs = next;
  },
};
let callback = 0;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
window.__TAURI_INTERNALS__ = {
  transformCallback() {
    return ++callback;
  },
  unregisterCallback() {},
  async invoke(command, args = {}) {
    window.__importQa.calls.push(command);
    if (command === "cms_restore_session")
      return {
        user: {
          userId: 99999,
          nickname: "隔离演示账号",
          roles: ["演示"],
          perms: [],
        },
        persistent: false,
      };
    if (command === "plugin:event|listen") return ++callback;
    if (command === "plugin:event|unlisten") return;
    if (command === "harvest_list_jobs")
      return {
        jobs: args.date === "2026-11-06" ? jobs : [],
        maintenanceWarning: null,
      };
    if (command === "list_articles") return [];
    if (command === "get_app_info")
      return { name: "PressDock", version: "0.1.0", platform: "隔离演示" };
    if (command === "health_check") return { ready: true };
    if (command === "harvest_load_settings")
      return {
        sourceMode: "webview",
        cdpBrowser: "chrome",
        cdpAddress: null,
        developerMode: false,
        autoClassify: false,
        autoTags: false,
        autoSummary: false,
        aiAutoPaginate: false,
        modelConfigId: null,
        retentionDays: 30,
      };
    window.__importQa.blocked.push({ command, args });
    throw {
      code: "DESIGN_READ_ONLY",
      message: "设计调研演示：此操作未执行，不连接 CMS 或 AI",
    };
  },
};
await import("/src/main.tsx");
