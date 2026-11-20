use serde_json::Value;
use tauri::AppHandle;

const DEFAULTS: &str = r#"{
  "dpi": 1200, "page": "a4", "card": "tcg",
  "bleedMm": 0.0, "compression": "balanced",
  "cacheMb": 2048, "upscaleMode": "off", "aiModel": null,
  "performance": "balanced"
}"#;

#[tauri::command]
pub async fn get_settings(handle: AppHandle) -> Result<Value, String> {
    let v = crate::database::get_setting(&handle, "app.settings")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::from_str(DEFAULTS).unwrap());
    Ok(v)
}

#[tauri::command]
pub async fn set_settings(handle: AppHandle, value: Value) -> Result<Value, String> {
    // merge con default per robustezza
    let mut base: Value = serde_json::from_str(DEFAULTS).unwrap();
    if let (Some(b), Some(v)) = (base.as_object_mut(), value.as_object()) {
        for (k, val) in v {
            b.insert(k.clone(), val.clone());
        }
    }
    crate::database::upsert_setting(&handle, "app.settings", &base.to_string())?;
    Ok(base)
}

#[tauri::command]
pub async fn reset_app(handle: AppHandle) -> Result<(), String> {
    crate::cache::clear_all(&handle)?;
    crate::database::with_conn(&handle, |c| {
        c.execute_batch("DELETE FROM cache_entries; DELETE FROM kv_settings;")
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Preset layout stampa custom (array JSON in kv). Validazione di forma qui,
/// validazione semantica (Zod) nel frontend prima dell'invio.
#[tauri::command]
pub async fn list_print_presets(handle: AppHandle) -> Result<Value, String> {
    let v = crate::database::get_setting(&handle, "print.presets")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Array(vec![]));
    Ok(v)
}

#[tauri::command]
pub async fn save_print_preset(handle: AppHandle, preset: Value) -> Result<Value, String> {
    let obj = preset.as_object().ok_or("preset non oggetto")?;
    let id = obj.get("id").and_then(|v| v.as_str()).ok_or("preset senza id")?;
    if id.trim().is_empty() || id.len() > 64 {
        return Err("id preset non valido".into());
    }
    let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
    if name.is_empty() || name.len() > 80 {
        return Err("nome preset non valido".into());
    }
    if obj.get("settings").and_then(|v| v.as_object()).is_none() {
        return Err("preset senza settings".into());
    }
    let mut list: Vec<Value> = crate::database::get_setting(&handle, "print.presets")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    list.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(id));
    list.push(preset);
    list.truncate(50);
    crate::database::upsert_setting(&handle, "print.presets", &Value::Array(list.clone()).to_string())?;
    Ok(Value::Array(list))
}

#[tauri::command]
pub async fn delete_print_preset(handle: AppHandle, id: String) -> Result<Value, String> {
    let mut list: Vec<Value> = crate::database::get_setting(&handle, "print.presets")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    list.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    crate::database::upsert_setting(&handle, "print.presets", &Value::Array(list.clone()).to_string())?;
    Ok(Value::Array(list))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    #[test]
    fn defaults_parse() {
        let v: Value = serde_json::from_str(super::DEFAULTS).unwrap();
        assert_eq!(v["dpi"], 1200);
        assert_eq!(v["upscaleMode"], "off");
    }
}
