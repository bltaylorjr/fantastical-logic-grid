// One engine worker thread. It loads the engine once, then builds puzzles and
// hints one at a time for the pool in server.mjs.
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const eng = await import(pathToFileURL(workerData.engineIndex).href);

parentPort.on('message', ({ id, op, args }) => {
  try {
    let result;
    if (op === 'generate') result = eng.generatePuzzle(args.options);
    else if (op === 'hint') result = eng.getHint(args.puzzle, args.marks);
    else throw new Error(`Unknown operation ${op}`);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
});
parentPort.postMessage({ ready: true, version: eng.ENGINE_VERSION || null });
