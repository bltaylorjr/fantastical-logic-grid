// Embeds the shared Windows manifest (desktop/windows/app.manifest) so the
// Windows App Certification Kit's UAC, compatibility and High DPI tests pass.
fn main() {
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("../windows/app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run the Tauri build script");
}
