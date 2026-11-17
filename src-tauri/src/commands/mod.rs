mod ai;
mod articles;
mod channel_drafts;
#[cfg(not(feature = "android-demo"))]
mod cms;
#[cfg(feature = "android-demo")]
#[path = "demo_cms.rs"]
mod cms;
mod image_presets;
mod images;
mod photocraft;
mod settings_sync;
mod system;
pub use ai::*;
pub use articles::*;
pub use channel_drafts::*;
pub use cms::*;
pub use image_presets::*;
pub use images::*;
// 独立工具的 IPC 也从 commands 统一注册，保持构建清单与主窗口权限可核验。
pub use photocraft::*;
pub use settings_sync::*;
pub use system::*;

mod harvest;
pub use harvest::*;
