use tauri::AppHandle;

#[tauri::command]
pub async fn export_images(handle: AppHandle, files: Vec<String>, dest_zip: String) -> Result<String, String> {
    let paths: Vec<std::path::PathBuf> = files.iter().map(std::path::PathBuf::from).collect();
    for p in &paths {
        if !p.exists() {
            return Err(format!("file mancante: {}", p.display()));
        }
    }
    crate::export::export_images_zip(&paths, std::path::Path::new(&dest_zip))?;
    let _ = handle;
    Ok(dest_zip)
}

/// Directory exports/ del progetto (assoluta, creata se manca).
/// Tutti gli export devono usare path assoluti da qui: mai più relativi alla CWD.
#[tauri::command]
pub async fn export_dir(handle: AppHandle, project_id: String) -> Result<String, String> {
    let dir = crate::storage::project_dir(&handle, &project_id)?.join("exports");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}
