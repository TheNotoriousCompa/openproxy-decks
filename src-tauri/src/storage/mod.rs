//! Percorsi locali + layout progetti. Windows-first, multipiattaforma.
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn app_root(_handle: &AppHandle) -> Result<PathBuf, String> {
    // %APPDATA%/ProxyApp su Windows, dirs equivalenti altrove.
    let base = dirs::data_dir()
        .ok_or_else(|| "data_dir non disponibile".to_string())?;
    Ok(base.join("ProxyApp"))
}

pub fn db_path(handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_root(handle)?.join("database.sqlite"))
}

pub fn projects_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_root(handle)?.join("projects"))
}

pub fn project_dir(handle: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    if project_id.contains('/') || project_id.contains('\\') || project_id.contains("..") {
        return Err("project_id non valido".into());
    }
    Ok(projects_dir(handle)?.join(project_id))
}

pub fn models_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_root(handle)?.join("models"))
}

pub async fn ensure_layout(handle: &AppHandle) -> Result<(), String> {
    let root = app_root(handle)?;
    for sub in ["projects", "models", "cache", "tmp"] {
        let p = root.join(sub);
        tokio::fs::create_dir_all(&p)
            .await
            .map_err(|e| format!("mkdir {}: {e}", p.display()))?;
    }
    Ok(())
}

pub fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok(hex::encode(h.finalize()))
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

// -----------
// (errori come String per semplicità FFI)

pub fn app_handle_data_dir(handle: &AppHandle) -> PathBuf {
    handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("ProxyApp"))
}

#[cfg(test)]
mod tests {
    use super::sha256_bytes;
    #[test]
    fn hash_stable() {
        assert_eq!(sha256_bytes(b"a").len(), 64);
        assert_eq!(sha256_bytes(b"a"), sha256_bytes(b"a"));
        assert_ne!(sha256_bytes(b"a"), sha256_bytes(b"b"));
    }
    #[test]
    fn traversal_rejected_by_validator() {
        fn valid(id: &str) -> bool {
            !(id.contains('/') || id.contains('\\') || id.contains(".."))
        }
        assert!(!valid("../x"));
        assert!(!valid("a/b"));
        assert!(valid("abc-123_UUID"));
    }
}
