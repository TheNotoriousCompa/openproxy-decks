//! Spazio disco: quanto pesa ogni area dei dati locali (assessment) + pulizia tmp.
//!
//! Solo lettura (niente cancellazioni tranne `clear_tmp`, che toglie i file
//! temporanei più vecchi di un'ora: mai quelli di un export in corso).

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AreaUsage {
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct StorageUsage {
    /// artwork full-res scaricati, per progetto (mai toccati dalle pulizie)
    pub assets: AreaUsage,
    /// PDF esportati (crescono a ogni export: nomi con timestamp)
    pub exports: AreaUsage,
    /// JPEG di stampa + thumb (ricostruibili: `clear_caches` li svuota)
    pub cache: AreaUsage,
    /// scarti di lavorazione (upscale `.png`, pagine intermedie)
    pub tmp: AreaUsage,
    pub models: AreaUsage,
    pub database: AreaUsage,
    pub projects: u64,
}

/// Somma ricorsiva di una cartella (pura sui path: errori ignorati per voce).
pub fn dir_usage(path: &Path) -> AreaUsage {
    let mut out = AreaUsage { bytes: 0, files: 0 };
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(m) = entry.metadata() {
                if m.is_file() {
                    out.files += 1;
                    out.bytes += m.len();
                }
            }
        }
    }
    out
}

fn file_usage(path: &Path) -> AreaUsage {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() => AreaUsage { bytes: m.len(), files: 1 },
        _ => AreaUsage { bytes: 0, files: 0 },
    }
}

#[tauri::command]
pub async fn storage_usage(handle: tauri::AppHandle) -> Result<StorageUsage, String> {
    let root = crate::storage::app_root(&handle)?;
    let projects_dir = root.join("projects");
    let mut assets = AreaUsage { bytes: 0, files: 0 };
    let mut exports = AreaUsage { bytes: 0, files: 0 };
    let mut projects = 0u64;
    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            projects += 1;
            let a = dir_usage(&p.join("assets"));
            let e = dir_usage(&p.join("exports"));
            assets.bytes += a.bytes;
            assets.files += a.files;
            exports.bytes += e.bytes;
            exports.files += e.files;
        }
    }
    Ok(StorageUsage {
        assets,
        exports,
        cache: dir_usage(&root.join("cache")),
        tmp: dir_usage(&root.join("tmp")),
        models: dir_usage(&root.join("models")),
        database: file_usage(&root.join("database.sqlite")),
        projects,
    })
}

/// Rimuove i file temporanei più vecchi di `min_age_secs` (default 3600).
/// Ritorna i byte liberati. Le cartelle restano al loro posto.
pub fn purge_tmp_older_than(tmp: &Path, min_age_secs: u64) -> (u64, u64) {
    let mut freed = 0u64;
    let mut removed = 0u64;
    let mut stack = vec![tmp.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let age_ok = entry
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t.elapsed().map(|d| d.as_secs() >= min_age_secs).unwrap_or(true))
                .unwrap_or(true);
            if !age_ok {
                continue;
            }
            if let Ok(m) = entry.metadata() {
                freed += m.len();
            }
            if std::fs::remove_file(&p).is_ok() {
                removed += 1;
            }
        }
    }
    (freed, removed)
}

#[tauri::command]
pub async fn clear_tmp(handle: tauri::AppHandle) -> Result<u64, String> {
    let tmp = crate::storage::app_root(&handle)?.join("tmp");
    Ok(purge_tmp_older_than(&tmp, 3600).0)
}

#[cfg(test)]
mod tests {
    use super::{dir_usage, purge_tmp_older_than};

    fn sandbox(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("proxxied-storage-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.bin"), vec![1u8; 100]).unwrap();
        std::fs::write(dir.join("sub").join("b.bin"), vec![2u8; 50]).unwrap();
        dir
    }

    #[test]
    fn dir_usage_somma_ricorsiva() {
        let dir = sandbox("usage");
        let u = dir_usage(&dir);
        assert_eq!((u.files, u.bytes), (2, 150));
        let missing = dir_usage(&dir.join("inesistente"));
        assert_eq!((missing.files, missing.bytes), (0, 0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn purge_tmp_rispetta_eta() {
        let dir = sandbox("purge");
        // soglia altissima: i file appena creati restano
        let (freed, removed) = purge_tmp_older_than(&dir, u64::MAX);
        assert_eq!((freed, removed), (0, 0));
        assert!(dir.join("a.bin").exists());
        // soglia zero: va via tutto (150 byte in 2 file)
        let (freed2, removed2) = purge_tmp_older_than(&dir, 0);
        assert_eq!((freed2, removed2), (150, 2));
        assert!(!dir.join("a.bin").exists());
        assert!(!dir.join("sub").join("b.bin").exists());
        // le cartelle restano, i file no
        assert!(dir.join("sub").is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
