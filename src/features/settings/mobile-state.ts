import { createContext, useContext, useEffect, useRef } from "react";
import { settingsActivity } from "@/features/settings-sync/activity";
import { useDesktopSettings } from "./desktop-state";

type Editor = { kind: "provider" | "model" | "template"; id: string };
export const MobileSettingsContext = createContext<{
  editor: Editor | null;
  providerId: string | null;
  purpose: "title" | "pagination" | "bodyOrganization";
  openEditor: (editor: Editor) => void;
  closeEditor: () => void;
  selectProvider: (id: string | null) => void;
  changePurpose: (purpose: "title" | "pagination" | "bodyOrganization") => void;
  report: (key: string, dirty: boolean, busy: boolean) => void;
} | null>(null);

export const useMobileSettings = () => useContext(MobileSettingsContext);

// 汇总桌面、手机及全局同步保护状态；表单及密钥始终留在原组件内存中。
export function useSettingsDraft(key: string, dirty: boolean, busy = false) {
  const editor = useRef({});
  const desktop = useDesktopSettings();
  const report = useMobileSettings()?.report ?? desktop?.report;
  useEffect(() => {
    report?.(key, dirty, busy);
    return () => report?.(key, false, false);
  }, [report, key, dirty, busy]);
  useEffect(() => {
    const token = editor.current;
    settingsActivity.report(token, dirty, busy);
    return () => settingsActivity.remove(token);
  }, [dirty, busy]);
}
