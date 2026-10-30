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
| 5:41 am Eastern | **Weekly Claude task**: up to three small fix PRs from the report | a Claude scheduled task (below) |

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
