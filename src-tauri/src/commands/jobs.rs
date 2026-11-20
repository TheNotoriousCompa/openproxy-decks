use tauri::AppHandle;

#[tauri::command]
pub async fn job_list() -> Result<Vec<crate::jobs::JobInfo>, String> {
    Ok(crate::jobs::list())
}

#[tauri::command]
pub async fn job_cancel(id: String) -> Result<bool, String> {
    Ok(crate::jobs::cancel(&id))
}

#[tauri::command]
pub async fn clear_caches(handle: AppHandle, what: String) -> Result<(), String> {
    match what.as_str() {
        "images" | "processing" | "all" => crate::cache::clear_all(&handle),
        "database" => crate::database::with_conn(&handle, |c| {
            c.execute("DELETE FROM cache_entries", []).map_err(|e| e.to_string())?;
            Ok(())
        }),
        _ => Err("target cache sconosciuto (images|processing|database|all)".into()),
    }
}
