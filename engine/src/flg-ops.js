// The Fantastical Logic Grid's engine operations (engine/src/games.js), in one
// table shared by every place the engine runs: the page's background worker (web/engine-worker.js), the
// on-page fallback for browsers without module workers (engine-link.js), and
// the private puzzle server (puzzle-server/, docs/PUZZLE-SERVER.md). One table
// means each place offers exactly the same abilities.
import { generatePuzzle, getHint } from './index.js';

export const OPS = {
  generate: (args) => generatePuzzle(args),
  hint: (a) => getHint(a.puzzle, a.marks),
};
