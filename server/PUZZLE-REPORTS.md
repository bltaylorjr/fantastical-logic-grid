# Report a problem with a puzzle

Every puzzle screen has **Report a problem with this puzzle** at the bottom.
It opens a box for up to 1,000 characters. When the player sends it:

1. The report and **the puzzle itself** go to the Worker
   (`POST /v1/puzzle-report`, `src/puzzle-reports.js`). The player gets a
   **tracking id** such as `PZ-7F3K2QAB`. It names the report everywhere: in the
   Communication inbox, in the emails and in the puzzle doctor's results.
2. It also shows in **Communication** as a problem ("A puzzle (Report a
   problem)"), with the tracking id, what the puzzle doctor found, and
   **Download the reported puzzle** to open it in the game yourself.
3. A player signed in with a confirmed email who ticked **Email me when it is
   fixed** is linked to the report only through that held email
   (`feedback_replies`, `FEEDBACK-EMAILS.md`). They get "We received your
   problem report" with their report number straight away.

## The puzzle doctor

Every 15 minutes the GitHub Action **Puzzle doctor**
(`.github/workflows/puzzle-reports.yml`, `scripts/puzzle-reports.mjs`) checks
waiting reports with the game's own engine (`scripts/puzzle-doctor.mjs`):

- the answer uses every item exactly once
- every clue is true for the answer
- the clues lead to that one answer by deduction, without guessing
- the answer key matches the answer, and nothing is blank

Each problem is written as one plain sentence a player understands, for
example "Clue 4 said something that is not true for the real answer, so the
puzzle could not be solved correctly."

Then:

- **Repaired automatically**: the puzzle is rebuilt from its own seed and
  settings with today's engine (the same story when the settings allow), and
  kept only if it passes every check. The report is marked addressed, and the
  player who asked gets **"We fixed the puzzle you reported"**: an apology,
  what they reported, **what we found**, **what we did**, and a button that
  opens the game and adds the repaired puzzle to their **Saved puzzles** on any
  device (`thelogicgrid.com/?repaired=<token>`, works for 30 days).
- **Needs a fix in the code**: something is wrong that today's engine still
  gets wrong. Download the puzzle, fix the engine, publish, then press **Check
  again**: the next round repairs it and emails the player automatically.
- **No fault found**: nothing wrong was found. Read the report and answer as
  usual (Mark addressed sends the normal update email).

Reports go after 90 days and repaired copies after 30 (`upkeep.js`). The
Action needs the repository secret `FLG_ADMIN_TOKEN` (already set for the
other Actions) and no packages.
