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
| Weekly live search check (sitemap, every page, canonical links, Lighthouse). Opens a `search-check` issue when something is wrong. See [SEO.md](SEO.md) | `.github/workflows/seo.yml` | Mondays |
| Cleanup of data the game no longer needs, so the free D1 database never fills up | `server/src/upkeep.js` | daily at 03:17 UTC |
| Weekly archive email: old rows zipped, emailed to the owner from Gmail, then removed (off until switched on). See [server/ARCHIVE.md](server/ARCHIVE.md) | `.github/workflows/archive-email.yml`, `server/src/archive.js` | Mondays at 05:07 UTC |
| Anonymous error reports from the apps (players can turn them off in Settings) | `web/js/errors.js`, `server/src/errors.js` | when an error happens |
| Website publish | `.github/workflows/pages.yml` | each push to main |
| Worker deploy and database migrations | Cloudflare Workers Builds | each push to main |
| Desktop release (signed update for installed copies) | `.github/workflows/release.yml` | when a new version number reaches main |

## What the daily cleanup removes

Races and their entries 45 days after the race was made, voice usage counters
after 60 days, rejected story parts 90 days after review, deleted-account
markers after 30 days, error reports after 30 days, anonymous play summaries
after 400 days (tuning only reads the last 90), its own log after 90 days,
the admin audit log after a year, kept rating summaries after 90 days, ended bans, and announcements 90 days after
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
