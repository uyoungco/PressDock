import {
  settingsSyncIpc,
  type SyncStatus,
} from "@/services/tauri/settings-sync";
import { onClientInvalidated } from "@/services/tauri/client";
type State = {
  loading: boolean;
  status: SyncStatus | null;
  error: string | null;
};
let state: State = { loading: true, status: null, error: null };
let epoch = 0;
let starting: Promise<void> | null = null;
const listeners = new Set<() => void>();
function update(next: State) {
  state = next;
  listeners.forEach((l) => l());
}
onClientInvalidated(() => {
  epoch++;
  starting = null;
  update({ loading: true, status: null, error: null });
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
    const generation = epoch;
    update({ ...state, loading: true, error: null });
    const task = settingsSyncIpc
      .start(retry)
      .then((status) => {
        if (generation === epoch)
          update({ loading: false, status, error: null });
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
  async refresh() {
    const generation = epoch;
    try {
      const status = await settingsSyncIpc.status();
      if (generation === epoch) update({ ...state, status });
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
  if (!status.ready) {
    if (status.lastError === "NOT_INITIALIZED")
      return "云端配置尚未初始化，请在指定电脑完成初始化后重试。";
    if (status.lastError === "UNSUPPORTED_VERSION")
      return "云端配置版本较新，请更新 PressDock 后重试。";
    if (status.lastError === "SYNC_CREDENTIAL_STORE")
      return "系统安全凭据库不可用，请恢复凭据服务后重试。";
    if (status.lastError === "CMS_TIMEOUT")
      return "云端登录校验超时，请稍后重试读取配置。";
    if (status.lastError?.startsWith("CMS_"))
      return "云端暂时无法校验登录，请稍后重试读取配置。";
    return "首次读取全局配置失败，请检查网络后重试。";
  }
  if (status.phase === "waitingAuth")
    return "本机已保存，登录失效后已暂停上报，请重新登录。";
  if (status.phase === "failedValidation")
    return "本机已保存，云端拒绝了修改，请检查配置引用或参数。";
  if (status.phase === "uploading")
    return `正在上报修改（${status.pending} 项）`;
  if (status.pending) return `本机已保存，${status.pending} 项修改待上报`;
  if (status.usingCache) {
    if (status.lastError === "CMS_TIMEOUT")
      return "云端登录校验超时，正在使用上次缓存";
    if (status.lastError?.startsWith("CMS_"))
      return "云端暂时无法校验登录，正在使用上次缓存";
    return "正在使用上次缓存，本次未能读取最新配置";
  }
  return "修改已上报；其他设备的修改在下次启动时读取";
}
