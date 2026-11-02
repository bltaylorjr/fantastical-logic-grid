// The private test app's engine worker for the kit games: which game it serves
// is the worker's name (new Worker(url, { type: 'module', name: 'cm' })).
// In the game itself the shared worker (web/engine-worker.js) does this job.
import { serveEngine } from '../../engine/src/engine-host.js';

const OPS_FILE = { cm: 'cm-ops.js', sc: 'sc-ops.js', pg: 'pg-ops.js' };
const file = OPS_FILE[self.name];
if (!file) throw new Error(`No engine for game "${self.name}"`);
const loaded = import(`../../engine/src/${file}`).then((m) => m.OPS);
serveEngine({ generate: async (a) => (await loaded).generate(a), hint: async (a) => (await loaded).hint(a) });
