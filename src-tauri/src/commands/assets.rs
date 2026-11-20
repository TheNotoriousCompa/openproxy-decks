use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub source_hash: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
}

const ALLOWED_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
/// Limite download singolo artwork (le sorgenti MPC/Scryfall restano sotto).
const MAX_ARTWORK_BYTES: usize = 40 * 1024 * 1024;

fn norm_ext(ext: &str) -> String {
    let e = ext.to_lowercase();
    if e == "jpeg" {
        "jpg".to_string()
    } else {
        e
    }
}

fn find_by_hash(handle: &AppHandle, project_id: &str, hash: &str) -> Result<Option<Asset>, String> {
    crate::database::with_conn(handle, |c| {
        let mut st = c.prepare("SELECT id,project_id,kind,source_hash,path,width,height FROM assets WHERE project_id=?1 AND source_hash=?2 LIMIT 1").map_err(|e| e.to_string())?;
        let mut rows = st.query(params![project_id, hash]).map_err(|e| e.to_string())?;
        if let Some(r) = rows.next().map_err(|e| e.to_string())? {
            Ok(Some(Asset {
                id: r.get(0).map_err(|e| e.to_string())?,
                project_id: r.get(1).map_err(|e| e.to_string())?,
                kind: r.get(2).map_err(|e| e.to_string())?,
                source_hash: r.get(3).map_err(|e| e.to_string())?,
                path: r.get(4).map_err(|e| e.to_string())?,
                width: r.get(5).map_err(|e| e.to_string())?,
                height: r.get(6).map_err(|e| e.to_string())?,
            }))
        } else {
            Ok(None)
        }
    })
}

