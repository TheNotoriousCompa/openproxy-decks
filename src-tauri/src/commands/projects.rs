use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub manifest: serde_json::Value,
}

#[tauri::command]
pub async fn list_projects(handle: AppHandle, query: Option<String>) -> Result<Vec<Project>, String> {
    crate::database::with_conn(&handle, |c| {
        let (sql, has_q) = match &query {
            Some(q) if !q.trim().is_empty() => (
                "SELECT id,name,created_at,updated_at,manifest FROM projects WHERE name LIKE ?1 ORDER BY updated_at DESC",
                true,
            ),
            _ => ("SELECT id,name,created_at,updated_at,manifest FROM projects ORDER BY updated_at DESC", false),
        };
        let mut st = c.prepare(sql).map_err(|e| e.to_string())?;
        let rows = if has_q {
            let like = format!("%{}%", query.unwrap_or_default());
            st.query_map(params![like], row_to_project).map_err(|e| e.to_string())?
        } else {
            st.query_map([], row_to_project).map_err(|e| e.to_string())?
        };
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

fn row_to_project(r: &rusqlite::Row) -> rusqlite::Result<Project> {
    let m: String = r.get(4)?;
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        created_at: r.get(2)?,
        updated_at: r.get(3)?,
        manifest: serde_json::from_str(&m).unwrap_or(serde_json::json!({})),
    })
}

/// Riepilogo leggero per liste con molti progetti (niente manifest interi).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub deck_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryPage {
    pub total: i64,
    pub items: Vec<ProjectSummary>,
}

fn row_to_summary(r: &rusqlite::Row) -> rusqlite::Result<ProjectSummary> {
    Ok(ProjectSummary {
        id: r.get(0)?,
        name: r.get(1)?,
        created_at: r.get(2)?,
        updated_at: r.get(3)?,
        deck_count: r.get(4)?,
    })
}

fn query_summaries(
    conn: &rusqlite::Connection,
    like: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<SummaryPage, String> {
    let limit = limit.clamp(1, 100);
    let offset = offset.max(0);
    let total: i64 = match like {
        Some(q) => conn
            .query_row("SELECT COUNT(*) FROM projects WHERE name LIKE ?1", params![q], |r| r.get(0)),
        None => conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)),
    }
    .map_err(|e| e.to_string())?;
    let sql = match like {
        Some(_) => "SELECT id,name,created_at,updated_at,CASE WHEN json_valid(manifest) THEN COALESCE(json_array_length(json_extract(manifest,'$.deck')),0) ELSE 0 END FROM projects WHERE name LIKE ?1 ORDER BY updated_at DESC LIMIT ?2 OFFSET ?3",
        None => "SELECT id,name,created_at,updated_at,CASE WHEN json_valid(manifest) THEN COALESCE(json_array_length(json_extract(manifest,'$.deck')),0) ELSE 0 END FROM projects ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2",
    };
    let mut st = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = match like {
        Some(q) => st.query_map(params![q, limit, offset], row_to_summary),
        None => st.query_map(params![limit, offset], row_to_summary),
    }
    .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for r in rows {
        items.push(r.map_err(|e| e.to_string())?);
    }
    Ok(SummaryPage { total, items })
}

