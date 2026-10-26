// The Fantastical Logic Grid Admin desktop app: one window that opens the online
// admin dashboard (https://flg-api.btay74.workers.dev/admin/), so it is always
// the live version with the server's own strict CSP and sign-in. The page gets no
// app permissions (no capabilities file): links that leave the dashboard open in
// the normal browser, and updates are checked here in Rust against GitHub
// Releases (tag admin-desktop), asking before installing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::NewWindowResponse;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const HOME: &str = "https://flg-api.btay74.workers.dev/admin/";
// Lets the page know it runs inside this app, so it hides "Download for Windows".
const MARK: &str = "window.__FLG_ADMIN_DESKTOP__ = true;";

/// Pages that stay in the app window: the admin dashboard and its archive viewer.
fn stays_inside(url: &Url) -> bool {
    let home = Url::parse(HOME).expect("HOME is a valid URL");
    url.origin() == home.origin() && url.path().starts_with("/admin")
}

fn open_outside(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let nav = app.handle().clone();
            let popup = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(Url::parse(HOME)?))
                .title("The Fantastical Logic Grid Admin")
                .inner_size(1280.0, 860.0)
                .min_inner_size(360.0, 480.0)
                .center()
                .disable_drag_drop_handler()
                .initialization_script(MARK)
                .on_navigation(move |url| {
                    if stays_inside(url) || url.scheme() == "about" {
                        return true;
                    }
                    open_outside(&nav, url);
                    false
                })
                .on_new_window(move |url, _features| {
                    // target="_blank" links: the archive viewer opens in its own
                    // app window; anything else (the game, GitHub) in the browser.
                    if stays_inside(&url) {
                        return NewWindowResponse::Allow;
                    }
                    open_outside(&popup, &url);
                    NewWindowResponse::Deny
                })
                .build()?;

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_for_update(handle).await {
                    eprintln!("update check failed: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running The Fantastical Logic Grid Admin");
}

/// Looks for a newer signed version; if there is one, asks before installing it.
async fn check_for_update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let (tx, rx) = futures_channel::oneshot::channel();
    app.dialog()
        .message(format!(
            "Version {} of the admin app is ready (you have {}).\n\nInstall it now? The app closes, updates and opens again.",
            update.version, update.current_version
        ))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom("Update now".into(), "Later".into()))
        .show(move |yes| {
            let _ = tx.send(yes);
        });
    if rx.await.unwrap_or(false) {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}
