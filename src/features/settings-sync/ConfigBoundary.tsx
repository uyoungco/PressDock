import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { settingsSyncService, syncMessage } from "./service";
import { useSettingsActivity } from "./activity";
export function ConfigBoundary({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    settingsSyncService.subscribe,
    settingsSyncService.getSnapshot,
  );
  const { synchronizing } = useSettingsActivity();
  useEffect(() => {
    void settingsSyncService.start();
    const timer = setInterval(() => void settingsSyncService.refresh(), 2000);
    const online = () => void settingsSyncService.wake();
    window.addEventListener("online", online);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, []);
  if (!state.status?.ready)
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md space-y-4 rounded-xl border bg-card p-7">
          <h1 className="text-xl font-semibold">
            {state.loading
              ? "正在读取全局配置"
              : state.status?.phase === "restartRequired"
                ? "待传修改已保留，请重新启动"
                : "全局配置暂时不可用"}
          </h1>
          <p
            role={state.loading ? "status" : "alert"}
            className="text-sm text-muted-foreground"
          >
            {state.error ?? syncMessage(state.status)}
          </p>
          {!state.loading && state.status?.phase !== "restartRequired" && (
            <Button onClick={() => void settingsSyncService.start(true)}>
              重试读取
            </Button>
          )}
          {!state.loading && <SyncDiagnostics status={state.status} />}
        </div>
      </div>
    );
  return (
    <>
      {(state.status.usingCache ||
        state.status.phase === "protocolMismatch") && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2 text-sm"
        >
          <span>
            {synchronizing
              ? "同步中…"
              : (state.error ?? syncMessage(state.status))}
          </span>
          <ManualSyncButton />
        </div>
      )}
      {children}
    </>
  );
}
export function ConfigSyncStatus() {
  const state = useSyncExternalStore(
    settingsSyncService.subscribe,
    settingsSyncService.getSnapshot,
  );
  const { synchronizing } = useSettingsActivity();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm"
      role="status"
    >
      <span>
        {synchronizing
          ? "同步中…"
          : (state.error ?? state.notice ?? syncMessage(state.status))}
      </span>
      <SyncDiagnostics status={state.status} />
      <ManualSyncButton />
      {state.status?.phase === "failedValidation" && (
        <RejectedChangesRecovery count={state.status.pending} />
      )}
      {!!state.status?.pending &&
        state.status.phase !== "failedValidation" &&
        state.status.phase !== "protocolMismatch" &&
        state.status.phase !== "waitingAuth" && (
          <Button
            size="sm"
            variant="outline"
            disabled={synchronizing}
            onClick={() => void settingsSyncService.wake()}
          >
            立即补传
          </Button>
        )}
    </div>
  );
}

function ManualSyncButton() {
  const state = useSyncExternalStore(
    settingsSyncService.subscribe,
    settingsSyncService.getSnapshot,
  );
  const { synchronizing } = useSettingsActivity();
  const disabled =
    synchronizing ||
    state.loading ||
    !state.status?.ready ||
    ["demo", "restartRequired", "waitingAuth", "failedValidation"].includes(
      state.status.phase,
    );
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={() => void settingsSyncService.manual()}
    >
      {synchronizing ? "同步中…" : "手动同步"}
    </Button>
  );
}

function RejectedChangesRecovery({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function resolve() {
    setPending(true);
    setError(null);
    const saved = await settingsSyncService.resolve();
    setPending(false);
    if (saved) setOpen(false);
    else setError("保留副本失败，原待传修改仍然保留，请重试。");
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          恢复同步
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>保留待传修改，重启后采用云端配置</DialogTitle>
          <DialogDescription>
            将保留全部 {count}{" "}
            项待传修改和对应密钥的本机恢复副本，并停止上报这些修改。请完全退出后重新启动，届时读取云端配置。云端已接受的修改会继续保留；原文、草稿和本机偏好也会保留。
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            继续保留待传
          </Button>
          <Button disabled={pending} onClick={() => void resolve()}>
            {pending ? "正在保留副本…" : "保留副本，重启后采用云端"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SyncDiagnostics({
  status,
}: {
  status: ReturnType<typeof settingsSyncService.getSnapshot>["status"];
}) {
  if (!status) return null;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">同步诊断</summary>
      <p className="mt-2" data-testid="settings-sync-diagnostics">
        读取 {status.readRequests} 次，成功 {status.successfulReads} 次；上报{" "}
        {status.writeRequests} 次，待传 {status.pending} 项。
        {status.lastError && ` 错误代码：${status.lastError}`}
      </p>
    </details>
  );
}
