// Server mode (docs/PUZZLE-SERVER.md): puzzles and hints come from the private
// puzzle server, through the game's Worker, instead of an engine on the page.
// The build copies this file over engine-client.js when FLG_PUZZLE_SERVER=1,
// so it keeps the same two exports.
import { CLOUD_URL } from './cloud-config.js';
import { report } from './errors.js';

const WORDS = {
  offline: 'Making a new puzzle needs an internet connection. Your saved puzzles still play offline.',
  busy: 'Lots of puzzles are being made right now. Please try again in a minute.',
  down: 'The puzzle maker is taking a short break. Please try again in a few minutes.',
};

async function call(path, body, { timeoutMs }) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(WORDS.offline);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${CLOUD_URL}/v1/puzzles/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
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
  const err = new Error(WORDS.down);
  report(new Error(`puzzle server ${res.status} ${data.error || ''}`), 'engine');
  throw err;
}

// The hardest tiers can take a while to build, so generating waits longer.
export const generate = (options) => call('generate', { options }, { timeoutMs: 180000 });
export const hint = (puzzle, marks) => call('hint', { puzzle, marks }, { timeoutMs: 30000 });
