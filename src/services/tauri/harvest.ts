import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { invokeCommand } from "./client";
import {
  harvestSettingsSchema,
  harvestJobSchema,
  harvestListSchema,
  harvestActionSchema,
  harvestDebugSchema,
  type HarvestDebugEvent,
  type HarvestSettings,
  type HarvestAction,
} from "@/features/import/contracts";

export const harvestIpc = {
  setDeveloperMode: (enabled: boolean) =>
    invokeCommand("harvest_set_developer_mode", z.boolean(), {
      enabled: z.boolean().parse(enabled),
    }),
  openDevtools: () => invokeCommand("harvest_open_devtools", z.null()),
  settings: () => invokeCommand("harvest_load_settings", harvestSettingsSchema),
  saveSettings: (request: HarvestSettings) =>
    invokeCommand("harvest_save_settings", z.null(), {
      request: harvestSettingsSchema.parse(request),
    }),
  list: (date: string) =>
    invokeCommand("harvest_list_jobs", harvestListSchema, { date }),
  enqueue: (id: string, url: string) =>
    invokeCommand("harvest_enqueue", harvestJobSchema, {
      request: { id: z.uuid().parse(id), url },
    }),
  action: (id: string, action: HarvestAction) =>
    invokeCommand("harvest_job_action", z.null(), {
      id: z.uuid().parse(id),
      action: harvestActionSchema.parse(action),
    }),
  // 事件只通知重新读取；文章数据与状态以 Rust/SQLite 返回的校验结果为准。
  subscribe: (refresh: () => void) => listen("harvest-changed", refresh),
  subscribeDebug: (receive: (entry: HarvestDebugEvent) => void) =>
    listen<unknown>("harvest-debug", ({ payload }) => {
      const parsed = harvestDebugSchema.safeParse(payload);
      if (parsed.success) receive(parsed.data);
      else console.warn("采集调试事件格式无效，已忽略");
    }),
};
