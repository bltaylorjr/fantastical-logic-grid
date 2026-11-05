// Picture Grid's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generatePictureGrid, getPictureGridHint } from './picture-grid.js';

export const OPS = {
  generate: (a) => generatePictureGrid(a),
  hint: (a) => getPictureGridHint(a.puzzle, a.entries),
};
