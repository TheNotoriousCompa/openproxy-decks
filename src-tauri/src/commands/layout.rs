#[tauri::command]
pub async fn compute_layout(input: crate::processing::LayoutInput) -> Result<crate::processing::LayoutOutput, String> {
    crate::processing::compute_layout(&input)
}
