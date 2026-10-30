# Puzzle modules

New puzzle types for The Fantastical Logic Grid, built as self-contained
modules. They are **not** part of the live game yet: each one is tried in the
private test app first and joins the game only after the owner approves it.

| Module | Engine | Status |
|---|---|---|
| `number-place/` | `engine/src/number-place.js` | In testing |

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

## Test app

```
npm run build                      # fonts for the test app
node modules/build-test-app.mjs    # writes dist/module-test
node scripts/serve.mjs dist/module-test 8080
node modules/number-place/e2e.cjs  # browser test
node engine/test/number-place-tests.js
```
