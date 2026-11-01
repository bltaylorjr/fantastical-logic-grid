// Every game's engine, in one list. The page's background workers and on-page
// fallback (web/engine-worker.js, web/js/engine-links.js), the private puzzle
// server (puzzle-server/), the Worker route that reaches it
// (server/src/puzzles.js) and its rate limits all read this list, so every
// game has the same abilities wherever its engine runs, and a new game needs
// no changes in any of them.
//
// To add a game (docs/PUZZLE-SERVER.md, "Adding a game"):
//   1. Write engine/src/<id>-ops.js exporting OPS: { name: (args) => result },
//      one entry per thing the game asks its engine for. Use plain JSON in
//      and out (it may cross a worker or the network).
//   2. Add it below with each operation's kind:
//        'build' - makes a new puzzle (may take a while; puzzle rate limit)
//        'play'  - during play: hints, moves, checks (should answer quickly)
//   3. On the page: const engine = gameLink('<id>'); await engine.call('generate', options).
// In server mode the game's engine files stay on the puzzle server
// automatically: the site ships only the files scripts/build.mjs lists as
// needed on the page (PAGE_FILES).
//
// Data only: no imports, so the page and the Worker can load it cheaply.
export const ENGINE_GAMES = {
  flg: {
    name: 'The Fantastical Logic Grid',
    ops: 'flg-ops.js',
    kinds: { generate: 'build', hint: 'play' },
  },
  np: {
    name: 'NINETIMESNINE',
    ops: 'np-ops.js',
    kinds: { generate: 'build', hint: 'play', move: 'play', tide: 'play', ebb: 'play', check: 'play' },
  },
};

// How long each kind may take, and how big a request may be.
export const OP_KINDS = {
  build: { timeoutMs: 180000, serverMs: 170000, maxBytes: 64_000 },
  play: { timeoutMs: 30000, serverMs: 25000, maxBytes: 512_000 },
};

export const opKind = (game, op) => {
  const g = Object.hasOwn(ENGINE_GAMES, game) ? ENGINE_GAMES[game] : null;
  return g && Object.hasOwn(g.kinds, op) ? g.kinds[op] : null;
};
