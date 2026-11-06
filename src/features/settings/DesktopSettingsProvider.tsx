import { useCallback, useMemo, useState, type PropsWithChildren } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

import { DesktopSettingsContext } from "./desktop-state";
type DraftState = { dirty: boolean; busy: boolean };

export function DesktopSettingsProvider({ children }: PropsWithChildren) {
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const report = useCallback((key: string, dirty: boolean, busy: boolean) => {
    setDrafts((previous) =>
      previous[key]?.dirty === dirty && previous[key]?.busy === busy
        ? previous
        : { ...previous, [key]: { dirty, busy } },
    );
  }, []);
  const value = useMemo(() => ({ report }), [report]);
  const dirty = Object.values(drafts).some((draft) => draft.dirty);
  const busy = Object.values(drafts).some((draft) => draft.busy);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && (dirty || busy),
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty || busy) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty, busy],
    ),
  );
  return (
    <DesktopSettingsContext.Provider value={value}>
      {children}
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent className="settings-dialog">
          <DialogTitle>{busy ? "设置正在处理" : "离开系统设置？"}</DialogTitle>
          <DialogDescription>
            {busy
              ? "请等待当前操作完成后再离开。"
              : "尚有未保存的修改。离开后将丢弃这些输入。"}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              留在设置
            </Button>
            <Button disabled={busy} onClick={() => blocker.proceed?.()}>
              丢弃修改并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DesktopSettingsContext.Provider>
  );
}
