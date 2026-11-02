// The `engine` object the kit expects, backed by a worker (the private test app).
export function workerEngine(url, name) {
  const w = new Worker(url, { type: 'module', name });
  let seq = 0;
  const pending = new Map();
  w.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result); else p.reject(new Error(e.data.error));
  };
  const call = (op, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, args });
  });
  return { generate: (options) => call('generate', options), hint: (puzzle, entries) => call('hint', { puzzle, entries }) };
}
