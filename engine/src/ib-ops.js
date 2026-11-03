// Island Bridges' engine operations (engine/src/games.js), shared by every place the
// engine runs: the page's background worker, the on-page fallback and the private puzzle server.
import { generateIslandBridges, getIslandBridgesHint } from './island-bridges.js';

export const OPS = {
  generate: (a) => generateIslandBridges(a),
  hint: (a) => getIslandBridgesHint(a.puzzle, a.entries),
};
