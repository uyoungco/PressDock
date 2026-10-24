use crate::{
    cms::CmsService,
    error::CommandError,
    imaging::{self, Format, ImageJobs, Input, Inspection, Output, ProcessRequest},
};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn image_inspect(
    job_id: String,
    input: Input,
    jobs: State<'_, Arc<ImageJobs>>,
    cms: State<'_, CmsService>,
) -> Result<Inspection, CommandError> {
    let generation = cms.authorize().await?;
    let result = jobs
        .run(job_id, move |cancel| imaging::inspect(input, cancel))
        .await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}

#[tauri::command]
pub async fn image_process(
    request: ProcessRequest,
    jobs: State<'_, Arc<ImageJobs>>,
    cms: State<'_, CmsService>,
) -> Result<Output, CommandError> {
    let generation = cms.authorize().await?;
    let result = jobs
        .run(request.job_id.clone(), move |cancel| {
            imaging::process(request, cancel)
        })
        .await?;
    cms.ensure_generation(generation).await?;
    Ok(result)
}

#[tauri::command]
pub fn image_cancel(job_id: String, jobs: State<'_, Arc<ImageJobs>>) {
    jobs.cancel(&job_id);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    saved: bool,
    file_name: Option<String>,
}

#[tauri::command]
pub async fn image_export(
    job_id: String,
    input: Input,
    format: Format,
    file_name: String,
    app: tauri::AppHandle,
    cms: State<'_, CmsService>,
    jobs: State<'_, Arc<ImageJobs>>,
) -> Result<ExportResult, CommandError> {
    let generation = cms.authorize().await?;
    if file_name.is_empty() || file_name.len() > 255 || file_name.contains(['/', '\\', ':', '\0']) {
        return Err(imaging::invalid("导出文件名无效").into());
    }
    let guard = jobs.begin(job_id)?;
    let flag = guard.flag.clone();
    let permit = jobs.permit().await?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        imaging::check(&flag)?;
        imaging::validate_export(input, format, &flag)
    })
    .await
    .map_err(|_| imaging::invalid("导出图片校验失败"))??;
    cms.ensure_generation(generation).await?;
    imaging::check(&guard.flag)?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("图片另存为")
            .set_file_name(file_name)
            .add_filter("图片", &[format.extension()])
            .blocking_save_file()
    })
    .await
    .map_err(|_| imaging::invalid("无法打开保存对话框"))?;
    let Some(selected) = selected else {
        return Ok(ExportResult {
            saved: false,
            file_name: None,
        });
    };
    imaging::check(&guard.flag)?;
    cms.ensure_generation(generation).await?;
    let mut path = selected
        .into_path()
        .map_err(|_| imaging::invalid("保存位置无效"))?;
    if path.extension().is_none() {
        path.set_extension(format.extension());
    }
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != format.extension() && !(format == Format::Jpeg && extension == "jpeg") {
        return Err(imaging::invalid("文件扩展名必须与输出图片格式一致").into());
    }
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    let flag = guard.flag.clone();
    tauri::async_runtime::spawn_blocking(move || {
        imaging::check(&flag)?;
        imaging::write_new(&path, &bytes, &flag)
    })
    .await
    .map_err(|_| imaging::invalid("图片保存失败"))??;
    Ok(ExportResult {
        saved: true,
        file_name,
    })
}
