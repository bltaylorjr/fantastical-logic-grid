# Continuous improvement

Every Monday the game looks at how it is doing, makes small safe changes on
its own, hands bigger fixes to a Claude task, and emails the owner what
changed and why. Everything here is free: scheduled GitHub Actions on a public
repository and Gmail. The Claude task runs on the owner's Claude plan.

| When (Monday) | What | Where |
|---|---|---|
| 2:00 to 2:30 am Eastern | Nightly maintenance: site, SEO, speed (Lighthouse), ratings and free-limit checks | `nightly.yml` (see MAINTENANCE.md) |
| 05:37 UTC | Weekly summary email: the week in numbers | `summary-email.yml` |
| 08:23 UTC (4:23 am EDT, 3:23 am EST) | **Weekly improvement run**: analyze, tune, report, email | `.github/workflows/improve.yml` |
| 09:47 UTC | Backup of the run above, only if GitHub skipped it | `.github/workflows/improve.yml` |
| 5:41 am Eastern | **Weekly Claude task**: up to three small fix PRs from the report | a Claude scheduled task (below) |

## Self-tuning with approval (admin dashboard)

The admin dashboard's **Analysis and self-tuning** page also tunes the live
game, but only with an admin's OK. Every night at 2 am Eastern (and when an
admin presses Check now) `server/src/tuning.js` reads the last 30 days and
suggests small, bounded changes:

| Kind | What changes | Limit | Needs |
|---|---|---|---|
| Level toughness | a Logic Grid level, gentler when players give up (35%+) or say too hard (40%+), tougher when 90%+ solve and 40%+ say too easy | 0.2 a step, never past 0.6 either way | 20 games at that level |
| Theme | how often Surprise me picks a theme: less when rated under 3 stars or given up 45%+, more when rated 4.5+ | x0.85 or x1.15 a step, 0.6 to 1.4 | 20 games in that theme |
| Hardest level | NINETIMESNINE, Cage Math, Sum Cross, Picture Grid: one level down when under 20% solve the top one | never below Medium | 10 games at the top level |
| Tips | the same games: first-puzzle tips back on when 40%+ give up | on only | 30 games |
| Support ask | the short Support ask after a solve, when visitors already press Support | on only | 100 tracked visits |
| Repeat a post | post an ad again a week later on the same channel (a copy with its own tracked link), when 30%+ of the visitors its link brought started a puzzle | one copy, never a copy of a copy | 10 tracked visits |
| Pause a channel | move a channel's upcoming approved posts back to draft when its links brought visitors but nobody started a puzzle | only upcoming posts; nothing deleted | 30 tracked visits |

Nothing changes until an admin presses **Approve** (each suggestion says why,
what changes and what will be checked). Level and theme changes are "house
nudges" added on top of the shared learning in `GET /v1/learn/tuning`, so they
reach new puzzles for players who keep "Learn from how I play" on (the
default) without a deploy; the others are ordinary settings. Fourteen days
later the change is judged (helped, no clear change, made it worse, or too few
games); one that made things worse is offered back as an undo, which also
waits for approval. **Undo** works at any time. A declined or undone change is
not suggested again for 30 days, a suggestion nobody answers goes away after
21 days, and a value someone changed by hand is never overwritten.

**Pre-approval** (owner only, per kind of change): "Pre-approved" lets that
kind apply by itself at the nightly check, still within its limits, measured
and undoable. Everything starts as "Ask me first". New suggestions and
pre-approved changes send an alert (Waiting for you). The weekly run below is
separate: it tunes the daily puzzle in code.

## 1. The weekly improvement run

`scripts/improve.mjs` reads:

- puzzle ratings and their rule findings (`/admin/v1/ratings`, by level, by
  play mode and by story part, last 30 days)
- the puzzle quality report: which theme and level players give up on or find
  too hard or too easy (`/admin/v1/quality`)
- what the shared learning service learned from everyone's games
  (`/v1/learn/tuning`)
- error and feedback **counts** and free limits (`/admin/v1/summary`, `/admin/v1/alerts`)
- the open `nightly-maintenance`, `health-check`, `search-check` and free-limit
  issues (site, SEO and speed problems the nightly run found)
- the speed, search and accessibility scores from the last 8 nightly
  Lighthouse runs (the `nightly-lighthouse` run files), to spot regressions

It ranks what it finds (most useful first) and writes the **Weekly
improvement report** issue (label `weekly-improvement`), rewritten each week.
It extends the nightly report rather than repeating its checks.

### What it changes by itself

Only small, bounded nudges, as one new dated entry in
`engine/src/house-tuning.js`:

