// Shared engine host: the worker side of every game's engine.
//
// Each game's worker is a few lines:
//
//   import { serveEngine } from './engine/engine-host.js';
//   import { generatePuzzle, getHint } from './engine/index.js';
//   serveEngine({
//     generate: (args) => generatePuzzle(args),
//     hint: (args) => getHint(args.puzzle, args.marks),
//   });
//
// The page talks to it with engineLink() (engine-link.js). Requests are
// { id, op, args }; replies are { id, ok, result } or { id, ok: false, error }.
// Every host also answers two built-in requests: `ops` (the list of
// operations, so a page can check what a worker supports) and `ping`.
// An operation may return a value or a promise.

export function serveEngine(ops, scope = globalThis) {
  const table = { ...ops };
  const builtIn = {
    ops: () => Object.keys(table),
    ping: () => 'pong',
  };
  scope.onmessage = async (e) => {
    // A worker only hears its own page; a message from anywhere else is ignored.
    if (e.origin && scope.location && e.origin !== scope.location.origin) return;
    const { id, op, args } = e.data || {};
    try {
      const fn = Object.hasOwn(table, op) ? table[op] : Object.hasOwn(builtIn, op) ? builtIn[op] : null;
      if (!fn) throw new Error(`Unknown request "${op}".`);
      const result = await fn(args || {});
      scope.postMessage({ id, ok: true, result });
    } catch (err) {
      scope.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
  };
  return table;
}
