# Put The Fantastical Logic Grid on the web

This folder is the whole game as a static website. `index.html` is at the root and every
path is relative, so it works at a domain root (`https://example.com/`) or in a sub-folder
(`https://example.com/games/logic-grid/`). There is no server code and no database: saves
stay in each player's browser.

## Any static host

1. Upload everything in this folder, including the hidden files `.htaccess`, `.nojekyll`
   and `_headers`, to the folder your site serves.
2. Use **HTTPS**. Offline play, "Install app" and the screen-awake feature only work over
   HTTPS (or on `localhost`).
3. Make sure the server sends these content types. Most hosts already do; the included
   `.htaccess` (Apache), `web.config` (IIS/Azure) and `_headers` (Netlify, Cloudflare
   Pages) set them for you.

   | Files | Content-Type |
   |---|---|
   | `.js`, `.mjs` | `text/javascript` (required: the game uses JavaScript modules) |
   | `.wasm` | `application/wasm` (Kokoro free voices) |
   | `.webmanifest` | `application/manifest+json` |
   | `.vtt` | `text/vtt` (video captions) |
   | `.mp4` | `video/mp4` |
   | `.woff2` | `font/woff2` |

4. Serve `sw.js` and `index.html` with `Cache-Control: no-cache` so players get updates
   quickly. Everything else can be cached.
5. Open the site, then reload once. The game now works offline.

nginx: add `types { text/javascript mjs; application/wasm wasm; text/vtt vtt; }` to the
`http` block if those types are missing, and `location = /sw.js { add_header Cache-Control "no-cache"; }`.

## GitHub Pages (from github.com/bltaylorjr/fantastical-logic-grid)

The repository has a workflow that builds and publishes the site on every push to `main`.

1. On GitHub, open the repository, then **Settings > Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Go to **Actions**, open **Publish web version**, and click **Run workflow** (or push to `main`).
4. The site appears at `https://bltaylorjr.github.io/fantastical-logic-grid/`.

To upload this folder by hand instead: put its contents on a `gh-pages` branch and choose
"Deploy from a branch" in the same settings page. Keep `.nojekyll`.

## Updating

Upload the new folder over the old one. Each build has its own service worker version,
so players get the update the next time they open the game.

## What the game reaches on the internet

Nothing, unless the player turns something on in Settings:
- **Free Kokoro voices** download a voice model once from `huggingface.co`.
- **Google Gemini voices** call `generativelanguage.googleapis.com` with the player's own key.
- **OpenAI pictures and voices** call `api.openai.com` with the player's own key.

If your host sets a Content-Security-Policy, allow those three hosts in `connect-src`,
plus `blob:` in `media-src` and `img-src`, and `'wasm-unsafe-eval'` in `script-src`.
