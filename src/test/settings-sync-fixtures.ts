import type { SyncStatus } from "@/services/tauri/settings-sync";
export const readySyncStatus: SyncStatus = {
  ready: true,
  phase: "reported",
  usingCache: false,
  pending: 0,
  lastError: null,
  readRequests: 1,
  successfulReads: 1,
  writeRequests: 0,
};
