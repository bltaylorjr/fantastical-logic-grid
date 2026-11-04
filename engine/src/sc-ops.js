// Sum Cross's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateSumCross, getSumCrossHint } from './sum-cross.js';

export const OPS = {
  generate: (a) => generateSumCross(a),
  hint: (a) => getSumCrossHint(a.puzzle, a.entries),
};
