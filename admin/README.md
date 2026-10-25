# Admin dashboard

A separate web app for running The Fantastical Logic Grid. It is served by the
game's own Cloudflare Worker at **https://flg-api.btay74.workers.dev/admin/**
(these files are the Worker's static assets, see `server/wrangler.toml`), so it
needs no extra hosting and stays free. Its API is `server/src/admin.js`.

| Section | What you can do | Lowest role |
| --- | --- | --- |
| Overview | Accounts, screen names, scoring players, games finished and solved by theme and difficulty, scores, races, free voices against the daily cap, error reports, things waiting for review | viewer |
| Usage and free limits | Database size and rows per table; with the optional Cloudflare token, daily Worker requests and D1 reads and writes against the free allowances | viewer |
| Story review | Approve or reject story parts players shared | moderator |
| Screen names | See new and changed names (names the word filter would now refuse come first), mark them fine, rename, reset or ban | moderator |
| Players | Find a player by screen name or id, see their scores, races and how much they sync; rename, ban or lift a ban | moderator |
| | Reset scores (this week or all time), delete an account's data | admin |
| Settings and switches | Free voices on/off and the daily voice cap, races, solo scores, new screen names, themes on/off, accepting shared plays, story parts and error reports, extra blocked words, **player defaults** (the starting value of Learn from everyone, error reports, server voices and which voices the device uses; a player's own choice always wins), **AI models** (the OpenAI picture model and quality, the OpenAI and Gemini voice models and the story writer model used with a player's own key) | viewer to look, admin to change |
| Announcements | A message at the top of the game's home screen, with an optional start and end | viewer to look, admin to publish |
| Error reports | Anonymous errors from the apps, most frequent first | viewer |
| Audit log | Every admin request, allowed or refused, kept for a year | admin |
| Admins | Add or remove admins and choose their role | owner |

Changes reach every copy of the game within about a minute (the game reads
`GET /v1/config` every 10 minutes and when it opens; the server's own switches
apply within 30 seconds). No new release is needed. When a shared feature is
switched off, the game also hides the player's matching choice in Settings
(server voices, Learn from everyone, error reports, sharing a story part).

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
6. Optional: add helpers under **Admins** with the email of their game account.

Everything here is on free plans; nothing can bill.

## Tests

`npm --prefix server test` (API, roles, audit, rate limits, settings, players)
and `npm run test:admin` (the dashboard in a real browser against the real
Worker, plus the announcement and switched-off theme in the game).
