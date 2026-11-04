// The Logic Grid Admin desktop app: one window that opens the online
// admin dashboard (https://flg-api.btay74.workers.dev/admin/), so it is always
// the live version with the server's own strict CSP and sign-in. The page gets one
// set of app permissions, for Vox only (capabilities/vox.json, see vox.rs): it can
// start, stop and connect to the voice engine. Links that leave the dashboard open
// in the normal browser, and updates are checked here in Rust against GitHub
// Releases (tag admin-desktop), asking before installing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vox;

use tauri::{AppHandle, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
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
        .manage(vox::Vox::default())
        .invoke_handler(tauri::generate_handler![
            vox::vox_status,
            vox::vox_choose_folder,
            vox::vox_start,
            vox::vox_stop,
            vox::vox_token,
            vox::vox_open,
            vox::vox_set_online,
            vox::vox_set_autostart
        ])
        .setup(|app| {
            let nav = app.handle().clone();
            let popup = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(Url::parse(HOME)?))
                .title("The Logic Grid Admin")
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

            // Vox starts hidden (no command window) as soon as the app opens,
            // unless that is switched off on the Voice engine page.
            let starter = app.handle().clone();
            if vox::autostart_on(&starter) {
                let _ = vox::vox_start(starter);
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_for_update(handle).await {
                    eprintln!("update check failed: {e}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running The Logic Grid Admin")
        .run(|app, event| match event {
            // Closing the main window (its X) closes the whole app, archive
            // viewer windows included, and that stops Vox.
            RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { .. }, .. } if label == "main" => {
                app.exit(0);
            }
            RunEvent::Exit => vox::shutdown(app),
            _ => {}
        });
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
