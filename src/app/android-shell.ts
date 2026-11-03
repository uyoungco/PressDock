import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isAndroid, homePath } from "@/lib/platform";

// 系统返回先关闭最上层浮层；根页面交回原生，将应用放到后台。
export function useAndroidShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAndroid()) return;
    document.documentElement.dataset.platform = "android";
    const back = (event: Event) => {
      const overlay = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"]',
      );
      if (overlay) {
        event.preventDefault();
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      } else if (pathname !== homePath() && pathname !== "/login") {
        event.preventDefault();
        void navigate(homePath());
      }
    };
    window.addEventListener("pressdock-back", back);
    return () => {
      window.removeEventListener("pressdock-back", back);
      delete document.documentElement.dataset.platform;
    };
  }, [pathname, navigate]);
}
