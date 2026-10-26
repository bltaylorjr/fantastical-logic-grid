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
   (`POST /admin/v1/replies/claim`), sends them from the game's Gmail and
   reports back (`POST /admin/v1/replies/done`). The address is removed as
   soon as a note is sent, or after 3 failed tries. Rows go after 30 days.

The sender shows as **The Fantastical Logic Grid (no-reply)**, and every
email ends with a note asking people not to reply. It also carries
`Auto-Submitted: auto-replied`, so mail programs do not answer it with
out-of-office replies.

## Limits

- Only to the signed-in account's own **confirmed** address.
- One note per player per day for ideas, and one for problems.
- **Thank-you emails a day** (admin dashboard, default 100, at most 400) for
  everyone together. Gmail allows about 500 emails a day, shared with the
  weekly archive and summary emails.
- The boxes' own limits: 5 sends a minute per connection, and 500 messages a day for everyone.

## Switches (admin dashboard > Settings and switches > Ideas and problems)

- **Thank-you emails**: on by default. Off: the game hides the tick box, no new
  notes are queued, and waiting ones are dropped with their addresses.
- **Thank-you emails a day**: the daily limit above.

The Ideas and problems page shows how many were sent in the last 24 hours and
how many are waiting.

## Setup

It uses the same repository secrets as the weekly archive email
(`server/ARCHIVE.md`): `GMAIL_USER`, `GMAIL_APP_PASSWORD` and
`FLG_ADMIN_TOKEN`. Without them each run says "not set up" and stops. To test,
sign in to the game with a confirmed account, send an idea with the box ticked,
then open Actions > Thank-you emails > Run workflow.

## Option: a real noreply@thelogicgrid.com address

Gmail can only send from its own address, so today the email comes from
fantasticallogicgrid@gmail.com with a "(no-reply)" name. A true
`noreply@thelogicgrid.com` sender needs email set up for the domain, for
example a free sending service that lets you add DNS records (SPF, DKIM) at
the domain registrar. It is not needed for the notes to work.
