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

const links = new Map();
export function gameLink(id) {
  if (!Object.hasOwn(ENGINE_GAMES, id)) throw new Error(`No engine for game "${id}"`);
  if (!links.has(id)) {
    // The game goes in the worker's name (engine-worker.js explains why).
    const url = new URL('../engine-worker.js', import.meta.url);
    links.set(id, engineLink(() => new Worker(url, { type: 'module', name: id }), {
      fallback: async () => (await import(`../engine/${ENGINE_GAMES[id].ops}`)).OPS,
      onError: (err) => report(err, 'engine'),
    }));
  }
  return links.get(id);
}
