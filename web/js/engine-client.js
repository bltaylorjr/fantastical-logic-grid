// Talks to worker.js. Falls back to running the engine on the page if module
// workers are not available (very old browsers).
import { report } from './errors.js';
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) return p.resolve(e.data.result);
      const err = new Error(e.data.error);
      report(err, 'engine');
      p.reject(err);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'The puzzle writer stopped unexpectedly.'));
      pending.clear();
      worker.terminate();
      worker = null;
    };
  } catch (e) {
    worker = false;
  }
  return worker;
}

async function call(op, args) {
  const w = getWorker();
  if (!w) {
    const eng = await import('../engine/index.js');
    return op === 'generate' ? eng.generatePuzzle(args) : eng.getHint(args.puzzle, args.marks);
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, args });
  });
}

export const generate = (options) => call('generate', options);
export const hint = (puzzle, marks) => call('hint', { puzzle, marks });
