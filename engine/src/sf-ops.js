// Star Field's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateStarField, getStarFieldHint } from './star-field.js';

export const OPS = {
  generate: (a) => generateStarField(a),
  hint: (a) => getStarFieldHint(a.puzzle, a.entries),
};
