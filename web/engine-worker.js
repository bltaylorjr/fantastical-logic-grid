// The background worker for every game's engine, so building a big puzzle never
// freezes the page. Which game it serves is the worker's name
// (new Worker(url, { name: 'np' })): not a ?game= query, because the offline
// cache serves this file without its query. The games and their operations are listed in
// engine/games.js. The request handling is the shared engine host
// (engine/engine-host.js).
import { serveEngine } from './engine/engine-host.js';
import { ENGINE_GAMES } from './engine/games.js';

const id = self.name;
const game = Object.hasOwn(ENGINE_GAMES, id) ? ENGINE_GAMES[id] : null;
if (!game) throw new Error(`No engine for game "${id}"`);
// The handlers are in place at once (the operation names come from the list),
// so no request can arrive before them; each waits for the engine to load.
const loaded = import(`./engine/${game.ops}`).then((m) => m.OPS);
serveEngine(Object.fromEntries(Object.keys(game.kinds).map((op) => [op, async (args) => (await loaded)[op](args)])));
