# The Fantastical Logic Grid: browser and desktop app

The playable game, built on the puzzle and story engine in
`/mnt/project-files/logic-grid-engine/` (copied in at build time, never edited here).

- **Browser:** a static web app (`dist/web`) that works offline and installs as an app (PWA)
  from Chrome or Edge ("Install app" in the game's Menu). Host the folder on any static host
  (GitHub Pages, Netlify, Cloudflare Pages) over HTTPS.
- **Desktop (Windows):** a Tauri app. `releases/The Fantastical Logic Grid_1.0.0_x64-setup.exe`
  installs for the current user, needs no admin rights, and uses the Edge WebView2 runtime that
  Windows 10 and 11 already have (the installer fetches it if missing). The installer is not
  code-signed yet, so Windows SmartScreen shows "Windows protected your PC": choose
  *More info* then *Run anyway*.
- **Preview on claude.ai:** `dist/preview` is the same app as an Artifact page. Printing and
  saving to files are hidden there because the Artifact frame blocks them.

## Features

Setup (difficulty, theme, size, clue count, cast names, title, clue types), a brand new story
every time (the app stores each `puzzle.story.id` and passes the list back as `usedStories`),
an accessible staircase grid (keyboard, touch, mouse, screen reader, list view), stepped hints,
check, unlimited undo/redo that survives saving, autosave and resume, a saved-puzzles list with
rename, delete-with-undo and save/open puzzle files, a completion panel with the story ending,
coach tips on the first Easy puzzle, optional sound, light/dark/high-contrast themes, and
print (blank or with marks, Letter or A4, answer key on its own page, step-by-step for Easy).

Multimedia layer (all built in, works offline): a themed scene for every story that reveals a
new layer as each grid section is finished, a portrait for every character that tells the
clues they remember (each clue is also always in the clue list), synthesized sound effects
(on by default, one-tap mute) and optional theme music whose mood brightens as the grid fills,
an optional "show mistakes as I play" check, a chime and pulse when a section is done, an
animated resolution scene with the culprit on solve, and a suggested difficulty based on
recent solves. **Silent mode** (New puzzle screen or Settings) hides all of it: only the
story, grid, clues and answer key remain, with no sound or animation.

**AI pictures and natural voices** (`web/js/ai.js`): with an OpenAI API key pasted in
Settings, each new story gets a painted scene (revealed panel by panel as sections finish)
and, optionally, character portraits (`gpt-image-2.5-flare`, medium quality), and the narrator and characters speak
with natural voices (`gpt-4o-mini-tts`, which OpenAI retires on 2027-01-06; after that the game falls back to the computer's voices until it moves to the Realtime API). Results are cached in IndexedDB by story id, so each
is made once. Without a key the game falls back to the built-in art and the computer's own
speech voices (Windows "Natural" voices are preferred when present). The key is stored only
on the player's device. Model names are settings (`imageModel`, `voiceModel`) if they change.

**Free natural voices (Google Gemini)**: Settings > "Where voices come from" defaults to
Gemini (`gemini-3.8-flash-tts`, setting `geminiVoiceModel`). The player pastes a free key from
https://aistudio.google.com/apikey. The free tier is daily-limited and Google may use free-tier
text to improve its products; the settings note says so. If the chosen service has no key, the
game uses the other one, then the computer's voices. Clips are cached like OpenAI ones.

**Free components** (Bobby approved 2026-10-24; licenses in `web/THIRD-PARTY-NOTICES.txt` and `web/vendor/*/LICENSE*`):
Kokoro offline natural voices (kokoro-js + Kokoro-82M, Apache-2.0; ONNX Runtime Web from Transformers.js 3.5.1;
the model downloads once from Hugging Face when the player clicks "Download free voices", voice files ship in
`web/vendor/kokoro/voices`, `web/kokoro-worker.js` runs it off the main thread, and it is left out of the service
worker precache), DiceBear portraits (`web/js/portraits.js`; MIT code, CC0 Notionists/Lorelei/Open Peeps art;
setting `portraitStyle`), canvas-confetti on a real solve (`web/js/effects.js`, ISC; off in silent mode and with
reduced motion; setting `confetti`), Lucide toolbar icons (ISC, inlined in `index.html`). Vendored files came from
npm (`npm pack`); DiceBear is bundled with esbuild into `web/vendor/dicebear/dicebear.js`.

**Narration**: `cleanSpeech` removes notes, brackets, markdown and emoji; `speechChunks` splits text so the first
sentence plays while the rest is made; the story opening is pre-made when a puzzle opens (`warmVoice`).

`releases/The-Fantastical-Logic-Grid.zip` holds the installer, a portable .exe and the web build.

## Player accounts (optional)

Players can create an account (email and password) so saved puzzles, progress,
settings and the used-story list sync across the website, desktop and phone
apps. Playing without an account works exactly as before. Accounts use free
plans only (Firebase Authentication and a Cloudflare Worker with D1) and stay
switched off until `FLG_FIREBASE_API_KEY` and `FLG_CLOUD_URL` are set. Setup,
costs and how conflicts are merged: [server/README.md](server/README.md).

## Build

```
npm install
npm run build        # copies the engine + fonts, writes dist/web and dist/preview
npm run serve        # http://localhost:8080
npm test             # end-to-end check in headless Chromium (needs Playwright)
```

Windows installer (on Windows: `npm run desktop:build`; from Linux, with mingw-w64 and nsis):

```
rustup target add x86_64-pc-windows-gnu
npm run desktop:build:win-from-linux
# -> desktop/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*-setup.exe
```

macOS and Linux builds use the same `npm run desktop:build` on those systems.

## Files

```
web/index.html, app.css     page and styles (tokens from the UI guidelines)
web/js/app.js               setup, play, hints, saves, settings, keyboard
web/js/grid.js              grid rendering, roving focus, cell menu
web/js/print.js             print pages and answer key
web/js/art.js               theme scenes and character portraits (generated SVG)
web/js/audio.js             sound effects and theme music (Web Audio)
web/js/ai.js                AI pictures and voices (OpenAI, player's key), device-voice fallback
web/js/store.js             IndexedDB saves and used-story list, settings
web/js/engine-client.js     talks to the Web Worker
web/worker.js               runs generatePuzzle and getHint off the main thread
web/sw.js                   offline cache (file list stamped by the build)
desktop/src-tauri/          Tauri desktop shell
scripts/                    build, local server, icons, end-to-end test
```

## Repository, releases and hosting

- `engine/` is a snapshot of the puzzle engine (`/mnt/project-files/logic-grid-engine`); `npm run build`
  copies `engine/src` into `web/engine`. Set `ENGINE_DIR` to build from another copy.
- `npm run build` writes `dist/web` (the app), `dist/preview` (claude.ai preview) and `dist/site`
  (`dist/web` plus `hosting/` files: `_headers`, `.htaccess`, `web.config`, `.nojekyll`, `DEPLOY.md`).
- **Desktop updates**: the Tauri updater (`desktop/src-tauri`, `web/js/updates.js`) reads
  `https://github.com/bltaylorjr/fantastical-logic-grid/releases/latest/download/latest.json`
  and only installs packages signed with the updater key. To release: raise `version` in
  `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` and `package.json`, push, then run
  **Actions > Release desktop app**. It needs the repository secret `TAURI_SIGNING_PRIVATE_KEY`.
  The key is never committed; losing it means installed copies can no longer update.
- **Web version**: **Actions > Publish web version** deploys `dist/site` to GitHub Pages on each push to `main`.