#[tauri::command]
pub async fn list_project_summaries(
    handle: AppHandle,
    query: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<SummaryPage, String> {
    let like = match query {
        Some(q) if !q.trim().is_empty() => Some(format!("%{}%", q)),
        _ => None,
    };
    crate::database::with_conn(&handle, |c| {
        query_summaries(c, like.as_deref(), limit.unwrap_or(20), offset.unwrap_or(0))
    })
}

#[tauri::command]
pub async fn create_project(handle: AppHandle, name: String) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("nome progetto vuoto".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::database::now_iso();
    let manifest = serde_json::json!({
        "version": 1, "deck": [], "print": default_print_settings(), "assets": []
    });
    crate::database::with_conn(&handle, |c| {
        c.execute(
            "INSERT INTO projects(id,name,created_at,updated_at,manifest) VALUES(?1,?2,?3,?4,?5)",
            params![id, name, now, now, manifest.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    // directory progetto
    let dir = crate::storage::project_dir(&handle, &id)?;
    for sub in ["assets", "processed", "exports", "cache", "artwork"] {
        tokio::fs::create_dir_all(dir.join(sub)).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(dir.join("manifest.json"), serde_json::to_string_pretty(&manifest).unwrap())
        .await
        .map_err(|e| e.to_string())?;
    get_project(handle, id).await
}

fn default_print_settings() -> serde_json::Value {
    serde_json::json!({
        "page": "a4", "orientation": "portrait",
        "card": "custom", "cardWmm": 63.0, "cardHmm": 88.0,
        "marginMm": 3.0, "spacingMm": 0.0, "bleedMm": 1.0,
        "dpi": 1200, "profile": "maximum",
        "guides": { "cropMarks": true, "cornerMarks": false, "cutLines": true },
        "guideColor": "#ff0000", "guideWidthPt": 0.4, "guidePlacement": "outside",
        "guideLengthMm": 1.5, "guideStyle": "solid", "guideCap": "square",
        "guideExtent": "corners",
        "duplex": "front_only", "upscaleMode": "always"
    })
}

#[tauri::command]
pub async fn get_project(handle: AppHandle, id: String) -> Result<Project, String> {
    crate::database::with_conn(&handle, |c| {
        let mut st = c
            .prepare("SELECT id,name,created_at,updated_at,manifest FROM projects WHERE id=?1")
            .map_err(|e| e.to_string())?;
        let mut rows = st.query(params![id]).map_err(|e| e.to_string())?;
        if let Some(r) = rows.next().map_err(|e| e.to_string())? {
            row_to_project(r).map_err(|e| e.to_string())
        } else {
            Err("progetto non trovato".into())
        }
    })
}

/// Salva il manifest (deck + impostazioni stampa) nel DB. Chiamato dall'autosave.
#[tauri::command]
pub async fn save_project_manifest(handle: AppHandle, id: String, manifest: String) -> Result<Project, String> {
    // valida che sia JSON
    serde_json::from_str::<serde_json::Value>(&manifest).map_err(|e| format!("manifest non valido: {e}"))?;
    let now = crate::database::now_iso();
    crate::database::with_conn(&handle, |c| {
        let n = c
            .execute("UPDATE projects SET manifest=?1, updated_at=?2 WHERE id=?3", params![manifest, now, id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("progetto non trovato".to_string());
        }
        Ok(())
    })?;
    // mirror su disco (manifest.json) per ispezione/debug
    if let Ok(dir) = crate::storage::project_dir(&handle, &id) {
        let _ = std::fs::write(dir.join("manifest.json"), &manifest);
    }
    get_project(handle, id).await
}

#[tauri::command]
pub async fn rename_project(handle: AppHandle, id: String, name: String) -> Result<Project, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("nome vuoto".into());
    }
    let now = crate::database::now_iso();
    crate::database::with_conn(&handle, |c| {
        let n = c
            .execute("UPDATE projects SET name=?1, updated_at=?2 WHERE id=?3", params![name, now, id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("progetto non trovato".to_string());
        }
        Ok(())
    })?;
    get_project(handle, id).await
}

#[tauri::command]
pub async fn duplicate_project(handle: AppHandle, id: String) -> Result<Project, String> {
    let src = get_project(handle.clone(), id.clone()).await?;
    let new_id = uuid::Uuid::new_v4().to_string();
    let now = crate::database::now_iso();
    let name = format!("{} (copia)", src.name);
    crate::database::with_conn(&handle, |c| {
        c.execute(
            "INSERT INTO projects(id,name,created_at,updated_at,manifest) VALUES(?1,?2,?3,?4,?5)",
            params![new_id, name, now, now, src.manifest.to_string()],
        )
        .map_err(|e| e.to_string())?;
        // duplica carte
        c.execute(
            "INSERT INTO cards(id,project_id,name,qty,zone,provider,provider_id,metadata,front_asset_id,back_asset_id,sort_order)
             SELECT lower(hex(randomblob(16))), ?1, name,qty,zone,provider,provider_id,metadata,front_asset_id,back_asset_id,sort_order
             FROM cards WHERE project_id=?2",
            params![new_id, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    // copia directory assets
    let sdir = crate::storage::project_dir(&handle, &id)?;
    let ddir = crate::storage::project_dir(&handle, &new_id)?;
    if sdir.exists() {
        copy_dir_recursive(&sdir, &ddir).map_err(|e| e.to_string())?;
    }
    get_project(handle, new_id).await
}

fn copy_dir_recursive(s: &std::path::Path, d: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(d)?;
    for e in walkdir::WalkDir::new(s).min_depth(1) {
        let e = e?;
        let rel = e.path().strip_prefix(s).unwrap();
        let dest = d.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else {
            if let Some(p) = dest.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(e.path(), &dest)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_project(handle: AppHandle, id: String) -> Result<(), String> {
    crate::database::with_conn(&handle, |c| {
        c.execute("DELETE FROM projects WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    })?;
    let dir = crate::storage::project_dir(&handle, &id)?;
    let _ = tokio::fs::remove_dir_all(dir).await;
    Ok(())
}

#[tauri::command]
pub async fn export_project(handle: AppHandle, id: String, dest_path: String) -> Result<String, String> {
    let proj = get_project(handle.clone(), id.clone()).await?;
    let dir = crate::storage::project_dir(&handle, &id)?;
    let mut assets: Vec<(String, std::path::PathBuf)> = Vec::new();
    let adir = dir.join("assets");
    if adir.exists() {
        for e in walkdir::WalkDir::new(&adir).min_depth(1).into_iter().filter_map(|e| e.ok()) {
            if e.file_type().is_file() {
                let rel = e.path().strip_prefix(&adir).unwrap().to_string_lossy().replace('\\', "/");
                assets.push((rel, e.path().to_path_buf()));
            }
        }
    }
    let manifest = serde_json::json!({
        "id": proj.id, "name": proj.name, "manifest": proj.manifest,
        "exportedAt": crate::database::now_iso()
    });
    crate::export::pack_project(
        &serde_json::to_string_pretty(&manifest).unwrap(),
        &assets,
        std::path::Path::new(&dest_path),
    )?;
    Ok(dest_path)
}

#[tauri::command]
pub async fn import_project(handle: AppHandle, zip_path: String, name: Option<String>) -> Result<Project, String> {
    let bytes = std::fs::read(&zip_path).map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("file vuoto".into());
    }
    // valida zip + manifest fuori dal DB
    let tmp = std::env::temp_dir().join(format!("px-import-{}", uuid::Uuid::new_v4()));
    let manifest: serde_json::Value = crate::export::unpack_project(std::path::Path::new(&zip_path), &tmp)?;
    let pname = name
        .filter(|s| !s.trim().is_empty())
        .or_else(|| manifest.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| "Progetto importato".into());
    let created = create_project(handle.clone(), pname).await?;
    // copia assets importati
    let src_assets = tmp.join("assets");
    if src_assets.exists() {
        let dest = crate::storage::project_dir(&handle, &created.id)?.join("assets");
        copy_dir_recursive(&src_assets, &dest).map_err(|e| e.to_string())?;
    }
    // se il manifest contiene deck/carte, persistilo
    if let Some(inner) = manifest.get("manifest") {
        crate::database::with_conn(&handle, |c| {
            c.execute(
                "UPDATE projects SET manifest=?1, updated_at=?2 WHERE id=?3",
                params![inner.to_string(), crate::database::now_iso(), created.id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })?;
    }
    let _ = std::fs::remove_dir_all(&tmp);
    get_project(handle, created.id).await
}

#[cfg(test)]
mod tests {
    use super::query_summaries;

    fn memdb() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,created_at TEXT,updated_at TEXT,manifest TEXT);",
        )
        .unwrap();
        c
    }

    fn seed(c: &rusqlite::Connection, id: &str, name: &str, deck_n: usize, updated: &str) {
        let deck = (0..deck_n).map(|i| format!("{{\"id\":\"{id}-{i}\"}}")).collect::<Vec<_>>().join(",");
        let m = format!("{{\"version\":1,\"deck\":[{deck}],\"print\":{{}}}}");
        c.execute(
            "INSERT INTO projects VALUES(?1,?2,'2026-01-01',?3,?4)",
            rusqlite::params![id, name, updated, m],
        )
        .unwrap();
    }

    #[test]
    fn summaries_paginate_and_count_deck() {
        let c = memdb();
        seed(&c, "a", "Alpha", 3, "2026-01-03");
        seed(&c, "b", "Beta", 0, "2026-01-02");
        seed(&c, "g", "Gamma", 7, "2026-01-01");
        let p1 = query_summaries(&c, None, 2, 0).unwrap();
        assert_eq!(p1.total, 3);
        assert_eq!(p1.items.len(), 2);
        assert_eq!(p1.items[0].id, "a"); // updated_at DESC
        assert_eq!(p1.items[0].deck_count, 3);
        let p2 = query_summaries(&c, None, 2, 2).unwrap();
        assert_eq!(p2.items.len(), 1);
        assert_eq!(p2.items[0].id, "g");
        let q = query_summaries(&c, Some("%alp%"), 20, 0).unwrap();
        assert_eq!(q.total, 1);
        assert_eq!(q.items[0].name, "Alpha");
        // clamp limiti
        let big = query_summaries(&c, None, 9999, -5).unwrap();
        assert_eq!(big.items.len(), 3);
    }

    #[test]
    fn summaries_tolerate_broken_manifest() {
        let c = memdb();
        c.execute("INSERT INTO projects VALUES('x','X','2026-01-01','2026-01-01','non-json')", [])
            .unwrap();
        let p = query_summaries(&c, None, 20, 0).unwrap();
        assert_eq!(p.total, 1);
        assert_eq!(p.items[0].deck_count, 0);
    }

    #[test]
    fn default_print_sane() {
        let v = super::default_print_settings();
        assert_eq!(v["dpi"], 1200);
        assert_eq!(v["profile"], "maximum");
        assert_eq!(v["upscaleMode"], "always");
        assert_eq!(v["page"], "a4");
    }
}
