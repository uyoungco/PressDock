import { z } from "zod";
import { invokeCommand } from "./client";

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;
export const healthSchema = z.object({
  ready: z.boolean(),
  database: z.literal("ready"),
});
export type HealthStatus = z.infer<typeof healthSchema>;
export const systemService = {
  getAppInfo: (): Promise<AppInfo> =>
    invokeCommand("get_app_info", appInfoSchema),
  healthCheck: (): Promise<HealthStatus> =>
    invokeCommand("health_check", healthSchema),
};
