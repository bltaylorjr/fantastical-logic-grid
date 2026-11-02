// Cage Math's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateCageMath, getCageMathHint } from './cage-math.js';

export const OPS = {
  generate: (a) => generateCageMath(a),
  hint: (a) => getCageMathHint(a.puzzle, a.entries),
};
