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

**Copyright and license:** © 2026 Bobby Taylor. All rights reserved. This is proprietary
software, not open source: see [LICENSE](LICENSE) and the player [Terms of use](https://thelogicgrid.com/terms/).
Third-party parts keep their own licenses (`web/THIRD-PARTY-NOTICES.txt`).

## Features

Setup (difficulty, theme, size, clue count, cast names, title, clue types), a brand new story
every time (the app stores each `puzzle.story.id` and passes the list back as `usedStories`),
an accessible staircase grid (keyboard, touch, mouse, screen reader, list view), stepped hints,
check, unlimited undo/redo that survives saving, autosave and resume, a saved-puzzles list with
rename, delete-with-undo and save/open puzzle files, a completion panel with the story ending,
coach tips on the first Easy puzzle, optional sound, light/dark/high-contrast themes, and
print (blank or with marks, Letter or A4, answer key on its own page, step-by-step for Easy).

**Daily puzzle, stats, badges and sharing** (`web/js/daily.js`, `stats.js`, `share-result.js`): the
home screen offers one new puzzle a day, the same for everyone. The website build (`scripts/seo.mjs`)
publishes it as `daily/latest.json` and `daily/puzzles/<date>.json` (UTC days; the desktop app reads
them from the public site). Solving the day's puzzle within 48 hours of the day starting builds a
streak. Daily puzzles earn no scoreboard points (their answers are on the website). Menu > My stats
and badges shows totals, times by difficulty, favorite themes and 19 badges, all worked out from a
solve log (meta `solves`) that syncs with an account. Share my result (on the solved panel) sends a
spoiler-free picture and message through the device's share sheet, or shows them to copy.

**Any language** (`web/js/i18n.js`, `server/src/translate.js`): US English is the default; Settings >
Language offers 100 languages. The page translates itself as it shows (menus, stories, clues, hints,
messages, printing, the shared result and read-aloud), using the browser's own on-device translator
when it has the language, otherwise the Worker's `POST /v1/translate` (Cloudflare Workers AI's free
allowance, each text translated once for everyone and kept in D1). Each device keeps the translations
it has seen. The English button at the top shows the original at any time. Names, notes and anything a
player types are never translated. Right-to-left languages read right to left (the grid keeps its order).

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
reduced motion; the admin dashboard picks which effects play, confetti, fireworks, stars, balloons, sparkles, theme
pictures, bubbles, falling snow/leaves/petals, shooting stars, ribbons, light rays or party emoji, and whether one is picked at random: settings `celebrations` and `celebrateRandom`), Lucide toolbar icons (ISC, inlined in `index.html`). Vendored files came from
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

Signed-in players must choose a screen name (shown at the top; anyone not
signed in plays as Guest), and can race other players on the
same puzzle (by code, link, *Find a race*, or a challenge to a player by screen name) and climb the weekly and
all-time scoreboard. It runs on the same free Worker and database; see
"How races and the scoreboard work" in [server/README.md](server/README.md).

## Build

```
npm install
npm run build        # copies the engine + fonts, writes dist/web and dist/preview
npm run serve        # http://localhost:8080
npm test             # end-to-end check in headless Chromium (needs Playwright)
```

The build minifies the game's own scripts and styles (esbuild; `web/vendor/` is left as is) and stamps
each with the copyright line. The story and puzzle content modules (storylines, topics, cast, clue wording) are
also obfuscated with javascript-obfuscator so their text can't be lifted; the solver and generator are not, because
that would slow puzzle making by about 65%. Set `FLG_NO_MINIFY=1` for readable files while debugging.

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
  (`dist/web` plus `hosting/` files: `_headers`, `.htaccess`, `web.config`, `.nojekyll`, `DEPLOY.md`,
  and the search pages, daily puzzle, sitemap and search tags from `scripts/seo.mjs`).
- **Desktop updates**: the Tauri updater (`desktop/src-tauri`, `web/js/updates.js`) reads
  `latest.json` from the latest release of the public site repository `bltaylorjr/thelogicgrid`
  first, then of this repository (see [docs/PRIVATE-REPO.md](docs/PRIVATE-REPO.md)), and only installs packages signed with the updater key. To release: raise `version` in
  `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` and `package.json` and merge to `main`;
  **Actions > Release desktop app** then runs by itself (or run it by hand). It needs the repository secret `TAURI_SIGNING_PRIVATE_KEY`.
  The key is never committed; losing it means installed copies can no longer update.
- **Web version**: **Actions > Publish web version** deploys `dist/site` to GitHub Pages on each push to `main`
  and every night (new daily puzzle page), then notifies IndexNow search engines.
- **Search**: crawlable how-to-play, themes, difficulty and daily puzzle pages, Lighthouse on every PR and a
  weekly live search check. Google Search Console and Bing setup steps: [SEO.md](SEO.md).
- **Self-maintenance**: tests on every PR, weekly dependency updates, a health check every 3 hours
  that opens an issue when something is down, a daily cleanup of old server data and anonymous
  error reports. See [MAINTENANCE.md](MAINTENANCE.md).
