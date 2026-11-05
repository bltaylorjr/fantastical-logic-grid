# The Logic Grid Admin for Windows

A small Windows app (Tauri) that opens the online admin dashboard,
https://flg-api.btay74.workers.dev/admin/, in its own window with a Start menu
icon. Nothing of the dashboard is bundled: the window always shows the live
version, with the Worker's strict Content Security Policy and the normal
sign-in. Admin data and sign-in are never stored in the app beyond what the
page itself keeps.

- **Download:** the "Download for Windows" button in the dashboard (Windows
  visitors only, hidden inside the app) links
  `releases/download/admin-desktop/The-Fantastical-Logic-Grid-Admin-Setup.exe`.
- **Vox, the voice engine, runs inside the app:** on the Voice engine page,
  **Start Vox** and **Stop Vox** run Vox on this computer with no command window,
  and the page connects by itself (the app reads Vox's admin token from
  `learning\admin_token.txt`). The first start installs Vox and makes the practice
  model if needed (output in `vox-setup-log.txt`); Vox's own output goes to
  `vox-log.txt`. The Vox folder is found in the usual places (like
  `Downloads\MEGA\vox-engine\vox-engine`) or chosen once in a folder picker.
  Vox starts by itself, hidden, as soon as the app opens ("Start Vox when the
  admin app opens" on the Voice engine page, on by default). Closing the app
  window (its X) closes the app and stops Vox, its tunnel, and a Vox started
  from the Vox desktop shortcut or a command window. See `src-tauri/src/vox.rs`.
- **Vox on any device:** unless "Let my other devices open Vox" is off, Start Vox
  puts it online with a free Cloudflare quick tunnel (`vox serve --tunnel`). The
  app downloads Cloudflare's free `cloudflared.exe` once into its data folder if
  it isn't installed. The page saves the address and token on the server
  (`/admin/v1/vox-link`, admins only), so the Voice engine page on a phone or any
  other computer connects by itself. The address changes on every start, and the
  dashboard's content policy allows only the current one. Stop Vox clears it.
- **The page's only permissions are Vox's:** `capabilities/vox.json` lets the
  dashboard's own address (and nothing else) call the eight `vox_*` commands. They
  take no program, path or arguments from the page, so the page still cannot run
  anything else, read files or use any other app feature. Links that leave `/admin` (Open the game, GitHub)
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
