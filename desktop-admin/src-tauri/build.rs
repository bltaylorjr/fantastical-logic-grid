// Embeds the shared Windows manifest (desktop/windows/app.manifest, shared with the game) so the
// Windows App Certification Kit's UAC, compatibility and High DPI tests pass.
fn main() {
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("../../desktop/windows/app.manifest"));
    // The only app commands, each with its own permission (allow-vox-…), granted
    // to the admin dashboard in capabilities/vox.json.
    let manifest = tauri_build::AppManifest::new().commands(&["vox_status", "vox_choose_folder", "vox_start", "vox_stop", "vox_token", "vox_open"]);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows).app_manifest(manifest))
        .expect("failed to run the Tauri build script");
}
