//! Local image processing. Originals and encoded results never enter persistent storage.
mod codec;
#[cfg(test)]
mod tests;

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::Semaphore;

pub const MAX_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 24_000_000;
pub const MAX_SIDE: u32 = 16_384;
pub type Result<T> = std::result::Result<T, ImageError>;

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct ImageError {
    pub code: &'static str,
    pub message: String,
}
pub fn invalid(message: impl Into<String>) -> ImageError {
    ImageError {
        code: "IMAGE_INVALID",
        message: message.into(),
    }
}
pub fn cancelled() -> ImageError {
    ImageError {
        code: "IMAGE_CANCELLED",
        message: "图片处理已取消".into(),
    }
}
pub fn check(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(cancelled())
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Jpeg,
    Png,
    Webp,
}
impl Format {
    pub fn mime(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }
    pub fn image_format(self) -> image::ImageFormat {
        match self {
            Self::Jpeg => image::ImageFormat::Jpeg,
            Self::Png => image::ImageFormat::Png,
            Self::Webp => image::ImageFormat::WebP,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub data_base64: String,
    pub mime_type: String,
}
impl Input {
    pub fn bytes(&self) -> Result<Vec<u8>> {
        if self.data_base64.len() > 4 * MAX_BYTES.div_ceil(3) {
            return Err(invalid("请选择不超过 20 MiB 的图片"));
        }
        let bytes = STANDARD
            .decode(&self.data_base64)
            .map_err(|_| invalid("图片数据不完整"))?;
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return Err(invalid("请选择不超过 20 MiB 的图片"));
        }
        let format = codec::identify(&bytes)?;
        if !self.mime_type.is_empty() && self.mime_type != format.mime() {
            return Err(invalid("图片 MIME 与实际文件格式不一致"));
        }
        Ok(bytes)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}
impl Size {
    pub fn validate(self) -> Result<Self> {
        if self.width == 0
            || self.height == 0
            || self.width > MAX_SIDE
            || self.height > MAX_SIDE
            || u64::from(self.width) * u64::from(self.height) > MAX_PIXELS
        {
            return Err(invalid(
                "图片宽高需为正整数，单边不超过 16384 像素，总像素不超过 2400 万",
            ));
        }
        Ok(self)
    }
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Crop {
    pub fn pixels(self, size: Size) -> Result<(u32, u32, u32, u32)> {
        if ![self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.x + self.width > 1.000001
            || self.y + self.height > 1.000001
        {
            return Err(invalid("裁剪区域必须位于图片内且宽高大于零"));
        }
        let x = (self.x * f64::from(size.width)).round() as u32;
        let y = (self.y * f64::from(size.height)).round() as u32;
        let right = ((self.x + self.width) * f64::from(size.width)).round() as u32;
        let bottom = ((self.y + self.height) * f64::from(size.height)).round() as u32;
        let w = right.min(size.width).saturating_sub(x);
        let h = bottom.min(size.height).saturating_sub(y);
        if w == 0 || h == 0 {
            return Err(invalid("裁剪区域至少需要一个原图像素"));
        }
        Ok((x, y, w, h))
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessRequest {
    pub job_id: String,
    pub input: Input,
    pub crop: Crop,
    pub size: Option<Size>,
    pub format: Format,
    pub max_bytes: Option<usize>,
    pub quality: u8,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub width: u32,
    pub height: u32,
    pub format: Format,
    pub byte_size: usize,
    pub preview_base64: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub width: u32,
    pub height: u32,
    pub format: Format,
    pub mime_type: &'static str,
    pub byte_size: usize,
    pub data_base64: String,
    pub quality: Option<u8>,
    pub lossy: bool,
}

pub struct ImageJobs {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    permits: Arc<Semaphore>,
}
pub struct JobGuard {
    id: String,
    jobs: Arc<ImageJobs>,
    pub flag: Arc<AtomicBool>,
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        self.flag.store(true, Ordering::Relaxed);
        self.jobs
            .jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}
impl Default for ImageJobs {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            permits: Arc::new(Semaphore::new(1)),
        }
    }
}
impl ImageJobs {
    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.jobs.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    pub fn begin(self: &Arc<Self>, id: String) -> Result<JobGuard> {
        if uuid::Uuid::parse_str(&id).is_err() {
            return Err(invalid("图片任务标识无效"));
        }
        let flag = Arc::new(AtomicBool::new(false));
        {
            let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
            if jobs.contains_key(&id) || jobs.len() >= 8 {
                return Err(invalid("图片任务繁忙，请稍后重试"));
            }
            jobs.insert(id.clone(), flag.clone());
        }
        Ok(JobGuard {
            id,
            jobs: self.clone(),
            flag,
        })
    }
    pub async fn permit(&self) -> Result<tokio::sync::OwnedSemaphorePermit> {
        self.permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| cancelled())
    }
    pub async fn run<T: Send + 'static>(
        self: &Arc<Self>,
        id: String,
        work: impl FnOnce(&AtomicBool) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let guard = self.begin(id)?;
        let flag = guard.flag.clone();
        async {
            let permit = self.permit().await?;
            tauri::async_runtime::spawn_blocking(move || {
                let _permit = permit;
                check(&flag)?;
                let result = work(&flag)?;
                check(&flag)?;
                Ok(result)
            })
            .await
            .map_err(|_| invalid("图片处理失败，请尝试其他图片"))?
        }
        .await
    }
}

pub fn inspect(input: Input, cancel: &AtomicBool) -> Result<Inspection> {
    let bytes = input.bytes()?;
    let format = codec::identify(&bytes)?;
    let image = codec::decode(&bytes, cancel)?;
    let (width, height) = (image.width(), image.height());
    let scale = (1600.0 / f64::from(width.max(height))).min(1.0);
    let preview = codec::resize(
        image,
        Size {
            width: (f64::from(width) * scale).round().max(1.0) as u32,
            height: (f64::from(height) * scale).round().max(1.0) as u32,
        },
        cancel,
    )?;
    let encoded = codec::png_bytes(&preview.to_rgba8())?;
    check(cancel)?;
    Ok(Inspection {
        width,
        height,
        format,
        byte_size: bytes.len(),
        preview_base64: STANDARD.encode(encoded),
    })
}

pub fn process(request: ProcessRequest, cancel: &AtomicBool) -> Result<Output> {
    if !(60..=100).contains(&request.quality) {
        return Err(invalid("图片质量需在 60–100 之间"));
    }
    if request
        .max_bytes
        .is_some_and(|limit| limit == 0 || limit > MAX_BYTES)
    {
        return Err(invalid("文件体积上限需大于零且不超过 20 MiB"));
    }
    if let Some(size) = request.size {
        size.validate()?;
    }
    let bytes = request.input.bytes()?;
    let image = codec::decode(&bytes, cancel)?;
    let (x, y, w, h) = request.crop.pixels(Size {
        width: image.width(),
        height: image.height(),
    })?;
    let mut cropped = image.crop_imm(x, y, w, h);
    drop(image);
    check(cancel)?;
    if let Some(size) = request.size {
        cropped = codec::resize(cropped, size, cancel)?;
    }
    check(cancel)?;
    let (encoded, quality, lossy) = codec::encode(
        &cropped.to_rgba8(),
        request.format,
        request.quality,
        request.max_bytes.unwrap_or(MAX_BYTES),
        cancel,
    )?;
    let dimensions = image::ImageReader::new(std::io::Cursor::new(&encoded))
        .with_guessed_format()
        .map_err(|_| invalid("输出图片校验失败"))?
        .into_dimensions()
        .map_err(|_| invalid("输出图片校验失败"))?;
    if dimensions != (cropped.width(), cropped.height())
        || codec::identify(&encoded)? != request.format
    {
        return Err(invalid("输出图片尺寸或格式不符合要求"));
    }
    Ok(Output {
        width: cropped.width(),
        height: cropped.height(),
        format: request.format,
        mime_type: request.format.mime(),
        byte_size: encoded.len(),
        data_base64: STANDARD.encode(encoded),
        quality,
        lossy,
    })
}

pub fn write_new(path: &std::path::Path, bytes: &[u8], cancel: &AtomicBool) -> Result<()> {
    use std::io::Write;
    check(cancel)?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                invalid("文件已存在，请使用新文件名，原图不会被覆盖")
            } else {
                invalid("无法创建图片文件，请检查保存位置和权限")
            }
        })?;
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(invalid("图片保存失败，请检查磁盘空间和权限"));
    }
    if let Err(error) = check(cancel) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

pub fn validate_export(input: Input, format: Format, cancel: &AtomicBool) -> Result<Vec<u8>> {
    let bytes = input.bytes()?;
    if codec::identify(&bytes)? != format {
        return Err(invalid("导出格式与图片内容不一致"));
    }
    codec::decode(&bytes, cancel)?;
    Ok(bytes)
}
