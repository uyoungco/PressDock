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
        // Radix 使用 data-state，Base UI 的选择器使用 data-open；两者都优先处理浮层。
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"], [role="dialog"][data-open], [role="listbox"][data-open], [role="menu"][data-open]',
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
        // 完整设置拥有分项、提供商和编辑层级，不再统一返回素材导入。
        if (pathname === "/settings")
          window.dispatchEvent(new Event("pressdock-settings-back"));
        else void navigate(homePath());
      }
    };
    window.addEventListener("pressdock-back", back);
    return () => {
      window.removeEventListener("pressdock-back", back);
      delete document.documentElement.dataset.platform;
    };
  }, [pathname, navigate]);
}
