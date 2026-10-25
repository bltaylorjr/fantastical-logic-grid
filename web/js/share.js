// Shared learning: sends anonymous summaries of finished puzzles to the
// game's service and brings back what everyone's games taught (see learn.js).
// Nothing personal is sent: no name, saves, story text or device id. It runs
// while the player keeps "Learn from how I play" on and the admin dashboard
// has "Learn from everyone" on, and never without CLOUD_URL.
import { CLOUD_URL } from './cloud-config.js';
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
  }));
  try {
    await post('/v1/learn/plays', { plays });
    await learn.markSent(ready.slice(0, 50).map((p) => p.storyId));
  } catch (e) { /* try again later */ }
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

export async function sharePart(theme, kind, value, source) {
  if (!available()) throw new Error('Sharing is not set up yet.');
  return post('/v1/learn/parts', { theme, kind, value, source });
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
