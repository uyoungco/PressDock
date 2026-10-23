use std::path::PathBuf;

// 平台错误可能包含秘密字节，禁止将其打印或转换为诊断字符串。
pub(super) trait CredentialVault: Send + Sync {
    fn load(&self) -> Result<Option<String>, ()>;
    fn save(&self, secret: &str) -> Result<(), ()>;
    fn clear(&self) -> Result<(), ()>;
}

pub(super) struct NativeVault {
    pub disabled_path: PathBuf,
}

impl NativeVault {
    fn entry(&self) -> Result<keyring::Entry, ()> {
        keyring::Entry::new("com.example.pressdock.cms", "newsadmin.nccontrol.com.cn")
            .map_err(|_| ())
    }
}

impl CredentialVault for NativeVault {
    fn load(&self) -> Result<Option<String>, ()> {
        // 凭据库删除失败时，非秘密的禁用标记阻止下次恢复已退出的会话。
        if self.disabled_path.try_exists().map_err(|_| ())? {
            return Ok(None);
        }
        match self.entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(()),
        }
    }

    fn save(&self, secret: &str) -> Result<(), ()> {
        std::fs::write(&self.disabled_path, b"disabled").map_err(|_| ())?;
        self.entry()?.set_password(secret).map_err(|_| ())?;
        std::fs::remove_file(&self.disabled_path).map_err(|_| ())
    }

    fn clear(&self) -> Result<(), ()> {
        let disabled = std::fs::write(&self.disabled_path, b"disabled").is_ok();
        let deleted = self
            .entry()
            .and_then(|entry| match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(()),
            })
            .is_ok();
        if disabled || deleted { Ok(()) } else { Err(()) }
    }
}
