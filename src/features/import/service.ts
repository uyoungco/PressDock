import { harvestIpc } from "@/services/tauri/harvest";
import { cmsIpc } from "@/services/tauri/cms";
import { importUrlSchema } from "@/types/article";
import { harvestSettingsService } from "./settings-service";

// 导入现在返回持久任务，不再把“入队成功”当作已经采到文章。
export const importService = {
  setDeveloperMode: harvestSettingsService.setDeveloperMode,
  openDevtools: harvestIpc.openDevtools,
  subscribeDebug: harvestIpc.subscribeDebug,
  enqueue: async (id: string, url: string) => {
    const source = importUrlSchema.parse(url.trim());
    return harvestSettingsService.withSavedSettings(() =>
      harvestIpc.enqueue(id, source),
    );
  },
  list: harvestIpc.list,
  subscribe: harvestIpc.subscribe,
  // 切换获取方式后立即重试也先补存，后端只刷新任务的获取配置。
  action: (id: string, action: Parameters<typeof harvestIpc.action>[1]) =>
    action === "retry"
      ? harvestSettingsService.withSavedSettings(() =>
          harvestIpc.action(id, action),
        )
      : harvestIpc.action(id, action),
  selectSourceTab: harvestIpc.selectSourceTab,
  settings: harvestSettingsService.load,
  settingsAutosave: harvestSettingsService,
  openSource: (url: string) => cmsIpc.openLink(importUrlSchema.parse(url)),
};
