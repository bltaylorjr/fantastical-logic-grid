// One engine worker thread for the pool in server.mjs. It serves every game in
// engine/src/games.js with the same shared engine host the browser workers use
// (engine-host.js), so each game has exactly the same operations here as on the
// page. Requests are { id, op: '<game>/<op>', args }.
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const load = (f) => import(pathToFileURL(join(workerData.engineDir, f)).href);
const [{ ENGINE_GAMES }, { serveEngine }] = await Promise.all([load('games.js'), load('engine-host.js')]);
const table = {};
for (const [id, game] of Object.entries(ENGINE_GAMES)) {
  const { OPS } = await load(game.ops);
  for (const op of Object.keys(game.kinds)) {
    if (typeof OPS[op] !== 'function') throw new Error(`${game.ops} has no operation "${op}" (listed in games.js)`);
    table[`${id}/${op}`] = OPS[op];
  }
}
// The shared host talks to a worker scope; this is the same thing for a Node thread.
serveEngine(table, {
  set onmessage(fn) { parentPort.on('message', (data) => fn({ data })); },
  postMessage: (msg) => parentPort.postMessage(msg),
});
const { ENGINE_VERSION = null } = await load('index.js');
parentPort.postMessage({ ready: true, version: ENGINE_VERSION });
