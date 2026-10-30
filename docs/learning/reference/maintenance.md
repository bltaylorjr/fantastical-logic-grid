# Tutorial: how the game looks after itself

Most upkeep runs on its own on a schedule, for free. Your part is to read the emails and issues it sends and act on the few that need a person. The full technical page is [MAINTENANCE.md](../../../MAINTENANCE.md).

![A 24-hour timeline: cleanup at 2 am, nightly checks at 2:20 am, player report around 3 am, your to-do email at about 7 am, and the next daily puzzle published in the evening. Below: every 3 hours a health check; every pull request runs the tests; Mondays bring weekly reports.](../wireframes/maintenance-schedule.png)

## The routine

| When | What runs | What it does |
| --- | --- | --- |
| Every pull request | **Tests** | Plays the game in a robot browser and checks hundreds of things. A red X blocks the change. |
| Every merge to main | Publish and deploy | The website republishes; the game server redeploys. |
| Every 3 hours | **Health check** | Checks the website, server, database and desktop update file. Opens a `health-check` issue if something is down and closes it when it's back. |
| 2:00 am Eastern | **Cleanup** | Removes old data the game no longer needs, so the free database never fills up. Scores, saves and accounts are never removed. |
| 2:20 am Eastern | **Nightly checks** | Links, page tags, speed scores, security advisories, free-plan limits. Problems go in one `nightly-maintenance` issue; only things that need you are emailed. |
| About 3 am Eastern | **Player report** | Emails new errors players hit and new ideas or problems they sent, only when something is new. |
| About 7 am Eastern | **Your to-do email** | Today's learning task, pull requests waiting for you, and what you finished. |
| Evening | **Daily puzzle** | Publishes tomorrow's daily puzzle page and tells search engines. |
| Weekly | **Dependabot** | Updates the code libraries the game uses. Small updates that pass the tests merge themselves; big ones wait for you. |
| Mondays | **Weekly improvement** | Reads ratings, quit rates and errors, makes small safe tuning changes, and emails what changed and why. |

## Emails and issues you'll get, and what to do

| You get | It means | What to do |
| --- | --- | --- |
| **To do: ...** (owner task email) | Something only you can do: a DNS record, a key, a dashboard switch | Follow its numbered steps. Ask Claude if a step is unclear. |
| `health-check` issue opened | Part of the game is down | Wait an hour: most outages fix themselves and the issue closes on its own. Still open? Ask Claude to look. |
| Nightly maintenance email | A problem the nightly checks found that needs a person | Forward it to Claude, or open the `nightly-maintenance` issue and say "Claude, take a look". |
| Player report | New errors or player ideas | Skim it. Errors repeating across many players are worth a fix; ask Claude. |
| A pull request from Dependabot that didn't merge itself | A big library update that needs a look | Leave it for Claude to review, or ask. Don't merge one with a red X. |
| Security alert from GitHub | A library has a known weakness | Ask Claude to fix it; these get priority. |
| Free-limit alert | A free plan is close to its limit | Ask Claude what's using it; usually a setting can lower it. |
| Weekly improvement email | What the game tuned by itself this week | Read for interest; nothing to do unless it says so. |

## Things that need a person, now and then

- **Renew the domain** thelogicgrid.com each year at your registrar (turn on auto-renew).
- **Keep repository activity going.** GitHub pauses scheduled jobs in a repository with no commits for 60 days. If the emails stop, open the **Actions** tab and re-enable the paused workflows.
- **Replace a key** when a service says it expired or leaked (see [how the game runs](how-the-game-runs.md#keys-and-secrets-how-services-trust-each-other)).
- **Merge or close pull requests** so the list in your to-do email stays short.

## Try it (10 minutes)

1. Open the **Actions** tab, choose **Nightly maintenance** on the left, and open last night's run. Its summary page is the nightly report.
2. Open the **Issues** tab and filter by the label `nightly-maintenance`. Is there an open one? Read what it found.
3. Open the **Pull requests** tab and find one opened by Dependabot. Read what it updates and whether its tests passed.
