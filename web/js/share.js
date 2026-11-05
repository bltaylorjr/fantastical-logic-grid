// Shared learning: sends anonymous summaries of finished puzzles to the
// game's service and brings back what everyone's games taught (see learn.js).
// Nothing personal is sent: no name, saves or device id. A problem puzzle
// (given up on, rated low, or outside its level's normal limits) also sends
// the puzzle itself, never a player's own story. It runs
// while the player keeps "Learn from how I play" on and the admin dashboard
// has "Learn from everyone" on, and never without CLOUD_URL.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as learn from './learn.js';
import * as store from './store.js';
import { feature } from './remote-config.js';

const TUNING_EVERY_MS = 6 * 3600 * 1000;
const SETTLE_MS = 10 * 60 * 1000; // wait for a rating before sending a finished puzzle
let timer = null;
let notice = () => {};

export const available = () => !!CLOUD_URL;
const on = () => { const s = store.loadSettings(); return available() && feature('learning') && s.learn; };

function platform() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return 'desktop';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua) && window.NativeBridge) return 'android';
  if (/iPhone|iPad/i.test(ua) && window.webkit?.messageHandlers) return 'ios';
  return 'web';
}

async function post(path, body) {
  const res = await fetch(`${CLOUD_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function flush() {
  if (!on()) return;
  const L = await learn.getState();
  const now = Date.now();
  const ready = L.plays.filter((p) => !p.sent && p.outcome !== 'playing' && (p.rating || p.feel || p.outcome === 'abandoned' || now - p.at > SETTLE_MS));
  if (!ready.length) return;
  const settings = store.loadSettings();
  if (!settings.shareNoticeShown) {
    settings.shareNoticeShown = true;
    store.saveSettings(settings);
    notice();
  }
  const plays = ready.slice(0, 50).map((p) => ({
    platform: platform(), tier: p.tier, theme: p.theme, size: `${p.K}x${p.N}`, clueTypes: p.clueTypes, effort: p.effort,
    signal: learn.signal(p), outcome: p.outcome, rating: p.rating, feel: p.feel, parts: p.parts,
    minutes: Math.round(p.ms / 6000) / 10, hints: p.hints, mistakes: p.mistakes,
    pid: p.pid, topic: p.topic, story: p.story, chars: p.chars, version: CLOUD.appVersion || null, mode: p.mode, whatif: p.whatif,
    puzzleId: p.puzzleId || null, expected: p.expectedMs ? Math.round(p.expectedMs / 6000) / 10 : null, clues: p.clueCount ?? null, score: p.score ?? null,
  }));
  try {
    await post('/v1/learn/plays', { plays });
    await learn.markSent(ready.slice(0, 50).map((p) => p.storyId));
  } catch (e) { return; /* try again later */ }
  // A problem puzzle (learn.js isProblem) also goes to the team's Puzzle
  // quality page, one at a time and a few per round. Nothing personal.
  for (const p of ready.filter((x) => x.puzzle && !x.puzzleSent).slice(0, 3)) {
    try {
      await post('/v1/learn/problem', { pid: p.pid, puzzle: p.puzzle });
      await learn.puzzleSent(p.storyId);
    } catch (e) {
      // Refused (not the game's own puzzle, or too big): drop it. Offline: later.
      if (/^4\d\d$/.test(e.message)) await learn.puzzleSent(p.storyId);
      break;
    }
  }
}

// Puzzles the team fixed and republished (Puzzle quality page), for the
// Hand-picked list. Empty when offline or switched off.
export async function fixedPuzzles() {
  if (!available()) return [];
  try {
    const res = await fetch(`${CLOUD_URL}/v1/learn/fixed`);
    if (!res.ok) return [];
    const body = await res.json();
    return (Array.isArray(body.puzzles) ? body.puzzles : []).filter((x) => x && x.id && x.puzzle && x.puzzle.clues && x.puzzle.solution);
  } catch (e) { return []; }
}

export async function refresh(force = false) {
  if (!on()) return;
  const L = await learn.getState();
  if (!force && L.shared && Date.now() - L.shared.fetchedAt < TUNING_EVERY_MS) return;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/learn/tuning`);
    if (res.ok) await learn.setShared(await res.json());
  } catch (e) { /* offline: keep what we have */ }
}

export function soon() {
  clearTimeout(timer);
  timer = setTimeout(flush, 4000);
}

export function init({ onNotice } = {}) {
  if (onNotice) notice = onNotice;
  window.share = { soon };
  if (!available()) return;
  setTimeout(() => { refresh(); flush(); }, 3000);
  setInterval(flush, SETTLE_MS);
  addEventListener('online', () => { refresh(); flush(); });
}
