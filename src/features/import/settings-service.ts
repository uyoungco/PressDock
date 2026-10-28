import { harvestIpc } from "@/services/tauri/harvest";
import { onClientInvalidated, ServiceError } from "@/services/tauri/client";
import { harvestSettingsSchema, type HarvestSettings } from "./contracts";

type ProcessingSettings = Omit<HarvestSettings, "developerMode">;
type SettingsSnapshot = {
  form: HarvestSettings | null;
  days: string;
  retentionError: string | null;
  status: "idle" | "pending" | "saving" | "saved" | "error";
  error: string | null;
  modeSaving: boolean;
};
const emptySnapshot: SettingsSnapshot = {
  form: null,
  days: "",
  retentionError: null,
  status: "idle",
  error: null,
  modeSaving: false,
};
const keys = [
  "autoClassify",
  "autoTags",
  "autoSummary",
  "autoOrganize",
  "autoPaginate",
  "modelConfigId",
  "retentionDays",
] as const;
const same = (a: HarvestSettings | null, b: HarvestSettings | null) =>
  a !== null && b !== null && keys.every((key) => a[key] === b[key]);
const listeners = new Set<() => void>();
let snapshot = emptySnapshot;
let confirmed: HarvestSettings | null = null;
let writing: HarvestSettings | null = null;
let failure: Error | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let ready = false;
let saved = false;
let epoch = 0;
let tail = Promise.resolve();
let saveTask: Promise<void> | null = null;

function publish(patch: Partial<SettingsSnapshot> = {}) {
  snapshot = { ...snapshot, ...patch };
  snapshot.status = writing
    ? "saving"
    : failure
      ? "error"
      : snapshot.retentionError ||
          (snapshot.form && !same(snapshot.form, confirmed))
        ? "pending"
        : saved
          ? "saved"
          : "idle";
  snapshot.error = failure?.message ?? null;
  listeners.forEach((listener) => listener());
}
function clearTimer() {
  clearTimeout(timer);
  timer = undefined;
}
function ensureEpoch(generation: number) {
  if (generation !== epoch)
    throw new ServiceError("SESSION_CHANGED", "登录状态已变化，请重试");
}
// 两种设置写入共用队列；请求在真正执行前再次核对会话。
function serial<T>(work: () => Promise<T>) {
  const generation = epoch;
  const task = tail.then(async () => {
    ensureEpoch(generation);
    return work();
  });
  tail = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
function needsSave() {
  return (
    snapshot.form !== null &&
    !snapshot.retentionError &&
    !same(snapshot.form, confirmed)
  );
}
function saveReady(): Promise<void> {
  if (saveTask) return saveTask;
  const generation = epoch;
  const task = serial(async () => {
    while (ready && needsSave()) {
      ready = false;
      // 待保存快照里的模式可能过时，始终使用队列中已确认的最新模式。
      const request = harvestSettingsSchema.parse({
        ...snapshot.form,
        developerMode: confirmed!.developerMode,
      });
      writing = request;
      publish();
      try {
        await harvestIpc.saveSettings(request);
        ensureEpoch(generation);
        confirmed = request;
        saved = true;
      } catch (reason) {
        ensureEpoch(generation);
        failure =
          reason instanceof Error ? reason : new Error("采集设置保存失败");
        clearTimer();
        ready = false;
        throw failure;
      } finally {
        if (generation === epoch) {
          writing = null;
          publish();
        }
      }
    }
  });
  saveTask = task;
  const finish = () => {
    if (saveTask === task) saveTask = null;
  };
  void task.then(finish, finish);
  return task;
}
function schedule(patch: Partial<SettingsSnapshot>) {
  clearTimer();
  ready = false;
  failure = null;
  publish(patch);
  // 与正在写入的值比较，避免用户改回旧值时遗漏补存。
  if (
    !snapshot.retentionError &&
    snapshot.form &&
    !same(snapshot.form, writing ?? confirmed)
  ) {
    timer = setTimeout(() => {
      timer = undefined;
      ready = true;
      void saveReady().catch(() => undefined);
    }, 500);
  }
}
async function flush() {
  const generation = epoch;
  clearTimer();
  do {
    ensureEpoch(generation);
    if (failure) throw failure;
    ready = true;
    if (saveTask || needsSave()) await saveReady();
    await tail;
    ensureEpoch(generation);
    if (failure) throw failure;
  } while (needsSave());
}
async function withSavedSettings<T>(work: () => Promise<T>) {
  const generation = epoch;
  await flush();
  ensureEpoch(generation);
  return serial(work);
}

onClientInvalidated(() => {
  epoch += 1;
  clearTimer();
  ready = false;
  confirmed = null;
  writing = null;
  failure = null;
  saveTask = null;
  saved = false;
  snapshot = emptySnapshot;
  publish();
});

export const harvestSettingsService = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
  load() {
    const generation = epoch;
    return withSavedSettings(async () => {
      const next = await harvestIpc.settings();
      ensureEpoch(generation);
      const preserve =
        snapshot.retentionError ||
        (snapshot.form && !same(snapshot.form, confirmed));
      confirmed = next;
      publish(
        preserve
          ? {
              form: snapshot.form && {
                ...snapshot.form,
                developerMode: next.developerMode,
              },
            }
          : { form: next, days: next.retentionDays?.toString() ?? "" },
      );
      return next;
    });
  },
  update(patch: Partial<Omit<ProcessingSettings, "retentionDays">>) {
    if (snapshot.form) schedule({ form: { ...snapshot.form, ...patch } });
  },
  updateDays(days: string) {
    if (!snapshot.form) return;
    const retentionDays = days.trim() === "" ? null : Number(days);
    const valid =
      harvestSettingsSchema.shape.retentionDays.safeParse(retentionDays);
    schedule({
      days,
      retentionError: valid.success
        ? null
        : "请输入 1～36500 的整数，或留空永久保留。",
      form: valid.success ? { ...snapshot.form, retentionDays } : snapshot.form,
    });
  },
  async setDeveloperMode(enabled: boolean) {
    const generation = epoch;
    publish({ modeSaving: true });
    try {
      return await serial(async () => {
        const value = await harvestIpc.setDeveloperMode(enabled);
        ensureEpoch(generation);
        if (confirmed) confirmed = { ...confirmed, developerMode: value };
        publish({
          form: snapshot.form && { ...snapshot.form, developerMode: value },
        });
        return value;
      });
    } finally {
      if (generation === epoch) publish({ modeSaving: false });
    }
  },
  flush,
  withSavedSettings,
  retry() {
    failure = null;
    publish();
    return flush();
  },
};
