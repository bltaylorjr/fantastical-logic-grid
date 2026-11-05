// Loop Line's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateLoopLine, getLoopLineHint } from './loop-line.js';

export const OPS = {
  generate: (a) => generateLoopLine(a),
  hint: (a) => getLoopLineHint(a.puzzle, a.entries),
};
