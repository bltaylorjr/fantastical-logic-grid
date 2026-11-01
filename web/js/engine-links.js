// The page's connection to any game's engine (engine/games.js), through the
// shared engine link (engine/engine-link.js): each game runs in its own
// background worker (engine-worker.js, named after the game), starts on first use, restarts after a
// crash, and runs on the page where module workers are not available.
//   const engine = gameLink('np');
//   const puzzle = await engine.call('generate', options);
// In server mode (docs/PUZZLE-SERVER.md) the build swaps this file for
// engine-links-remote.js, which reaches the same operations on the private
// puzzle server, with the same gameLink() for every game.
import { report } from './errors.js';
import { engineLink } from '../engine/engine-link.js';
import { ENGINE_GAMES } from '../engine/games.js';

// lane 'ahead' is a second worker for building the next puzzle in the
// background, so a hint never waits behind it. It has no page fallback:
// building ahead on the page would slow the game, so without workers it fails.
const links = new Map();
export function gameLink(id, lane = 'main') {
  if (!Object.hasOwn(ENGINE_GAMES, id)) throw new Error(`No engine for game "${id}"`);
  const key = `${id}|${lane}`;
  if (!links.has(key)) {
    // The game goes in the worker's name (engine-worker.js explains why).
    const url = new URL('../engine-worker.js', import.meta.url);
    links.set(key, engineLink(() => new Worker(url, { type: 'module', name: id }), lane === 'main' ? {
      fallback: async () => (await import(`../engine/${ENGINE_GAMES[id].ops}`)).OPS,
      onError: (err) => report(err, 'engine'),
    } : {}));
  }
  return links.get(key);
}
