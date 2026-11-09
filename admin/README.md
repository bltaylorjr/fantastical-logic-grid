# Admin dashboard

A separate web app for running The Logic Grid. It is served by the
game's own Cloudflare Worker at **https://flg-api.btay74.workers.dev/admin/**
(these files are the Worker's static assets, see `server/wrangler.toml`), so it
needs no extra hosting and stays free. Its API is `server/src/admin.js`.

## Dashboards

The menu has one dashboard for the app and one for each game. Pick one with
the buttons at the top of the menu; the menu then shows that dashboard's
sections. Every address (`#daily`, `#settings`, ...) still works and opens
its own dashboard.

- **The Logic Grid** (the app, shared by every game): Overview, Status (live), Visitors,
  Usage and free limits, Search, Website, Marketing, Books and covers, Amazon KDP, Communication, Error
  tracking, Players, Screen names, Supporters, App keys, **App settings and
  switches** (sign-in, messages, ideas and problems, languages, support,
  alerts, moderation, backups, social links), Connections and setup, Face ID
  and fingerprint, Backups and archive, Audit log, Admins.
- **Passwords** (owner only, see below): its own dashboard button, one page
  with no section menu. `#passwords` or `#vault` opens it, and the installed
  app's icon has a Passwords shortcut (long-press or right-click).
- **The Fantastical Logic Grid**: **Fantastical home** (`#fantastical`: what is
  waiting for review, play numbers, and a way into each section), Daily
  puzzles, Characters, Media library, Puzzle quality, Ratings and insights,
  Puzzle emails, Story workshop, Puzzle submissions, Storyline submissions, Educator requests,
  Educator feedback, Badges, and **Game settings and switches**
  (`#game-settings`: play, themes, characters, voices, sounds, pictures,
  celebrations, puzzle emails, printable packs, educators, learning).
- **NINETIMESNINE**: its numbers and its own settings (`#numberplace`).

Which settings group goes on which dashboard is set in `admin/admin.js`
(`GAME_GROUPS`); a new group shows under App settings until it is listed there.

| Section | What you can do | Lowest role |
| --- | --- | --- |
| Overview | Alerts when a free allowance (voices, pictures, database size, Worker requests, database reads and writes) passes the alert level; accounts, screen names, scoring players, games finished and solved by theme and difficulty, scores, races, free voices and AI pictures against their daily caps, error reports, things waiting for review (story parts, names, new ideas and problems) | viewer |
| Status (live) | Everything worth watching on one page, checked every 30 seconds while it's open (paused when the tab is hidden): the Worker, database and website checks; the Oracle puzzle server, Vox, the free-tier guard, outbound data, disk, server size and the daily cleanup; today's free allowances; scheduled work (nightly maintenance, weekly archive, search numbers, your alerts, the puzzle doctor and each GitHub Actions workflow's last run, with the optional GITHUB_DISPATCH_TOKEN); and work waiting for you. Problems come first, each row opens the page where it's handled, and the menu shows how many need a look. **What it watches follows the code:** on every Worker deploy `scripts/status-catalog.mjs` reads the workflows (and their schedules), the Worker's bindings and crons, the database tables and these pages into `server/src/status-catalog.js`, so new features are watched and removed ones drop off by themselves, and the page says what changed since you last looked. A daily cap is watched by adding `watch: { usage, on }` to it in `server/src/settings.js`; any other daily counter shows up on its own. Rows that are switched off or not set up wait, folded, at the bottom | viewer |
| Usage and free limits | Database size and rows per table; with the optional Cloudflare token, daily Worker requests and D1 reads and writes against the free allowances | viewer |
| Search (Google and Bing) | Clicks, impressions, average position, top searches and top pages for the last 28 days, sitemaps and whether the home page is indexed; fetched daily, Refresh now for admins | viewer |
| Daily puzzles | The next 14 days' daily puzzles (title, theme, level, size) as the last site build made them; plan up to 60 days ahead: change a day's theme, level or size, ask for a new story, add a note, or put a day back to automatic. Changes go live with the next site build (daily just after midnight US Eastern, or Publish web version now) | moderator to look, admin to change |
| Characters | The game's own characters: name, woman or man (face and voice both follow it), personality, cast or storyteller, every theme or chosen ones, a drawn face (DiceBear) or an AI portrait (Workers AI, counts toward New AI pictures a day), a server voice and an on-device Kokoro voice with a pace, and lines for clues, hints and solves (drafted free by a Workers AI text model, editable). Names and lines are checked against the story rules and the word filter before publishing. Also reviews characters players suggest from Menu > Suggest a character. Switches and caps are under Settings > Characters | moderator; admin to publish |
| Media library (sounds and pictures) | Try out every sound and picture in the game, in groups: background music for each theme (with a slider for how full the grid is), sound effects, voices (server voices, voice styles, this device's voices), celebrations (each with its On for players switch, the same as in Settings), theme scenes (with a slider for how much of the grid is finished), character faces in every style, and theme pictures. It runs copies of the game's own files (`game-*.js`, `confetti.js`), made by `node scripts/admin-media.mjs`; run it after changing web/js/audio.js, art.js, gender.js or effects.js (server/test/media.test.mjs fails when a copy is out of date) | viewer; admin to switch celebrations |
| Puzzle quality | For each theme and level over the last 30 or 90 days: games, solve rate, how many gave up or revealed the answer, ratings and "too hard / too easy", minutes and hints. Groups with 5 or more games that many players give up on, rate under 3 or find too hard or too easy are flagged and come first | viewer |
| Ratings and insights | The optional 1 to 5 stars players give after solving (5 is excellent): average, how many rate, the spread of stars and the average over time, for the last 7, 30, 90 or 365 days. Group by theme and difficulty, theme, topic, difficulty, size, clue type, what-if reasoning, story part, story, character, app version, platform or play mode, each with solve, give-up, too hard / too easy and trend columns. "What's working" and "What to improve" say in plain words which groups (5 ratings or more) stand out and what to try. "In a few words" is a short summary from the free Workers AI text model, written from the numbers only, at most `ratings_ai_daily_cap` times a day (Settings > Alerts and reports) and kept for the day. The same analysis goes into the weekly summary email and the nightly report (`GET /admin/v1/ratings?brief=1`: `headline` and `actionNeeded`) | viewer (Write it again: admin) |
| Website | How thelogicgrid.com looks, in 10 groups you open one at a time: colors (light and dark), fonts and text size, shapes and layout, the front page's words, game cards and visual effects (arrival animation, card hover, puzzles that solve themselves, backdrop, twinkling stars), its header and footer, the NINETIMESNINE page, the information pages (how to play, daily, printables, themes, educators, privacy, terms) and what search results show. Every option is one dropdown or text box, each group shows how many choices differ from the original, and each option and group can go back to the original. The live preview shows the real site with the draft applied (any page, light or dark, computer or phone) and takes no clicks. **Edit on the page** turns the preview into a page editor: click any element to pick it (click inside to pick something smaller, "↑ Bigger" for the box around it), double-click words to change them in place (Enter keeps, Esc cancels) or type them in the panel, drag a picked element to a new place (a gold line shows where it lands), or use Move up, Move down and Hide. Each change is listed under Changes on this page with Remove; links and buttons never open while editing. Changes are plain words, hide and move only, addressed by place and first words so a changed page skips them rather than hitting the wrong element (`web/js/site-design.js`, applied by `web/js/design-preview.js` in the preview and for visitors). **Open in a new window** opens the same editor full size; both windows stay in step and either can publish. Undo and Redo (Ctrl+Z, Ctrl+Shift+Z), Discard draft, Publish, and the last 20 published versions can come back as a draft. Publish rebuilds the site at once when the GITHUB_DISPATCH_TOKEN secret is set (otherwise the nightly build shows it). The options are `web/js/site-design.js` (copied to `admin/site-design.js` by `node scripts/admin-media.mjs`); the build writes the design into every page (`scripts/site-design-build.mjs`); the games themselves keep their own look | viewer to look, admin to change and publish |
| Voice engine | Vox, the free voice engine, on your own computer (`vox serve`) or online at your own address through a named Cloudflare tunnel (like voice.thelogicgrid.com; quick `*.trycloudflare.com` tunnels are not allowed, since anyone can make one). **Open Vox** (shown until connected): a light that shows whether Vox is running (checked every 3 seconds), **Download start shortcut** (a `Start Vox.cmd` for Windows built from your Vox folder, model file and an optional "put it online" switch; double-click it to start Vox), the start command with Copy, and the admin token box. Once a token is saved, the page connects by itself whenever Vox comes up; a refused token is never retried on its own. **Open Voice Studio** opens Vox's own studio in a new tab. **In the Windows admin app** the page instead shows **Start Vox** / **Stop Vox**: the app runs Vox with no command window (installing it and making the practice model the first time), reads the admin token itself and connects; "Start Vox when the admin app opens" is on by default (the app starts it hidden at launch and stops it when its window is closed), and **More** opens the Vox folder and its logs. **On any device:** the Windows app puts Vox online (a free Cloudflare address that changes each start) and saves the address and token on the server (`vox-link`, admins only); the Voice engine page on a phone or another computer reads it and connects by itself, reloading once when the address changes, since the content policy allows only the current address. **Voices** also makes **new voices from samples**: keywords search openly licensed recordings (or add your own links and files with their license), and at least 3 different speakers are blended so the voice sounds like none of them. **Words**: the American English dictionary (install once, free: about 243,000 words and phrases with pronunciation as a respelling, IPA and sounds, syllables, meanings by part of speech, examples and synonyms; words said two ways, like record, show both), Hear it, Hear it slowly, Hear it in use, and your pronunciation fixes. **Languages**: translate a line into 99 other languages (or 400+ with the larger model) and hear it. **Learning**: lines spoken, quality over time, your ratings and choices, Refine now, automatic refinement settings and every past round. **Review takes**: play recent lines, rate them Good or Not good, and make A/B pairs of the same line to pick the better one; each rating and choice teaches it. **Auto-tune**: per-voice pitch correction (subtle, natural, pop, hard, robot, bard, giant, pixie or custom: key, scale, retune speed, strength, humanize, shift, vibrato, mix) with Hear it / Hear it without. **Voices**: hear, auto-optimize generation settings, reset, undo the last refinement, delete. **Voices for every age**: make the six starting voices (adult, teen and adolescent; male and female) in any dialect, or a new voice at any age from first words (1) to 90, with dialect and accent strength, speaking style, usual delivery, fluency, child sound patterns kept at any age, and "say it the way a child would"; **Try any voice** plays a sample with any age, dialect, style or delivery (whisper to scream, laughing, crying, falsetto, singing on notes you give). **Age, dialect and delivery** on each voice edits its profile. **Vox on the server** (docs/VOX-SERVER.md): once the Oracle server runs Vox, the page uses it on every device through `/admin/v1/vox/...` (signed in, admins only; the Worker adds Vox's key), and the Windows app's own Vox steps aside ("Use Vox on this computer instead" switches back). The Learning tab's **Automatic training** (nightly gathering by single dictionary words, dialect and vocabulary learning, training with a check before a new model goes live, accuracy scans, storage budget; Run now, Stop, Go back to the previous model, schedule and limits) and **Install Whisper** installs Whisper wherever Vox runs, if it's missing. **Discover voices from every word**: goes through every dictionary word a few at a time as search keywords for openly licensed recordings and makes a blended voice from each group with 3+ speakers (resumable; Start, Stop, Start over; each discovered voice has Play sample). **Versions**: every model the learning made, with its test score; use any version or roll back. Talks to the engine directly, never through the Worker; the content policy allows only `127.0.0.1`/`localhost` and `*.thelogicgrid.com` | admin |
| Books and covers (in Book Studio) | Now the **Grid books** tab of Book Studio (`/admin/book-studio/#gridbooks`; the dashboard link and `#books` go there). Make puzzle books to publish (print on demand, such as Amazon KDP). **The book**: title, subtitle, volume, edition, author (Bobby Taylor), optional ISBN, trim size (6 × 9, 7 × 10, 8 × 10, 8.25 × 11, 8.5 × 11 in), white or cream paper, answer keys at the back (one or two to a page) or after each puzzle, contents and how-to-play pages. **The puzzles**: one game, or *different puzzles* (a mix of games): add a section for each game and level (size, story theme, how many), section by section or mixed together. The website's Book maker page (`web/book-maker/`, shown in a frame) makes them with each game's own engine and print layout; no puzzle that is already in any book is made again (`book_puzzles` keeps every fingerprint, one book each), and every puzzle's words go through the trademark and copyright watch list (Clear, Check or Problem; Replace any one). **Inside the book**: title page, copyright page, contents with page numbers, how to play, the numbered puzzles, the answers and notes pages up to 24 pages and an even count; every page's contents shrink to fit the trim, the gutter grows with the page count (KDP's table) and page numbers print at the foot. Print and Save as PDF for the interior file. **The cover**: one full wrap (back, spine, front) with 0.125 in bleed, the spine from the page count and paper, a clear 2 × 1.2 in barcode area, spine words only past 79 pages; six templates (Classic frame, Bold band, Night sky, Puzzle pattern, Clean and simple, Bright blocks), each drawing the book's own games' puzzle pictures (every game has one); colors, front line, back words and points; save your own templates; print the cover (Save as PDF) or download it as SVG. **Save** keeps the book and its pages (so it prints the same again); **Mark as published** locks it and its puzzles for good; a draft can be deleted, which frees its puzzles | anyone who may publish books (Book Studio) makes, saves and publishes; **Open in the editor** brings a book into Book Studio for any publisher's specs and the submission packet |
| Amazon KDP | Each book's Amazon KDP listing, one per format (paperback or hardcover), kept the way KDP's three setup tabs ask for it: **Book and status** (link a Grid book and **Fill in from the Grid book** for title, subtitle, author, volume, trim, paper and pages; where it is on KDP: Planning, Draft on KDP, In review, Live on Amazon, Unpublished; ASIN and ISBN), **Details** (title and subtitle with a shared 200-character count, series, edition, author, contributors, a 4,000-character description, reading age), **Keywords and categories** (7 boxes of 50 characters, 3 categories), **AI-generated content** (KDP's text, images and translations answers; the game's AI writer and AI pictures count, engine-made puzzles don't), **Print and price** (ink, trim, paper, pages, finish, bleed, list price, Expanded Distribution, with the printing cost, lowest allowed price and royalty a copy worked out as you type from `admin/kdp-calc.js`, Amazon.com figures with the date they were checked), **Upload steps** (tick list from Book Studio's PDFs to Author Central), **Sales by month** (copies and royalty from KDP's royalty report; a month entered again replaces it; Download CSV) and **Notes**. One group opens at a time and each says whether it is done. The check at the top lists what KDP would refuse (too long, banned keyword words like "free" or "bestseller", missing AI answers, a price under the minimum) and tips (empty keyword boxes, keywords that only repeat the title, the 60% royalty from $9.99), plus the trademark and copyright watch list on the saved words. **Copy** beside each box copies it to paste into KDP. KDP has no API, so nothing here changes KDP or Amazon. Tiles total listings, live books, copies and royalties, with a chart of royalties per month. Tables `kdp_listings` and `kdp_sales`; API `server/src/kdp.js` | viewer to look, admin to change |
| Marketing | Every campaign and ad: the exact words to post, its media (videos and pictures in `media/promo` and `media/marketing`), where it goes, its status (draft, approved, posted with the live link) and its tracked link. Numbers per day, channel, campaign and ad: visits from campaign links and other websites, the first puzzle played, solves, app installs and Windows downloads in the 30 days after the visit. Make a tracked link for anything else, and download every number as CSV. The game sends these as anonymous daily counts (`web/js/campaign.js`, `POST /v1/m`); unknown campaign codes are counted as "(other)". The launch campaign (`server/src/marketing-seed.js`) is added once, as drafts | viewer (change, CSV: admin) |
| Story workshop and review | Write story parts for every player's new stories (checked by the game's rules, live within about 15 minutes), draft them with the AI writer (Gemini free tier), and approve or reject parts sent from older app versions | moderator |
| Communication | **Inbox**: one list, newest first, of messages from signed-in players, ideas, problems, error reports and the log of emails to players, with filters (what, new or done, words to find). Open a conversation to read it and reply as "The team", mark it done or reopen it; ideas and problems are marked done or deleted, and show Reply when the player asked for one. **Send to players**: message one player (by screen name or player id, also from their page under Players), news in every player's Messages, and the home-screen banner (announcements). Older links to #feedback, #errors and #announcements open it | viewer: error reports, email log, news and banners; moderator: read and reply to what players wrote; admin: write first, news, banners, delete conversations |
| Screen names | See new and changed names (names the word filter would now refuse come first), approve them, rename, reset or ban. With **New screen names wait for approval** on (Settings > Play, on by default), other players see a typed name as "New player" until it is approved; names from the game's Suggest a name button are approved automatically | moderator |
| Players | Every account in one list, in sections: **Needs approval** (new or changed names), **Approved, active** (seen in the last 30 days), **Approved, inactive** (nothing for over 30 days), **Blocked** (banned) and **No screen name yet** (accounts that only sync saves), plus Everyone. Search by name or id, sort by any column, 25/50/100 a page. Viewers see names, dates and counts only | viewer |
| | Approve or block a name from the list; open a player's page (link `#players/<id>`) to see their scores, races and how much they sync; rename, ban or lift a ban | moderator |
| | Reset scores (this week or all time), delete an account's data | admin |
| App settings and switches / Game settings and switches | Split by dashboard (see Dashboards above). **Keys and services**: whether the GEMINI_API_KEY secret and Workers AI are set up (keys are never shown or typed here). **Sounds**: sound effects and theme music on/off for everyone, and whether they start on and at what volume (a player can still turn their own off). **Voices**: characters speak their clues, where voices come from (server Gemini, Kokoro on the device, or the device's own), server voices on/off, the daily voice cap and the Gemini voice model. **Pictures**: portrait style, AI pictures (none, scenes, or scenes and portraits, from Workers AI's free allowance), the daily picture cap and model. **Celebrations**: which effects play when a puzzle is solved (confetti, fireworks, stars, balloons, sparkles, theme pictures, bubbles, falling snow, leaves or petals, shooting stars, ribbons, light rays, party emoji), each with its own checkbox, and Random to play one checked effect at each solve instead of all of them. **Play**: races, solo scores, new screen names, themes on/off. **Learning**: learn from everyone, story parts from older apps, the AI writer's model. **Ideas and problems**: the game's two boxes and automatic error reports. **Moderation**: extra blocked words. **Languages**: translations for players who choose another language on/off, new translations a day, and the Workers AI translation model. **Alerts and reports**: the alert level (80% at first) and the weekly summary email on/off | viewer to look, admin to change |
| Backups and archive | What the weekly archive email takes out of the database and for how long each kind is kept, rows waiting, past runs; send now or download the zip (owner). Archive viewer: open archive zips in the browser to filter, group, chart and export them | admin (send/download: owner) |
| Audit log | Every admin request, allowed or refused; 90 days in the database, older entries in the weekly archive | admin |
| Book Studio | Opens its own page, `/admin/book-studio/`: the puzzle book editor with publisher presets, puzzle generators, cover designer and one-click submission packets (see [book-studio/README.md](../book-studio/README.md)). Each export is checked and written to the audit log | admin, or anyone given publishing (below) |
| Admins | Add or remove admins and choose their role: admin, moderator, viewer, or **publisher** (Book Studio only, nothing else). **Can publish books** gives a moderator or viewer Book Studio too; the owner, admins and publishers always have it | owner |

Every table has **Download this table (CSV)**, and admins can download all
players, all scores, or all ideas and problems as spreadsheet files (Players
and Communication sections). Cells that start like a formula get an
apostrophe so a spreadsheet never runs them.

When an allowance passes the alert level, the hourly health check (GitHub
Actions) also opens an issue titled **Free limits** in the repository, so
GitHub emails you, and closes it again when usage drops.

Changes reach every copy of the game within about a minute (the game reads
`GET /v1/config` every 10 minutes and when it opens; the server's own switches
apply within 30 seconds). No new release is needed. When a feature is
switched off, the game also hides it (theme music, the Ideas and problems
boxes, the note about anonymous sharing).

In the game's own Settings, players keep only their personal choices: Silent
mode, colors, play aids, "Learn from how I play", and their sound effects and
theme music switches and volumes. The Sound button on a puzzle mutes
everything in one tap.

## Passwords (owner only)

`#vault` is a password manager for every website and service you run the
business with: name, type, website and sign-in page, username, account email,
password, 2-step code key, notes, extra fields (PINs, security answers) and a
favourite star.

- **Locked on your device.** The first visit asks for a master password. Every
  login is locked in the browser (AES-GCM, with a random vault key that the
  master password locks through PBKDF2-SHA-256 at 600,000 rounds) before it
  is sent, so D1, backups, the audit log, the break-glass key and assistant
  keys only ever hold scrambled text. The master password is never sent or
  stored and **cannot be recovered**: forgetting it means wiping the vault
  (Unlock > Forgot the master password?).
- **Only the owner**, signed in with their own account. The break-glass key,
  assistant keys and other admins are refused by the API (`server/src/vault.js`).
- **Face ID, fingerprint or Windows Hello** can unlock it instead of the
  master password on each device you set up (offered after you unlock with the
  master password; listed under Import, export and settings, where a lost
  device can be removed). It uses a passkey made just for Passwords and the
  browser's PRF extension: after the face or finger check the passkey gives a
  secret that opens that device's own locked copy of the vault key
  (`vault_devices`). Needs a recent Chrome, Edge or Safari; other browsers are
  told so and keep using the master password, which always works.
- **Locks itself** after 5 minutes without use (1 to 30, under Import, export
  and settings), on Lock now, on sign-out and on reload.
- **Log in** opens the site's sign-in page in a new tab and copies the
  username; then Copy password and Copy code. Copied text is cleared from the
  clipboard after 30 seconds. A web page cannot type into another website, so
  real autofill would need a browser extension.
- **2-step codes**: paste the setup key a site shows beside its QR code (or an
  `otpauth://` link) and the 6-digit code shows and counts down, like an
  authenticator app.
- Make a password (20 characters), a strength meter, tiles and filters for
  weak and reused passwords, the last 5 passwords kept on each login, a bin
  with Undo (emptied after 30 days), CSV import from Chrome, Edge, Firefox,
  Safari, Bitwarden, 1Password and LastPass (duplicates skipped), CSV export,
  and Change the master password.

## On your phone or computer

The dashboard installs like an app, free and with no app store:

- **iPhone or iPad:** open https://flg-api.btay74.workers.dev/admin/ in Safari,
  tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the menu (three dots), then **Install app**
  (or **Add to Home screen**).
- **Windows app:** press **Download for Windows** at the top (shown to Windows
  visitors) or use the link in "Put the dashboard on your phone or computer" on
  the sign-in page. It is a free installer that updates itself; see
  [desktop-admin/README.md](../desktop-admin/README.md). Windows may show
  "Windows protected your PC" because it is not signed with a paid certificate:
  click **More info**, then **Run anyway**.
- **Windows or Mac in Chrome or Edge:** press **Install the app** at the top, or
  the install icon at the right end of the address bar.

It opens full screen as "Grid Admin". You sign in each time you open it. The
service worker (`sw.js`) keeps only the app's own files; admin data and sign-in
are never stored on the phone. Icons: `node scripts/admin-icons.cjs admin`.

## Security

- **Sign-in** uses the admin's normal game account (Firebase, free). The Worker
  checks the Firebase token, then that the email is the owner (`OWNER_EMAIL`
  secret) or on the admin list, and that the email is **confirmed** (anyone
  could make an account with an email they do not own).
- **Roles**: owner > admin > moderator > viewer. The owner is set only by the
  secret, so nobody can take that role from inside the dashboard.
  **Publisher** sits outside that ladder: it signs in like any admin but the
  API refuses every route except who-am-I, Face ID setup, sign-out and Book
  Studio's export check, and the dashboard sends it straight to Book Studio.
- **Break-glass key**: the Worker's existing `ADMIN_TOKEN` secret still opens
  the dashboard with the owner's rights, for when sign-in is down. Every use is
  logged as "break-glass token".
- **Audit log**: every `/admin/v1` request and every use of the older
  token-only `/admin/learn/*` and `/admin/errors` routes is written to
  `admin_audit`. The old `/admin/learn` review page now opens the dashboard's
  Story review.
- **Rate limits**: 120 requests a minute per connection on every `/admin` path
  and 60 a minute per signed-in admin.
- The API sends no CORS headers, so only the dashboard (same address) can call
  it from a browser. The pages have a strict Content-Security-Policy, cannot be
  framed and are not indexed. With "Keep me signed in on this device" the
  session survives switching apps (localStorage), otherwise it lives only in
  the tab; either way it locks after 1 idle hour.
- **Face ID and fingerprint** (`server/src/passkeys.js`, `admin/passkeys.js`):
  each admin can set up passkeys on their phones and computers under Face ID
  and fingerprint. The device keeps the private key and only unlocks it with
  the admin's face, finger or PIN; the Worker keeps the public key (D1
  `admin_passkeys`) and checks each sign-in with WebCrypto. A passkey sign-in
  gives a session key (only its hash is stored, `admin_sessions`) that locks
  after 1 idle hour and ends after 12 hours, on sign-out, or when the
  device or the admin is removed. Setting up a device needs a password
  sign-in from the last 15 minutes. Free: no library or service.
- **Privacy**: anonymous learning data (plays and story parts) is only counted
  on its own and never joined to accounts. Saved puzzles are counted, never
  shown. Emails stay in Firebase; players appear by screen name and id.

## One-time setup

1. **Merge the pull request.** Cloudflare Workers Builds deploys the Worker with
   these files and creates the new tables (migration `0300_admin.sql`).
2. **Add two Worker secrets.** Cloudflare dashboard > Workers & Pages >
   **flg-api** > Settings > Variables and Secrets > **Add**. Choose type
   **Secret** for both (a deploy wipes plain text variables that are not in
   `wrangler.toml`):
   - `OWNER_EMAIL`: the email of your game account (the owner).
   - `FIREBASE_WEB_API_KEY`: the Firebase web API key, the same value as the
     GitHub repository variable `FLG_FIREBASE_API_KEY` (Firebase console >
     Project settings > General > Web API key). It is not a secret, but GitHub's
     secret scanner flags it in code, so it lives here.
3. **Have a game account with that email.** If you do not have one, make it in
   the game: Menu > Account and sync. The email must be confirmed; if it is not,
   the dashboard's sign-in offers to send the confirmation link.
4. **Open https://flg-api.btay74.workers.dev/admin/** and sign in.
5. Optional, **daily usage numbers**: Cloudflare dashboard > My Profile > API
   Tokens > Create Token > Custom token with permission *Account > Account
   Analytics > Read*. Add it as the Worker secret `CF_API_TOKEN`, and your
   Account ID (shown on the Workers & Pages overview) as `CF_ACCOUNT_ID`. Free.
7. Optional, **Google and Bing numbers** for the Search section (both free):
   - **Google.** Sign in to https://console.cloud.google.com with the Google
     account that owns the Search Console property.
     1. Top bar project picker > **New project**, name it `logic-grid-search`,
        **Create**, then select it.
     2. Search the top bar for **Google Search Console API** > **Enable**.
     3. Menu > IAM & Admin > **Service accounts** > **Create service account**,
        name `search-reader`, **Done** (no roles needed).
     4. Open it > **Keys** > Add key > Create new key > **JSON** > Create. A
        `.json` file downloads. Copy its `client_email` (ends in
        `iam.gserviceaccount.com`).
     5. https://search.google.com/search-console > the `https://thelogicgrid.com/`
        property > Settings > **Users and permissions** > **Add user**, paste
        that email, permission **Restricted**, Add.
     6. Open the `.json` file in Notepad, copy everything, and add it as the
        Worker secret `GSC_SERVICE_ACCOUNT` (type **Secret**). Then delete the
        downloaded file.
   - **Bing.** https://www.bing.com/webmasters > Settings (gear) > **API access**
     > **API Key** > Generate. Add it as the Worker secret `BING_WEBMASTER_KEY`,
     and add the same key as a GitHub repository secret `BING_WEBMASTER_KEY`
     (GitHub > Settings > Secrets and variables > Actions). Bing often refuses
     the Worker because Cloudflare shares its internet address with other sites,
     so the **Bing search numbers** Action fetches it from GitHub every 6 hours.
   - Open the dashboard's **Search** section and press **Refresh now**. After
     that it updates by itself: every night at 2 am Eastern, an hourly catch-up
     when numbers are over 20 hours old, and Bing from GitHub every 6 hours. If your property is a
     domain property, set the Worker variable `SEARCH_SITE_URL` in
     `server/wrangler.toml` to `sc-domain:thelogicgrid.com`.
8. Optional: add helpers under **Admins** with the email of their game account.

Everything here is on free plans; nothing can bill.

## Connections and setup

**Connections and setup** (viewer and up) is a searchable guide to every outside
connection: why it is needed, the exact names and settings, steps, and links to
each settings page, with live status (Connected, Missing, Not checked yet,
Optional, Check by hand). It is built from `admin/connections.js`; secrets are
never shown, only whether each name is set. GitHub's secret and variable names
come from the daily **Connections status** Action, which needs the
`FLG_ADMIN_TOKEN` repository secret. Ticked steps are remembered only in that
browser. See MAINTENANCE.md for how the list is kept up to date.

## Tests

`npm --prefix server test` (API, roles, audit, rate limits, settings, players)
and `npm run test:admin` (the dashboard in a real browser against the real
Worker, plus the announcement and switched-off theme in the game, and the
Backups section and archive viewer). The weekly archive is explained in
`server/ARCHIVE.md`.
