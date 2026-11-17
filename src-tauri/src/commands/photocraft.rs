use serde::Serialize;
#[cfg(desktop)]
use tauri::Manager;

#[derive(Serialize)]
pub struct Error {
    code: &'static str,
    message: &'static str,
}

impl From<tauri::Error> for Error {
    fn from(error: tauri::Error) -> Self {
        eprintln!("PhotoCraft: {error}");
        Self {
            code: "PHOTOCRAFT_OPEN_FAILED",
            message: "无法打开 PhotoCraft，请重试",
        }
    }
}

#[tauri::command]
pub async fn open_photocraft(window: tauri::WebviewWindow) -> Result<(), Error> {
    if window.label() != "main" {
        return Err(Error {
            code: "PHOTOCRAFT_PERMISSION_DENIED",
            message: "仅支持从主窗口打开 PhotoCraft",
        });
    }
    #[cfg(desktop)]
    {
        let app = window.app_handle().clone();
        let handle = app.clone();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        // 主线程串行检查并创建窗口，避免多个 IPC 同时打开重复实例。
        app.run_on_main_thread(move || {
            let _ = sender.send(crate::photocraft::open(&handle));
        })?;
        receiver
            .await
            .map_err(|_| Error {
                code: "PHOTOCRAFT_OPEN_FAILED",
                message: "PhotoCraft 窗口创建被中断，请重试",
            })?
            .map_err(Into::into)
    }
    #[cfg(mobile)]
    Err(Error {
        code: "PHOTOCRAFT_UNSUPPORTED",
        message: "PhotoCraft 独立窗口仅支持桌面端",
    })
}
