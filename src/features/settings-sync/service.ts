import {
  settingsSyncIpc,
  type SyncStatus,
} from "@/services/tauri/settings-sync";
import { onClientInvalidated } from "@/services/tauri/client";
import { harvestSettingsService } from "@/features/import/settings-service";
import { settingsActivity } from "./activity";
type State = {
  loading: boolean;
  status: SyncStatus | null;
  error: string | null;
  notice: string | null;
};
let state: State = { loading: true, status: null, error: null, notice: null };
let epoch = 0;
let operation = 0;
let starting: Promise<void> | null = null;
let manualTask: Promise<void> | null = null;
const listeners = new Set<() => void>();
function update(next: State) {
  state = next;
  listeners.forEach((l) => l());
}
onClientInvalidated(() => {
  epoch++;
  operation++;
  starting = null;
  manualTask = null;
  update({ loading: true, status: null, error: null, notice: null });
});
export const settingsSyncService = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  start(retry = false) {
    if (starting) return starting;
    if (manualTask) return manualTask;
    operation++;
    const generation = epoch;
    update({ ...state, loading: true, error: null, notice: null });
    const task = settingsSyncIpc
      .start(retry)
      .then((status) => {
        if (generation === epoch) {
          if (status.successfulReads > (state.status?.successfulReads ?? 0))
            settingsActivity.applied();
          update({ loading: false, status, error: null, notice: null });
        }
      })
      .catch((e: unknown) => {
        if (generation === epoch)
          update({
            ...state,
            loading: false,
            error: e instanceof Error ? e.message : "读取全局配置失败",
          });
      })
      .finally(() => {
        if (starting === task) starting = null;
      });
    starting = task;
    return task;
  },
  manual() {
    if (manualTask) return manualTask;
    if (starting) return starting;
    const status = state.status;
    if (
      !status?.ready ||
      ["demo", "restartRequired", "waitingAuth", "failedValidation"].includes(
        status.phase,
      )
    )
      return Promise.resolve();
    const activity = settingsActivity.getSnapshot();
    if (activity.dirty || activity.busy) {
      update({
        ...state,
        notice: null,
        error: activity.busy
          ? "设置正在处理，请等待完成后再同步"
          : "请先保存或取消编辑",
      });
      return Promise.resolve();
    }
    const generation = epoch;
    operation++;
    settingsActivity.lock(true);
    update({ ...state, error: null, notice: null });
    const task = (async () => {
      try {
        const autosave = harvestSettingsService.getSnapshot();
        if (autosave.retentionError)
          throw new Error("请先修正采集设置中的无效输入");
        if (autosave.modeSaving)
          throw new Error("采集设置正在保存，请等待完成后再同步");
        await harvestSettingsService.flush();
        if (generation !== epoch) return;
        const next = await settingsSyncIpc.manual();
        if (generation !== epoch) return;
        const applied = next.successfulReads > status.successfulReads;
        if (applied) settingsActivity.applied();
        update({
          ...state,
          status: next,
          error: applied ? null : syncMessage(next),
          notice: applied
            ? next.pending
              ? `已更新云端配置，仍有 ${next.pending} 项修改待上报`
              : "已同步最新配置"
            : null,
        });
      } catch (error: unknown) {
        if (generation === epoch)
          update({
            ...state,
            error:
              error instanceof Error ? error.message : "手动同步失败，请重试",
            notice: null,
          });
      } finally {
        if (generation === epoch) settingsActivity.lock(false);
      }
    })().finally(() => {
      if (manualTask === task) manualTask = null;
    });
    manualTask = task;
    return task;
  },
  async refresh() {
    if (starting || manualTask) return;
    const generation = epoch;
    const currentOperation = operation;
    try {
      const status = await settingsSyncIpc.status();
      if (
        generation === epoch &&
        currentOperation === operation &&
        !starting &&
        !manualTask
      )
        update({
          ...state,
          status,
          notice:
            status.pending || status.usingCache || status.lastError
              ? null
              : state.notice,
        });
    } catch {
      /* 会话错误由统一 IPC 层处理；保留最近的状态。 */
    }
  },
  wake: () => settingsSyncIpc.wake().catch(() => undefined),
  async resolve() {
    const generation = epoch;
    try {
      const status = await settingsSyncIpc.resolve();
      if (generation === epoch) update({ ...state, status, error: null });
      return generation === epoch;
    } catch (error: unknown) {
      if (generation === epoch)
        update({
          ...state,
          error:
            error instanceof Error
              ? error.message
              : "保留待传修改失败，请重试。",
        });
      return false;
    }
  },
};
export function syncMessage(status: SyncStatus | null) {
  if (!status) return "正在读取全局配置…";
  if (status.phase === "restartRequired")
    return "待传修改及密钥已保留为本机恢复副本。请完全退出 PressDock 后重新启动，采用云端配置。";
  if (status.phase === "demo") return "演示模式：配置保存在本机";
  if (status.phase === "protocolMismatch")
    return "配置同步协议不兼容，已暂停上报，本机修改仍保留。请确认 PressDock 与云端服务均已升级，再手动同步。";
  if (!status.ready) {
    if (status.lastError === "NOT_INITIALIZED")
      return "云端配置尚未初始化，请在指定电脑完成初始化后重试。";
    if (status.lastError === "UNSUPPORTED_VERSION")
      return "配置同步协议不兼容，请确认 PressDock 与云端服务均已升级；本机修改仍保留。";
    if (status.lastError === "SYNC_CREDENTIAL_STORE")
      return "系统安全凭据库不可用，请恢复凭据服务后重试。";
    if (status.lastError === "CMS_TIMEOUT")
      return "云端登录校验超时，请稍后重试读取配置。";
    if (status.lastError?.startsWith("CMS_"))
      return "云端暂时无法校验登录，请稍后重试读取配置。";
    return "首次读取全局配置失败，请检查网络后重试。";
  }
  if (status.phase === "waitingAuth" || status.lastError === "AUTH_EXPIRED")
    return "本机已保存，登录失效后已暂停上报，请重新登录。";
  if (status.phase === "failedValidation")
    if (status.lastError === "UNSUPPORTED_VERSION")
      return "旧版待传修改不能直接重放，已保留在本机。请使用恢复同步保留副本，再采用新版云端配置。";
  if (status.phase === "failedValidation")
    return "本机已保存，云端拒绝了修改，请检查配置引用或参数。";
  if (status.phase === "uploading")
    return `正在上报修改（${status.pending} 项）`;
  if (status.usingCache) {
    const pending = status.pending ? `，${status.pending} 项修改待上报` : "";
    if (status.lastError === "STALE_SNAPSHOT")
      return `云端返回了较旧配置，已保留本机配置，请稍后重试${pending}`;
    if (status.lastError === "SYNC_CREDENTIAL_STORE")
      return `系统安全凭据库不可用，已保留本机配置，请修复后重试${pending}`;
    if (status.lastError === "CMS_TIMEOUT")
      return `云端登录校验超时，正在使用上次缓存${pending}`;
    if (status.lastError?.startsWith("CMS_"))
      return `云端暂时无法校验登录，正在使用上次缓存${pending}`;
    return `正在使用上次缓存，本次未能读取最新配置${pending}`;
  }
  if (status.pending) return `本机已保存，${status.pending} 项修改待上报`;
  return "修改已上报，可手动同步其他设备的最新配置";
}
