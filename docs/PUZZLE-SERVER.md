# The private puzzle server

Bobby chose on 2026-11-01 to keep the puzzle generator off players' devices.
Before this, the website sent the whole engine (generator, solver, clue writer,
storylines and topic libraries, about 1.6 MB) to every browser, so anyone could
save it from thelogicgrid.com even with the source repository private. In
server mode the site keeps only what it needs to *play* a puzzle (checking
marks, story beats, the tutorial, about 130 KB). Puzzles and hints come from a
server that only the game's own Worker can reach.

```
player's browser ──HTTPS──▶ Cloudflare Worker flg-api ──Cloudflare Tunnel (Workers VPC)──▶ Oracle VM
  (no generator)            /v1/puzzles/generate         no public address, no open ports    puzzle server
                            /v1/puzzles/hint             + shared key PUZZLE_KEY             (engine/src)
                            origin check, rate limits
```

| Part | Where | What it does |
| --- | --- | --- |
| `puzzle-server/` | Oracle VM, container `flg-puzzles` (172.30.0.10:8080 on the VM's private `flg` network) | Runs `engine/src` in 2 worker threads. Refuses any request without the key, caps sizes, queues up to 60 requests (then "busy"), stops a puzzle that runs past 170 s. Read-only container, runs as an ordinary user. |
| `server/src/puzzles.js` | Cloudflare Worker | `POST /v1/puzzles/generate`, `POST /v1/puzzles/hint`, `GET /v1/puzzles/health`. Only the game's own origins (`ALLOWED_ORIGINS`), 60 puzzles and 120 hints a minute per visitor (`LIMIT_PUZZLES`, `LIMIT_HINTS`). Answers 503 `puzzles_off` until the binding and secret exist. |
| `web/js/engine-remote.js` | Website | Replaces `engine-client.js` in server-mode builds. Same two exports, friendly words when offline or busy. |
| `scripts/build.mjs` | Build | With `FLG_PUZZLE_SERVER=1`, removes the server-only engine files and `worker.js`, and fails if any shipped file still imports one. |
| `.github/workflows/puzzle-server.yml` | Oracle runner | On every change to `engine/src` or `puzzle-server` on main: tests, copies the release into `/opt/flg-puzzles/releases/<sha>`, switches `current`. The server restarts itself on the new release within 15 s, after finishing the puzzles in hand. |
| `scripts/runner/oracle-cloud-init.sh` | Oracle VM | Sets up runners, the puzzle server and the tunnel. Safe to run again (`/opt/flg/setup.sh`). Log: `/var/log/flg-setup.log`. |

Files that stay on the server: `index, generator, solver, hints, clues,
classroom, order, player-stories, topics, topic-kit, storylines, more-stories,
themes, more-topics-*`. Hints moved from `play.js` to `hints.js` so the play
helpers no longer pull in the solver.

## Switches (all off by default, each can be undone)

1. Worker binding `PUZZLES` (wrangler.toml `[[vpc_services]]`, needs the VPC
   Service id) and Worker secret `PUZZLE_KEY` (from `/opt/flg/puzzle.env` on
   the VM). Without both, `/v1/puzzles/*` answers 503 and nothing else changes.
2. Repository variable `FLG_PUZZLE_DEPLOY=1` (with `FLG_RUNNER` set): deploys
   the puzzle server to the VM.
3. Repository variable `FLG_PUZZLE_SERVER=1`: the next *Publish web version*
   ships the site without the generator. Delete the variable and publish again
   to go back to puzzles made on the player's device.

Turn on 3 only after `https://flg-api.btay74.workers.dev/v1/puzzles/health`
shows `"ok":true` with the latest release.

## What it does not cover yet

- The Windows app (and the paused phone apps) still carry the engine so they
  work offline, a paid feature. It is packed inside the installer, which is
  harder to get at than a web page but still possible. A later step can ship
  them a bank of ready-made puzzles instead.
- NINETIMESNINE's generator (`engine/number-place*.js`) still runs on the page;
  the Puzzle Wizard's NINETIMESNINE checks use it. Moving it is the same work again.
- Anything already published stays published: the public repository's history
  and older site versions may already have been copied. Server mode protects
  what comes next. The LICENSE and Terms are what cover earlier copies.
- If the Oracle VM is down, new web puzzles stop (saved puzzles still play).
  The Worker's health route and the existing owner alerts show it. To go back
  at once, delete `FLG_PUZZLE_SERVER` and run *Publish web version*.

## Looking after it

- Status: `sudo docker ps -a` and `sudo docker logs --tail 50 flg-puzzles` on the VM.
- New key: `sudo rm /opt/flg/puzzle.env && sudo bash /opt/flg/setup.sh`, then
  update the `PUZZLE_KEY` Worker secret with `sudo cat /opt/flg/puzzle.env`.
- Tests: `node puzzle-server/test/server.test.mjs` and
  `node --test server/test/puzzles.test.mjs`.
