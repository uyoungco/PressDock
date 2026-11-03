use super::AiError;

pub(super) trait AiVault: Send + Sync {
    fn load(&self, reference: &str) -> Result<String, AiError>;
    fn save(&self, reference: &str, secret: &str) -> Result<(), AiError>;
    fn clear(&self, reference: &str) -> Result<(), AiError>;
}

pub(super) struct NativeAiVault;

fn failure() -> AiError {
    AiError::new(
        "AI_CREDENTIAL_STORE",
        "无法访问系统安全凭据库，请检查系统凭据服务后重试",
    )
}

#[cfg(not(target_os = "android"))]
impl NativeAiVault {
    fn entry(reference: &str) -> Result<keyring::Entry, AiError> {
        keyring::Entry::new("com.example.pressdock.ai", reference).map_err(|_| failure())
    }
}

#[cfg(not(target_os = "android"))]
impl AiVault for NativeAiVault {
    fn load(&self, reference: &str) -> Result<String, AiError> {
        Self::entry(reference)?
            .get_password()
            .map_err(|_| failure())
    }
    fn save(&self, reference: &str, secret: &str) -> Result<(), AiError> {
        Self::entry(reference)?
            .set_password(secret)
            .map_err(|_| failure())
    }
    fn clear(&self, reference: &str) -> Result<(), AiError> {
        match Self::entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(failure()),
        }
    }
}

#[cfg(target_os = "android")]
impl AiVault for NativeAiVault {
    fn load(&self, _: &str) -> Result<String, AiError> {
        Err(failure())
    }
    fn save(&self, _: &str, _: &str) -> Result<(), AiError> {
        Err(failure())
    }
    fn clear(&self, _: &str) -> Result<(), AiError> {
        Err(failure())
    }
}
