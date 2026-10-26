// Everyone's numbers for a daily puzzle (server/src/daily-results.js): how
// many played, how many solved and the typical time. Only counts are sent:
// that a daily puzzle was opened, and the solve time (or that it was revealed).
import { CLOUD_URL } from './cloud-config.js';
import * as remote from './remote-config.js';

export const available = () => !!CLOUD_URL && remote.feature('dailyResults');

function post(date, what, body = {}) {
  if (!available()) return;
  try { fetch(`${CLOUD_URL}/v1/daily/${date}/${what}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch (e) { /* offline */ }
}
export const started = (date) => post(date, 'start');
export const finished = (date, elapsedMs, revealed) => post(date, 'result', { elapsedMs: Math.max(5000, Math.round(elapsedMs)), revealed: !!revealed });

export async function statsFor(date) {
  if (!available()) return null;
  try {
    const r = await fetch(`${CLOUD_URL}/v1/daily/${date}/stats`);
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

const minutes = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? '' : 's'}`; };
const players = (n) => `${n} player${n === 1 ? '' : 's'}`;

// The home card's line, e.g. "128 players today · 62% solved · typical time about 7 minutes".
export function summaryLine(s) {
  if (!s) return '';
  if (!s.started) return 'Be one of the first to solve today’s puzzle.';
  return [`${players(s.started)} so far`, `${s.solvedPct}% solved`, s.medianMs ? `typical time about ${minutes(s.medianMs)}` : ''].filter(Boolean).join(' · ');
}

// Share of other solvers this time was quicker than (0 to 100), or null.
export function quickerThan(s, ms) {
  if (!s || s.solved < 2) return null;
  const mine = Math.floor(ms / 60000);
  let slower = 0;
  for (const [m, n] of s.minutes) if (m > mine) slower += n;
  return Math.round((slower / Math.max(1, s.solved - 1)) * 100);
}
