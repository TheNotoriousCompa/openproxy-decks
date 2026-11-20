//! Proxy CORS-free verso backend stile MPC Autofill.
//!
//! Il `fetch` del frontend è soggetto a CORS: senza header
//! `Access-Control-Allow-Origin` il browser blocca con `TypeError: Failed to fetch`
//! anche se l'endpoint è raggiungibile (curl ok). Rust non ha CORS, quindi
//! l'app desktop instrada queste chiamate qui. Allowlist stretta anti-SSRF.

/// Endpoint API consentiti (con o senza slash finale).
pub fn allowed_path(path: &str) -> bool {
    matches!(
        path.trim_start_matches('/'),
        "2/searchEngineHealth/" | "2/searchEngineHealth"
        | "2/sources/" | "2/sources"
        | "2/editorSearch/" | "2/editorSearch"
        | "3/editorSearch/" | "3/editorSearch"
        | "2/cards/" | "2/cards"
    )
}

pub fn normalize_server(server: &str) -> Result<String, String> {
    let t = server.trim().trim_end_matches('/');
    if t.is_empty() {
        return Err("server vuoto".into());
    }
    let url = url::Url::parse(t).map_err(|_| "URL server non valido".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("solo URL http(s)".into());
    }
    Ok(t.to_string())
}

pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // UA browser-like: alcuni host/WAF bloccano UA non browser.
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Proxxied/0.1.0")
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())
}

/// Inoltra una chiamata API JSON al server MPC. Ritorna il JSON di risposta.
#[tauri::command]
pub async fn mpc_proxy(
    server: String,
    path: String,
    method: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let base = normalize_server(&server)?;
    if !allowed_path(&path) {
        return Err("endpoint non consentito".into());
    }
    let method_up = method.to_uppercase();
    if method_up != "GET" && method_up != "POST" {
        return Err("solo GET/POST".into());
    }
    let url = format!("{}/{}", base, path.trim_start_matches('/'));
    let client = http_client()?;
    let mut req = match method_up.as_str() {
        "GET" => client.get(&url),
        _ => {
            let payload = serde_json::to_string(&body.unwrap_or(serde_json::Value::Null))
                .map_err(|e| e.to_string())?;
            client
                .post(&url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(payload)
        }
    };
    req = req.header(reqwest::header::ACCEPT, "application/json");
    let resp = req.send().await.map_err(|e| format!("proxy: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("proxy: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("proxy: {e}"))?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("proxy: risposta troppo grande".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("proxy: JSON non valido: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{allowed_path, normalize_server};

    #[test]
    fn allowlist_stretta() {
        for ok in [
            "2/searchEngineHealth/",
            "2/sources",
            "/2/editorSearch/",
            "3/editorSearch/",
            "2/cards/",
        ] {
            assert!(allowed_path(ok), "{ok}");
        }
        for bad in ["", "2/admin", "../2/sources/", "2/sources/extra", "http://x/2/sources/"] {
            assert!(!allowed_path(bad), "{bad}");
        }
    }

    #[test]
    fn server_http_solo() {
        assert!(normalize_server("https://mpcfill.com/").is_ok());
        assert!(normalize_server("").is_err());
        assert!(normalize_server("ftp://x/").is_err());
        assert!(normalize_server("notaurl").is_err());
    }
}
