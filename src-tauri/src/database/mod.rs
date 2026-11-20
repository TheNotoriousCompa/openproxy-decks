//! SQLite: metadata soltanto, mai blob pesanti.
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

static DB: Mutex<Option<PathBuf>> = Mutex::new(None);

pub const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS projects(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  manifest TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS cards(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  zone TEXT NOT NULL DEFAULT 'main',
  provider TEXT NOT NULL DEFAULT 'custom',
  provider_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  front_asset_id TEXT,
  back_asset_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id);
CREATE TABLE IF NOT EXISTS assets(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'image',
  source_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(source_hash);
CREATE TABLE IF NOT EXISTS cache_entries(
  key TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv_settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

fn open(handle: &AppHandle) -> Result<Connection, String> {
    let p = crate::storage::db_path(handle)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&p).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

pub async fn init(handle: &AppHandle) -> Result<(), String> {
    let conn = open(handle)?;
    drop(conn);
    let p = crate::storage::db_path(handle)?;
    *DB.lock().map_err(|e| e.to_string())? = Some(p);
    // Abilita FK
    let conn = open(handle)?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn with_conn<T>(handle: &AppHandle, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = open(handle)?;
    conn.execute_batch("PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
    f(&conn)
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[allow(dead_code)]
pub fn upsert_setting(handle: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    with_conn(handle, |c| {
        c.execute(
            "INSERT INTO kv_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[allow(dead_code)]
pub fn get_setting(handle: &AppHandle, key: &str) -> Result<Option<String>, String> {
    with_conn(handle, |c| {
        let mut st = c.prepare("SELECT value FROM kv_settings WHERE key=?1").map_err(|e| e.to_string())?;
        let mut rows = st.query(params![key]).map_err(|e| e.to_string())?;
        if let Some(r) = rows.next().map_err(|e| e.to_string())? {
            Ok(Some(r.get::<_, String>(0).map_err(|e| e.to_string())?))
        } else {
            Ok(None)
        }
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn schema_has_all_tables() {
        for t in ["projects", "cards", "assets", "cache_entries", "kv_settings"] {
            assert!(super::SCHEMA.contains(t), "missing {t}");
        }
    }
}
