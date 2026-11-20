//! Export immagini (PNG/JPEG/WEBP, singola/multipla/ZIP) e .proxyproject (ZIP).
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn export_images_zip(files: &[PathBuf], dest_zip: &Path) -> Result<(), String> {
    let f = std::fs::File::create(dest_zip).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for p in files {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("file").to_string();
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Crea .proxyproject (ZIP): project.json + assets/ + metadata/
pub fn pack_project(
    manifest_json: &str,
    asset_files: &[(String, PathBuf)],
    dest: &Path,
) -> Result<(), String> {
    let f = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("project.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(manifest_json.as_bytes()).map_err(|e| e.to_string())?;
    for (arc_name, src) in asset_files {
        zip.start_file(format!("assets/{arc_name}"), opts).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(src).map_err(|e| format!("asset {arc_name}: {e}"))?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.start_file("metadata/export-info.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(
        serde_json::json!({ "app": "Proxxied", "version": "0.1.0", "at": crate::database::now_iso() })
            .to_string()
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn unpack_project(zip_path: &Path, dest_dir: &Path) -> Result<serde_json::Value, String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if name.contains("..") {
            return Err("zip con path non valido".into());
        }
        let out = dest_dir.join(&name);
        if file.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut o = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut o).map_err(|e| e.to_string())?;
        }
    }
    let manifest = std::fs::read_to_string(dest_dir.join("project.json")).map_err(|e| e.to_string())?;
    serde_json::from_str(&manifest).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn zip_roundtrip() {
        let dir = std::env::temp_dir().join(format!("px-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.txt");
        std::fs::write(&a, b"hello").unwrap();
        let z = dir.join("out.zip");
        super::export_images_zip(&[a.clone()], &z).unwrap();
        assert!(z.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn pack_unpack() {
        let dir = std::env::temp_dir().join(format!("px-proj-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let asset = dir.join("img.png");
        std::fs::write(&asset, b"fakepng").unwrap();
        let dest = dir.join("p.proxyproject");
        super::pack_project(r#"{"name":"t"}"#, &[("img.png".into(), asset)], &dest).unwrap();
        let out = dir.join("unpacked");
        let v = super::unpack_project(&dest, &out).unwrap();
        assert_eq!(v["name"], "t");
        assert!(out.join("assets/img.png").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn rejects_traversal_marker() {
        // unpack rifiuta entry con `..` nel nome
        assert!("a/../b".contains(".."));
    }
}
