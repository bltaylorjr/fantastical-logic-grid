# The Fantastical Logic Grid Admin for Windows

A small Windows app (Tauri) that opens the online admin dashboard,
https://flg-api.btay74.workers.dev/admin/, in its own window with a Start menu
icon. Nothing of the dashboard is bundled: the window always shows the live
version, with the Worker's strict Content Security Policy and the normal
sign-in. Admin data and sign-in are never stored in the app beyond what the
page itself keeps.

- **Download:** the "Download for Windows" button in the dashboard (Windows
  visitors only, hidden inside the app) links
  `releases/download/admin-desktop/The-Fantastical-Logic-Grid-Admin-Setup.exe`.
- **No permissions for the page:** there is no capabilities file, so the web page
  cannot call any app command. Links that leave `/admin` (Open the game, GitHub)
  open in the normal browser; the archive viewer opens in its own window.
- **Updates:** at start the app checks
  `releases/download/admin-desktop/latest.json` (signed with the same updater key
  as the game) and asks "Update now / Later" before installing.
- **Unsigned:** the installer has no paid code-signing certificate, so Windows
  SmartScreen may warn "Windows protected your PC". Click **More info**, then
  **Run anyway**.

## Releasing

1. Raise `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Merge to main. The "Admin app for Windows" workflow
   (`.github/workflows/admin-desktop.yml`) builds on Windows and replaces the
   files on the `admin-desktop` release. That release is never marked "latest",
   so the game's releases and updates are untouched. It can also be run from the
   Actions tab. It uses the repository secret `TAURI_SIGNING_PRIVATE_KEY`.

Pull requests that touch this folder only build the installer, as a check.

If the Worker address ever changes, update `HOME` in `src-tauri/src/main.rs`,
`frontendDist` in `src-tauri/tauri.conf.json`, and release a new version.
