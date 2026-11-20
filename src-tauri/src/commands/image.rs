use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
pub struct AnalyzeResult {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub source_hash: String,
    pub quality: crate::processing::QualityReport,
}

#[tauri::command]
pub async fn analyze_image(
    _handle: AppHandle,
    path: String,
    target_w_mm: f64,
    target_h_mm: f64,
    target_dpi: f64,
) -> Result<AnalyzeResult, String> {
    // Accetta anche URL asset:// (convertFileSrc) oltre ai path plain.
    let fs_path = crate::commands::assets::resolve_to_fs_path(&path).unwrap_or(path);
    let a = crate::image::analyze_file(std::path::Path::new(&fs_path), target_w_mm, target_h_mm, target_dpi)?;
    Ok(AnalyzeResult {
        width: a.width,
        height: a.height,
        format: a.format,
        source_hash: a.source_hash,
        quality: a.quality,
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProcessImageArgs {
    pub src_path: String,
    pub target_w_px: u32,
    pub target_h_px: u32,
    /// formato carta nominale in mm (default 63×88 per i vecchi chiamanti)
    #[serde(default = "default_card_w")]
    pub card_w_mm: f64,
    #[serde(default = "default_card_h")]
    pub card_h_mm: f64,
    pub crop: Option<[f32; 4]>,
    pub rotate_deg: i32,
    pub flip_h: bool,
    pub flip_v: bool,
    pub bleed_px: u32,
    pub quality: u8,
    pub out_format: String,
    pub cache_key: String,
    /// luminosità in punti percentuale (-50..+50, 0 = invariata)
    #[serde(default)]
    pub brightness_pct: i32,
}

fn default_card_w() -> f64 {
    63.0
}

fn default_card_h() -> f64 {
    88.0
}

#[tauri::command]
pub async fn process_image(handle: AppHandle, args: ProcessImageArgs) -> Result<String, String> {
    if let Some(hit) = crate::cache::lookup(&handle, &args.cache_key)? {
        return Ok(hit.to_string_lossy().to_string());
    }
    let dir = crate::cache::processed_dir(&handle)?;
    let method = if args.target_w_px == 0 {
        crate::processing::UpscaleMethod::None
    } else {
        crate::processing::UpscaleMethod::Interpolate
    };
    let out = crate::image::process_to_cache(
        std::path::Path::new(&args.src_path),
        &crate::image::ProcessOptions {
            target_w_px: args.target_w_px.max(1),
            target_h_px: args.target_h_px.max(1),
            card_w_mm: args.card_w_mm,
            card_h_mm: args.card_h_mm,
            crop: args.crop,
            rotate_deg: args.rotate_deg,
            flip_h: args.flip_h,
            flip_v: args.flip_v,
            bleed_px: args.bleed_px,
            quality: args.quality,
            out_format: args.out_format,
            method,
            brightness_pct: args.brightness_pct,
        },
        &args.cache_key,
        &dir,
    )?;
    crate::cache::store(&handle, &args.cache_key, &out)?;
    Ok(out.to_string_lossy().to_string())
}
