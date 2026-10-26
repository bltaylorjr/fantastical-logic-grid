# Admin dashboard

A separate web app for running The Fantastical Logic Grid. It is served by the
game's own Cloudflare Worker at **https://flg-api.btay74.workers.dev/admin/**
(these files are the Worker's static assets, see `server/wrangler.toml`), so it
needs no extra hosting and stays free. Its API is `server/src/admin.js`.

| Section | What you can do | Lowest role |
| --- | --- | --- |
| Overview | Alerts when a free allowance (voices, pictures, database size, Worker requests, database reads and writes) passes the alert level; accounts, screen names, scoring players, games finished and solved by theme and difficulty, scores, races, free voices and AI pictures against their daily caps, error reports, things waiting for review (story parts, names, new ideas and problems) | viewer |
| Usage and free limits | Database size and rows per table; with the optional Cloudflare token, daily Worker requests and D1 reads and writes against the free allowances | viewer |
| Search (Google and Bing) | Clicks, impressions, average position, top searches and top pages for the last 28 days, sitemaps and whether the home page is indexed; fetched daily, Refresh now for admins | viewer |
| Daily puzzles | The next 14 days' daily puzzles (title, theme, level, size) as the last site build made them; plan up to 60 days ahead: change a day's theme, level or size, ask for a new story, add a note, or put a day back to automatic. Changes go live with the next site build (daily at 00:17 UTC, or Publish web version now) | moderator to look, admin to change |
| Characters | The game's own characters: name, woman or man (face and voice both follow it), personality, cast or storyteller, every theme or chosen ones, a drawn face (DiceBear) or an AI portrait (Workers AI, counts toward New AI pictures a day), a server voice and an on-device Kokoro voice with a pace, and lines for clues, hints and solves (drafted free by a Workers AI text model, editable). Names and lines are checked against the story rules and the word filter before publishing. Also reviews characters players suggest from Menu > Suggest a character. Switches and caps are under Settings > Characters | moderator; admin to publish |
| Puzzle quality | For each theme and level over the last 30 or 90 days: games, solve rate, how many gave up or revealed the answer, ratings and "too hard / too easy", minutes and hints. Groups with 5 or more games that many players give up on, rate under 3 or find too hard or too easy are flagged and come first | viewer |
| Ratings and insights | The optional 1 to 5 stars players give after solving (5 is excellent): average, how many rate, the spread of stars and the average over time, for the last 7, 30, 90 or 365 days. Group by theme and difficulty, theme, topic, difficulty, size, clue type, what-if reasoning, story part, story, character, app version, platform or play mode, each with solve, give-up, too hard / too easy and trend columns. "What's working" and "What to improve" say in plain words which groups (5 ratings or more) stand out and what to try. "In a few words" is a short summary from the free Workers AI text model, written from the numbers only, at most `ratings_ai_daily_cap` times a day (Settings > Alerts and reports) and kept for the day. The same analysis goes into the weekly summary email and the nightly report (`GET /admin/v1/ratings?brief=1`: `headline` and `actionNeeded`) | viewer (Write it again: admin) |
| Marketing | Every campaign and ad: the exact words to post, its media (videos and pictures in `media/promo` and `media/marketing`), where it goes, its status (draft, approved, posted with the live link) and its tracked link. Numbers per day, channel, campaign and ad: visits from campaign links and other websites, the first puzzle played, solves, app installs and Windows downloads in the 30 days after the visit. Make a tracked link for anything else, and download every number as CSV. The game sends these as anonymous daily counts (`web/js/campaign.js`, `POST /v1/m`); unknown campaign codes are counted as "(other)". The launch campaign (`server/src/marketing-seed.js`) is added once, as drafts | viewer (change, CSV: admin) |
| Story workshop and review | Write story parts for every player's new stories (checked by the game's rules, live within about 15 minutes), draft them with the AI writer (Gemini free tier), and approve or reject parts sent from older app versions | moderator |
| Ideas and problems | What players sent from the game's two boxes, each in its own list; mark done or delete | moderator |
| Screen names | See new and changed names (names the word filter would now refuse come first), mark them fine, rename, reset or ban | moderator |
| Players | Find a player by screen name or id, see their scores, races and how much they sync; rename, ban or lift a ban | moderator |
| | Reset scores (this week or all time), delete an account's data | admin |
| Settings and switches | **Keys and services**: whether the GEMINI_API_KEY secret and Workers AI are set up (keys are never shown or typed here). **Sounds**: sound effects and theme music on/off for everyone, and whether they start on and at what volume (a player can still turn their own off). **Voices**: characters speak their clues, where voices come from (server Gemini, Kokoro on the device, or the device's own), server voices on/off, the daily voice cap and the Gemini voice model. **Pictures**: portrait style, AI pictures (none, scenes, or scenes and portraits, from Workers AI's free allowance), the daily picture cap and model. **Celebrations**: which effects play when a puzzle is solved (confetti, fireworks, stars, balloons, sparkles, theme pictures, bubbles, falling snow, leaves or petals, shooting stars, ribbons, light rays, party emoji), each with its own checkbox, and Random to play one checked effect at each solve instead of all of them. **Play**: races, solo scores, new screen names, themes on/off. **Learning**: learn from everyone, story parts from older apps, the AI writer's model. **Ideas and problems**: the game's two boxes and automatic error reports. **Moderation**: extra blocked words. **Languages**: translations for players who choose another language on/off, new translations a day, and the Workers AI translation model. **Alerts and reports**: the alert level (80% at first) and the weekly summary email on/off | viewer to look, admin to change |
| Announcements | A message at the top of the game's home screen, with an optional start and end | viewer to look, admin to publish |
| Error reports | Anonymous errors from the apps, most frequent first | viewer |
| Backups and archive | What the weekly archive email takes out of the database and for how long each kind is kept, rows waiting, past runs; send now or download the zip (owner). Archive viewer: open archive zips in the browser to filter, group, chart and export them | admin (send/download: owner) |
| Audit log | Every admin request, allowed or refused; 90 days in the database, older entries in the weekly archive | admin |
| Admins | Add or remove admins and choose their role | owner |

Every table has **Download this table (CSV)**, and admins can download all
players, all scores, or all ideas and problems as spreadsheet files (Players
and Ideas and problems sections). Cells that start like a formula get an
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

## On your phone

The dashboard installs like an app, free and with no app store:

- **iPhone or iPad:** open https://flg-api.btay74.workers.dev/admin/ in Safari,
  tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the menu (three dots), then **Install app**
  (or **Add to Home screen**).
- **Windows or Mac:** in Chrome or Edge, press **Install the app** at the top.

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
  framed and are not indexed. The session lives only in the browser tab and
  ends after 30 idle minutes.
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
     > **API Key** > Generate. Add it as the Worker secret `BING_WEBMASTER_KEY`.
   - Open the dashboard's **Search** section and press **Refresh now**. After
     that it updates by itself every day at 06:41 UTC. If your property is a
     domain property, set the Worker variable `SEARCH_SITE_URL` in
     `server/wrangler.toml` to `sc-domain:thelogicgrid.com`.
8. Optional: add helpers under **Admins** with the email of their game account.

Everything here is on free plans; nothing can bill.

## Tests

`npm --prefix server test` (API, roles, audit, rate limits, settings, players)
and `npm run test:admin` (the dashboard in a real browser against the real
Worker, plus the announcement and switched-off theme in the game, and the
Backups section and archive viewer). The weekly archive is explained in
`server/ARCHIVE.md`.
