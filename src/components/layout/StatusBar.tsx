import { isDesktop } from "@/services/tauri/client";
import { APP_VERSION } from "@/constants/app";
import { isDemo } from "@/lib/platform";
export function StatusBar() {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t bg-background px-4 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {isDemo()
          ? "演示工作区 · 本机 Mock 数据"
          : isDesktop()
            ? "本地工作区 · SQLite"
            : "浏览器演示 · 数据仅保存在本次会话"}
      </span>
      <span>
        <span className="hidden sm:inline">News Editorial Workspace</span>{" "}
        <span className="ml-4">v{APP_VERSION}</span>
      </span>
    </footer>
  );
}
