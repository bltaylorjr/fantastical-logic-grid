// More or Less's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateMoreOrLess, getMoreOrLessHint } from './more-or-less.js';

export const OPS = {
  generate: (a) => generateMoreOrLess(a),
  hint: (a) => getMoreOrLessHint(a.puzzle, a.entries),
};
