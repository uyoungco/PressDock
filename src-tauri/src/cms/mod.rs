//! 新闻后台的原生认证、凭据与只读素材接口。令牌不跨越 IPC 边界。
mod client;
mod credentials;
mod images;
mod models;
#[cfg(test)]
mod tests;

pub use client::{CmsError, CmsService};
pub use models::*;
