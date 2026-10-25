# Weekly archive email

Every Monday at 04:47 UTC the Worker (`src/archive.js`) collects the rows the
game no longer needs, zips them as CSV files, emails the zip to the owner and
only then removes those rows from the D1 database to save space. Everything
used to run the game or serve players stays.

It is free: Cloudflare Email Routing can send to a verified address of your
own at no cost, and the zip is built inside the Worker.

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
   removed only when Cloudflare has accepted the email. While this is off the
   email is just a copy, and the same rows come again the next week.

**Backups and archive** in the dashboard shows the list above with how many rows
are waiting, past runs, a **Send the archive email now** button (owner) and
**Download the zip now** (owner; never removes anything).

## Archive viewer

Dashboard > Backups and archive > **Open the archive viewer**
(`/admin/archive.html`). Pick one or more archive zips from your email. They are
read in your browser only: nothing is uploaded and nothing goes back into the
database. You can filter by date, text and column, group by any column, see
totals and averages, a chart over time, and export the matching rows or the
groups as CSV. Rows that appear in two archives are counted once.

## One-time setup (about 15 minutes)

Email Routing needs the domain's DNS to be on Cloudflare. thelogicgrid.com
works; any domain on your Cloudflare account would too.

1. **Is thelogicgrid.com on Cloudflare?** Sign in at
   <https://dash.cloudflare.com>. If thelogicgrid.com is listed under your
   domains with status **Active**, go to step 3.
2. **Move the domain's DNS to Cloudflare (free).** Choose **Add a domain**,
   type `thelogicgrid.com`, pick the **Free** plan. Cloudflare copies the
   existing DNS records; check the GitHub Pages ones are there (four `A` records
   to 185.199.108.153, .109.153, .110.153 and .111.153, and `www` as a `CNAME`
   to `bltaylorjr.github.io`) and set them to **DNS only** (grey cloud). Then at
   the company where you bought the domain, replace its nameservers with the
   two Cloudflare shows. When the domain says **Active** (minutes to a few
   hours), carry on. The website stays on GitHub Pages; only DNS moves.
3. **Switch on Email Routing.** Open thelogicgrid.com in Cloudflare >
   **Email > Email Routing > Get started**. Skip creating a custom address if
   asked, then choose **Add records and enable** so Cloudflare adds its MX,
   SPF and DKIM records. (If the domain already receives email somewhere else,
   stop and ask first: this replaces its MX records.)
4. **Verify the address the zips go to.** **Email Routing > Destination
   addresses > Add destination address**, enter the address, then open the
   email Cloudflare sends and click **Verify email address** (check Junk).
5. **Connect the Worker.** In `server/wrangler.toml`, remove the `# ` in front
   of the two `[[send_email]]` lines. (Claude can do this as a small pull
   request once steps 3 and 4 are done.)
6. **Add the address as a secret.** **Workers & Pages > flg-api > Settings >
   Variables and Secrets > Add**, type **Secret**, name `ARCHIVE_TO`, value the
   verified address. It is a secret so the address is not in the public repo.
7. **Test it.** Dashboard > **Backups and archive > Send the archive email
   now**. The zip should arrive within a minute (nothing is removed by a test
   while the switches are off).
8. **Switch it on.** Settings and switches > Backups > **Weekly archive email**
   on. When you are happy with the list above, also switch on **Remove
   archived rows after the email is sent**.

The sender is `backups@thelogicgrid.com` (`ARCHIVE_FROM` in `wrangler.toml`);
it does not need a mailbox.

## Limits and costs

- Free: Email Routing sends to verified addresses at no cost, up to 25 MiB per
  message. The Worker refuses zips over 17 MB and removes nothing in that case.
- The Workers free plan gives a cron run a small amount of CPU time. A very
  large week could run out; then the run fails, nothing is removed, and the
  next week tries again with the row limits above.
- If you would rather not move DNS to Cloudflare, use **Download the zip now**
  each week instead, and leave the switches off. A free alternative that
  emails from a Gmail account through a GitHub Action is possible too.
