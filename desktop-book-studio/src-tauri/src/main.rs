// Book Studio desktop app: one window that opens the online Book Studio
// (https://flg-api.btay74.workers.dev/admin/book-studio/), so it is always the
// live version, with the server's own strict CSP, sign-in and publishing
// access check. Books sync with the signed-in account (book-studio/src/sync.js)
// and the page keeps its files for offline use (admin/book-studio/sw.js).
// The page gets no app permissions at all. Links that leave the admin pages
// open in the normal browser, and updates are checked here in Rust against
// GitHub Releases (tag book-studio-desktop), asking before installing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::NewWindowResponse;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const HOME: &str = "https://flg-api.btay74.workers.dev/admin/book-studio/";
// Lets the page know it runs inside this app, so it hides "Get the app".
const MARK: &str = "window.__FLG_BOOK_STUDIO_DESKTOP__ = true;";

/// Pages that stay in the app window: Book Studio, and Grid Admin for an
/// admin who presses "← Grid Admin" (the server decides what each role sees).
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
                .title("Book Studio")
                .inner_size(1360.0, 900.0)
                .min_inner_size(360.0, 480.0)
                .center()
                // The page takes dropped manuscripts and pictures itself.
                .disable_drag_drop_handler()
                .initialization_script(MARK)
                .on_navigation(move |url| {
                    if stays_inside(url) || matches!(url.scheme(), "about" | "blob" | "data") {
                        return true;
                    }
                    open_outside(&nav, url);
                    false
                })
                .on_new_window(move |url, _features| {
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
        .expect("error while running Book Studio");
}

/// Looks for a newer signed version; if there is one, asks before installing it.
async fn check_for_update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let (tx, rx) = futures_channel::oneshot::channel();
    app.dialog()
        .message(format!(
            "Version {} of Book Studio is ready (you have {}).\n\nInstall it now? The app closes, updates and opens again. Your work is kept on this computer and syncs when it opens again.",
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
