# Daily puzzle by email

Signed-in players with a confirmed email can tick **Email me each day's puzzle**
on the Daily puzzle card. Once a day, at about 7 am Eastern, they get the day's
puzzle: its title, difficulty, theme and opening paragraph, and a **Play
today's puzzle** button that opens it in the game (`/?play=daily`, tagged
`utm_source=daily-email` so the weekly report can count it).

## How it works

- `server/src/daily-email.js` keeps the list in the `daily_email` table: the
  account id, its confirmed address, a random unsubscribe token and the last
  day sent. Nothing else.
- `.github/workflows/daily-email.yml` runs at 11:07 and 13:07 UTC. It reads
  `thelogicgrid.com/daily/latest.json`, asks the Worker for the people who have
  not had that day's email yet (`POST /admin/v1/daily-email/claim`, which marks
  them so nobody gets two), sends, and reports back which failed (tried again
  at the second run) or were refused (taken off the list).
- It sends from `noreply@thelogicgrid.com` through Resend when `RESEND_API_KEY`
  is set and the domain is verified there, and from the game's Gmail otherwise.
  These are the same secrets as the thank-you emails (FEEDBACK-EMAILS.md), so
  there is nothing new to set up. The job prints only counts, never addresses.

## Leaving the list

Every email has an **Unsubscribe** link and `List-Unsubscribe` headers, so Gmail
and Outlook show their own one-click unsubscribe button. Unticking the box in
the game, the link, and deleting the account all remove the row straight away.

## Limits and switches (admin dashboard, Play)

- **Daily puzzle by email**: off stops sending and new sign-ups; the list is kept.
- **Daily emails a day** (default 300, at most 450): the list stops taking new
  sign-ups at this size, so everyone on it gets the email. Resend's free plan
  sends 100 a day; Gmail sends about 500 a day, shared with the other emails.

All free: scheduled GitHub Actions on a public repository, Resend's free plan
and Gmail.
