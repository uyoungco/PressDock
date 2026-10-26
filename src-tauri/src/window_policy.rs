use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, WebviewWindow};

// 页面菜单跟随当前全局设置；任务是否提交仍使用各自入队快照，不能混用。
pub(crate) struct WindowPolicy(pub AtomicBool);
const SCRIPT: &str = r#"(() => {
  let enabled = __PRESSDOCK_MENU_ENABLED__;
  const channel = 'pressdock-context-menu';
  const notify = (target) => target.postMessage({channel, enabled}, '*');
  const update = (value) => {
    enabled = value;
    for (let i = 0; i < window.frames.length; i++) notify(window.frames[i]);
  };
  Object.defineProperty(window, '__pressdockSetContextMenu', {value: update});
  window.addEventListener('contextmenu', (event) => {
    if (!enabled) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, {capture: true});
  // 只同步无业务权限的菜单布尔值，跨域 iframe 不获得 invoke 或任何认证信息。
  window.addEventListener('message', (event) => {
    if (event.data?.channel !== channel) return;
    if (window !== window.parent && event.source === window.parent && typeof event.data.enabled === 'boolean') {
      update(event.data.enabled);
    } else if (event.data.ready === true) {
      for (let i = 0; i < window.frames.length; i++) {
        if (event.source === window.frames[i]) notify(event.source);
      }
    }
  });
  if (window !== window.parent) window.parent.postMessage({channel, ready: true}, '*');
})()"#;

pub(crate) fn script(enabled: bool) -> String {
    SCRIPT.replace(
        "__PRESSDOCK_MENU_ENABLED__",
        if enabled { "true" } else { "false" },
    )
}
pub(crate) fn enabled(app: &AppHandle) -> bool {
    app.state::<WindowPolicy>().0.load(Ordering::SeqCst)
}
pub(crate) fn apply(window: &WebviewWindow) {
    // 初始化脚本在每个文档安装一次；导航及保存设置时只更新闭包中的开关。
    let _ = window.eval(format!(
        "window.__pressdockSetContextMenu?.({})",
        enabled(window.app_handle())
    ));
}
pub(crate) fn sync(app: &AppHandle, enabled: bool) {
    app.state::<WindowPolicy>()
        .0
        .store(enabled, Ordering::SeqCst);
    for window in app.webview_windows().values() {
        apply(window);
    }
}
