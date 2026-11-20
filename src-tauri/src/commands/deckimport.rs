//! Import deck da link Moxfield / Archidekt (stessa barra di ricerca).
//!
//! Il `fetch` frontend è soggetto a CORS (Moxfield 403 su UA non browser,
//! Archidekt allow-origin solo localhost:3000): Rust non ha CORS, quindi
//! l'app desktop risolve i link qui con allowlist stretta anti-SSRF.
//! Nessuna chiave/API privata: solo deck pubblici.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedEntry {
    pub qty: u32,
    pub name: String,
    pub zone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collector_number: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeckImportResult {
    pub name: String,
    pub provider: String,
    pub entries: Vec<ImportedEntry>,
    pub unknown: Vec<String>,
    pub warnings: Vec<String>,
}

fn valid_moxfield_id(id: &str) -> bool {
    let t = id.trim();
    if t.len() < 4 || t.len() > 64 {
        return false;
    }
    t.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_archidekt_id(id: &str) -> bool {
    let t = id.trim();
    if t.is_empty() || t.len() > 12 {
        return false;
    }
    t.chars().all(|c| c.is_ascii_digit())
}

/// normalizza categoria/board → zona interna (main/side/commander/extra/maybe/considering/tokens/custom)
fn map_zone(raw: &str) -> String {
    // Ordine importante: "considering" contiene "side" → va controllata prima.
    let l = raw.trim().to_lowercase();
    if l.contains("consider") {
        "considering".into()
    } else if l.contains("command") {
        "commander".into()
    } else if l.contains("maybe") {
        "maybe".into()
    } else if l.contains("side") {
        "side".into()
    } else if l.contains("token") {
        "tokens".into()
    } else if l.contains("extra") || l.contains("compan") || l.contains("attract") {
        "extra".into()
    } else {
        "main".into()
    }
}

fn entry(qty: u32, name: &str, zone: &str, set: Option<String>, cn: Option<String>) -> Option<ImportedEntry> {
    let name = name.trim().to_string();
    if name.is_empty() || qty == 0 || qty > 99 {
        return None;
    }
    let clean_set = set
        .map(|s| s.trim().to_uppercase())
        .filter(|s| (2..=6).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric()));
    let clean_cn = cn
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.len() <= 12);
    Some(ImportedEntry {
        qty,
        name,
        zone: map_zone(zone),
        set_code: clean_set,
        collector_number: clean_cn,
    })
}

