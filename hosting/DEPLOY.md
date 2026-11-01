# Put The Fantastical Logic Grid on the web

**Site layout.** The website is The Logic Grid: its front page (`index.html`) lists
the games, The Fantastical Logic Grid plays at `fantastical/` and NINETIMESNINE at
`ninetimesnine/` (built by `scripts/hub.mjs`). Every other page and file (daily
puzzles, how to play, educators, printables...) stays where it was. Old links to the
game at the site root (`/?play=now`, `/?challenge=CODE`, the installed app) are sent
on to `fantastical/` by the front page. All pages share one web address, so saves,
settings and sign-in are the same everywhere.

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
4. The site appears at `https://thelogicgrid.com/` (and the old
   `https://bltaylorjr.github.io/fantastical-logic-grid/` address forwards there).

### Custom domain: thelogicgrid.com

The game uses only relative paths, so it runs the same at the domain root. `CNAME` in this
folder records the domain for hosts that read it; with **Source: GitHub Actions** GitHub
ignores that file, so the domain is set once in the repository settings.

1. At the domain registrar, open the DNS settings for `thelogicgrid.com`, delete any
   existing `A`, `AAAA` or `CNAME` records for `@` and `www` (parking pages), then add:

   | Type | Name | Value |
   |---|---|---|
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | AAAA | @ | 2606:50c0:8000::153 |
   | AAAA | @ | 2606:50c0:8001::153 |
   | AAAA | @ | 2606:50c0:8002::153 |
   | AAAA | @ | 2606:50c0:8003::153 |
   | CNAME | www | bltaylorjr.github.io |

   On Cloudflare DNS, set each record to **DNS only** (grey cloud) until HTTPS works.
2. In the repository, **Settings > Pages > Custom domain**, enter `thelogicgrid.com` and
   click **Save**. Wait for the DNS check to pass (minutes, sometimes up to a day).
3. Tick **Enforce HTTPS** once GitHub has issued the certificate (it greys out until then).
4. Optional, protects the domain from takeover: GitHub profile **Settings > Pages >
   Add a domain**, enter `thelogicgrid.com`, and add the `TXT` record it shows at the
   registrar.

Saved games live in the browser per web address, so a game saved at the old github.io
address does not appear at thelogicgrid.com. Use **Save to file** on the old address,
then **Open a puzzle file** on the new one.

To upload this folder by hand instead: put its contents on a `gh-pages` branch and choose
"Deploy from a branch" in the same settings page. Keep `.nojekyll`.

## Updating

**Players never have to do anything.** Each build has its own service worker version.
An open copy of the game checks for a new version every 30 minutes and whenever it is
brought back to the front. When one is ready, the home screen offers **Reload now**. It
never interrupts a puzzle in progress, and saved games carry over.

**By hand:** upload the new folder over the old one.

**Automatically:** every push to `main` runs the **Publish web version** workflow. It always
updates GitHub Pages, and it also updates any host below whose secrets you add under
**Settings > Secrets and variables > Actions > New repository secret** in the GitHub repo.
Hosts without secrets are skipped, so add only the ones you use.

| Host | Secrets to add | Where to get them |
|---|---|---|
| Netlify | `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | User settings > Applications > Personal access tokens; Site configuration > Site ID |
| Cloudflare Pages | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PROJECT` | My Profile > API Tokens (template "Edit Cloudflare Workers", or a token with Cloudflare Pages: Edit); the account ID is on the dashboard sidebar; the project is your Pages project name |
| FTP or FTPS (most shared hosting, cPanel, GoDaddy, Bluehost, Hostinger) | `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, optional `FTP_DIR` (for example `/public_html/`) | Your host's FTP accounts page. Use `ftps://host` when your host supports it |
| SSH server (VPS, nginx, Apache, Raspberry Pi) | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PATH` (for example `/var/www/logic-grid`), optional `SSH_PORT` | Make a key just for deploying (`ssh-keygen -t ed25519`), add the public half to the server's `~/.ssh/authorized_keys`, paste the private half as the secret |
| Anything with a deploy hook (Vercel, Render, Netlify build hooks, DigitalOcean App Platform) | `DEPLOY_HOOK_URL` | The host's "deploy hook" or "build hook" setting. The workflow sends it a POST after each push |

The FTP and SSH steps upload only changed files and delete files the new version no longer
uses. To run it without pushing, open **Actions > Publish web version > Run workflow**.

## What the game reaches on the internet

Nothing, unless the player turns something on in Settings:
- **Free Kokoro voices** download a voice model once from `huggingface.co`.
- **Google Gemini voices** call `generativelanguage.googleapis.com` with the player's own key.
- **OpenAI pictures and voices** call `api.openai.com` with the player's own key.

If your host sets a Content-Security-Policy, allow those three hosts in `connect-src`,
plus `blob:` in `media-src` and `img-src`, and `'wasm-unsafe-eval'` in `script-src`.
