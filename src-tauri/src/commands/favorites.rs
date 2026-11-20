//! Stampe preferite (cuore nel print-picker), persistenti cross-progetto.
//!
//! Array JSON in `kv_settings` (`print.favorites`, max 500): niente migrazioni
//! schema, stesso pattern di `save_print_preset`. Validazione di forma qui,
//! mai throw su dati legacy corrotti (reset a lista vuota).

use serde::{Deserialize, Serialize};

const FAV_KEY: &str = "print.favorites";
const MAX_FAVS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Favorite {
    /// id stampa provider (scryfall uuid oppure drive identifier mpc)
    pub id: String,
    pub name: String,
    /// scryfall | mpc
    pub source: String,
}

pub fn validate_favorite(v: &serde_json::Value) -> Result<Favorite, String> {
    let obj = v.as_object().ok_or("preferito non oggetto")?;
    let id = obj.get("id").and_then(|x| x.as_str()).unwrap_or("").trim();
    if id.is_empty() || id.len() > 128 {
        return Err("id preferito non valido".into());
    }
    let name = obj.get("name").and_then(|x| x.as_str()).unwrap_or("").trim();
    if name.is_empty() || name.len() > 200 {
        return Err("nome preferito non valido".into());
    }
    let source = obj.get("source").and_then(|x| x.as_str()).unwrap_or("").trim();
    if source != "scryfall" && source != "mpc" {
        return Err("sorgente preferito non valida (scryfall|mpc)".into());
    }
    Ok(Favorite { id: id.to_string(), name: name.to_string(), source: source.to_string() })
}

fn read_list(handle: &tauri::AppHandle) -> Vec<Favorite> {
    crate::database::get_setting(handle, FAV_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<Favorite>>(&s).ok())
        .unwrap_or_default()
}

fn write_list(handle: &tauri::AppHandle, list: &[Favorite]) -> Result<(), String> {
    crate::database::upsert_setting(handle, FAV_KEY, &serde_json::to_string(list).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn list_favorites(handle: tauri::AppHandle) -> Result<Vec<Favorite>, String> {
    Ok(read_list(&handle))
}

#[tauri::command]
pub async fn add_favorite(handle: tauri::AppHandle, fav: serde_json::Value) -> Result<Vec<Favorite>, String> {
    let fav = validate_favorite(&fav)?;
    let mut list = read_list(&handle);
    list.retain(|f| f.id != fav.id);
    list.push(fav);
    list.truncate(MAX_FAVS);
    write_list(&handle, &list)?;
    Ok(list)
}

#[tauri::command]
pub async fn remove_favorite(handle: tauri::AppHandle, id: String) -> Result<Vec<Favorite>, String> {
    let mut list = read_list(&handle);
    list.retain(|f| f.id != id);
    write_list(&handle, &list)?;
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::{validate_favorite, MAX_FAVS};

    fn fav(id: &str) -> serde_json::Value {
        serde_json::json!({ "id": id, "name": "Bolt", "source": "scryfall" })
    }

    #[test]
    fn valida_preferito() {
        let f = validate_favorite(&fav("uuid-1")).unwrap();
        assert_eq!(f.id, "uuid-1");
        assert_eq!(f.source, "scryfall");
        assert!(validate_favorite(&serde_json::json!({ "id": "", "name": "x", "source": "scryfall" })).is_err());
        assert!(validate_favorite(&serde_json::json!({ "id": "x", "name": "", "source": "scryfall" })).is_err());
        assert!(validate_favorite(&serde_json::json!({ "id": "x", "name": "x", "source": "altro" })).is_err());
        assert!(validate_favorite(&serde_json::json!("stringa")).is_err());
    }

    #[test]
    fn cap_massimo_documentato() {
        assert_eq!(MAX_FAVS, 500);
    }
}
