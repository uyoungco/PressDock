#[tokio::main]
async fn main() -> Result<(), &'static str> {
    let action = std::env::args()
        .nth(1)
        .ok_or("请指定 inspect 或 initialize")?;
    pressdock_lib::settings_sync::admin::run(&action).await
}
