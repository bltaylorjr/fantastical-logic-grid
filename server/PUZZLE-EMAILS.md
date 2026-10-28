# Weekly and special edition puzzle emails

Anyone can sign up in the game, with or without an account: **Menu > Puzzle
emails**, or **Get the weekly puzzle by email** on the Daily puzzle card. There
are two lists:

- **The puzzle of the week**: every Monday from about 7 am Eastern, a bigger
  Expert puzzle with a brand-new story. The game shows it on the Daily puzzle
  card too.
- **Special edition puzzles**: one-off puzzles you plan in the admin dashboard
  (**Puzzle emails**), sent on their day from about 7 am Eastern.

The links in the emails open the puzzle in the game (`/?play=weekly&week=…`,
`/?play=special&id=…`), tagged `utm_source=email` and `utm_campaign=weekly-email`
or `special-email`, so the admin Marketing numbers count them. Like the daily
puzzle, these earn no scoreboard points, because their answers are public.

## Confirm your email, and leaving the list

- A guest (or a player whose account email is not confirmed) gets a **confirm
  link** first. Nothing else is sent until they open it and press **Confirm**
  (only the button confirms, because some mail programs open links by
  themselves). An address that is never confirmed is removed after 7 days.
  Each address gets at most 3 confirm emails a day, 10 minutes apart, and the
  answer in the game looks the same whether or not the address was already
  on the list, so the form cannot be used to find out who is.
- A signed-in player with a confirmed account email needs no confirm link.
- Every puzzle email has an **Unsubscribe** link (one click, just that list),
  `List-Unsubscribe` headers (Gmail's and Outlook's own unsubscribe button) and
  a **change which emails you get** page. Unsubscribing from both lists, the
  admin removing the address, or deleting the account removes the row.

## Where the puzzles come from

The website build (`scripts/seo.mjs`) makes the puzzle of the week (from Monday
2 November 2026) and each special edition in the same date-ordered chain as the
daily puzzles, so no story is ever used twice. It publishes
`weekly/latest.json`, `weekly/puzzles/<Monday>.json`, `specials/index.json`
and `specials/<id>.json` on its day, and `specials/upcoming.json` (no clues or
answers) for the dashboard's preview. An edition can only be changed or
cancelled before its day, so past puzzles never change.

## How sending works

- `server/src/puzzle-mail.js` keeps the list (`puzzle_mail`: the address, which
  lists, a random token for the links and, for a player, the account id),
  who has had which send (`puzzle_mail_got`) and the day's count
  (`puzzle_mail_days`). `server/src/editions.js` keeps the special editions.
- `.github/workflows/puzzle-mail.yml` runs every 15 minutes
  (`scripts/puzzle-mail.py`). It asks the Worker what is due, sends the confirm
  links, and on their days the puzzle of the week and the special editions,
  read from the live site, so nothing goes out before the site has the puzzle.
  It reports back which failed (tried again next run) or were refused (taken
  off the list). The job prints only counts, never addresses.
- It sends from `noreply@thelogicgrid.com` through Resend when `RESEND_API_KEY`
  is set and the domain is verified there, and from the game's Gmail otherwise.
  These are the same secrets as the daily puzzle and thank-you emails
  (DAILY-EMAIL.md, FEEDBACK-EMAILS.md), so there is nothing new to set up.

## Admin dashboard

- **Puzzle emails**: how many are on each list, waiting to confirm, sent today,
  and each send so far; plan, change or cancel special editions; find an
  address and remove it; add someone who asked (they still get a confirm link);
  download the list as a spreadsheet (owner).
- **Settings > Puzzle emails**: **Puzzle email sign-ups** (off: no sign-ups and
  nothing sent; the list is kept), **Weekly puzzle email**, **Special edition
  emails**, and **Puzzle emails a day** (default 150, at most 450; confirm
  links and puzzle emails together; the rest go the next day, and a weekly or
  special send keeps going for a week). Resend's free plan sends 100 a day;
  Gmail sends about 500 a day, shared with the other emails.

All free: scheduled GitHub Actions on a public repository, Resend's free plan
and Gmail.
