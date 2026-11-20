//! Cache a livelli (source/processed/final/pdf-asset) su filesystem + indice SQLite.
//! Chiave = source_hash + crop + rotation + target + bleed + model + version + settings.
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub fn cache_root(handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::storage::app_root(handle)?.join("cache"))
}

pub fn processed_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(cache_root(handle)?.join("processed"))
}

pub fn final_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(cache_root(handle)?.join("final"))
}

pub fn pdf_asset_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(cache_root(handle)?.join("pdf-assets"))
}

/// Costruisce la chiave di cache canonica.
pub fn make_key(parts: &[&str]) -> String {
    crate::storage::sha256_bytes(parts.join("|").as_bytes())
}

pub fn lookup(handle: &AppHandle, key: &str) -> Result<Option<PathBuf>, String> {
    crate::database::with_conn(handle, |c| {
        let mut st = c.prepare("SELECT path FROM cache_entries WHERE key=?1").map_err(|e| e.to_string())?;
        let mut rows = st.query(rusqlite::params![key]).map_err(|e| e.to_string())?;
        if let Some(r) = rows.next().map_err(|e| e.to_string())? {
            let p: String = r.get(0).map_err(|e| e.to_string())?;
            let pb = PathBuf::from(&p);
            if pb.exists() {
                return Ok(Some(pb));
            }
        }
        Ok(None)
    })
}

pub fn store(handle: &AppHandle, key: &str, path: &Path) -> Result<(), String> {
    let bytes = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    let s = path.to_string_lossy().to_string();
    crate::database::with_conn(handle, |c| {
        c.execute(
            "INSERT INTO cache_entries(key,path,bytes,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET path=excluded.path, bytes=excluded.bytes",
            rusqlite::params![key, s, bytes, crate::database::now_iso()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// LRU semplice: elimina i più vecchi oltre max_bytes.
pub fn enforce_budget(handle: &AppHandle, max_bytes: i64) -> Result<usize, String> {
    crate::database::with_conn(handle, |c| {
        let total: i64 = c
            .query_row("SELECT COALESCE(SUM(bytes),0) FROM cache_entries", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if total <= max_bytes {
            return Ok(0);
        }
        let mut st = c.prepare("SELECT key, path, bytes FROM cache_entries ORDER BY created_at ASC").map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, i64)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut freed = 0usize;
        let mut acc = total;
        for (k, p, b) in rows {
            if acc <= max_bytes {
                break;
            }
            let _ = std::fs::remove_file(&p);
            c.execute("DELETE FROM cache_entries WHERE key=?1", rusqlite::params![k])
                .map_err(|e| e.to_string())?;
            acc -= b;
            freed += 1;
        }
        Ok(freed)
    })
}

pub fn clear_all(handle: &AppHandle) -> Result<(), String> {
    let root = cache_root(handle)?;
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::create_dir_all(&root);
    crate::database::with_conn(handle, |c| {
        c.execute("DELETE FROM cache_entries", []).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn key_stable_and_sensitive() {
        let a = super::make_key(&["h1", "744x1039", "300dpi"]);
        let b = super::make_key(&["h1", "744x1039", "300dpi"]);
        let c = super::make_key(&["h1", "744x1039", "600dpi"]);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }
}
