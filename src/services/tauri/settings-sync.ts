import { z } from "zod";
import { invokeCommand } from "./client";
export const syncStatusSchema = z.object({
  ready: z.boolean(),
  phase: z.enum([
    "idle",
    "blocked",
    "waitingAuth",
    "failedValidation",
    "uploading",
    "pending",
    "cache",
    "reported",
    "demo",
    "restartRequired",
  ]),
  usingCache: z.boolean(),
  pending: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  readRequests: z.number().int().nonnegative(),
  successfulReads: z.number().int().nonnegative(),
  writeRequests: z.number().int().nonnegative(),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export const settingsSyncIpc = {
  start: (retry = false) =>
    invokeCommand("settings_sync_start", syncStatusSchema, { retry }),
  status: () => invokeCommand("settings_sync_status", syncStatusSchema),
  wake: () => invokeCommand("settings_sync_wake", z.null()),
  resolve: () => invokeCommand("settings_sync_resolve", syncStatusSchema),
};
