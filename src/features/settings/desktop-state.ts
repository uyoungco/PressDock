import { createContext, useContext } from "react";

export const DesktopSettingsContext = createContext<{
  report: (key: string, dirty: boolean, busy: boolean) => void;
} | null>(null);
export const useDesktopSettings = () => useContext(DesktopSettingsContext);
