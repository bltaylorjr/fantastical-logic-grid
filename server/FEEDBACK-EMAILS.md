# Thank-you emails for ideas and problems

When a player who is **signed in with a confirmed email** sends something from
Menu > Ideas and problems, they can leave "Email me a thank-you note" ticked:

- **Idea:** "Thank you for your idea!", thanking them for the submission and
  for contributing.
- **Problem:** "We received your problem report", apologizing for the
  inconvenience, saying the report was received and is being addressed, and
  thanking them for the information.

The text is fixed (`scripts/feedback-replies.py`). It never includes what the
player wrote, so the boxes cannot be used to send someone a message.

## How it works

1. `POST /v1/feedback` saves the idea or problem as before (anonymous). If the
   player asked for a note, the game sends their sign-in token too, and
   `server/src/replies.js` queues a note for the account's own confirmed
   address in the D1 table `feedback_replies`, kept apart from the message.
2. Every 15 minutes the GitHub Action **Thank-you emails**
   (`.github/workflows/feedback-replies.yml`) collects the waiting notes
   (`POST /admin/v1/replies/claim`), sends them from
   **noreply@thelogicgrid.com** through Resend (or, as a backup, from the
   game's Gmail) and reports back (`POST /admin/v1/replies/done`). The address is removed as
   soon as a note is sent, or after 3 failed tries. Rows go after 30 days.

Through Resend the sender is **The Fantastical Logic Grid
&lt;noreply@thelogicgrid.com&gt;**. Through the Gmail backup it shows as **The
Fantastical Logic Grid (no-reply)** from fantasticallogicgrid@gmail.com, because
Gmail can only send from its own address. Every email ends with a note asking people not to reply. It also carries
`Auto-Submitted: auto-replied`, so mail programs do not answer it with
out-of-office replies.

## Limits

- Only to the signed-in account's own **confirmed** address.
- One note per player per day for ideas, and one for problems.
- **Thank-you emails a day** (admin dashboard, default 100, at most 400) for
  everyone together. Resend's free plan sends 100 a day and 3,000 a month;
  past that, the rest go from Gmail, which allows about 500 a day (shared with
  the weekly archive and summary emails).
- The boxes' own limits: 5 sends a minute per connection, and 500 messages a day for everyone.

## Switches (admin dashboard > Settings and switches > Ideas and problems)

- **Thank-you emails**: on by default. Off: the game hides the tick box, no new
  notes are queued, and waiting ones are dropped with their addresses.
- **Thank-you emails a day**: the daily limit above.

The Ideas and problems page shows how many were sent in the last 24 hours and
how many are waiting.

## Setup

The Gmail backup uses the repository secrets the weekly archive email already
has (`server/ARCHIVE.md`): `GMAIL_USER`, `GMAIL_APP_PASSWORD` and
`FLG_ADMIN_TOKEN`. With only those, notes go from the Gmail address.

### Sending from noreply@thelogicgrid.com (Resend, free)

Resend's free plan (3,000 emails a month, 100 a day, one domain, no card)
costs nothing. Past the free limits Resend refuses rather than bills, and the
script then uses Gmail. The domain stays where it is; you only add DNS records
at whoever runs its DNS today.

1. Sign up at https://resend.com (free, use fantasticallogicgrid@gmail.com).
2. **Domains > Add domain**: enter `thelogicgrid.com`, region US East.
3. Resend lists 3 or 4 records (an **MX** and a **TXT** for `send`, a **TXT**
   for `resend._domainkey`, and an optional **TXT** for `_dmarc`). Add each
   one at your domain's DNS settings, copying the name and value exactly.
   They only cover the `send` and `resend._domainkey` names, so they do not
   touch the website or any other email.
4. Back in Resend, press **Verify DNS records** (it can take from a few
   minutes to a few hours).
5. **API Keys > Create API key**: name `logic-grid`, permission **Sending
   access**, domain `thelogicgrid.com`. Copy the key (it starts with `re_`).
6. In GitHub: repository **Settings > Secrets and variables > Actions > New
   repository secret**, name `RESEND_API_KEY`, paste the key.
7. Test: sign in to the game with a confirmed account, send an idea with the
   box ticked, then **Actions > Thank-you emails > Run workflow**. The log
   says how many went through Resend and how many through Gmail.

Optional: to use another address on the domain, add a repository variable
`MAIL_FROM` (for example `hello@thelogicgrid.com`).

Until the domain is verified, Resend refuses and the notes go from Gmail, so
nothing is lost while you set it up.
