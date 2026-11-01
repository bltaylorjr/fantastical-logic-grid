# Report a Problem and error tracking

**Report a Problem** sits in the footer of every screen of the game and every
page of the website. It opens the **Report a Problem page** (`web/report/`,
`web/js/report-page.js`): in a new tab on the website, so the player's puzzle
stays open behind it, and in the same window in the Windows, Android and iPhone
apps (Back returns to the game). What the report is about is handed to the
page through the browser's own storage (`web/js/report-handoff.js`); nothing
leaves the device until the player presses Submit. The page has two choices,
up to 1,000 characters, and room for attachments:

- **Puzzle Problem**: on a puzzle, the puzzle itself and its picture go with
  the report, so it can be checked and repaired automatically.
- **Web Page Issue**: the screen or page, the app version and the window size
  go with it (nothing personal).
- **Pictures and files** (optional): up to 3, each up to 1 MB: screenshots or
  photos (PNG, JPEG, WebP, GIF), PDFs, or text files (.txt, .log, .json,
  .csv). Add them with the button, by dropping them on the page, or by pasting
  a screenshot. Pictures are redrawn in the browser first: at most 1,600
  pixels across and without hidden details such as where a photo was taken.
  The Worker (`src/report-files.js`) checks every file again by its first
  bytes and keeps only those types (never SVG or HTML, which could carry
  scripts). They are kept in `report_files`, seen only in the admin app
  (pictures shown, other files downloaded) and deleted after 90 days.

