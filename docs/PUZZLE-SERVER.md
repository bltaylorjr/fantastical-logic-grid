# The private puzzle server

Bobby chose on 2026-11-01 to keep every game's puzzle engine off players'
devices: The Fantastical Logic Grid, NINETIMESNINE, and any game added later.
Before this, the website sent the whole engine (generators, solvers, clue and
story writers, storylines and topic libraries, about 1.6 MB) to every browser,
so anyone could save it from thelogicgrid.com even with the source repository
private. In server mode the site keeps only what it needs to *play* (checking
marks, story moments, the tutorial, the Educators forms, theme names: about
130 KB). Everything the games compute comes from a server that only the
game's own Worker can reach.

```
player's browser ──HTTPS──▶ Cloudflare Worker flg-api ──Cloudflare Tunnel (Workers VPC)──▶ Oracle VM
  (no generators            /v1/puzzles/<game>/<op>      no public address, no open ports    puzzle server
   or solvers)              origin check, rate limits    + shared key PUZZLE_KEY             (engine/src)
```

## One engine system for every game

Every game's engine works the same way and has the same abilities wherever it
runs. The list of games is `engine/src/games.js`:

| Game | Operations file | Operations |
| --- | --- | --- |
| `flg` The Fantastical Logic Grid | `engine/src/flg-ops.js` | `generate` (build), `hint` |
| `np` NINETIMESNINE | `engine/src/np-ops.js` | `generate` (build), `hint`, `move` (the Rival Grid's rival), `tide` and `ebb` (Tidewater), `check` (the Puzzle Wizard's one-answer check) |

Each operations file is one table, `OPS`, used unchanged by all three places
an engine runs:

| Where | File | How |
| --- | --- | --- |
| Background worker on the page | `web/engine-worker.js` | One worker per game, named after the game; the shared engine host (`engine-host.js`) answers requests. |
| On the page, for browsers without module workers | `web/js/engine-links.js` | The shared engine link (`engine-link.js`) loads the same table on the page. It also restarts a crashed worker and can stop a request that runs too long. |
| Private puzzle server | `puzzle-server/engine-thread.mjs` | Every game's table, under `<game>/<op>`, served by the same shared engine host in Node worker threads. |

The page asks with one call for any game:
`gameLink('np').call('hint', { puzzle, entries })`. The game modules use small
wrappers (`web/js/engine-client.js` for the Logic Grid, `web/js/np-engine.js`
for NINETIMESNINE). In server mode the build swaps `engine-links.js` for
`engine-links-remote.js`, which offers the same `gameLink()` for every game,
backed by the puzzle server, with plain words when offline or busy.

### Adding a game

1. Write `engine/src/<id>-ops.js` exporting `OPS`, one function per thing the
   game asks its engine for (plain JSON in and out).
2. Add the game to `engine/src/games.js` with each operation's kind: `build`
   (makes a new puzzle; 3-minute limit; counts against `LIMIT_PUZZLES`) or
   `play` (hints, moves, checks; 30 seconds; `LIMIT_HINTS`).
3. On the page, use `gameLink('<id>')`.

Nothing else changes. The background worker, the on-page fallback, the puzzle
server, the Worker route and its rate limits all read `games.js`. In server
mode, the new game's engine files stay on the server automatically, because
the site ships only the engine files `scripts/build.mjs` lists in `PAGE_FILES`.
A test (`puzzle-server/test/server.test.mjs`) fails if an operations file and
`games.js` don't list the same operations.

## The parts

| Part | Where | What it does |
| --- | --- | --- |
| `puzzle-server/` | Oracle VM, container `flg-puzzles` (172.30.0.10:8080 on the VM's private `flg` network) | Runs every game's operations in 2 worker threads. Refuses any request without the key, caps sizes, queues up to 60 requests (then "busy"), stops a request past its kind's time limit. Read-only container, runs as an ordinary user. |
| `server/src/puzzles.js` | Cloudflare Worker | `POST /v1/puzzles/<game>/<op>`, `GET /v1/puzzles/health`. Only operations in `games.js`, only the game's own origins (`ALLOWED_ORIGINS`), and per visitor a minute 120 builds (`LIMIT_PUZZLES`) and 600 play-time requests (`LIMIT_HINTS`), enough for a classroom behind one school address. Answers 503 `puzzles_off` until the binding and secret exist. |
| `scripts/build.mjs` | Build | With `FLG_PUZZLE_SERVER=1`: keeps only `PAGE_FILES` in the site's engine folder, removes the engine worker, swaps in the remote engine links, writes names-only theme and topic lists for the Educators forms and NINETIMESNINE's menu, and fails if any shipped file still imports a removed one. |
| `.github/workflows/puzzle-server.yml` | Oracle runner | On every change to `engine/src` or `puzzle-server` on main: tests, copies the release into `/opt/flg-puzzles/releases/<sha>`, switches `current`. The server restarts itself on the new release within 15 s, after finishing the requests in hand. |
| `scripts/runner/oracle-cloud-init.sh` | Oracle VM | Sets up the build runners, the puzzle server and the tunnel. Safe to run again (`/opt/flg/setup.sh`). Log: `/var/log/flg-setup.log`. |

Engine files split so the page needs only small pieces: Logic Grid hints
moved from `play.js` to `hints.js`; story-part checks from `story.js` to
`story-parts.js`; the classroom package builders from `classroom.js` to
`classroom-build.js`; the Wizard's NINETIMESNINE solving to
`number-place-wizard.js`.

## Switches (all off by default, each can be undone)

1. Worker binding `PUZZLES` (wrangler.toml `[[vpc_services]]`, needs the VPC
   Service id) and Worker secret `PUZZLE_KEY` (from `/opt/flg/puzzle.env` on
   the VM). Without both, `/v1/puzzles/*` answers 503 and nothing else changes.
2. Repository variable `FLG_PUZZLE_DEPLOY=1` (with `FLG_RUNNER` set): deploys
   the puzzle server to the VM.
3. Repository variable `FLG_PUZZLE_SERVER=1`: the next *Publish web version*
   ships the site without any game's engine. Delete the variable and publish
   again to go back to puzzles made on the player's device.

Turn on 3 only after `https://flg-api.btay74.workers.dev/v1/puzzles/health`
shows `"ok":true` with the latest release.

## What it does not cover yet

- The Windows app (and the paused phone apps) still carry the engines so they
  work offline, a paid feature. They are packed inside the installer, which is
  harder to get at than a web page but still possible. A later step can ship
  them a bank of ready-made puzzles instead.
- Anything already published stays published: the public repository's history
  and older site versions may already have been copied. Server mode protects
  what comes next. The LICENSE and Terms are what cover earlier copies.
- If the Oracle VM is down, new web puzzles, hints and NINETIMESNINE's rival
  and tide stop (saved puzzles still open). The Worker's health route and the
  existing owner alerts show it. To go back at once, delete `FLG_PUZZLE_SERVER`
  and run *Publish web version*.

## Looking after it

- Status: `sudo docker ps -a` and `sudo docker logs --tail 50 flg-puzzles` on the VM.
- New key: `sudo rm /opt/flg/puzzle.env && sudo bash /opt/flg/setup.sh`, then
  update the `PUZZLE_KEY` Worker secret with `sudo cat /opt/flg/puzzle.env`.
- Tests: `node puzzle-server/test/server.test.mjs`,
  `node --test server/test/puzzles.test.mjs`, and the browser test
  `scripts/e2e-puzzle-server.cjs` (after a server-mode build; see the CI step).