| Change | From | Limit |
|---|---|---|
| Daily puzzle toughness within each level | the shared learning (half strength), plus a step gentler when 35% or more give up or 40% say too hard on the daily puzzle (10+ games), or tougher when 40% say too easy | -0.6 to 0.6, at most 0.2 a week |
| Daily puzzle clue mix | the shared learning's clue weights (half strength) | 0.75 to 1.4, at most 0.15 a week |
| Story parts picked less (or more) often | story parts with 5+ ratings averaging under 3 (or over 4) stars; older entries fade by 20% a week | never brings back a used story |

Nothing is tuned until there are 30 games in the last 30 days. Each entry
starts the day after the run, so **past daily puzzles never change**, and days
planned by hand in the admin dashboard are left exactly as planned. The game
also uses the story-part preferences at half strength for players who have
"Learn from how I play" on; their own ratings count more.

The change goes in a pull request labelled `improvement`. The full test suite
runs on it, and it merges itself only when every test passes (then the
website is published again). If a test fails, the PR stays open and the email
says so.

### The email

`scripts/improve-email.py` sends **"what we changed and why"** to the owner
(SUMMARY_TO, else ARCHIVE_TO; the same Gmail secrets as the summary email):
this week's automatic tuning and its reasons, every PR merged in the last 7
days with its reason, the top findings, what the Claude task will pick up,
and anything that may need the owner.

### Switches

- Repository variable `IMPROVE=off` stops the run; `IMPROVE=report` writes the
  report and email but never changes the tuning.
- Run it by hand: Actions > Weekly improvement > Run workflow (untick "Apply
  the tuning" for a dry run).
- To undo a tuning entry, revert its PR. An entry whose date has not come yet
  can simply be deleted from `house-tuning.js`.

### Privacy

The repository and its Actions logs are public, so the report, PRs and logs
hold only counts, rates and built-in names. Player-typed text (ideas,
problems, error messages) never leaves the Worker this way. When the Claude
task needs that text, it uses the encrypted method in MAINTENANCE.md ("Player
reports"): a one-off key, the Daily player report workflow with `public_key`,
decrypted only inside the session.

## 2. The weekly Claude task

A Claude scheduled task ("Weekly game improvement", owner's account) wakes
the project thread "Set up continuous game improvement" every Monday at 5:41
am Eastern with a prompt like the one below. It reads the latest report issue
and makes up to three small PRs. To change or stop it, ask Claude in the
project, or edit it in claude.ai under scheduled tasks.

The task follows these rules:

1. Read the open **Weekly improvement report** issue (label
   `weekly-improvement`) and the "For the weekly Claude task" list. Skip items
   an open PR already covers (search open PRs first).
2. Pick at most three items, highest priority first, that a small, safe code
   change can fix: SEO and accessibility fixes the checks flag, speed
   regressions, fresh story parts to replace ones players rate low, clearer
   clues or hints for puzzles players give up on, and clear player problems.
3. One PR per item, labelled `improvement`, on its own `claude/` branch, with a
   plain "what and why" first line (the weekly email quotes it). Run the
   tests (`npm test`, `npm --prefix server test`) before opening it.
4. Merge each PR (squash) once its checks pass. The Cloudflare "Workers
   Builds" check always fails on branches and does not block.
5. Standing rules: free tools only; never reuse a story (write new story
   lines); never put player text in the repo, issues, PRs or plain logs; when
   the game's look or features change, video.yml re-records the how-to-play
   video and opens a "[video]" PR after the merge: merge that too once its
   checks pass; mobile apps are paused (no mobile changes); bump the version (package.json, tauri.conf.json,
   Cargo.toml) only for player-facing app changes.
6. Anything that needs the owner outside the code (DNS, secrets, dashboard
   switches) goes in `docs/owner-tasks/YYYY-MM-DD-name.md` in a PR, which
   emails it to the owner.
7. When a fix addresses a player report, put `Fixes reports:` (tracking
   ids) and a plain `Player note:` in the PR body so Report fixes marks it
   Addressed with the version on merge (server/PUZZLE-REPORTS.md, "Code
   fixes"). Reported problems themselves are the daily code-fix task's job.
8. Bigger or riskier changes (new features, difficulty plan changes, anything
   that would change past daily puzzles) are not made: they are listed in a
   comment on the report issue for the owner to decide.

### The prompt

```
Weekly improvement task for The Fantastical Logic Grid (GitHub repo
bltaylorjr/fantastical-logic-grid). Read IMPROVE.md in the repo, section
"2. The weekly Claude task", and follow its rules exactly. Then read the open
GitHub issue labelled weekly-improvement and work through its "For the weekly
Claude task" list: at most three small PRs, one per item, labelled
improvement, each merged once its checks pass. Finish by adding one comment
to that issue listing what you changed (with PR links) and anything you left
for the owner and why. Never put player text in the repo, issues, PRs or
logs. Free tools only. Mobile is paused.
```
