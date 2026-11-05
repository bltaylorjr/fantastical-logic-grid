// Server mode (docs/PUZZLE-SERVER.md): every game's engine is on the private
// puzzle server, reached through the game's Worker. The build copies this file
// over engine-links.js when FLG_PUZZLE_SERVER=1, so every game keeps the same
// gameLink(id).call(op, args) it uses with the background workers, and a new
// game in engine/games.js works here with no changes.
import { CLOUD_URL } from './cloud-config.js';
import { report } from './errors.js';
import { ENGINE_GAMES, OP_KINDS } from '../engine/games.js';

const WORDS = {
  offline: 'Making a new puzzle needs an internet connection. Your saved puzzles still play offline.',
  busy: 'Lots of puzzles are being made right now. Please try again in a minute.',
  down: 'The puzzle maker is taking a short break. Please try again in a few minutes.',
};

async function remote(game, op, args, timeoutMs) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(WORDS.offline);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${CLOUD_URL}/v1/puzzles/${game}/${op}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }), signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(ctl.signal.aborted ? WORDS.down : WORDS.offline);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data.result;
  if (res.status === 429) throw new Error(WORDS.busy);
  // A puzzle the engine cannot build (for example, a wizard entry with a
  // problem) comes back with the engine's own words.
  if (res.status === 422 && data.message) throw new Error(data.message);
  report(new Error(`puzzle server ${game}/${op} ${res.status} ${data.error || ''}`), 'engine');
  throw new Error(WORDS.down);
}

// The lane (engine-links.js: 'ahead' builds the next puzzle in the background)
// makes no difference here: the puzzle server runs requests side by side.
const links = new Map();
export function gameLink(id, lane = 'main') {
  const game = Object.hasOwn(ENGINE_GAMES, id) ? ENGINE_GAMES[id] : null;
  if (!game) throw new Error(`No engine for game "${id}"`);
  if (!links.has(id)) {
    links.set(id, {
      call(op, args, { timeoutMs } = {}) {
        if (!Object.hasOwn(game.kinds, op)) return Promise.reject(new Error(`Unknown request "${op}".`));
        return remote(id, op, args, timeoutMs || OP_KINDS[game.kinds[op]].timeoutMs);
      },
      terminate() {},
      get busy() { return false; },
    });
  }
  return links.get(id);
}
