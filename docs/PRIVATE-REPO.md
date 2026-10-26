# Private source, public site

Bobby chose on 2026-10-26 to keep the source code private so nobody can read
or copy it. Players still need three things from GitHub, so those come from a
second, **public** repository that holds only built files:

| What | Private repo `bltaylorjr/fantastical-logic-grid` | Public repo `bltaylorjr/thelogicgrid` |
| --- | --- | --- |
| Source, tests, workflows, secrets | yes | no |
| Website (thelogicgrid.com) | built here | served by GitHub Pages from its `gh-pages` branch (minified files only, one fresh commit per publish, no history) |
| Windows installer + `latest.json` for updates | released here | copied here by `release.yml` (job `mirror`) |

Builds run on our own free server, because private repos get only 2,000 free
GitHub Actions minutes a month and the project uses about 1,500 a day.

## How the switches work

Everything is off until these repository **variables** are set (Settings >
Secrets and variables > Actions > Variables). Removing them goes back to the
old way, so each step can be undone.

- `FLG_RUNNER` = `["self-hosted","flg"]`: every Linux job runs on the Oracle
  build server instead of GitHub's machines. Pull requests from forks always
  stay on GitHub's machines. Windows releases (`windows-latest`) and the paused
  mobile workflow always use GitHub's machines (Windows minutes count double,
  but a release takes about 15 minutes).
- `FLG_SITE_REPO` = `bltaylorjr/thelogicgrid`: `pages.yml` pushes the built
  site to the public repo instead of deploying Pages here, `release.yml`
  mirrors each release there, `health.yml` checks the update file there, and
  the build points the game's Download for Windows button at it.
- Secret `SITE_REPO_TOKEN`: a fine-grained personal access token with
  **Contents: read and write** on `bltaylorjr/thelogicgrid` only.

The Windows app (from the first release after 2026-10-26) checks for updates at the public repo first and the old
address second (`plugins.updater.endpoints` in `desktop/src-tauri/tauri.conf.json`).
Copies older than that only know the old address, so a release that carries the new
address must ship **before** the source goes private, and the old address stops
working once it does. Anyone still on an older copy can reinstall from the
website.

## The build server

`scripts/runner/oracle-cloud-init.sh` sets up an Oracle Cloud Always Free
Ampere A1 VM (4 Arm cores, 24 GB, Ubuntu 24.04): Docker, then three GitHub
Actions runners (labels `self-hosted`, `flg`), each in its own container so
tests with fixed ports never collide. The image has Node 22, the GitHub CLI,
ffmpeg, Python and Playwright's Chromium (`CHROME_PATH` for Lighthouse).
Security updates install themselves. To rebuild a runner, run the script again
on the VM with a fresh registration token.

Oracle may reclaim an Always Free VM that stays almost idle for 7 days (CPU,
network and memory all under 20%). Daily builds normally keep it busy. If it
is ever reclaimed, create a new one with the same script.

## Order of the switch-over

1. Bobby: create the public repo, the token and the secret, and the Oracle VM
   (docs/owner-tasks/2026-10-26-private-source-part-1.md).
2. Set `FLG_RUNNER` and watch a few runs pass on the Oracle server.
3. Set `FLG_SITE_REPO`, run *Publish web version* and *Release desktop app*
   by hand, and check that the public repo has the site and the installer.
4. Move GitHub Pages: remove the custom domain here, then set the public repo's
   Pages source to the `gh-pages` branch with custom domain `thelogicgrid.com`
   and Enforce HTTPS. DNS does not change (same `bltaylorjr.github.io` user).
5. Ship a desktop release that carries the new update address and wait for
   copies to update.
6. Bobby: Settings > General > Danger Zone > Change visibility > Private.
