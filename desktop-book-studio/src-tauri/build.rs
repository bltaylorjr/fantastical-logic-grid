// Embeds the shared Windows manifest (desktop/windows/app.manifest, shared with the game and
// the admin app) for UAC, compatibility and High DPI. The app has no commands of its own: the
// Book Studio page gets no app permissions at all.
fn main() {
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("../../desktop/windows/app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run the Tauri build script");
}
