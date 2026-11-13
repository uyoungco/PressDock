import { useSyncExternalStore } from "react";
import { onClientInvalidated, ServiceError } from "@/services/tauri/client";

type Activity = { dirty: boolean; busy: boolean };
const editors = new Map<object, Activity>();
const listeners = new Set<() => void>();
let state = { dirty: false, busy: false, synchronizing: false, revision: 0 };
function publish(patch: Partial<typeof state> = {}) {
  const next = {
    ...state,
    ...patch,
    dirty: [...editors.values()].some((editor) => editor.dirty),
    busy: [...editors.values()].some((editor) => editor.busy),
  };
  if (
    Object.keys(next).every(
      (key) =>
        next[key as keyof typeof next] === state[key as keyof typeof state],
    )
  )
    return;
  state = next;
  listeners.forEach((listener) => listener());
}
onClientInvalidated(() => {
  editors.clear();
  publish({ synchronizing: false });
});
export const settingsActivity = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  report(editor: object, dirty: boolean, busy: boolean) {
    editors.set(editor, { dirty, busy });
    publish();
  },
  remove(editor: object) {
    editors.delete(editor);
    publish();
  },
  lock(synchronizing: boolean) {
    publish({ synchronizing });
  },
  applied() {
    publish({ revision: state.revision + 1 });
  },
};
export const useSettingsActivity = () =>
  useSyncExternalStore(
    settingsActivity.subscribe,
    settingsActivity.getSnapshot,
  );

export function guardSettingsWrite<Args extends unknown[], Result>(
  write: (...args: Args) => Result,
) {
  return (...args: Args): Result => {
    if (state.synchronizing)
      throw new ServiceError(
        "SETTINGS_SYNC_BUSY",
        "配置正在同步，请等待完成后再修改",
      );
    return write(...args);
  };
}
