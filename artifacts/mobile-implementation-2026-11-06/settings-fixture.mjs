window.isTauri = true;
const compatibility = {
  maxTokensField: "max_completion_tokens",
  systemRole: "system",
  sendStore: true,
};
const settings = {
  providers: [
    {
      id: "demo-local",
      displayName: "本机网关 · 演示",
      baseUrl: "http://127.0.0.1:11434/v1",
      protocol: "chatCompletions",
      compatibility,
      hasApiKey: false,
    },
    {
      id: "demo-editorial",
      displayName: "编辑部网关 · 演示",
      baseUrl: "https://gateway.demo.invalid/v1",
      protocol: "responses",
      compatibility,
      hasApiKey: true,
    },
  ],
  models: [
    {
      id: "demo-metadata",
      providerId: "demo-local",
      modelId: "demo-metadata-model",
      displayName: "元数据处理 · 演示",
      contextWindow: 32768,
      maxOutputTokens: 4096,
      reasoningEffort: null,
    },
    {
      id: "demo-page",
      providerId: "demo-editorial",
      modelId: "demo-pagination-model",
      displayName: "文章分页 · 演示",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEffort: "medium",
    },
  ],
  templates: [
    {
      id: "demo-title",
      purpose: "title",
      paginationOptions: null,
      name: "新闻标题优化 · 演示",
      systemPrompt: "保留新闻事实，使用准确简洁的中文标题。",
      userPrompt:
        "标题：{{title}}\n参考内容：{{content}}\n生成 {{count}} 个标题，每个不超过 {{max_length}} 字。\n补充要求：{{requirements}}",
      modelConfigId: "demo-metadata",
      candidateCount: 3,
      maxLength: 30,
      isDefault: true,
    },
    {
      id: "demo-pagination",
      purpose: "pagination",
      paginationOptions: { minChars: 100, targetChars: 240, maxChars: 400 },
      name: "常规文章分页 · 演示",
      systemPrompt:
        "判断相邻内容的语义绑定与自然边界。仅返回 bind_after、prefer_after 两个字符串数组。",
      userPrompt: "标题：{{title}}\n内容块：{{blocks}}",
      modelConfigId: "demo-page",
      candidateCount: 3,
      maxLength: 30,
      isDefault: true,
    },
  ],
};
let callback = 0;
window.__settingsQa = { calls: [], blocked: [], settings };
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
window.__TAURI_INTERNALS__ = {
  transformCallback() {
    return ++callback;
  },
  unregisterCallback() {},
  async invoke(command, args = {}) {
    window.__settingsQa.calls.push({ command, args });
    if (command === "cms_restore_session")
      return {
        user: {
          userId: 99999,
          nickname: "设置调研 · 隔离演示",
          roles: ["演示"],
          perms: [],
        },
        persistent: false,
      };
    if (command === "plugin:event|listen") return ++callback;
    if (command === "plugin:event|unlisten") return;
    if (command === "get_app_info")
      return {
        name: "PressDock",
        version: "0.1.0",
        platform:
          location.port === "18782"
            ? "Android 分支 · 隔离演示"
            : "Windows · 隔离演示",
      };
    if (command === "image_cancel") return null;
    if (command === "image_inspect") {
      const binary = atob(args.input.dataBase64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: args.input.mimeType }),
      );
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return {
        ...size,
        format: "png",
        byteSize: bytes.length,
        previewBase64: args.input.dataBase64,
      };
    }
    if (command === "health_check") return { ready: true, database: "ready" };
    if (command === "ai_load_settings") return structuredClone(settings);
    if (command === "harvest_load_settings")
      return {
        sourceMode: location.port === "18782" ? "webview" : "cdp",
        cdpBrowser: "chrome",
        cdpAddress: null,
        developerMode: false,
        autoClassify: true,
        autoTags: true,
        autoSummary: true,
        aiAutoPaginate: true,
        modelConfigId: "demo-metadata",
        retentionDays: 30,
      };
    if (command === "harvest_bridge_status")
      return { running: true, error: null };
    if (command === "cms_list_promote_channels")
      return [{ channel: "演示渠道", subchannels: ["头条推荐", "轮播小图"] }];
    if (command === "list_channel_image_presets")
      return [
        {
          channel: "演示渠道",
          subChannel: "头条推荐",
          titlePic: {
            size: { width: 560, height: 248 },
            maxBytes: 80896,
            format: "jpeg",
          },
          titlePic2: { size: { width: 280, height: 124 }, format: "jpeg" },
        },
      ];
    window.__settingsQa.blocked.push({ command });
    throw {
      code: "DESIGN_READ_ONLY",
      message: "隔离演示：写入、模型请求和外部操作已拦截，不连接 CMS 或 AI",
    };
  },
};
await import("/src/main.tsx");
