# Thank-you and update emails for ideas and problems

When a player who is **signed in with a confirmed email** sends something from
Menu > Ideas and problems, they can leave "Email me an update" ticked:

- **Idea:** "Thank you for your idea!", thanking them for the submission and
  for contributing, quoting their idea.
- **Problem:** "We received your problem report", apologizing for the
  inconvenience, saying the report was received and is being addressed,
  quoting what they reported, and thanking them for the information.
- **Update (idea or problem):** "An update on your idea" or "The problem you
  reported has been addressed", sent when the team presses **Mark addressed**
  in the admin Communication inbox. It quotes what the player wrote and the
  team's **What was done** note. Write that note in plain, everyday words a
  player understands (the dashboard refuses obvious technical words like file
  names, "PR #", "commit" or "null"). Marking it **Done** or deleting it
  instead sends no update and removes the held address and words.

- **Message notice:** "You have a new message from The Fantastical Logic Grid
  team", sent when the team writes to a player who turned on "Email me when
  the team writes" in Menu > Messages (see `MESSAGES.md`). At most one a day
  per player, and it only says to open Messages.

- **Storylines (story ideas): one email per submission.** No thank-you goes
  straight away. In the admin Communication inbox a new storyline has just two
  buttons, **Approve** and **Disapprove** (nothing to type):
  - **Approve:** the player gets **"Congratulations! Your storyline has been
    approved"**. Before it is sent, `scripts/storyline-puzzle.mjs` builds the
    first puzzle from the storyline with the game's engine, the Worker stores
    it for the player (`POST /admin/v1/replies/puzzle`), and the email carries
    it as a **PDF with its answer key** on the last page. The game puts the
    puzzle straight into the player's **Saved puzzles**, ready to play (it is
    also in Menu > Messages > Puzzles for you for 30 days).
  - **Disapprove:** the player gets **"Thank you for your storyline"**,
    thanking them for their input.
  The puzzle is built from the lists in the storyline, written like
  `Companies: A, B, C. Price: $60, $69, $75. Accessories: X, Y, Z`
  (`admin/storyline-parse.js`): the first list of names is who is in it, a
  list of numbers or prices is ordered, and the text before the lists is the
  scene. The dashboard shows what it found before you press Approve. With 4
  lists the puzzle is Medium, with 3 it is Easy. A storyline without lists
  still gets the congratulations, without a puzzle. If printing the PDF fails,
  the email still goes without it. Deleting a storyline sends nothing.

The wording is fixed (`scripts/feedback-replies.py`). The player's words (with
email addresses and links already blanked) and the team's note only ever go to
the player's own confirmed address, so the boxes cannot be used to send
someone else a message. They are removed together with the address once the
email is sent.

## How it works

1. `POST /v1/feedback` saves the idea or problem as before (anonymous). If the
   player asked for a note, the game sends their sign-in token too, and
   `server/src/replies.js` queues a thank-you note for the account's own
   confirmed address in the D1 table `feedback_replies`, and holds an update
   row (status `held`, linked by `feedback_id`) until the team marks that idea
   or problem addressed. The feedback row itself still has nothing about the
   player. A player can have at most 20 updates held; held rows go after 180
   days, and deleting the account removes them.
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
- One thank-you note per player per day for ideas, and one for problems.
  Update emails go only when the team marks something addressed.
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
3. Resend lists 4 records: a **TXT** for `resend._domainkey`, **CNAME**s for
   `send` and `rsend`, and an optional **TXT** for `_dmarc`. The domain's DNS
   is at Namecheap: Resend's **Go to Namecheap** button adds them for you, or
   add each under **Advanced DNS > Host Records** with only the short name
   (`send`, not `send.thelogicgrid.com`). They do not touch the website or any
   other email. Full click-by-click steps:
   `docs/owner-tasks/2026-10-28-resend-namecheap.md`.
4. Back in Resend, press **Verify DNS records** (it can take from a few
   minutes to a few hours).
5. **API Keys > Create API key**: name `logic-grid`, permission **Sending
   access**, domain `thelogicgrid.com`. Copy the key (it starts with `re_`).
6. In GitHub: repository **Settings > Secrets and variables > Actions > New
   repository secret**, name `RESEND_API_KEY`, paste the key.
7. Quick test: **Actions > Resend check > Run workflow** looks up the
   records and sends one test email to the game's Gmail through Resend.
8. Full test: sign in to the game with a confirmed account, send an idea with the
   box ticked, then **Actions > Thank-you emails > Run workflow**. The log
   says how many went through Resend and how many through Gmail.

Optional: to use another address on the domain, add a repository variable
`MAIL_FROM` (for example `hello@thelogicgrid.com`).

Until the domain is verified, Resend refuses and the notes go from Gmail, so
nothing is lost while you set it up.
