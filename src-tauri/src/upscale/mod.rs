//! Upscale locale CPU (Lanczos3 HQ). Sempre disponibile, nessuna dipendenza esterna.
//!
//! Policy: mai ingrandire oltre il necessario; con mode=off mai ingrandire
//! oltre le dimensioni native (l'export usa i DPI originali della sorgente).
//! Se l'immagine è già abbastanza grande → nessuno upscale.
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
pub struct UpscalerStatus {
    pub cpu_available: bool,
    pub ai_available: bool,
    pub ai_model: Option<String>,
    pub ai_model_version: Option<String>,
    pub gpu_hint: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpscaleRequest {
    pub src_path: String,
    pub target_w_px: u32,
    pub target_h_px: u32,
    /// off | ask | auto | always
    pub mode: String,
    #[allow(dead_code)]
    pub model: Option<String>,
}

pub fn status(_models_dir: &Path) -> UpscalerStatus {
    UpscalerStatus {
        cpu_available: true,
        ai_available: false,
        ai_model: None,
        ai_model_version: None,
        gpu_hint: "cpu".to_string(),
    }
}

/// Entry-point: decide CPU-skip vs Lanczos3 in base a mode + scala necessaria.
/// Ritorna Err quando non serve upscalare (il chiamante usa la sorgente così com'è).
pub fn upscale_file(req: &UpscaleRequest, _models_dir: &Path, tmp_dir: &Path) -> Result<PathBuf, String> {
    if req.mode == "off" {
        return Err("upscale disabilitato (mode=off)".into());
    }
    let bytes = std::fs::read(&req.src_path).map_err(|e| format!("read: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode: {e}"))?;
    use image::GenericImageView;
    let (sw, sh) = img.dimensions();
    let sx = req.target_w_px as f64 / sw.max(1) as f64;
    let sy = req.target_h_px as f64 / sh.max(1) as f64;
    let scale = sx.max(sy);

    if scale <= 1.0 && req.mode != "always" {
        return Err("skip: immagine già sufficiente, nessuno upscale".into());
    }
    cpu_upscale(&req.src_path, req.target_w_px, req.target_h_px, tmp_dir)
}

pub fn cpu_upscale(src: &str, tw: u32, th: u32, tmp_dir: &Path) -> Result<PathBuf, String> {
    let bytes = std::fs::read(src).map_err(|e| format!("read: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode: {e}"))?;
    let out = img.resize_exact(tw.max(1), th.max(1), image::imageops::FilterType::Lanczos3);
    std::fs::create_dir_all(tmp_dir).map_err(|e| e.to_string())?;
    let key = format!("cpu-{}x{}-{}", tw, th, crate::storage::sha256_bytes(&bytes)[..16].to_string());
    let dest = tmp_dir.join(format!("{key}.png"));
    out.save_with_format(&dest, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::cpu_upscale;

    #[test]
    fn cpu_upscale_rispetta_target() {
        let dir = std::env::temp_dir().join(format!("proxxied-cpu-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut img = image::RgbImage::new(8, 8);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = image::Rgb([x as u8 * 30, y as u8 * 30, 0]);
        }
        let src = dir.join("s.png");
        img.save_with_format(&src, image::ImageFormat::Png).unwrap();
        let out = cpu_upscale(&src.to_string_lossy(), 16, 16, &dir).unwrap();
        let got = image::open(&out).unwrap();
        use image::GenericImageView;
        assert_eq!(got.dimensions(), (16, 16));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
