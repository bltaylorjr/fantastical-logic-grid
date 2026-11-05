// The Crossword's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateCrossword, getCrosswordHint } from './crossword.js';

export const OPS = {
  generate: (a) => generateCrossword(a),
  hint: (a) => getCrosswordHint(a.puzzle, a.entries),
};
