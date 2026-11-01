// NINETIMESNINE's engine operations (engine/src/games.js), in one table shared
// by every place the engine runs, the same way as the Logic Grid's (flg-ops.js): the page's
// background worker (web/engine-worker.js), the on-page fallback (engine-link.js)
// and the private puzzle server (puzzle-server/, docs/PUZZLE-SERVER.md).
import { generateNumberPlace, getNumberPlaceHint } from './number-place.js';
import { nextPlacement, planTide, ebbTide } from './number-place-styles.js';
import { analyzeGivens } from './number-place-wizard.js';

export const OPS = {
  generate: (a) => generateNumberPlace(a),
  hint: (a) => getNumberPlaceHint(a.puzzle, a.entries),
  // The game styles: the rival's next move, and the Tidewater pools and ebb.
  move: (a) => nextPlacement(a.puzzle, a.grid, a.options),
  tide: (a) => planTide(a.puzzle, a.options),
  ebb: (a) => ebbTide(a.puzzle, a.grid, a.water),
  // The Puzzle Wizard's one-answer check for an author's own numbers.
  check: (a) => analyzeGivens(a),
};