Problems are no longer sent through **Share an idea** (it used to be "Ideas
and problems"), so that box is only for ideas.

## The moment a report arrives

The Worker gives the report its tracking id and category (below), saves any
files, and the doctor reviews it straight away (`reviewNow` in
`src/puzzle-reports.js`):

- **A puzzle**: the Worker starts the **Puzzle doctor** Action at once (the
  `GITHUB_DISPATCH_TOKEN` Worker secret, the same one the marketing poster and
  educator packages use). It checks and repairs the puzzle and reports back
  within a minute or two. Without the secret, its 15-minute round picks it up.
- **No puzzle attached**: the team looks; it is counted with its screen.
- **A web page**: counted with its screen and app version, with any puzzle
  reports from there, for the daily code-fix task.

The admins get a **Problem** alert at once (push and email, as each one set
in My alerts) with the review and the player's words. When the doctor
finishes, a second alert gives its verdict: repaired (and the player emailed),
needs a code fix, no fault found, or a likely display problem.

## The errors database

`error_log` records every step of every report, from the moment it is
submitted: received, files attached, the doctor started (or waiting for its
round), its review, its repair or why it could not repair, the alerts sent,
and how the report was closed (a code fix, or the team's Mark done). It holds
tracking ids and plain sentences only, never the player's words or email. The
admin **Error tracking** page shows each report's steps as its **Doctor's
log**, and the latest steps of all reports under **Errors database: every
step** (`GET /admin/v1/error-log`). Steps are kept for a year.

## Tracking ids and the two categories

The moment a report arrives, the Worker (`src/puzzle-reports.js`) gives it its
tracking id and its category:

| Category | Tracking id | What it holds |
| --- | --- | --- |
| Puzzle | `PZ-XXXXXXXX` | the puzzle, its picture, its storyline, the player's words |
| Web structure | `WS-XXXXXXXX` | the screen or page, version and window size, the player's words |

Both categories live in one table (`puzzle_reports`) and are used together:

- every report lists the reports of the **other** category from the same
  screen and app version (**related**), both ways;
- when the doctor finds nothing wrong in a reported puzzle but there are Web
  Page Issues for that screen and version, the reason given is "most likely a
  display problem", and it is counted with those page issues;
- the learning table counts both (below).

A player signed in with a confirmed email who ticks **Email me when it is
fixed** is linked to the report only through that held email
(`feedback_replies`). They get "We received your problem report" with the
report number straight away. The website has no sign-in, so its box says to
report from the game to get an email.

## The puzzle doctor

The moment a puzzle is reported (above), and every 15 minutes as a backstop,
the GitHub Action **Puzzle doctor**
(`.github/workflows/puzzle-reports.yml`, `scripts/puzzle-reports.mjs`) checks
waiting Puzzle reports with the game's own engine (`scripts/puzzle-doctor.mjs`):
the answer uses every item once, every clue is true, the clues lead to exactly
one answer without guessing, the answer key matches, nothing is blank. Each
problem becomes one plain sentence (the **reason for failure**).

It then rebuilds the puzzle, trying its strategies (same story; same theme;
all settings; a new story in the same theme) **in the order the learning table
says works best for that fault**, and keeps a rebuild only if it passes every
check:

- **Repaired**: marked addressed, and the player who asked gets **"We fixed
  the puzzle you reported"**: an apology, what they reported, what we found,
  what we did (the **correction made**) and a button that adds the repaired
  puzzle to their **Saved puzzles** on any device (30 days).
- **Needs a fix in the code**: today's engine still gets it wrong. The daily
  code-fix task picks it up (below).
- **No fault in the puzzle**: see the display rule above.

## Code fixes: the doctor fixes what it cannot rebuild

Some reports cannot be repaired by rebuilding the puzzle: a fault today's
puzzle maker still makes (**Needs a fix in the code**), a **Web Page Issue**, a
puzzle report with no puzzle attached, or a sound puzzle the player still had
trouble with. App errors the game reports by itself are the same. These are
fixed in the code, automatically, in two parts.

**1. The daily code-fix task.** A Claude scheduled task ("Puzzle doctor code
fixes", owner's account) wakes the project thread "Make Puzzle doctor
auto-fix reported errors" every day at 6:47 am Eastern and follows these rules
(the same ones as the weekly task in [IMPROVE.md](../IMPROVE.md)):

1. Read the waiting reports without making them public: make a one-off key
   pair in the session, run **Daily player report** with `send` off and
   `public_key` set (MAINTENANCE.md, "Player reports"), and decrypt the log.
   Its `waiting` list holds every report still waiting in Error tracking (with
   the puzzle for each one that needs a fix in the puzzle maker), and `errors`
   holds the app errors.
2. Skip anything an open pull request already covers (search open PRs for the
   tracking id). Oldest first, pick at most **three** fixes a small, safe code
   change can make. Reproduce each one first (load the reported puzzle with
   `scripts/puzzle-doctor.mjs`, or open the screen at the reported window size).
3. One pull request per fix, on its own `claude/` branch, labelled
   `report-fix`, with the tests passing (`npm test`, `npm --prefix server test`)
   and a test that would have caught it. Its body names what it fixes, one item
   per line:

   ```
   Fixes reports: PZ-ABCD2345, WS-EFGH6789
   Player note: The game menu now fits on small phones instead of running off the screen.
   Fixes error: Cannot read properties of undefined (reading 'toLowerCase') | app.js
   ```

   The **player note** is what players are told: plain, everyday words, no code
   names. Tracking ids and app error messages are not personal; the players'
   own words never go in a pull request, commit, issue or log.
4. Bump the version (package.json, tauri.conf.json, Cargo.toml) for any change
   players will see, so the note can say which version has the fix.
5. Merge each pull request (squash) once its checks pass. The Cloudflare
   "Workers Builds" check always fails on branches and does not block.
6. Standing rules: free tools only; never reuse a story; mobile changes only
   for Android; anything the owner must do outside the code goes in
   `docs/owner-tasks/`; when the look or features change, merge the "[video]"
   pull request that follows.
7. Not fixed automatically: a report that is really a new feature or a change
   of design, anything that would change past daily puzzles, and anything
   unclear. The task lists those (by tracking id) in its reply in the project
   thread for the owner to decide.

**2. Report fixes** (`.github/workflows/report-fixes.yml`,
`scripts/report-fixes.mjs`). When a pull request merges into main, this
Action reads those lines and, using the version in package.json:

- marks each listed report **done** and its problem **Addressed** in the admin
  app, with the player note and "Fixed in version X";
- emails the player who asked (the usual "addressed" update with that note);
- sends a puzzle report that needed a fix in the puzzle maker back to the
  doctor instead, which rebuilds it with the fixed engine and emails the
  **repaired puzzle**. If nothing is left to repair, the report closes with
  the note as above;
- marks each listed app error fixed in that version (Error reports).

It also runs by hand (Actions > Report fixes > Run workflow) with tracking
ids and a note, for a fix made some other way. A report already done is left
alone.

## Learning: self-diagnosis and self-repair

`fault_patterns` keeps one row per kind of fault: for puzzles, fault +
theme + difficulty; for web pages, screen + app version. It counts reports,
repairs, reports that needed a code fix, how often each rebuild strategy
worked, and which clue types were false. From it:

- **Playbook**: the doctor tries the best strategy for each fault first.
- **Self-diagnosis**: each round, the doctor makes fresh puzzles like the ones
  behind up to three known faults (same theme, difficulty and size) with the
  newest engine, and checks them. The result shows on the Error tracking page
  ("Still happening" or "Gone", with the engine version).
- **Self-repair**: when a fault is gone, every report waiting for that fix
  goes back to the doctor, is repaired and its player emailed automatically.
  No button needed (**Check again** still works for one report).

## Admin: Error tracking

The **Error tracking** page lists every report, filtered by category, status
or search, with the puzzle or page, the error (the player's words), the reason
for failure, the correction made and how many files were attached. Opening one
shows the player's pictures and files, the doctor's log, the storyline as
reported and as repaired, the clues, the picture, related reports, and
**Download the reported puzzle**, **Check again** and **Mark done with a
note** (which emails the update to a player who asked). Below it, **What the
doctor has learned** shows the learning table.

Reports and their log go after 365 days, attached files after 90, repaired copies after 30 (`upkeep.js`); the
learning table keeps its counts. The Action uses the existing `FLG_ADMIN_TOKEN`
secret and needs no packages.
