# Puzzle modules

New puzzle types for The Fantastical Logic Grid, built as self-contained
modules. Each one is tried in the private test app first and joins the game
only after the owner approves it.

| Module | Engine | Status |
|---|---|---|
| `number-place/` (NINETIMESNINE) | `engine/src/number-place.js`, `engine/src/number-place-styles.js` | In the game (small menu link); game styles in the test app |
| `cage-math/` (Cage Math) | `engine/src/cage-math.js` | Own screen in the app, own page on the website (`<game>/`) |
| `sum-cross/` (Sum Cross) | `engine/src/sum-cross.js` | Own screen in the app, own page on the website (`<game>/`) |
| `picture-grid/` (Picture Grid) | `engine/src/picture-grid.js`, `engine/src/picture-grid-art.js` | Own screen in the app, own page on the website (`<game>/`) |
| `grid-kit/` | `engine/src/kit-common.js` | The shared game screen the three above are built on |

## Cage Math, Sum Cross and Picture Grid (the grid kit)

These three share one game screen, `grid-kit/kit.js`. `createGame(def)` takes a
game definition (`<game>/game.js`: levels, board drawing, how a move works,
how-to text, badges) and returns the module API (`mount`, `unmount`, `suspend`,
`reopen`, `setShared`, `state`, `learning`, `dailyOptions`); `<game>/ui.js` is
one line that does this. Every element id starts with the game id (`cm`, `sc`,
`pg`), so all three can be open at once.

What each game gets from the kit: six levels with a suggested one, a daily
puzzle with a streak, saved games (rename, delete, undo), timer and pause,
notes or shade/cross pens, undo and redo, check, three-step hints beside the
grid, Fill it in, show the answer, the solution replayed step by step, how-it-
felt rating, badges and stats, share as picture or text, save and open a file,
print, sound, silent mode and full keyboard play.

Every puzzle is proven by a solver that works the way a person does, so it has
one answer and needs no guessing; the hints come from the same solver. The
player's own records (`grid-kit/learning.js`) tune how tough each puzzle is
inside its level, pick practice puzzles for the steps they ask hints about, and
make sure no puzzle, story or picture comes twice (daily puzzles excepted).
Picture Grid keeps a gallery of the pictures a player has uncovered.

In the game each is its own screen (`#screen-cm`, `#screen-sc`, `#screen-pg`),
loaded by `web/js/kit-games.js`; on the website each also has its own page (`web/js/kit-page.js`, written by `scripts/hub.mjs`).
`web/js/kit-share.js` sends anonymous play data to `POST /v1/learn/<game>/plays`
and brings back `GET /v1/learn/<game>/tuning` (server/src/kit-games.js, table
`kit_plays`, migration 2140). Each game has its own admin dashboard section
and settings (`cm_*`, `sc_*`, `pg_*`). Tests: `node modules/grid-kit/e2e.cjs`
and `node engine/test/kit-games-tests.js`.

## How a module plugs in

```js
import { mount } from './modules/number-place/ui.js';
import { workerEngine } from './modules/number-place/engine-client.js';

mount(container, {
  engine: workerEngine(new URL('./modules/number-place/engine-worker.js', import.meta.url)),
  storagePrefix: 'flg.np',      // localStorage keys
  celebrate: () => {},          // optional: the game's solve effects
  canPrint: true,               // false hides Print where the host can't print
});
```

The module brings its own markup (`markup.js`) and styles (`ui.css`, scoped to
`.np-app`). It reads the host's color tokens (`--accent`, `--bg`, `--text`...)
and uses the host's `.btn` and `.card`, so it matches the game in light, dark
and high-contrast themes.

## NINETIMESNINE game styles

The setup screen's **Game style** picks how a puzzle is played. Classic
(NINETIMESNINE) is the default; the others are NINETIMESNINE-Rival Grid,
-Chain Reaction, -Tidewater and -Glyph Quest (`number-place/styles.js`). Each
one tunes itself from the player's own records of that style (the record's
`style` and `sr` fields). The rival's moves and the Tidewater pools and ebb run
in the engine worker (`move`, `tide`, `ebb`), so a host's fallback engine needs
those too. **How to play** (`number-place/howto.js`) has the full rules and a
worked example for every style. Test: `node modules/number-place/e2e-styles.cjs`.

## In the game

NINETIMESNINE is its own screen (`#screen-np`), opened from a small link at the
foot of the Menu. `scripts/build.mjs` copies this folder to `web/modules/`, and
`web/js/number-place.js` loads it the first time the player opens it, with the
engine in the shared game worker (`web/engine-worker.js`, game `np`; see docs/PUZZLE-SERVER.md). It keeps its own saves, settings and stats
(`flg.np.*`). The only thing it shares is anonymous play data:
`web/js/np-share.js` sends finished games to `POST /v1/learn/np/plays` and
brings back `GET /v1/learn/np/tuning` (server/src/number-place.js). The admin
dashboard's **NINETIMESNINE** section shows how each level is going and holds
the settings that are NINETIMESNINE's alone. Test: `node scripts/e2e-number-place.cjs`.

## Test app

```
npm run build                      # fonts for the test app
node modules/build-test-app.mjs    # writes dist/module-test
node scripts/serve.mjs dist/module-test 8080
node modules/number-place/e2e.cjs  # browser test
node modules/number-place/e2e-styles.cjs  # game styles
node engine/test/number-place-tests.js
node modules/grid-kit/e2e.cjs      # Cage Math, Sum Cross, Picture Grid (?game=cm|sc|pg)
node engine/test/kit-games-tests.js
```
