# Book Studio for Windows

A small Windows app (Tauri) that opens the online Book Studio,
https://flg-api.btay74.workers.dev/admin/book-studio/, in its own window with a Start menu
icon. Nothing of Book Studio is bundled: the window always shows the live version, with the
Worker's strict Content Security Policy, the normal sign-in and the publishing access check.
Only people the owner has given publishing access (Publisher role, an admin, or "Can publish
books" under Admins) get past the sign-in screen.

- **Download:** Book Studio's **Get the app > Download for Windows** links
  `releases/download/book-studio-desktop/Book-Studio-Setup.exe`.
- **Sync:** books are saved to the signed-in account (book-studio/src/sync.js), so the same
  books are in the app, the browser and on a phone. The page keeps its own files for offline
  use (admin/book-studio/sw.js).
- **No app permissions:** the page cannot call any app command. Links that leave `/admin` open
  in the normal browser. Exports download as they do in Edge.
- **Updates:** at start the app checks `releases/download/book-studio-desktop/latest.json`
  (signed with the same updater key as the game) and asks "Update now / Later". A change to
  Book Studio itself needs no new app version, since the app shows the live page.
- **Unsigned:** Windows SmartScreen may warn "Windows protected your PC". Click **More info**,
  then **Run anyway**.

## Releasing

1. Raise `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Merge to main. The "Book Studio app for Windows" workflow
   (`.github/workflows/book-studio-desktop.yml`) builds on Windows and replaces the files on the
   `book-studio-desktop` release (never marked "latest"). It can also be run from the Actions tab.
   It uses the repository secret `TAURI_SIGNING_PRIVATE_KEY`.

Pull requests that touch this folder only build the installer, as a check.
