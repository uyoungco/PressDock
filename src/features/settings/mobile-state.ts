import { createContext, useContext, useEffect } from "react";

type Editor = { kind: "provider" | "model" | "template"; id: string };
export const MobileSettingsContext = createContext<{
  editor: Editor | null;
  providerId: string | null;
  purpose: "title" | "pagination";
  openEditor: (editor: Editor) => void;
  closeEditor: () => void;
  selectProvider: (id: string | null) => void;
  changePurpose: (purpose: "title" | "pagination") => void;
  report: (key: string, dirty: boolean, busy: boolean) => void;
} | null>(null);

export const useMobileSettings = () => useContext(MobileSettingsContext);

// 只向手机设置报告状态；表单及密钥始终留在原组件内存中。
export function useSettingsDraft(key: string, dirty: boolean, busy = false) {
  const report = useMobileSettings()?.report;
  useEffect(() => {
    report?.(key, dirty, busy);
    return () => report?.(key, false, false);
  }, [report, key, dirty, busy]);
}
