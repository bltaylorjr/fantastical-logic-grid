// Skyline's engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateSkyline, getSkylineHint } from './skyline.js';

export const OPS = {
  generate: (a) => generateSkyline(a),
  hint: (a) => getSkylineHint(a.puzzle, a.entries),
};
