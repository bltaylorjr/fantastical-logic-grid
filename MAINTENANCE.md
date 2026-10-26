# How the game looks after itself

Everything here uses free tools only: GitHub Actions and Dependabot (free for
public repositories) and a Cloudflare Workers cron trigger (free plan allows 5).

| What | Where | When |
|---|---|---|
| Tests on every pull request and every push to main | `.github/workflows/ci.yml` | each PR and push |
| Library updates, each one tested; passing patch and minor updates merge themselves and republish the website, major updates wait for you | `.github/dependabot.yml`, `dependabot-merge` in `ci.yml` | weekly; security fixes right away |
| Health check of the website, Worker, database, daily cleanup and desktop update file. Opens a `health-check` issue when something is down and closes it when it is back up | `.github/workflows/health.yml` | every 3 hours |
| Daily digest of errors players hit, as a `player-errors` issue | `.github/workflows/health.yml` | daily, once `FLG_ADMIN_TOKEN` is set |
| Daily player report email: new errors (grouped, already-fixed ones listed apart) and new problems and ideas, only when something is new. See "Player reports" below | `.github/workflows/player-reports.yml`, `scripts/player-reports.py` | daily at 07:13 UTC |
| Daily puzzle page and sitemap refresh, then IndexNow notice to Bing and other engines | `.github/workflows/pages.yml` | nightly, 00:17 UTC |
| **Nightly maintenance** at 2 am Eastern (see below) | `.github/workflows/nightly.yml`, `scripts/nightly-checks.sh`, `server/src/nightly.js` | nightly, 2:00 and 2:20 am ET |
| Cleanup of data the game no longer needs, so the free D1 database never fills up, then `PRAGMA optimize` and the Google and Bing search numbers | `server/src/nightly.js`, `server/src/upkeep.js` | nightly, 2:00 am ET |
| Weekly archive email: old rows zipped, emailed to the owner from Gmail, then removed (off until switched on). See [server/ARCHIVE.md](server/ARCHIVE.md) | `.github/workflows/archive-email.yml`, `server/src/archive.js` | Mondays at 05:07 UTC |
| Anonymous error reports from the apps (players can turn them off in Settings) | `web/js/errors.js`, `server/src/errors.js` | when an error happens |
| Website publish | `.github/workflows/pages.yml` | each push to main |
| Worker deploy and database migrations | Cloudflare Workers Builds | each push to main |
| Desktop release (signed update for installed copies) | `.github/workflows/release.yml` | when a new version number reaches main |

## Nightly maintenance (2 am Eastern)

The Worker goes first at 2:00 am: it removes old data (below), lets the D1
database tidy its indexes (`PRAGMA optimize`; D1 does not allow `VACUUM` and
compacts its storage by itself) and refreshes the Google and Bing search numbers
for the admin dashboard. At 2:20 am the GitHub run checks and reports:

- the Worker, its database and that tonight's cleanup ran
- search numbers, puzzle ratings and free limits (needs `FLG_ADMIN_TOKEN`)
- security advisories (`npm audit`) and outdated libraries for the game and the Worker
- the built website: every link, page tag and structured-data block, and every
  link to another website (`scripts/check-site.mjs --external`)
- the live website: robots.txt, sitemap, canonical addresses, the daily page
  (if it is stale the run publishes again, which also tells IndexNow), the
  IndexNow key and the share picture
- Lighthouse on the live site with speed budgets (`lighthouserc.live.json`)
- housekeeping: GitHub Actions caches unused for 7 days and run files older than 14 days are removed

The run's summary page is the nightly report. Anything to fix goes in one GitHub
issue labelled `nightly-maintenance`, updated each night and closed on a clean
night. Only problems that need the owner are emailed (from the game's Gmail, the
same secrets as the weekly emails; optional `NIGHTLY_TO`), so quiet nights send
nothing. Run it by hand from Actions > Nightly maintenance > Run workflow (tick
the box to send a test email).

Cron triggers only know UTC, so both the Worker and the GitHub run list two
crons (06:00 and 07:00 UTC, plus 20 minutes for GitHub) and only the one that is
2 am in New York does anything; daylight saving needs no change. To move the
time, change `MAINTENANCE_HOUR` / `MAINTENANCE_TZ` and the crons in
`server/src/nightly.js`, `server/wrangler.toml` and `.github/workflows/nightly.yml`.

## Speed

The game page's first load is kept fast by: the setup screen's choice lists
drawn into `index.html` at build time (no jump when the script runs), the two
text fonts preloaded, the DiceBear faces and the confetti loaded after the first
screen, and the one-time natural-voice download (about 90 MB) waiting until the
page has loaded and is idle. Lighthouse checks the budgets on every pull request
and every night.

## What the daily cleanup removes

Races and their entries 45 days after the race was made, voice usage counters
after 60 days, rejected story parts 90 days after review, deleted-account
markers after 30 days, error reports after 30 days, anonymous play summaries
after 400 days (tuning only reads the last 90), its own log after 90 days,
the admin audit log after a year, ended bans, and announcements 90 days after
they end.
Scores, saves, accounts and approved story parts are never removed (an admin
can reset a player's scores or delete an account from the admin dashboard).
While the weekly archive email is switched on, the daily cleanup leaves races,
play summaries, error reports, voice counters, rejected parts, announcements and
the logs to the weekly archive, which emails them before removing them (with
shorter ages: play summaries and the audit log after 90 days). See
[server/ARCHIVE.md](server/ARCHIVE.md).

## One-time setup

1. **Turn on Dependabot alerts**: Settings > Code security > Dependabot alerts
   and Dependabot security updates. The weekly update PRs start on their own
   from `.github/dependabot.yml`.
2. **Error digest (optional)**: add the repository secret `FLG_ADMIN_TOKEN`
   (Settings > Secrets and variables > Actions) with the same value as the
   Worker's `ADMIN_TOKEN` secret. Without it the health check still runs; it
   just skips the digest. You can also read reports any time at
   `https://flg-api.btay74.workers.dev/admin/errors` with that token.
3. **Issue emails**: GitHub emails the repository owner about new issues by
   default (Settings > Notifications on github.com).

## Player reports

The daily player report emails the game's Gmail (`REPORTS_TO`, else
`ARCHIVE_TO`) using the archive email's secrets. Errors are grouped by message
and file across versions. When a fix ships, add it to
`scripts/known-errors.json` (`match`, `place`, `fixedIn`): reports of that
error from older versions then show under "Already fixed", and one from the
fixed version or later shows under "Needs a look" with a note that the fix
missed it. To stop the email, set the repository variable `PLAYER_REPORTS` to
`off`.

The repository is public, so its Actions logs are too: the job prints counts
only. To read the full reports for fixing without making them public, make a
one-off key pair, run **Daily player report** from the Actions tab with
`send` off and `public_key` set to the base64 of the PEM public key, then
decrypt the log's KEY (RSA-OAEP) and DATA (`openssl enc -d -aes-256-cbc
-pbkdf2 -pass file:<key>`, then gunzip) with the private key. Never paste
player text into issues, commits or pull requests.

## Things to know

- GitHub pauses scheduled workflows in a repository with no commits for 60
  days. If the health check stops, re-enable it in the Actions tab.
- `GET /v1/health?deep=1` on the Worker shows whether the database answers,
  when the cleanup last ran, today's server voice clips against the free cap,
  and how many errors players reported today.
- To ship a desktop release, bump the version in `package.json`,
  `desktop/src-tauri/tauri.conf.json` and `desktop/src-tauri/Cargo.toml`
  (the Tests workflow checks they match) and merge to main.