fn str_field(v: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(k).and_then(|x| x.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn u32_field(v: &serde_json::Value, keys: &[&str]) -> Option<u32> {
    for k in keys {
        if let Some(n) = v.get(k).and_then(|x| x.as_u64()) {
            if n > 0 && n <= 99 {
                return Some(n as u32);
            }
        }
        // alcuni payload usano float o stringa numerica
        if let Some(s) = v.get(k).and_then(|x| x.as_str()) {
            if let Ok(n) = s.trim().parse::<u32>() {
                if n > 0 && n <= 99 {
                    return Some(n);
                }
            }
        }
    }
    None
}

/// Moxfield v2: boards = { mainboard, sideboard, maybeboard, commanders, companions, ... }
/// ogni voce: { quantity, card: { name, set, cn } } con varianti di casing/shape.
fn parse_moxfield(root: &serde_json::Value) -> DeckImportResult {
    let name = str_field(root, &["name", "deckName", "title"]).unwrap_or_else(|| "Mazzo Moxfield".into());
    let mut entries = Vec::new();
    let mut unknown = Vec::new();
    let mut warnings = Vec::new();

    let boards: &[(&str, &str)] = &[
        ("mainboard", "main"),
        ("main", "main"),
        ("sideboard", "side"),
        ("side", "side"),
        ("commanders", "commander"),
        ("commander", "commander"),
        ("companions", "extra"),
        ("maybeboard", "maybe"),
        ("maybe", "maybe"),
        ("considering", "considering"),
        ("tokens", "tokens"),
        ("extra", "extra"),
    ];
    let mut found_any_board = false;
    for (key, zone) in boards {
        let Some(board) = root.get(*key) else {
            continue;
        };
        found_any_board = true;
        if let Some(obj) = board.as_object() {
            for (map_key, item) in obj {
                let qty = u32_field(item, &["quantity", "qty", "count"]).unwrap_or(1);
                let card = item.get("card").unwrap_or(item);
                let cname = str_field(card, &["name", "cardName", "oracleName"])
                    .or_else(|| str_field(item, &["name", "cardName"]));
                match cname {
                    Some(n) => {
                        let set = str_field(card, &["set", "setCode", "edition", "expansion"]);
                        let cn = str_field(card, &["cn", "collectorNumber", "collector_number", "number"]);
                        match entry(qty, &n, zone, set, cn) {
                            Some(e) => entries.push(e),
                            None => unknown.push(map_key.clone()),
                        }
                    }
                    None => unknown.push(map_key.clone()),
                }
            }
        } else if let Some(arr) = board.as_array() {
            for item in arr {
                let qty = u32_field(item, &["quantity", "qty", "count"]).unwrap_or(1);
                let card = item.get("card").unwrap_or(item);
                let cname = str_field(card, &["name", "cardName"])
                    .or_else(|| str_field(item, &["name"]));
                match cname {
                    Some(n) => {
                        let set = str_field(card, &["set", "setCode", "edition"]);
                        let cn = str_field(card, &["cn", "collectorNumber", "number"]);
                        if let Some(e) = entry(qty, &n, zone, set, cn) {
                            entries.push(e);
                        } else {
                            unknown.push(n);
                        }
                    }
                    None => unknown.push("(voce senza nome)".into()),
                }
            }
        }
    }
    if !found_any_board {
        warnings.push("formato Moxfield non riconosciuto (nessuna board nota)".into());
    }
    // consolida duplicati stesso nome+zona+set
    consolidate(&mut entries, &mut warnings);
    DeckImportResult {
        name,
        provider: "moxfield".into(),
        entries,
        unknown,
        warnings,
    }
}

/// Archidekt: { name, cards: [ { quantity, category, card: { oracleCard: { name }, edition: { editioncode }, collectorNumber } } ] }
fn parse_archidekt(root: &serde_json::Value) -> DeckImportResult {
    let name = str_field(root, &["name", "title"]).unwrap_or_else(|| "Mazzo Archidekt".into());
    let mut entries = Vec::new();
    let mut unknown = Vec::new();
    let mut warnings = Vec::new();

    let cards = root
        .get("cards")
        .and_then(|c| c.as_array())
        .or_else(|| root.get("cardList").and_then(|c| c.as_array()));
    let Some(cards) = cards else {
        warnings.push("formato Archidekt non riconosciuto (manca cards[])".into());
        return DeckImportResult {
            name,
            provider: "archidekt".into(),
            entries,
            unknown,
            warnings,
        };
    };
    for item in cards {
        let qty = u32_field(item, &["quantity", "qty"]).unwrap_or(1);
        let zone_raw = str_field(item, &["category", "board", "zone"]).unwrap_or_else(|| "Mainboard".into());
        let card = item.get("card").unwrap_or(item);
        // nome: oracleCard.name > card.name > name
        let oracle_name = card
            .get("oracleCard")
            .and_then(|o| str_field(o, &["name"]));
        let cname = oracle_name
            .or_else(|| str_field(card, &["name", "cardName"]))
            .or_else(|| str_field(item, &["name"]));
        let Some(cname) = cname else {
            unknown.push("(voce senza nome)".into());
            continue;
        };
        // set: edition.editioncode > edition > set
        let edition = card.get("edition");
        let set = edition
            .and_then(|e| str_field(e, &["editioncode", "code", "set"]))
            .or_else(|| str_field(card, &["edition", "set", "setCode", "expansion"]));
        let cn = str_field(card, &["collectorNumber", "collector_number", "cn", "number"]);
        match entry(qty, &cname, &zone_raw, set, cn) {
            Some(e) => entries.push(e),
            None => unknown.push(cname),
        }
    }
    consolidate(&mut entries, &mut warnings);
    DeckImportResult {
        name,
        provider: "archidekt".into(),
        entries,
        unknown,
        warnings,
    }
}

fn consolidate(entries: &mut Vec<ImportedEntry>, warnings: &mut Vec<String>) {
    use std::collections::HashMap;
    let mut map: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<ImportedEntry> = Vec::with_capacity(entries.len());
    for e in entries.drain(..) {
        let k = format!(
            "{}|{}|{}|{}",
            e.zone,
            e.name.to_lowercase(),
            e.set_code.clone().unwrap_or_default(),
            e.collector_number.clone().unwrap_or_default()
        );
        if let Some(&idx) = map.get(&k) {
            out[idx].qty = out[idx].qty.saturating_add(e.qty).min(99);
            warnings.push(format!("Unite {}x {} (duplicato)", e.qty, e.name));
        } else {
            map.insert(k, out.len());
            out.push(e);
        }
    }
    *entries = out;
}

async fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    let (status, json) = get_api(url).await?;
    if status == 404 {
        return Err("mazzo non trovato (link errato o privato)".into());
    }
    if status == 403 || status == 401 {
        return Err("mazzo privato o accesso negato (rendilo pubblico)".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    json.ok_or_else(|| "JSON non valido: risposta vuota".into())
}

/// GET con status esposto: serve a distinguere 404 (inesistente) da altri
/// errori quando si sondano più varianti di endpoint.
async fn get_api(url: &str) -> Result<(u16, Option<serde_json::Value>), String> {
    let client = super::mpc::http_client()?;
    let resp = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("rete: {e}"))?;
    let status = resp.status().as_u16();
    let bytes = resp.bytes().await.map_err(|e| format!("rete: {e}"))?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("risposta troppo grande".into());
    }
    Ok((status, serde_json::from_slice(&bytes).ok()))
}

#[tauri::command]
pub async fn fetch_moxfield_deck(id: String) -> Result<DeckImportResult, String> {
    let id = id.trim().to_string();
    if !valid_moxfield_id(&id) {
        return Err("ID Moxfield non valido".into());
    }
    let url = format!("https://api.moxfield.com/v2/decks/all/{id}");
    let json = fetch_json(&url).await?;
    let r = parse_moxfield(&json);
    if r.entries.is_empty() {
        return Err("nessuna carta trovata (mazzo vuoto o privato)".into());
    }
    Ok(r)
}

#[tauri::command]
pub async fn fetch_archidekt_deck(id: String) -> Result<DeckImportResult, String> {
    let id = id.trim().to_string();
    if !valid_archidekt_id(&id) {
        return Err("ID Archidekt non valido".into());
    }
    let url = format!("https://archidekt.com/api/decks/{id}/");
    let json = fetch_json(&url).await?;
    let r = parse_archidekt(&json);
    if r.entries.is_empty() {
        return Err("nessuna carta trovata (mazzo vuoto o privato)".into());
    }
    Ok(r)
}

#[derive(Debug, Clone, Serialize)]
pub struct UserDeckSummary {
    pub public_id: String,
    pub name: String,
    pub format: String,
    pub main_count: u32,
    pub total_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserDecksResult {
    pub user: String,
    pub decks: Vec<UserDeckSummary>,
    pub total: usize,
}

fn valid_moxfield_user(u: &str) -> bool {
    let t = u.trim();
    if t.len() < 2 || t.len() > 64 {
        return false;
    }
    t.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

fn u32_or_zero(v: &serde_json::Value, keys: &[&str]) -> u32 {
    for k in keys {
        if let Some(n) = v.get(k).and_then(|x| x.as_u64()) {
            return n.min(99999) as u32;
        }
        if let Some(s) = v.get(k).and_then(|x| x.as_str()) {
            if let Ok(n) = s.trim().parse::<u64>() {
                return n.min(99999) as u32;
            }
        }
    }
    0
}

/// Lista deck pubblici di un utente Moxfield. Parser tollerante: la forma
/// esatta della risposta non è documentata, quindi si accettano varianti di
/// chiavi (`data`|`decks`|array radice; `publicId`|`public_id`|`id`; …).
/// Ritorna (sintesi, totale dichiarato o 0 se assente).
fn parse_moxfield_user_decks(root: &serde_json::Value) -> (Vec<UserDeckSummary>, usize) {
    let arr: Option<&Vec<serde_json::Value>> = root
        .get("data")
        .or_else(|| root.get("decks"))
        .or_else(|| root.get("results"))
        .and_then(|v| v.as_array())
        .or_else(|| root.as_array());
    let Some(arr) = arr else {
        return (Vec::new(), 0);
    };
    let mut decks = Vec::new();
    for item in arr {
        let Some(pid) = str_field(item, &["publicId", "public_id", "publicid", "id"]) else {
            continue;
        };
        let name = str_field(item, &["name", "title"]).unwrap_or_else(|| "Senza nome".into());
        let format = str_field(item, &["format", "formatName", "gameFormat"]).unwrap_or_default();
        let main = u32_or_zero(item, &["mainboardCount", "mainCardCount", "mainCount", "main"]);
        let side = u32_or_zero(item, &["sideboardCount", "sideCardCount", "side"]);
        let total = u32_or_zero(item, &["totalCards", "cardCount", "totalCardCount", "copies", "total"]);
        let total_count = if total > 0 { total } else { main.saturating_add(side) };
        let updated_at = str_field(item, &["lastUpdatedAt", "updatedAt", "updated_at", "lastUpdated"]);
        decks.push(UserDeckSummary {
            public_id: pid,
            name,
            format,
            main_count: main,
            total_count,
            updated_at,
        });
    }
    let total = root
        .get("totalResults")
        .or_else(|| root.get("total"))
        .or_else(|| root.get("totalDecks"))
        .or_else(|| root.get("totalCount"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    (decks, total)
}

/// Deck pubblici di un profilo Moxfield (paginati, solo pubblici: i privati
/// richiedono login e restano fuori portata). Da qui l'import in blocco
/// crea un progetto per deck selezionato.
///
/// La forma esatta dell'endpoint non è documentata: si sondano varianti
/// (v2/v1, con/senza query di paginazione, case del nickname) e si usa la
/// prima che risponde 2xx con forma riconosciuta.
#[tauri::command]
pub async fn fetch_moxfield_user_decks(user: String) -> Result<UserDecksResult, String> {
    let user = user.trim().to_string();
    if !valid_moxfield_user(&user) {
        return Err("nickname Moxfield non valido".into());
    }
    let mut winner: Option<String> = None;
    let mut first_batch: Vec<UserDeckSummary> = Vec::new();
    let mut first_total = 0usize;
    let mut saw_404_only = true;
    'probe: for base in user_decks_bases(&user) {
        let url = page_url(&base, 1);
        match get_api(&url).await {
            Ok((200..=299, Some(json))) if user_decks_recognized(&json) => {
                let (batch, total) = parse_moxfield_user_decks(&json);
                winner = Some(base);
                first_batch = batch;
                first_total = total;
                break 'probe;
            }
            Ok((200..=299, _)) => continue, // 2xx ma forma ignota: altra variante
            Ok((404, _)) => continue,       // variante inesistente: altra variante
            Ok((_code, _)) => {
                saw_404_only = false;
                continue;
            }
            Err(_) => {
                saw_404_only = false;
                continue;
            }
        }
    }
    let Some(tmpl) = winner else {
        if saw_404_only {
            return Err("utente non trovato (nickname errato o profilo privato)".into());
        }
        return Err("lista deck non leggibile (Moxfield non risponde come previsto)".into());
    };
    let mut decks = first_batch;
    let mut total = first_total;
    if decks.is_empty() {
        // pagina 1 riconosciuta ma vuota: niente da paginare
        return Err("nessun deck pubblico trovato per questo utente".into());
    }
    // la forma secca (?pageSize=100) non ha numero pagina: se dichiara più
    // deck di quelli ricevuti, si continua con la forma paginata v2.
    let mut tmpl = tmpl;
    if !tmpl.contains("{p}") && total > decks.len() {
        tmpl = format!("https://api.moxfield.com/v2/users/{user}/decks?pageNumber={{p}}&pageSize=100");
    }
    if tmpl.contains("{p}") {
        for page in 2..=10u32 {
            let json = match get_api(&page_url(&tmpl, page)).await {
                Ok((200..=299, Some(j))) => j,
                _ => break,
            };
            let (mut batch, t) = parse_moxfield_user_decks(&json);
            if page == 2 && total == 0 {
                total = t;
            }
            let n = batch.len();
            decks.append(&mut batch);
            if n == 0 {
                break;
            }
            if total > 0 && decks.len() >= total {
                break;
            }
            if n < 100 {
                break;
            }
        }
    }
    Ok(UserDecksResult { user, total: total.max(decks.len()), decks })
}

/// Template URL candidati per la lista deck (con `{p}` = numero pagina dove
/// supportato). Puro e testabile. Ordine: forma verificata dalla comunità
/// (`?pageSize=100` secca) prima delle varianti; poi v1, poi ricerca per
/// autore (`authorUserNames`, vista dal vivo su api2), poi stesse con
/// nickname minuscolo (l'API potrebbe essere case-sensitive mentre il sito no).
fn user_decks_bases(user: &str) -> Vec<String> {
    let mut names = vec![user.to_string()];
    let lower = user.to_lowercase();
    if lower != *user {
        names.push(lower);
    }
    let mut out = Vec::new();
    for name in &names {
        out.push(format!("https://api.moxfield.com/v2/users/{name}/decks?pageSize=100"));
        out.push(format!(
            "https://api.moxfield.com/v2/users/{name}/decks?pageNumber={{p}}&pageSize=100"
        ));
        out.push(format!("https://api.moxfield.com/v1/users/{name}/decks?pageSize=100"));
        out.push(format!(
            "https://api.moxfield.com/v1/users/{name}/decks?pageNumber={{p}}&pageSize=100"
        ));
        for host in ["api.moxfield.com", "api2.moxfield.com"] {
            for sfw in ["search-sfw", "search"] {
                out.push(format!("https://{host}/v2/decks/{sfw}?authorUserNames={name}&pageNumber={{p}}&pageSize=100&sortType=updated&sortDirection=descending"));
            }
        }
    }
    out
}

fn page_url(template: &str, page: u32) -> String {
    template.replace("{p}", &page.to_string())
}

/// Forma riconosciuta (chiavi lista note, array radice o totale dichiarato)?
/// Una 2xx senza forma nota non conta come "zero deck": è variante errata.
fn user_decks_recognized(root: &serde_json::Value) -> bool {
    root.get("data").is_some()
        || root.get("decks").is_some()
        || root.get("results").is_some()
        || root.is_array()
        || root.get("totalResults").is_some()
        || root.get("total").is_some()
        || root.get("totalDecks").is_some()
        || root.get("totalCount").is_some()
}

#[cfg(test)]
mod tests {
    use super::{map_zone, parse_archidekt, parse_moxfield, parse_moxfield_user_decks, user_decks_bases, user_decks_recognized, valid_archidekt_id, valid_moxfield_id, valid_moxfield_user, ImportedEntry};

    /// E2E manuale dei 4 deck Moxfield: fetch Scryfall in RAM → resize 1200/maximum
    /// → PDF per deck → verify 100%. NESSUNA immagine su disco, solo i PDF finali.
    /// Eseguire con: `cargo test --lib full_decks_e2e -- --ignored --nocapture`
    /// Env: PROXXIED_E2E_OUT (dir output), PROXXIED_E2E_DECKS (filtro sottostringa id).
    #[test]
    #[ignore]
    fn full_decks_e2e() {
        use std::io::Cursor;

        const DECKS: &[&str] = &[
            "mox-a1IXW3pcXUW6g5V09QovSg.json",
            "mox-OjyfAdecLHWZe2-0jZXl1Q.json",
            "mox-5j6gAfo9dHuD0vgOpDxZ8Q.json",
            "mox-bjyfAZFZg3WPjR1MTWmTmA.json",
        ];
        const ZONE_ORDER: &[&str] =
            &["main", "side", "commander", "extra", "maybe", "considering", "tokens", "custom"];
        const DPI: f64 = 1200.0;
        const QUALITY: u8 = 96; // profilo maximum
        const CARD_W: f64 = 63.0;
        const CARD_H: f64 = 88.0;
        const BLEED: f64 = 1.0;

        let out_dir = std::env::var("PROXXIED_E2E_OUT")
            .unwrap_or_else(|_| format!("{}/proxxied-e2e", std::env::temp_dir().to_string_lossy()));
        std::fs::create_dir_all(&out_dir).unwrap();
        let only = std::env::var("PROXXIED_E2E_DECKS").unwrap_or_default();

        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let client = reqwest::Client::builder()
            .user_agent("Proxxied-E2E/0.1.0 (local verification)")
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap();

        // GET JSON con rate limit gentile (come il frontend: ~100ms tra chiamate)
        let get_json = |url: &str| -> Result<serde_json::Value, String> {
            std::thread::sleep(std::time::Duration::from_millis(100));
            rt.block_on(async {
                let resp = client
                    .get(url)
                    .header(reqwest::header::ACCEPT, "application/json")
                    .send()
                    .await
                    .map_err(|e| format!("rete: {e}"))?;
                if resp.status().as_u16() == 404 {
                    return Err("404".into());
                }
                if !resp.status().is_success() {
                    return Err(format!("HTTP {}", resp.status()));
                }
                let bytes = resp.bytes().await.map_err(|e| format!("rete: {e}"))?;
                serde_json::from_slice(&bytes).map_err(|e| format!("JSON: {e}"))
            })
        };
        let get_bytes = |url: &str| -> Result<Vec<u8>, String> {
            std::thread::sleep(std::time::Duration::from_millis(100));
            rt.block_on(async {
                let resp = client.get(url).send().await.map_err(|e| format!("rete: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!("HTTP {}", resp.status()));
                }
                let bytes = resp.bytes().await.map_err(|e| format!("rete: {e}"))?;
                if bytes.len() > 40 * 1024 * 1024 {
                    return Err("immagine troppo grande".into());
                }
                Ok(bytes.to_vec())
            })
        };
        // Risolve l'URL immagine fronte via Scryfall (stampa esatta+set, fallback nome solo)
        let enc = |s: &str| url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>();
        let resolve_art = |e: &ImportedEntry| -> Result<String, String> {
            let exact = |set: Option<&str>| {
                let mut u = format!("https://api.scryfall.com/cards/named?exact={}", enc(&e.name));
                if let Some(s) = set.filter(|s| s.len() >= 2) {
                    u.push_str(&format!("&set={}", enc(&s.to_lowercase())));
                }
                u
            };
            let pick_url = |card: &serde_json::Value| -> Option<String> {
                let uris = card.get("image_uris")?;
                uris.get("png")
                    .or_else(|| uris.get("large"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        // DFC: prima faccia
                        card.get("card_faces")?.as_array()?.first()?
                            .get("image_uris")?.get("large")?.as_str().map(|s| s.to_string())
                    })
            };
            let set = e.set_code.clone();
            for attempt in [set.clone(), None] {
                match get_json(&exact(attempt.as_deref())) {
                    Ok(card) => {
                        if let Some(url) = pick_url(&card) {
                            return Ok(url);
                        }
                        return Err("senza image_uris".into());
                    }
                    Err(m) if m == "404" => continue,
                    Err(m) => return Err(m),
                }
            }
            Err("non trovata".into())
        };

        for file in DECKS {
            if !only.is_empty() && !file.contains(&only as &str) {
                continue;
            }
            let path = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), file);
            let text = std::fs::read_to_string(&path).expect("fixture");
            let v: serde_json::Value = serde_json::from_str(&text).unwrap();
            let deck = parse_moxfield(&v);
            println!("=== {} ({} voci) ===", deck.name, deck.entries.len());

            // Download+process una volta per stampa unica (nome+set+cn), riuso per qty
            use std::collections::HashMap;
            let mut art: HashMap<String, (Vec<u8>, u32, u32)> = HashMap::new();
            let mut skipped: Vec<String> = Vec::new();
            let req_w = crate::processing::required_pixels(CARD_W + BLEED * 2.0, DPI);
            let req_h = crate::processing::required_pixels(CARD_H + BLEED * 2.0, DPI);
            for e in &deck.entries {
                let key = format!(
                    "{}|{}|{}",
                    e.name.to_lowercase(),
                    e.set_code.clone().unwrap_or_default(),
                    e.collector_number.clone().unwrap_or_default()
                );
                if art.contains_key(&key) {
                    continue;
                }
                let url = match resolve_art(e) {
                    Ok(u) => u,
                    Err(m) => {
                        skipped.push(format!("{} ({})", e.name, m));
                        continue;
                    }
                };
                let bytes = match get_bytes(&url) {
                    Ok(b) => b,
                    Err(m) => {
                        skipped.push(format!("{} (dl: {})", e.name, m));
                        continue;
                    }
                };
                let img = match image::load_from_memory(&bytes) {
                    Ok(i) => i.to_rgb8(),
                    Err(m) => {
                        skipped.push(format!("{} (decode: {})", e.name, m));
                        continue;
                    }
                };
                let big = image::imageops::resize(&img, req_w, req_h, image::imageops::FilterType::Lanczos3);
                let mut jpg = Vec::new();
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut Cursor::new(&mut jpg), QUALITY)
                    .encode_image(&big)
                    .expect("encode jpeg");
                art.insert(key, (jpg, req_w, req_h));
            }
            println!("  stampe uniche ok: {}, saltate: {}", art.len(), skipped.len());
            for s in skipped.iter().take(10) {
                println!("    skip: {s}");
            }

            // Fogli per zona (stesso ordine del frontend), espansione qty
            let mut pdf_pages: Vec<crate::pdf::PdfPage> = Vec::new();
            let mut placed_total = 0usize;
            let mut missing_art = 0usize;
            for zone in ZONE_ORDER {
                let zentries: Vec<&ImportedEntry> =
                    deck.entries.iter().filter(|e| e.zone == *zone).collect();
                if zentries.is_empty() {
                    continue;
                }
                let total: usize = zentries.iter().map(|e| e.qty as usize).sum();
                let layout = crate::processing::compute_layout(&crate::processing::LayoutInput {
                    page_w_mm: 210.0,
                    page_h_mm: 297.0,
                    card_w_mm: CARD_W,
                    card_h_mm: CARD_H,
                    margin_top_mm: 3.0,
                    margin_right_mm: 3.0,
                    margin_bottom_mm: 3.0,
                    margin_left_mm: 3.0,
                    spacing_row_mm: 0.0,
                    spacing_col_mm: 0.0,
                    bleed_mm: BLEED,
                    total_cards: total,
                })
                .expect("layout");
                // indice flat → (entry, bytes)
                let mut flat: Vec<(&ImportedEntry, Option<&(Vec<u8>, u32, u32)>)> = Vec::new();
                for e in zentries {
                    let key = format!(
                        "{}|{}|{}",
                        e.name.to_lowercase(),
                        e.set_code.clone().unwrap_or_default(),
                        e.collector_number.clone().unwrap_or_default()
                    );
                    let a = art.get(&key);
                    if a.is_none() {
                        missing_art += e.qty as usize;
                    }
                    for _ in 0..e.qty.max(1) {
                        flat.push((e, a));
                    }
                }
                let guides = crate::pdf::GuideOptions {
                    crop_marks: true,
                    corner_marks: false,
                    cut_lines: false,
                    page_lines: true,
                    mark_len_mm: 2.0,
                    cut_shape: "inside".into(),
                    cut_offset_mm: 0.0,
                    color_rgb: crate::pdf::parse_hex_color("#000000"),
                    crop_rgb: crate::pdf::parse_hex_color("#00ff00"),
                    width_pt: 0.75,
                    placement: "inside".into(),
                    line_style: "solid".into(),
                    line_cap: "square".into(),
                    bleed_mm: BLEED,
                };
                let mut page_imgs: Vec<Vec<crate::pdf::PlacedImage>> =
                    vec![Vec::new(); layout.pages.max(1)];
                let mut page_rects: Vec<Vec<(f64, f64, f64, f64)>> =
                    vec![Vec::new(); layout.pages.max(1)];
                for pl in &layout.placements {
                    let Some((_, art_opt)) = flat.get(pl.index) else {
                        continue;
                    };
                    let Some((jpg, w, h)) = art_opt else {
                        continue;
                    };
                    page_imgs[pl.page].push(crate::pdf::PlacedImage {
                        hash: format!("{}-{}-{}", zone, pl.page, pl.index),
                        x_mm: pl.x_mm,
                        y_mm_top: pl.y_mm,
                        w_mm: pl.w_mm,
                        h_mm: pl.h_mm,
                        jpeg_bytes: std::rc::Rc::new((*jpg).clone()),
                        img_w_px: *w,
                        img_h_px: *h,
                    });
                    page_rects[pl.page].push((pl.x_mm, pl.y_mm, pl.w_mm, pl.h_mm));
                    placed_total += 1;
                }
                for p in 0..layout.pages.max(1) {
                    pdf_pages.push(crate::pdf::PdfPage {
                        w_mm: 210.0,
                        h_mm: 297.0,
                        images: std::mem::take(&mut page_imgs[p]),
                        guides: guides.clone(),
                        guide_rects: std::mem::take(&mut page_rects[p]),
                    });
                }
            }
            let pdf = crate::pdf::build_pdf(&pdf_pages).expect("build pdf");
            let rep = crate::pdf::verify::verify_pdf(&pdf, 65.0, 90.0, 0.5, 0.3).expect("verify");
            let out = format!("{out_dir}/{}.pdf", file.trim_end_matches(".json"));
            std::fs::write(&out, &pdf).expect("scrivi pdf");
            println!(
                "  PDF: {} pagine, {:.1}MB, piazzate {placed_total}, senza art {missing_art} -> {out}\n  verify: {}",
                pdf_pages.len(),
                pdf.len() as f64 / 1_048_576.0,
                rep.summary
            );
            assert!(rep.pass, "{}", rep.summary);
        }
    }

    /// Payload Moxfield reali (trimmati ai campi letti dal parser, shape intatte),
    /// dai 4 deck Commander dell'E2E. Conteggi verificati via API il giorno del test.
    struct RealDeck {
        file: &'static str,
        name: &'static str,
        copies: u32,
        commander: &'static str,
        spot: (&'static str, &'static str, &'static str),
    }
    const REAL_DECKS: &[RealDeck] = &[
        RealDeck { file: "mox-a1IXW3pcXUW6g5V09QovSg.json", name: "Sauron Deck", copies: 137, commander: "Sauron, the Dark Lord", spot: ("Sol Ring", "mainboard", "LTC") },
        RealDeck { file: "mox-OjyfAdecLHWZe2-0jZXl1Q.json", name: "Eldrazi Incursion DA PROXARE", copies: 121, commander: "Ulalek, Fused Atrocity", spot: ("Chromatic Lantern", "mainboard", "PLST") },
        RealDeck { file: "mox-5j6gAfo9dHuD0vgOpDxZ8Q.json", name: "Mono Green Hydra Gargos", copies: 134, commander: "Gargos, Vicious Watcher", spot: ("Sol Ring", "mainboard", "CM2") },
        RealDeck { file: "mox-bjyfAZFZg3WPjR1MTWmTmA.json", name: "Necron Deck", copies: 114, commander: "Imotekh the Stormlord", spot: ("Steel Overseer", "mainboard", "M20") },
    ];

    #[test]
    fn moxfield_payload_reali_4_commander() {
        for d in REAL_DECKS {
            let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), format!("tests/fixtures/{}", d.file));
            let text = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("fixture mancante: {path}"));
            let v: serde_json::Value = serde_json::from_str(&text).unwrap();
            let r = parse_moxfield(&v);
            assert_eq!(r.name, d.name, "{}", d.file);
            assert!(r.unknown.is_empty(), "{} unknown: {:?}", d.file, &r.unknown[..r.unknown.len().min(3)]);
            let copies: u32 = r.entries.iter().map(|e| e.qty).sum();
            assert_eq!(copies, d.copies, "{} copie totali", d.file);
            let cmd = r.entries.iter().find(|e| e.name == d.commander)
                .unwrap_or_else(|| panic!("{} commander assente", d.file));
            assert_eq!(cmd.zone, "commander");
            // tokens (shape lista piatta, senza quantity/card) in zona tokens
            assert!(r.entries.iter().any(|e| e.zone == "tokens"), "{} senza token", d.file);
            // maybeboard presente
            assert!(r.entries.iter().any(|e| e.zone == "maybe"), "{} senza maybe", d.file);
            // spot check set/zone (set normalizzato maiuscolo)
            let (sname, szone, sset) = d.spot;
            let s = r.entries.iter().find(|e| e.name == sname)
                .unwrap_or_else(|| panic!("{} spot {sname} assente", d.file));
            assert_eq!(s.zone, if szone == "mainboard" { "main" } else { szone });
            assert_eq!(s.set_code.as_deref(), Some(sset), "{} set {sname}", d.file);
        }
    }

    #[test]
    fn user_decks_forme_tolleranti() {
        // forma attesa: data[] con campi canonici
        let v: serde_json::Value = serde_json::from_str(
            r#"{"data":[
              {"publicId":"abc123","name":"Necron","format":"commander","mainboardCount":99,"sideboardCount":10,"lastUpdatedAt":"2026-01-01"},
              {"publicId":"zzz","name":"Draft","format":"limited","mainboardCount":40}
            ],"totalResults":2}"#,
        )
        .unwrap();
        let (decks, total) = parse_moxfield_user_decks(&v);
        assert_eq!(total, 2);
        assert_eq!(decks.len(), 2);
        assert_eq!(decks[0].public_id, "abc123");
        assert_eq!(decks[0].total_count, 109);
        assert_eq!(decks[1].total_count, 40);
        assert_eq!(decks[0].updated_at.as_deref(), Some("2026-01-01"));
        // varianti: chiave decks[], public_id snake, totalCards, voce senza id scartata
        let v2: serde_json::Value = serde_json::from_str(
            r#"{"decks":[
              {"public_id":"x1","title":"T1","formatName":"modern","totalCards":75},
              {"name":"senza-id"}
            ]}"#,
        )
        .unwrap();
        let (d2, t2) = parse_moxfield_user_decks(&v2);
        assert_eq!(t2, 0);
        assert_eq!(d2.len(), 1);
        assert_eq!(d2[0].name, "T1");
        assert_eq!(d2[0].format, "modern");
        // array radice
        let v3: serde_json::Value = serde_json::from_str(r#"[{"id":"q9","name":"Root"}]"#).unwrap();
        let (d3, _) = parse_moxfield_user_decks(&v3);
        assert_eq!(d3.len(), 1);
        assert_eq!(d3[0].public_id, "q9");
        // spazzatura → lista vuota, mai panic
        let (d4, t4) = parse_moxfield_user_decks(&serde_json::json!({"nope": 1}));
        assert!(d4.is_empty() && t4 == 0);
    }

    #[test]
    fn user_decks_sonde_ordinate() {
        let bases = user_decks_bases(&"TheNotoriousCompa".to_string());
        // forma comunitaria prima, poi varianti, poi ricerca per autore, poi minuscole
        assert_eq!(
            bases[0],
            "https://api.moxfield.com/v2/users/TheNotoriousCompa/decks?pageSize=100"
        );
        assert!(bases[1].contains("/v2/users/TheNotoriousCompa/decks?pageNumber={p}"));
        assert!(bases[2].contains("/v1/users/TheNotoriousCompa/decks?pageSize=100"));
        assert!(bases[4].contains("search-sfw?authorUserNames=TheNotoriousCompa"));
        assert!(bases[5].contains("/v2/decks/search?authorUserNames="));
        assert!(bases[6].contains("api2.moxfield.com"));
        assert!(bases[8].contains("/thenotoriouscompa/"));
        assert_eq!(bases.len(), 16);
        // nickname già minuscolo: niente duplicati
        assert_eq!(user_decks_bases(&"abc".to_string()).len(), 8);
    }

    #[test]
    fn user_decks_recognized_solo_forme_note() {
        assert!(user_decks_recognized(&serde_json::json!({"data": []})));
        assert!(user_decks_recognized(&serde_json::json!({"decks": []})));
        assert!(user_decks_recognized(&serde_json::json!([{"id": "x"}])));
        assert!(user_decks_recognized(&serde_json::json!({"totalResults": 0, "other": 1})));
        // 2xx con forma ignota NON conta come "zero deck": è variante errata
        assert!(!user_decks_recognized(&serde_json::json!({"nope": 1})));
        assert!(!user_decks_recognized(&serde_json::json!("solo stringa")));
    }

    #[test]
    fn user_nickname_stretto() {
        assert!(valid_moxfield_user("Necron_fan-99"));
        assert!(valid_moxfield_user("ab"));
        assert!(!valid_moxfield_user("a"));
        assert!(!valid_moxfield_user("con spazi"));
        assert!(!valid_moxfield_user("x/y"));
        assert!(!valid_moxfield_user(&"z".repeat(65)));
    }

    #[test]
    fn ids_stretti() {
        assert!(valid_moxfield_id("abcDEF1234"));
        assert!(valid_moxfield_id("aB1-_x9Q"));
        assert!(!valid_moxfield_id("ab"));
        assert!(!valid_moxfield_id("../x"));
        assert!(!valid_moxfield_id("a/b"));
        assert!(valid_archidekt_id("123456"));
        assert!(!valid_archidekt_id("12a"));
        assert!(!valid_archidekt_id(""));
        assert!(!valid_archidekt_id("1234567890123"));
    }

    #[test]
    fn zone_mapping() {
        assert_eq!(map_zone("Mainboard"), "main");
        assert_eq!(map_zone("Sideboard"), "side");
        assert_eq!(map_zone("Commander"), "commander");
        assert_eq!(map_zone("Maybeboard"), "maybe");
        assert_eq!(map_zone("Considering"), "considering");
        assert_eq!(map_zone("Tokens"), "tokens");
        assert_eq!(map_zone("Companions"), "extra");
        assert_eq!(map_zone("sconosciuta"), "main");
    }

    #[test]
    fn moxfield_boards() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{
              "name": "Test",
              "mainboard": {
                "a": {"quantity": 4, "card": {"name": "Lightning Bolt", "set": "m11", "cn": "146"}},
                "b": {"quantity": 2, "card": {"name": "Counterspell"}}
              },
              "sideboard": {"c": {"quantity": 1, "card": {"name": "Sol Ring"}}},
              "commanders": {"d": {"quantity": 1, "card": {"name": "Atraxa"}}}
            }"#,
        )
        .unwrap();
        let r = parse_moxfield(&v);
        assert_eq!(r.entries.len(), 4);
        let bolt = r.entries.iter().find(|e| e.name == "Lightning Bolt").unwrap();
        assert_eq!(bolt.qty, 4);
        assert_eq!(bolt.zone, "main");
        assert_eq!(bolt.set_code.as_deref(), Some("M11"));
        assert_eq!(bolt.collector_number.as_deref(), Some("146"));
        assert!(r.entries.iter().any(|e| e.zone == "side"));
        assert!(r.entries.iter().any(|e| e.zone == "commander"));
    }

    #[test]
    fn archidekt_cards() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{
              "name": "Test",
              "cards": [
                {"quantity": 3, "category": "Mainboard", "card": {"oracleCard": {"name": "Bolt"}, "edition": {"editioncode": "m11"}, "collectorNumber": "146"}},
                {"quantity": 1, "category": "Commander", "card": {"oracleCard": {"name": "Atraxa"}}},
                {"quantity": 2, "category": "Sideboard", "card": {"name": "Sol Ring"}}
              ]
            }"#,
        )
        .unwrap();
        let r = parse_archidekt(&v);
        assert_eq!(r.entries.len(), 3);
        assert!(r.entries.iter().any(|e| e.zone == "commander" && e.name == "Atraxa"));
        let bolt = r.entries.iter().find(|e| e.name == "Bolt").unwrap();
        assert_eq!(bolt.set_code.as_deref(), Some("M11"));
    }

    #[test]
    fn duplicati_consolidati() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"name":"T","mainboard":{"a":{"quantity":2,"card":{"name":"Bolt"}},"b":{"quantity":2,"card":{"name":"Bolt"}}}}"#,
        )
        .unwrap();
        let r = parse_moxfield(&v);
        assert_eq!(r.entries.len(), 1);
        assert_eq!(r.entries[0].qty, 4);
        assert!(!r.warnings.is_empty());
    }
}
