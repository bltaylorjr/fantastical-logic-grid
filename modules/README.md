# Puzzle modules

New puzzle types for The Fantastical Logic Grid, built as self-contained
modules. Each one is tried in the private test app first and joins the game
only after the owner approves it.

| Module | Engine | Status |
|---|---|---|
| `number-place/` (NINETIMESNINE) | `engine/src/number-place.js`, `engine/src/number-place-styles.js` | In the game (small menu link); game styles in the test app |

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
engine in `web/np-worker.js`. It keeps its own saves, settings and stats
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
```
