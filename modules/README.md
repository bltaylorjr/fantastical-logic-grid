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
| `more-or-less/` (More or Less) | `engine/src/more-or-less.js`, `engine/src/latin-kit.js` | Own screen in the app, own page on the website (`<game>/`) |
| `skyline/` (Skyline) | `engine/src/skyline.js`, `engine/src/latin-kit.js` | Own screen in the app, own page on the website (`<game>/`) |
| `star-field/` (Star Field) | `engine/src/star-field.js` | Own screen in the app, own page on the website (`<game>/`) |
| `loop-line/` (Loop Line) | `engine/src/loop-line.js` | Own screen in the app, own page on the website (`<game>/`) |
| `island-bridges/` (Island Bridges) | `engine/src/island-bridges.js` | Own screen in the app, own page on the website (`<game>/`) |
| `grid-kit/` | `engine/src/kit-common.js` | The shared game screen the eight above are built on |

## The grid-kit games

Cage Math, Sum Cross, Picture Grid, More or Less, Skyline, Star Field, Loop
Line and Island Bridges share one game screen, `grid-kit/kit.js`. `createGame(def)` takes a
game definition (`<game>/game.js`: levels, board drawing, how a move works,
how-to text, badges) and returns the module API (`mount`, `unmount`, `suspend`,
`reopen`, `setShared`, `state`, `learning`, `dailyOptions`); `<game>/ui.js` is
one line that does this. Every element id starts with the game id (`cm`, `sc`,
`pg`, `ml`, `sk`, `sf`, `ll`, `ib`), so all of them can be open at once.

What each game gets from the kit: six levels with a suggested one, a daily
puzzle with a streak, saved games (rename, delete, undo), timer and pause,
notes or shade/cross pens, undo and redo, check, three-step hints beside the
grid, Fill it in, show the answer, the solution replayed step by step, how-it-
felt rating, badges and stats, share as picture or text, save and open a file,
print, sound, silent mode and full keyboard play.

**Story themes.** The setup screen's Story theme picks one of the main game's
themes (or Surprise me); the daily puzzle's theme comes from the date, so it is
the same for everyone. The engine gets it as the `theme` generate option and
builds the title, opening, ending and three story moments
(`engine/src/kit-story.js`); every word players see is in
`engine/src/kit-story-words.js`, with a HOW TO WRITE note. The story is only a
wrapper: the grid and clues are exactly the same with any theme or none
(`engine/test/kit-story-proof.json`). Story moments show under the board as
progress passes a third, two thirds and nearly the end, unless the player
turns off Show story moments. When the player's record says another level
suits them, the solved card says so and Next puzzle goes there.

Every puzzle is proven by a solver that works the way a person does, so it has
one answer and needs no guessing; the hints come from the same solver. The
player's own records (`grid-kit/learning.js`) tune how tough each puzzle is
inside its level, pick practice puzzles for the steps they ask hints about, and
make sure no puzzle, story or picture comes twice (daily puzzles excepted).
Picture Grid keeps a gallery of the pictures a player has uncovered.

In the game each is its own screen (`#screen-cm`, `#screen-sc`, `#screen-ml`, ...),
loaded by `web/js/kit-games.js`; on the website each also has its own page (`web/js/kit-page.js`, written by `scripts/hub.mjs`).
`web/js/kit-share.js` sends anonymous play data to `POST /v1/learn/<game>/plays`
and brings back `GET /v1/learn/<game>/tuning` (server/src/kit-games.js, table
`kit_plays`, migration 2140). Each game has its own admin dashboard section
and settings (`cm_*`, `sc_*`, `pg_*`, `ml_*`, `sk_*`, `sf_*`, `ll_*`, `ib_*`). Tests: `node modules/grid-kit/e2e.cjs`,
each new game's `node modules/<game>/e2e.cjs` and `node engine/test/kit-games-tests.js`
(plus `ml-`, `sk-`, `sf-`, `ll-` and `ib-tests.js`). A game without an intro video
simply has no Watch button or video on its pages; adding `web/media/games/<video>.mp4`
and the game's `video` field (web/js/games.js, scripts/hub.mjs) is all it takes.

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
node modules/more-or-less/e2e.cjs  # and skyline, star-field, loop-line, island-bridges (?game=ml|sk|sf|ll|ib)
node engine/test/kit-games-tests.js
```

## Daily puzzles on social media and their answer keys

`scripts/game-daily.mjs` makes each game's daily puzzle outside the browser exactly as the
game does (same seed, daily options and admin switches from `GET /v1/config`). The nightly
build writes an answer key page for each, `<game>/daily/<date>/` (today and the 30 days
before), and each morning `scripts/social-games.mjs` checks the puzzle (rules checked
independently, one answer proven by the engine's solver, answer key page live and showing
this puzzle) and makes its picture and captions, which `scripts/marketing-post.py` posts
after the Logic Grid's (`.github/workflows/daily-puzzle-social.yml`). `?play=daily` on a
game's page opens today's puzzle (`playDaily()` in each module). Test:
`node scripts/test-social-games.mjs`.

## Races against other players

Every module game has races like The Fantastical Logic Grid's (`web/js/game-race.js`, added by
`web/js/number-place.js` and `web/js/kit-games.js` when accounts are on): a *Race other players*
card on the setup screen (Start a race, Find a race, Join with a code), a race bar while a race
puzzle is open, and race links (`<game>/?race=CODE`). The module provides `racePuzzle()` (a puzzle
with the setup choices), `startShared(p)` and `state()`. A finished race sends every cell's value;
the Worker (`server/src/compete.js`, `GAMES`) checks the puzzle's shape when a race starts and the
answers when it finishes. Test: `node scripts/e2e-game-races.cjs`.
