// The Fantastical Logic Grid desktop shell: one window that loads the web app
// bundled from ../web. Saves live in the window's own storage on this computer.
// The updater plugin checks GitHub Releases for a signed newer version; the web
// app asks the player before installing it (see web/js/updates.js).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running The Fantastical Logic Grid");
}
