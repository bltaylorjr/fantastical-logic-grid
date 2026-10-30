# Learning: small coding tasks, build sheets and your daily email

A slow, steady way for the owner to learn the code: small real tasks, each with a sheet that shows what it should look like and explains the code. Claude can take over any task at any time.

## The pieces

| What | Where |
| --- | --- |
| Tasks | GitHub issues labeled **learning**, each 10 to 15 minutes, with exact steps |
| Build sheets | [build-sheets/](build-sheets/): one per task, named `<issue number>-<short-name>.md`. A wireframe of the result, the code line by line, and how to check it |
| Wireframes | [wireframes/](wireframes/): the pictures, drawn by `wireframes/draw.py` |
| Reference sheets | [reference/](reference/): [HTML text](reference/html-text.md), [JavaScript lists](reference/javascript-lists.md), [CSS colors](reference/css-colors.md), [Story parts](reference/story-parts.md) |
| Tutorials | [How the game runs](reference/how-the-game-runs.md) (the services it connects to) and [How it looks after itself](reference/maintenance.md) (the maintenance routine) |

## Your emails

Sent from the game's Gmail by `.github/workflows/learning-digest.yml` and `scripts/learning-digest.py`:

- **Every morning, about 7 am Eastern:** today's pick (the smallest open learning task), the other open tasks, pull requests waiting for your review, and what you finished yesterday. Nothing to report means no email.
- **When you close a learning issue as completed:** that task's build sheet, with its wireframe and the code explained.

They go to the game's Gmail by default. To send them to another inbox, set the repository secret `OWNER_TASKS_TO` to that address (Settings > Secrets and variables > Actions); the owner task emails use the same one. To try it by hand: **Actions > Learning emails > Run workflow**.

## Rules for new tasks (for Claude and anyone adding one)

1. Small, real and safe: words, simple HTML, CSS values, data lists, story parts. Never accounts, payments, security, the puzzle engine's logic or player data.
2. The issue says the time, the level, the exact file and where in it, what to change, what not to touch, and how to know it's done. It ends with "Claude, take over".
3. Every task gets a build sheet in `build-sheets/` before the issue opens, and its wireframe in `wireframes/draw.py`.
4. Each level builds on the one before: words, then HTML, then CSS, then data, then small logic with a test.
