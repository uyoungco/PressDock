import { useEffect } from "react";
import { toast } from "sonner";
import { authService } from "@/features/auth/service";
import { isDesktop } from "@/services/tauri/client";
import { importService } from "./service";

export function useDeveloperTools() {
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    let consoleUser: number | null = null;
    function clearAccountLog() {
      if (consoleUser !== null) {
        console.clear();
        consoleUser = null;
      }
    }
    // Console 也包含正文；退出、失效或换号时清理，避免新账号读取旧调试历史。
    const stopAuth = authService.subscribe(() => {
      const auth = authService.getSnapshot();
      if (
        auth.status !== "authenticated" ||
        auth.session?.user.userId !== consoleUser
      )
        clearAccountLog();
    });
    // 绑定整个工作区而不是导入页；每次回调重新读取账号，避免异步卸载期间泄露旧账号日志。
    importService
      .subscribeDebug((entry) => {
        const auth = authService.getSnapshot();
        if (
          !active ||
          auth.status !== "authenticated" ||
          auth.session?.user.userId !== entry.userId
        )
          return;
        consoleUser = entry.userId;
        const title = `[采集调试] ${entry.jobId} · 第 ${entry.attempt} 次 · ${entry.step} · ${entry.kind} · ${entry.timestamp}`;
        // 失败默认展开，避免完整错误链藏在折叠组内；正常步骤继续折叠输出完整业务数据。
        if (entry.kind === "error") console.group(title);
        else console.groupCollapsed(title);
        try {
          if (entry.kind === "error") {
            console.error(entry.data);
            if (entry.diagnostic) {
              console.error(
                entry.diagnostic.operation,
                entry.diagnostic.context,
              );
              entry.diagnostic.causes.forEach((cause, index) =>
                console.error(`原因 ${index + 1}: ${cause}`),
              );
            }
          } else console.log(entry.data);
        } finally {
          console.groupEnd();
        }
      })
      .then((stop) => {
        if (!active) stop();
        else unlisten = stop;
      })
      .catch(() => {
        if (active) toast.error("采集调试日志监听不可用，重新进入工作区后重试");
      });
    function open(event: KeyboardEvent) {
      if (event.key !== "F12" || event.repeat || event.isComposing) return;
      event.preventDefault();
      // 是否允许打开以 Rust 的已保存设置为准，不依赖未保存表单或前端标志。
      void importService.openDevtools().catch((reason: unknown) => {
        if (active)
          toast.error(
            reason instanceof Error ? reason.message : "无法打开开发者工具",
          );
      });
    }
    window.addEventListener("keydown", open);
    return () => {
      active = false;
      stopAuth();
      clearAccountLog();
      unlisten?.();
      window.removeEventListener("keydown", open);
    };
  }, []);
}
