import { harvestIpc } from "@/services/tauri/harvest";
import { cmsIpc } from "@/services/tauri/cms";
import { importUrlSchema } from "@/types/article";

// 导入现在返回持久任务，不再把“入队成功”当作已经采到文章。
export const importService = {
  setDeveloperMode: harvestIpc.setDeveloperMode,
  openDevtools: harvestIpc.openDevtools,
  subscribeDebug: harvestIpc.subscribeDebug,
  enqueue: (id: string, url: string) =>
    harvestIpc.enqueue(id, importUrlSchema.parse(url.trim())),
  list: harvestIpc.list,
  subscribe: harvestIpc.subscribe,
  action: harvestIpc.action,
  settings: harvestIpc.settings,
  saveSettings: harvestIpc.saveSettings,
  openSource: (url: string) => cmsIpc.openLink(importUrlSchema.parse(url)),
};