/// Salva byte immagine in `assets/<hash>.<ext>` con dedup per hash. Ritorna l'Asset.
pub fn store_asset_bytes(
    handle: &AppHandle,
    project_id: &str,
    bytes: &[u8],
    ext_hint: &str,
) -> Result<Asset, String> {
    if bytes.is_empty() {
        return Err("file vuoto".into());
    }
    if bytes.len() > MAX_ARTWORK_BYTES {
        return Err(format!("file troppo grande ({} MB, max 40)", bytes.len() / 1024 / 1024));
    }
    // Valida che sia davvero un'immagine decodificabile.
    let (w, h) = image::load_from_memory(bytes)
        .map(|i| {
            use image::GenericImageView;
            i.dimensions()
        })
        .map_err(|_| "file non riconosciuto come immagine supportata (png/jpg/webp/gif/bmp)".to_string())?;
    let mut ext = norm_ext(ext_hint);
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        // Sniff dal contenuto quando l'hint non è affidabile (URL senza estensione).
        ext = match image::guess_format(bytes).map_err(|e| e.to_string())? {
            image::ImageFormat::Png => "png",
            image::ImageFormat::Jpeg => "jpg",
            image::ImageFormat::WebP => "webp",
            image::ImageFormat::Gif => "gif",
            image::ImageFormat::Bmp => "bmp",
            _ => "png",
        }
        .to_string();
    }
    let hash = crate::storage::sha256_bytes(bytes);
    if let Some(a) = find_by_hash(handle, project_id, &hash)? {
        return Ok(a);
    }
    let pdir = crate::storage::project_dir(handle, project_id)?.join("assets");
    std::fs::create_dir_all(&pdir).map_err(|e| e.to_string())?;
    let dest = pdir.join(format!("{hash}.{ext}"));
    if !dest.exists() {
        // Stessa immagine già in un altro progetto → hard link (zero byte extra).
        // Cancellare un progetto non tocca gli altri (ogni nome è indipendente).
        let other = find_by_hash_any(handle, &hash)?.filter(|p| p != &dest);
        link_or_write(&dest, other.as_deref(), bytes)?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::database::now_iso();
    crate::database::with_conn(handle, |c| {
        c.execute(
            "INSERT INTO assets(id,project_id,kind,source_hash,path,width,height,created_at) VALUES(?1,?2,'image',?3,?4,?5,?6,?7)",
            params![id, project_id, hash, dest.to_string_lossy().to_string(), w as i64, h as i64, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    touch_project(handle, project_id)?;
    Ok(Asset {
        id,
        project_id: project_id.to_string(),
        kind: "image".into(),
        source_hash: hash,
        path: dest.to_string_lossy().to_string(),
        width: w,
        height: h,
    })
}

/// Cerca un asset con lo stesso hash in QUALSIASI progetto (dedup globale:
/// la stessa immagine in due progetti occupa un solo contenuto su disco).
/// Ritorna il path solo se il file esiste ancora.
fn find_by_hash_any(handle: &AppHandle, hash: &str) -> Result<Option<std::path::PathBuf>, String> {
    crate::database::with_conn(handle, |c| {
        let mut st = c.prepare("SELECT path FROM assets WHERE source_hash=?1").map_err(|e| e.to_string())?;
        let rows: Vec<String> = st
            .query_map(params![hash], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for p in rows {
            let pb = std::path::PathBuf::from(&p);
            if pb.exists() {
                return Ok(Some(pb));
            }
        }
        Ok(None)
    })
}

/// Scrive `bytes` in `dest` riusando `src` quando possibile: prima prova l'hard
/// link (stesso contenuto, zero byte extra; sicuro con NTFS/APFS/ext4), poi
/// ripiega sulla scrittura normale. Funzione pura (niente DB): testabile.
fn link_or_write(dest: &std::path::Path, src: Option<&std::path::Path>, bytes: &[u8]) -> Result<bool, String> {
    if let Some(s) = src {
        if s.exists() && std::fs::hard_link(s, dest).is_ok() {
            return Ok(true);
        }
    }
    std::fs::write(dest, bytes).map_err(|e| e.to_string())?;
    Ok(false)
}

fn touch_project(handle: &AppHandle, project_id: &str) -> Result<(), String> {
    crate::database::with_conn(handle, |c| {
        c.execute(
            "UPDATE projects SET updated_at=?1 WHERE id=?2",
            params![crate::database::now_iso(), project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn import_assets(handle: AppHandle, project_id: String, paths: Vec<String>) -> Result<Vec<Asset>, String> {
    // Risolve asset://localhost e percorsi plain; rifiuta blob:/remote:.
    let mut out = Vec::new();
    for src in paths {
        let fs_path = resolve_to_fs_path(&src)?;
        let sp = std::path::Path::new(&fs_path);
        let ext = sp.extension().and_then(|s| s.to_str()).unwrap_or("png").to_string();
        let bytes = std::fs::read(sp).map_err(|e| format!("read {}: {e}", sp.display()))?;
        out.push(store_asset_bytes(&handle, &project_id, &bytes, &ext)?);
    }
    Ok(out)
}

/// Upload dal picker file del frontend (File → byte via JS). Per l'app desktop.
#[tauri::command]
pub async fn import_asset_bytes(
    handle: AppHandle,
    project_id: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<Asset, String> {
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_string();
    store_asset_bytes(&handle, &project_id, &bytes, &ext)
}

/// Scarica un URL remoto in cache (senza registrazione DB): per export e preview.
/// Ritorna il path del file scaricato. Dedup per hash URL.
pub async fn download_remote_to_cache(handle: &AppHandle, url: &str) -> Result<std::path::PathBuf, String> {
    let parsed = url::Url::parse(url).map_err(|_| "URL non valido".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("solo URL http(s)".into());
    }
    let url_hash = crate::storage::sha256_bytes(url.as_bytes());
    let dir = crate::cache::final_dir(handle)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // riusa se presente (marker json accanto al file)
    let marker = dir.join(format!("remote-{url_hash}.json"));
    if marker.exists() {
        if let Ok(txt) = std::fs::read_to_string(&marker) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                if let Some(p) = v.get("path").and_then(|x| x.as_str()) {
                    let pb = std::path::PathBuf::from(p);
                    if pb.exists() {
                        return Ok(pb);
                    }
                }
            }
        }
    }
    let client = reqwest::Client::builder()
        // UA browser-like: Drive (e gli altri host dietro Cloudflare) bloccano
        // gli UA non browser con 403 — con UA custom le anteprime e l'export
        // delle art MPC fallivano in blocco. Timeout corto: è solo un download.
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| format!("download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("download: {e}"))?;
    if bytes.is_empty() || bytes.len() > MAX_ARTWORK_BYTES {
        return Err("download: dimensione non valida".into());
    }
    // Valida immagine + sniff estensione dal contenuto.
    image::load_from_memory(&bytes).map_err(|_| "download: non è un'immagine valida".to_string())?;
    let ext = match image::guess_format(&bytes).map_err(|e| e.to_string())? {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Gif => "gif",
        image::ImageFormat::Bmp => "bmp",
        _ => "jpg",
    };
    let dest = dir.join(format!("remote-{url_hash}.{ext}"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::write(
        &marker,
        serde_json::json!({ "url": url, "path": dest.to_string_lossy() }).to_string(),
    );
    Ok(dest)
}

/// Scarica un artwork remoto (Scryfall/MPC) in cache progetto con dedup per hash.
#[tauri::command]
pub async fn fetch_artwork(handle: AppHandle, project_id: String, url: String) -> Result<Asset, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "URL non valido".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("solo URL http(s)".into());
    }
    // Dedup per URL: se già scaricato in questo progetto, riusa.
    let url_hash = crate::storage::sha256_bytes(url.as_bytes());
    let cache_dir = crate::cache::processed_dir(&handle)?;
    let marker = cache_dir.join(format!("url-{url_hash}.json"));
    if marker.exists() {
        if let Ok(txt) = std::fs::read_to_string(&marker) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                if let Some(h) = v.get("source_hash").and_then(|x| x.as_str()) {
                    if let Some(a) = find_by_hash(&handle, &project_id, h)? {
                        return Ok(a);
                    }
                }
            }
        }
    }
    let client = reqwest::Client::builder()
        // UA browser-like: alcuni host (Cloudflare/Drive) bloccano UA non browser.
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Proxxied/0.1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url.clone()).send().await.map_err(|e| format!("download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download: HTTP {}", resp.status()));
    }
    if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE) {
        let ct = ct.to_str().unwrap_or("").to_lowercase();
        // Drive risponde application/binary con redirect già seguito da reqwest.
        if !ct.starts_with("image/")
            && !ct.starts_with("application/octet-stream")
            && !ct.starts_with("application/binary")
        {
            return Err(format!("content-type non immagine: {ct}"));
        }
    }
    let bytes = resp.bytes().await.map_err(|e| format!("download: {e}"))?;
    if bytes.len() > MAX_ARTWORK_BYTES {
        return Err("immagine remota troppo grande (max 40 MB)".into());
    }
    let ext_hint = parsed
        .path_segments()
        .and_then(|mut s| s.next_back())
        .and_then(|f| std::path::Path::new(f).extension())
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();
    let asset = store_asset_bytes(&handle, &project_id, &bytes, &ext_hint)?;
    let _ = std::fs::write(
        &marker,
        serde_json::json!({ "url": url, "source_hash": asset.source_hash }).to_string(),
    );
    Ok(asset)
}

/// Converte URL `asset://` (convertFileSrc) o percorsi plain in path filesystem.
/// Rifiuta `blob:`/`data:` (vanno re-importati) e remoti http(s) (usare fetch_artwork).
pub fn resolve_to_fs_path(src: &str) -> Result<String, String> {
    if src.starts_with("blob:") || src.starts_with("data:") {
        return Err("riferimento sessione scaduto (blob:): ricarica il file".into());
    }
    if src.starts_with("https://asset.localhost/") || src.starts_with("http://asset.localhost/") {
        let prefix = if src.starts_with("https://") {
            "https://asset.localhost/"
        } else {
            "http://asset.localhost/"
        };
        let enc = &src[prefix.len()..];
        let no_query = enc.split('?').next().unwrap_or(enc);
        // convertFileSrc percent-encoda il path; decodifica manuale minimale.
        let decoded = percent_decode(no_query);
        // Su Windows il path è tipo /C:/... → rimuovi la slash iniziale.
        let stripped = decoded.strip_prefix('/').unwrap_or(&decoded);
        // Normalizza separatori per Windows.
        return Ok(stripped.replace('/', std::path::MAIN_SEPARATOR_STR));
    }
    if src.starts_with("asset://") {
        let rest = src.trim_start_matches("asset://").trim_start_matches("localhost");
        let decoded = percent_decode(rest);
        let stripped = decoded.strip_prefix('/').unwrap_or(&decoded);
        return Ok(stripped.replace('/', std::path::MAIN_SEPARATOR_STR));
    }
    if src.starts_with("http://") || src.starts_with("https://") {
        return Err("URL remoto: usare fetch_artwork per scaricarlo prima".into());
    }
    if src.starts_with("file://") {
        return Ok(src.trim_start_matches("file://").to_string());
    }
    Ok(src.to_string())
}

fn percent_decode(s: &str) -> String {
    // Decodifica %XX a livello di byte e ricompone UTF-8 (nomi con accenti).
    let mut bytes: Vec<u8> = Vec::with_capacity(s.len());
    let mut it = s.as_bytes().iter();
    while let Some(&b) = it.next() {
        if b == b'%' {
            let hi = it.next().copied().unwrap_or(b'0');
            let lo = it.next().copied().unwrap_or(b'0');
            let hex = |c: u8| (c as char).to_digit(16).unwrap_or(0) as u8;
            bytes.push(hex(hi) * 16 + hex(lo));
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|_| s.to_string())
}

#[tauri::command]
pub async fn list_assets(handle: AppHandle, project_id: String) -> Result<Vec<Asset>, String> {
    crate::database::with_conn(&handle, |c| {
        let mut st = c.prepare("SELECT id,project_id,kind,source_hash,path,width,height FROM assets WHERE project_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
        let rows = st.query_map(params![project_id], |r| {
            Ok(Asset {
                id: r.get(0)?,
                project_id: r.get(1)?,
                kind: r.get(2)?,
                source_hash: r.get(3)?,
                path: r.get(4)?,
                width: r.get(5)?,
                height: r.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
        Ok(out)
    })
}

#[tauri::command]
pub async fn delete_asset(handle: AppHandle, id: String) -> Result<(), String> {
    crate::database::with_conn(&handle, |c| {
        c.execute("DELETE FROM assets WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Cartelle di un progetto (create se mancano): immagini locali + export PDF.
/// Per gli shortcut "Visualizza" (apertura con l'explorer di sistema).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectFolders {
    pub assets: String,
    pub exports: String,
}

#[tauri::command]
pub async fn project_folders(handle: AppHandle, project_id: String) -> Result<ProjectFolders, String> {
    let dir = crate::storage::project_dir(&handle, &project_id)?;
    let assets = dir.join("assets");
    let exports = dir.join("exports");
    std::fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    Ok(ProjectFolders {
        assets: assets.to_string_lossy().to_string(),
        exports: exports.to_string_lossy().to_string(),
    })
}

/// Quanto occupano le immagini locali di un progetto (conteggio + byte reali).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectStorageInfo {
    pub asset_count: usize,
    pub asset_bytes: u64,
}

#[tauri::command]
pub async fn project_storage_info(handle: AppHandle, project_id: String) -> Result<ProjectStorageInfo, String> {
    let paths: Vec<String> = crate::database::with_conn(&handle, |c| {
        let mut st = c.prepare("SELECT path FROM assets WHERE project_id=?1").map_err(|e| e.to_string())?;
        let rows: Vec<String> = st
            .query_map(params![project_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })?;
    let mut bytes = 0u64;
    for p in &paths {
        bytes += std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    }
    Ok(ProjectStorageInfo { asset_count: paths.len(), asset_bytes: bytes })
}

/// Svuota le immagini locali di un progetto (righe DB + file dentro assets/).
/// Il deck resta intatto (nomi/provider): basta "Trova artwork" per riscaricare.
/// Con la dedup globale gli altri progetti non soffrono (hard link indipendenti).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ClearAssetsResult {
    pub removed: usize,
    pub freed_bytes: u64,
}

#[tauri::command]
pub async fn clear_project_assets(handle: AppHandle, project_id: String) -> Result<ClearAssetsResult, String> {
    let dir = crate::storage::project_dir(&handle, &project_id)?;
    let adir = dir.join("assets");
    let paths: Vec<String> = crate::database::with_conn(&handle, |c| {
        let mut st = c.prepare("SELECT path FROM assets WHERE project_id=?1").map_err(|e| e.to_string())?;
        let rows: Vec<String> = st
            .query_map(params![project_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })?;
    let mut freed = 0u64;
    for p in &paths {
        let pb = std::path::PathBuf::from(p);
        // Sicurezza: cancella solo file dentro assets/ di questo progetto.
        if pb.starts_with(&adir) {
            freed += std::fs::metadata(&pb).map(|m| m.len()).unwrap_or(0);
            let _ = std::fs::remove_file(&pb);
        }
    }
    let removed = paths.len();
    crate::database::with_conn(&handle, |c| {
        c.execute("DELETE FROM assets WHERE project_id=?1", params![project_id]).map_err(|e| e.to_string())?;
        Ok(())
    })?;
    touch_project(&handle, &project_id)?;
    Ok(ClearAssetsResult { removed, freed_bytes: freed })
}

/// Thumbnail come data: URL (niente asset-protocol, niente scope: rendering garantito).
/// Riusa thumb_for (download+valida+cache) e codifica il file in base64.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ThumbData {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn thumb_data_url(handle: AppHandle, url: String, max_px: u32) -> Result<ThumbData, String> {
    let path = thumb_for_path(&handle, &url, max_px).await?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("thumb troppo grande per data URL".into());
    }
    let img = image::load_from_memory(&bytes).map_err(|e| format!("thumb non valida: {e}"))?;
    use image::GenericImageView;
    let (w, h) = img.dimensions();
    Ok(ThumbData {
        data_url: format!("data:image/jpeg;base64,{}", base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)),
        width: w,
        height: h,
    })
}

/// Stato diagnostico di un riferimento artwork (mai nero muto in UI).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ArtworkStatus {
    pub kind: String,
    pub exists: bool,
    pub decodes: bool,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub detail: String,
}

#[tauri::command]
pub async fn artwork_status(src: String) -> Result<ArtworkStatus, String> {
    if src.starts_with("blob:") || src.starts_with("data:") {
        return Ok(ArtworkStatus {
            kind: "session".into(),
            exists: false,
            decodes: false,
            width: 0,
            height: 0,
            bytes: 0,
            detail: "riferimento di sessione scaduto: ricaricare il file".into(),
        });
    }
    if src.starts_with("http://") || src.starts_with("https://") {
        if src.contains("asset.localhost") {
            match resolve_to_fs_path(&src) {
                Ok(p) => return Ok(status_for_path(&p)),
                Err(e) => {
                    return Ok(ArtworkStatus {
                        kind: "asset".into(),
                        exists: false,
                        decodes: false,
                        width: 0,
                        height: 0,
                        bytes: 0,
                        detail: e,
                    })
                }
            }
        }
        return Ok(ArtworkStatus {
            kind: "remote".into(),
            exists: true,
            decodes: false,
            width: 0,
            height: 0,
            bytes: 0,
            detail: "URL remoto non scaricato: usare fetch_artwork/thumb_for".into(),
        });
    }
    let plain = src.strip_prefix("file://").unwrap_or(&src).to_string();
    Ok(status_for_path(&plain))
}

fn status_for_path(plain: &str) -> ArtworkStatus {
    let pb = std::path::PathBuf::from(plain);
    if !pb.exists() {
        return ArtworkStatus {
            kind: "missing".into(),
            exists: false,
            decodes: false,
            width: 0,
            height: 0,
            bytes: 0,
            detail: format!("file mancante: {plain}"),
        };
    }
    let bytes = std::fs::metadata(&pb).map(|m| m.len()).unwrap_or(0);
    let data = match std::fs::read(&pb) {
        Ok(d) => d,
        Err(e) => {
            return ArtworkStatus {
                kind: "corrupt".into(),
                exists: true,
                decodes: false,
                width: 0,
                height: 0,
                bytes,
                detail: format!("non leggibile: {e}"),
            }
        }
    };
    match image::load_from_memory(&data) {
        Ok(img) => {
            use image::GenericImageView;
            let (w, h) = img.dimensions();
            ArtworkStatus {
                kind: "local".into(),
                exists: true,
                decodes: true,
                width: w,
                height: h,
                bytes,
                detail: format!("{w}x{h}"),
            }
        }
        Err(e) => ArtworkStatus {
            kind: "corrupt".into(),
            exists: true,
            decodes: false,
            width: 0,
            height: 0,
            bytes,
            detail: format!("non decodificabile: {e}"),
        },
    }
}

/// Thumbnail garantita via backend: scarica/valida/cache, ritorna path locale.
/// La UI non deve mai dipendere dalla rete della WebView per le anteprime.
#[tauri::command]
pub async fn thumb_for(handle: AppHandle, url: String, max_px: u32) -> Result<String, String> {
    Ok(thumb_for_path(&handle, &url, max_px).await?.to_string_lossy().to_string())
}

pub async fn thumb_for_path(
    handle: &AppHandle,
    url: &str,
    max_px: u32,
) -> Result<std::path::PathBuf, String> {
    let max_px = max_px.clamp(64, 1024);
    let key = crate::cache::make_key(&["thumb2", url, &max_px.to_string()]);
    if let Some(hit) = crate::cache::lookup(handle, &key)? {
        if hit.exists() {
            return Ok(hit);
        }
    }
    // Risolvi i byte: file locale oppure download remoto. Mai upscale in preview.
    let is_remote = url.starts_with("https://") || url.starts_with("http://");
    let bytes: Vec<u8> = if is_remote {
        let tmp = download_remote_to_cache(handle, url).await.map_err(|e| {
            eprintln!("[proxxied] thumb: download fallito {url}: {e}");
            e
        })?;
        std::fs::read(&tmp).map_err(|e| e.to_string())?
    } else {
        let p = resolve_to_fs_path(url)?;
        std::fs::read(std::path::Path::new(&p)).map_err(|e| {
            eprintln!("[proxxied] thumb: lettura fallita {url}: {e}");
            e.to_string()
        })?
    };
    const PASSTHROUGH_MAX_BYTES: usize = 768 * 1024;
    let dir = crate::cache::processed_dir(handle)?.join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // File piccoli che ci stanno nei bounds → byte originali (res nativa, zero processing).
    if bytes.len() <= PASSTHROUGH_MAX_BYTES {
        if let Ok(img) = image::load_from_memory(&bytes) {
            use image::GenericImageView;
            let (w, h) = img.dimensions();
            if w <= max_px && h <= max_px && w > 0 && h > 0 {
                let ext = match image::guess_format(&bytes) {
                    Ok(image::ImageFormat::Png) => "png",
                    Ok(image::ImageFormat::Jpeg) => "jpg",
                    Ok(image::ImageFormat::WebP) => "webp",
                    Ok(image::ImageFormat::Gif) => "gif",
                    Ok(image::ImageFormat::Bmp) => "bmp",
                    _ => "jpg",
                };
                let dest = dir.join(format!("{key}.{ext}"));
                if !dest.exists() {
                    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
                }
                crate::cache::store(handle, &key, &dest)?;
                return Ok(dest);
            }
        }
    }
    // Altrimenti solo downsample (mai upscale) + normalizzazione color-type.
    let img = image::load_from_memory(&bytes).map_err(|e| {
        eprintln!("[proxxied] thumb: decode fallita ({url}, {} bytes): {e}", bytes.len());
        format!("thumb non valida: {e}")
    })?;
    let img = normalize_for_thumb(img);
    let thumb = img.thumbnail(max_px, max_px);
    let dest = dir.join(format!("{key}.jpg"));
    crate::image::write_optimized(&thumb, &dest, 82).map_err(|e| {
        eprintln!("[proxxied] thumb: encode fallita {url}: {e}");
        e
    })?;
    crate::cache::store(handle, &key, &dest)?;
    Ok(dest)
}

/// Converte in RGBA8: appiattisce gray/16-bit/palette per resize/encode sicuri.
fn normalize_for_thumb(img: image::DynamicImage) -> image::DynamicImage {
    if matches!(img.color(), image::ColorType::Rgb8 | image::ColorType::Rgba8) {
        return img;
    }
    // via RGBA8: preserva l'alpha (il flatten per JPEG avviene in write_optimized)
    image::DynamicImage::ImageRgba8(img.to_rgba8())
}

#[cfg(test)]
mod tests {
    use super::{link_or_write, percent_decode, resolve_to_fs_path};
    use image::GenericImageView;

    #[test]
    fn asset_localhost_roundtrip() {
        // convertFileSrc("C:\\a\\b.png") → https://asset.localhost/C%3A%5Ca%5Cb.png (forma tipica)
        let p = resolve_to_fs_path("https://asset.localhost/C%3A%5Ca%5Cb.png").unwrap();
        assert!(p.contains('a') && p.ends_with("b.png"), "got {p}");
        assert!(!p.starts_with('/'));
    }

    #[test]
    fn rejects_session_and_remote() {
        assert!(resolve_to_fs_path("blob:https://x/123").is_err());
        assert!(resolve_to_fs_path("https://cards.scryfall.io/x.jpg").is_err());
    }

    #[test]
    fn plain_path_passthrough() {
        assert_eq!(resolve_to_fs_path("C:\\img\\a.png").unwrap(), "C:\\img\\a.png");
    }

    #[test]
    fn percent_decode_utf8() {
        assert_eq!(percent_decode("Mauh%C3%BBr.png"), "Mauhûr.png");
    }

    #[test]
    fn status_missing_blob() {
        let s = super::status_for_path("C:\\definitivamente\\assente\\x.png");
        assert_eq!(s.kind, "missing");
        assert!(!s.exists);
    }

    #[test]
    fn status_valid_png() {
        let dir = std::env::temp_dir().join(format!("px-st-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("ok.png");
        let img = image::DynamicImage::new_rgba8(12, 20);
        img.save_with_format(&p, image::ImageFormat::Png).unwrap();
        let s = super::status_for_path(&p.to_string_lossy());
        assert_eq!(s.kind, "local");
        assert!(s.decodes);
        assert_eq!((s.width, s.height), (12, 20));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_corrupt() {
        let dir = std::env::temp_dir().join(format!("px-stc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("bad.png");
        std::fs::write(&p, b"non-sono-un-immagine").unwrap();
        let s = super::status_for_path(&p.to_string_lossy());
        assert_eq!(s.kind, "corrupt");
        assert!(!s.decodes);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn normalize_gray16_to_rgba() {
        let gray16 = image::DynamicImage::ImageLuma16(image::ImageBuffer::from_pixel(
            4,
            4,
            image::Luma([0x1234u16]),
        ));
        assert!(matches!(gray16.color(), image::ColorType::L16));
        let out = super::normalize_for_thumb(gray16);
        assert!(matches!(out.color(), image::ColorType::Rgba8));
        assert_eq!(out.dimensions(), (4, 4));
    }

    #[test]
    fn normalize_keeps_rgb_rgba() {
        let rgb = image::DynamicImage::new_rgb8(4, 4);
        assert!(matches!(super::normalize_for_thumb(rgb).color(), image::ColorType::Rgb8));
    }

    #[test]
    fn link_or_write_riusa_senza_riscrivere() {
        let dir = std::env::temp_dir().join(format!("proxxied-link-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.bin");
        let dest = dir.join("b.bin");
        std::fs::write(&src, b"stessi-byte").unwrap();
        // con sorgente: non riscrive (hard link o copia), contenuto identico
        link_or_write(&dest, Some(&src), b"stessi-byte").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"stessi-byte");
        // senza sorgente: scrittura normale
        let dest2 = dir.join("c.bin");
        let linked = link_or_write(&dest2, None, b"nuovi-byte").unwrap();
        assert!(!linked);
        assert_eq!(std::fs::read(&dest2).unwrap(), b"nuovi-byte");
        // cancellare una copia non tocca l'altra
        std::fs::remove_file(&dest).unwrap();
        assert_eq!(std::fs::read(&src).unwrap(), b"stessi-byte");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
