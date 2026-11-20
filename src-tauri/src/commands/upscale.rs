use tauri::AppHandle;

#[tauri::command]
pub async fn upscale_status(handle: AppHandle) -> Result<crate::upscale::UpscalerStatus, String> {
    let dir = crate::storage::models_dir(&handle)?;
    Ok(crate::upscale::status(&dir))
}

#[tauri::command]
pub async fn upscale_image(handle: AppHandle, req: crate::upscale::UpscaleRequest) -> Result<String, String> {
    let models = crate::storage::models_dir(&handle)?;
    let tmp = crate::storage::app_root(&handle)?.join("tmp");
    Ok(crate::upscale::upscale_file(&req, &models, &tmp)?.to_string_lossy().to_string())
}
