//! Collezione dei proxy fisici posseduti (Collection Manager).
//!
//! Array JSON in `kv_settings` (`proxy.collection`, max 5000 voci): niente
//! migrazioni schema, stesso pattern di `print.favorites`. Una voce = una
//! stampa posseduta (nome + set + numero), con quantità. La chiave la calcola
//! il frontend (`collectionKey` in `lib/collection.ts`); qui si valida forma
//! e limiti, mai throw su dati legacy corrotti (reset a lista vuota).

use serde::{Deserialize, Serialize};

const COLLECTION_KEY: &str = "proxy.collection";
const MAX_ITEMS: usize = 5000;
const MAX_QTY: i64 = 9999;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollectionEntry {
    /// chiave stabile `nome‖set‖numero` (minuscola, trimmata) dal frontend
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub set_code: String,
    #[serde(default)]
    pub collector_number: String,
    pub qty: i64,
    #[serde(default)]
    pub added_at: String,
}

pub fn validate_entry(v: &serde_json::Value) -> Result<CollectionEntry, String> {
    let obj = v.as_object().ok_or("voce collezione non oggetto")?;
    let str_field = |f: &str| obj.get(f).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let key = str_field("key");
    if key.is_empty() || key.len() > 300 {
        return Err("chiave collezione non valida".into());
    }
    let name = str_field("name");
    if name.is_empty() || name.len() > 200 {
        return Err("nome collezione non valido".into());
    }
    let set_code = str_field("set_code");
    if set_code.len() > 16 {
        return Err("set collezione non valido".into());
    }
    let collector_number = str_field("collector_number");
    if collector_number.len() > 16 {
        return Err("numero collezione non valido".into());
    }
    let qty = obj.get("qty").and_then(|x| x.as_i64()).unwrap_or(0);
    if qty < 1 || qty > MAX_QTY {
        return Err("quantità collezione non valida (1..9999)".into());
    }
    let added_at = str_field("added_at");
    Ok(CollectionEntry { key, name, set_code, collector_number, qty, added_at })
}

fn read_list(handle: &tauri::AppHandle) -> Vec<CollectionEntry> {
    crate::database::get_setting(handle, COLLECTION_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<CollectionEntry>>(&s).ok())
        .unwrap_or_default()
}

fn write_list(handle: &tauri::AppHandle, list: &[CollectionEntry]) -> Result<(), String> {
    crate::database::upsert_setting(handle, COLLECTION_KEY, &serde_json::to_string(list).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn collection_list(handle: tauri::AppHandle) -> Result<Vec<CollectionEntry>, String> {
    Ok(read_list(&handle))
}

/// Aggiunge voci sommando le quantità sulle chiavi esistenti (mai duplicati).
/// Ritorna la lista completa aggiornata.
#[tauri::command]
pub async fn collection_add(
    handle: tauri::AppHandle,
    items: Vec<serde_json::Value>,
) -> Result<Vec<CollectionEntry>, String> {
    let mut list = read_list(&handle);
    for raw in &items {
        let item = validate_entry(raw)?;
        match list.iter_mut().find(|e| e.key == item.key) {
            Some(existing) => {
                existing.qty = (existing.qty + item.qty).min(MAX_QTY);
                if existing.name != item.name {
                    existing.name = item.name.clone();
                }
            }
            None => list.push(item),
        }
    }
    list.truncate(MAX_ITEMS);
    // più recenti in testa per `added_at` (le senza data restano in coda)
    list.sort_by(|a, b| b.added_at.cmp(&a.added_at));
    write_list(&handle, &list)?;
    Ok(list)
}

#[tauri::command]
pub async fn collection_set_qty(
    handle: tauri::AppHandle,
    key: String,
    qty: i64,
) -> Result<Vec<CollectionEntry>, String> {
    let mut list = read_list(&handle);
    if qty < 1 {
        list.retain(|e| e.key != key);
    } else if let Some(existing) = list.iter_mut().find(|e| e.key == key) {
        existing.qty = qty.min(MAX_QTY);
    } else {
        return Err("voce collezione non trovata".into());
    }
    write_list(&handle, &list)?;
    Ok(list)
}

#[tauri::command]
pub async fn collection_remove(handle: tauri::AppHandle, key: String) -> Result<Vec<CollectionEntry>, String> {
    let mut list = read_list(&handle);
    list.retain(|e| e.key != key);
    write_list(&handle, &list)?;
    Ok(list)
}

#[tauri::command]
pub async fn collection_clear(handle: tauri::AppHandle) -> Result<Vec<CollectionEntry>, String> {
    write_list(&handle, &[])?;
    Ok(vec![])
}

#[cfg(test)]
mod tests {
    use super::{validate_entry, MAX_QTY};

    fn item(key: &str, qty: i64) -> serde_json::Value {
        serde_json::json!({
            "key": key, "name": "Sol Ring", "set_code": "ltr",
            "collector_number": "1", "qty": qty, "added_at": "2026-01-01",
        })
    }

    #[test]
    fn valida_voce() {
        let e = validate_entry(&item("sol ring‖ltr‖1", 4)).unwrap();
        assert_eq!(e.qty, 4);
        assert_eq!(e.set_code, "ltr");
        assert!(validate_entry(&item("", 1)).is_err());
        assert!(validate_entry(&item("k", 0)).is_err());
        assert!(validate_entry(&item("k", MAX_QTY + 1)).is_err());
        assert!(validate_entry(&item("k", 1)).unwrap().collector_number == "1");
        assert!(validate_entry(&serde_json::json!({"key": "k", "name": "", "qty": 1})).is_err());
    }

    #[test]
    fn chiave_lunga_scartata() {
        let long = "k".repeat(301);
        assert!(validate_entry(&item(&long, 1)).is_err());
    }
}
