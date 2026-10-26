# Weekly archive email

Every Monday at 05:07 UTC the GitHub Action **Weekly archive email**
(`.github/workflows/archive-email.yml`, `scripts/archive-email.py`) asks the
Worker (`src/archive.js`) for a zip of the rows the game no longer needs, emails
it from the game's Gmail account, and then tells the Worker it was sent. Only
then are those rows removed from the D1 database to save space. Everything used
to run the game or serve players stays.

It is free: scheduled Actions on a public repository and Gmail cost nothing.
The repository is public, so the Action prints only row counts: the zip never
goes into a log, a file or an artifact. (If thelogicgrid.com's DNS ever moves to
Cloudflare, the Worker can send the email itself instead; see the last section.)

## What gets archived

| Data | Table(s) | Kept in D1 | Why older rows are not needed |
| --- | --- | --- | --- |
| Finished races, their players and challenges | `races`, `race_entries`, `race_invites` | 45 days | Races close after 7 days and results show for 45. Points earned stay in `scores`. |
| Anonymous play summaries | `plays` | 90 days | Difficulty tuning and the dashboard read only the last 90 days. (Before: 400 days.) |
| Error reports from the apps | `app_errors` | 30 days | The dashboard shows the last 30 days. |
| Daily voice clip counters | `usage` | 60 days | Only today's count protects the free voice quota. |
| Rejected story parts | `parts` (status rejected) | 90 days after review | Never shown to players. |
| Ended announcements | `announcements` | 90 days after they end | Players stop seeing them when they end. |
| Admin audit log | `admin_audit` | 90 days | Older entries live on in the archive. (Before: 365 days.) |
| Daily cleanup log | `upkeep_log` | 90 days | The health check reads only the latest run. |

Up to 20,000 rows per table (1,000 races) go each week; anything more goes the
next week.

**Never archived or removed by this job:** accounts and synced saves
(`sync_users`, `sync_records`), screen names (`players`, `name_reviews`),
scores, bans, admins, settings, approved or waiting story parts, open races and
anything newer than the ages above. Two small things the daily cleanup already
removes keep working as before: deleted-account markers after 30 days (a random
id only) and bans once they have ended.

## Personal data in the zip

- Player ids in the race tables are replaced with codes such as
  `p_3f9a1c0b7e21`. The same player gets the same code every week, so you can
  still count repeat players, but the code cannot be tied back to an account
  without the Worker's key. No emails, screen names, passwords or saved games
  are included.
- The admin audit log keeps each admin's email address (that is the point of an
  audit log). Its `target` column can hold a player id or a setting name.
- Everything else is anonymous.

Keep the emails somewhere private. If a player asks for their data to be
deleted, their scores and account are deleted from D1 as usual; the archive
only holds the coded id.

## The two switches

In the admin dashboard, **Settings and switches > Backups**:

1. **Weekly archive email** (off at first). On: each Monday the zip is emailed.
   While it is on, the daily cleanup leaves these rows for the archive, so
   nothing is removed without a backup.
2. **Remove archived rows after the email is sent** (off at first). Rows are
   removed only after the email was sent (Gmail accepted it and the Action
   confirmed it within 6 hours). While this is off the email is just a copy,
   and the same rows come again the next week.

**Backups and archive** in the dashboard shows the list above with how many rows
are waiting, past runs and **Download the zip now** (owner; never removes
anything). To send an email straight away, run the workflow by hand (step 4
below).

## Archive viewer

Dashboard > Backups and archive > **Open the archive viewer**
(`/admin/archive.html`). Pick one or more archive zips from your email. They are
read in your browser only: nothing is uploaded and nothing goes back into the
database. You can filter by date, text and column, group by any column, see
totals and averages, a chart over time, and export the matching rows or the
groups as CSV. Rows that appear in two archives are counted once.

## One-time setup (about 10 minutes)

**1. Turn on 2-Step Verification for the game's Gmail** (Google only gives app
passwords to accounts that have it)
- Sign in to fantasticallogicgrid@gmail.com, go to <https://myaccount.google.com>
  and choose **Security** (on a phone: **Security & sign-in**).
- Under "How you sign in to Google", click **2-Step Verification**, then
  **Turn on**, and follow the steps (a phone number or the Google app).

**2. Make an app password**
- Go to <https://myaccount.google.com/apppasswords> (sign in again if asked).
- Type a name such as `Logic Grid archive` and click **Create**.
- Copy the 16-letter password Google shows. You will not see it again (you
  can always delete it and make a new one).

**3. Add four repository secrets in GitHub**
Repository **Settings > Secrets and variables > Actions > Secrets > New
repository secret**, one at a time:

| Name | Value |
| --- | --- |
| `GMAIL_USER` | fantasticallogicgrid@gmail.com |
| `GMAIL_APP_PASSWORD` | the 16-letter app password (spaces are fine) |
| `ARCHIVE_TO` | the address the zips go to (fantasticallogicgrid@gmail.com) |
| `FLG_ADMIN_TOKEN` | the same value as the Worker's `ADMIN_TOKEN` secret. Skip if it is already there (the health check uses it too). Cloudflare cannot show a secret again: if you no longer have it, make a new long random value and set it in both places (Cloudflare: Workers & Pages > flg-api > Settings > Variables and Secrets, type Secret). |

The addresses are secrets so they never appear in the public repository.

**4. Send a test**
Repository **Actions > Weekly archive email > Run workflow**, leave **Test
send** ticked, click **Run workflow**. Within a minute or two the email should
reach the inbox (check Junk the first time and mark it "Not junk"). A test
never removes anything, and works while the switches are off.

**5. Switch it on**
Admin dashboard > **Settings and switches > Backups > Weekly archive email**
on. When you are happy with the list above, also switch on **Remove archived
rows after the email is sent**.

If a weekly run fails (for example the app password was removed), GitHub emails
the repository owner and nothing is removed; the next Monday tries again.

## Weekly summary email

Every Monday at 05:37 UTC, `.github/workflows/summary-email.yml` sends a short
email with last week in numbers: new accounts and screen names, games finished
and solved, top themes, races and scores, new ideas and problems waiting,
the most common errors, puzzles players struggle with (from Puzzle quality)
and any free-limit alerts. It uses the same four secrets as the archive email
(steps 1 to 3 above), so once those are set up nothing more is needed. To
send it somewhere else, add an optional secret `SUMMARY_TO`; otherwise it goes
to `ARCHIVE_TO`.

Test it with **Actions > Weekly summary email > Run workflow** (Test send
ticked). Turn it off with Admin dashboard > **Settings and switches > Alerts
and reports > Weekly summary email**. The Action log only says whether it was
sent, never what was in it.

## Limits and costs

- Free. Gmail allows 25 MB per email; the Worker refuses zips over 17 MB and
  removes nothing in that case. Up to 20,000 rows per table (1,000 races) go
  each week; anything more goes the next week.
- The Workers free plan gives each request a small amount of CPU time. A very
  large week could run out; then the run fails, nothing is removed, and the
  next week tries again.

## If the domain's DNS moves to Cloudflare later

The Worker can then send the email itself through Cloudflare Email Routing
(free to a verified address) on its own Monday cron, with no Gmail or Action:
switch on Email Routing for thelogicgrid.com (**Email > Email Routing > Get
started > Add records and enable**), verify the destination address under
**Destination addresses**, add the Worker secret `ARCHIVE_TO`, and remove the
`# ` in front of the two `[[send_email]]` lines in `server/wrangler.toml`. Then
disable the GitHub workflow so only one email goes out.
