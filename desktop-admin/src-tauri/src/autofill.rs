// Passwords "Log in" inside the app: the dashboard (and only the dashboard,
// capabilities/passwords.json) hands over one login; this opens its site in a
// new window that fills the sign-in form with the same script as the browser
// extension (admin/extension/fill.js). The login lives only in that window's
// start-up script, fills only on the login's own site and only for 3 minutes,
// and the window gets no app permissions at all.
use serde::Deserialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::NewWindowResponse;
use tauri_plugin_opener::OpenerExt;
use url::Url;

const FILL_JS: &str = include_str!("../../../admin/extension/fill.js");
const MINUTES: u64 = 3;
static NEXT: AtomicU32 = AtomicU32::new(1);

#[derive(Deserialize)]
pub struct Login {
    url: String,
    #[serde(default)]
    hosts: Vec<String>,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    totp: String,
    #[serde(default)]
    title: String,
}

fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

#[tauri::command]
pub fn vault_login(app: AppHandle, login: Login) -> Result<(), String> {
    let url = Url::parse(&login.url).map_err(|_| "That sign-in address does not look right.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only web addresses can be opened.".into());
    }
    let expires = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64 + MINUTES * 60_000;
    let hosts: Vec<String> = login.hosts.iter().take(4).map(|h| cut(h, 253)).collect();
    let fill = serde_json::json!({
        "hosts": if hosts.is_empty() { vec![url.host_str().unwrap_or_default().to_string()] } else { hosts },
        "username": cut(&login.username, 300),
        "password": cut(&login.password, 2000),
        "totp": cut(&login.totp, 600),
        "expires": expires,
    });
    // JSON is a valid JavaScript expression; serde_json escapes every quote and control character.
    let script = format!("{FILL_JS}\n;globalThis.__flgFill({fill});");
    let title = if login.title.trim().is_empty() { url.host_str().unwrap_or("Log in").to_string() } else { cut(login.title.trim(), 80) };
    let label = format!("login-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let outside = app.clone();
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title(format!("{title} – Log in"))
        .inner_size(1100.0, 820.0)
        .center()
        .initialization_script(script)
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about" | "blob" | "data"))
        .on_new_window(move |u, _features| {
            // Sign-in pop-ups (Google, Microsoft, Apple) open as app windows; anything odd goes to the browser.
            if matches!(u.scheme(), "http" | "https") {
                return NewWindowResponse::Allow;
            }
            let _ = outside.opener().open_url(u.as_str(), None::<&str>);
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
