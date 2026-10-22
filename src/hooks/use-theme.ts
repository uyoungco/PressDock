import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { themeAtom } from "@/atoms/theme";

export function useTheme() {
  const theme = useAtomValue(themeAtom);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const resolved =
    theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  return resolved;
}
