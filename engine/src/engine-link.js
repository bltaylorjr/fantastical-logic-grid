// Shared engine link: the page side of every game's engine.
//
//   const engine = engineLink(new URL('../worker.js', import.meta.url), {
//     fallback: async () => { const m = await import('../engine/index.js'); return { generate: m.generatePuzzle }; },
//     onError: (err) => report(err, 'engine'),
//   });
//   const puzzle = await engine.call('generate', options);
//
// - The worker starts on the first call, so a game that is never opened costs nothing.
// - If the worker crashes, waiting calls are told and the next call starts a fresh worker.
// - Where module workers are not available, `fallback()` supplies the same
//   operations to run on the page (loaded once, only when needed).
// - `timeoutMs` (per call) stops a request that runs too long and restarts the
//   worker, so one stuck request can never hold up the next.

export function engineLink(source, { fallback = null, onError = null, timeoutMs = 0 } = {}) {
  let worker = null; // null: not started; false: workers unavailable
  let local = null;
  let seq = 0;
  const pending = new Map();

  const failAll = (message) => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
    pending.clear();
  };

  function stop() {
    if (worker) worker.terminate();
    worker = null;
  }

  function start() {
    if (worker !== null) return worker;
    try {
      worker = typeof source === 'function' ? source() : new Worker(source, { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data && e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        clearTimeout(p.timer);
        if (e.data.ok) return p.resolve(e.data.result);
        const err = new Error(e.data.error);
        if (onError) onError(err);
        p.reject(err);
      };
      worker.onerror = (e) => {
        failAll((e && e.message) || 'The puzzle engine stopped unexpectedly.');
        stop();
      };
    } catch (e) {
      worker = false;
    }
    return worker;
  }

  async function call(op, args, { timeoutMs: limit = timeoutMs } = {}) {
    const w = start();
    if (!w) {
      if (!fallback) throw new Error('This browser cannot run the puzzle engine in the background.');
      if (!local) local = await fallback();
      if (!Object.hasOwn(local, op)) throw new Error(`Unknown request "${op}".`);
      return local[op](args);
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const entry = { resolve, reject, timer: null };
      if (limit > 0) {
        entry.timer = setTimeout(() => {
          pending.delete(id);
          // The worker is busy with this request; start over so later calls are not stuck behind it.
          failAll('The puzzle engine was restarted.');
          stop();
          reject(new Error('The puzzle engine took too long.'));
        }, limit);
      }
      pending.set(id, entry);
      w.postMessage({ id, op, args });
    });
  }

  return {
    call,
    // Stop the worker now (it starts again on the next call).
    terminate() { failAll('The puzzle engine was stopped.'); stop(); },
    get busy() { return pending.size > 0; },
  };
}
