// NINETIMESNINE's shared learning: the one thing the NINETIMESNINE screen shares
// with the rest of the game. Anonymous summaries of finished NINETIMESNINE
// puzzles go to the game's service (POST /v1/learn/np/plays), and what
// everyone's games taught comes back (GET /v1/learn/np/tuning). Nothing
// personal is sent: no name, saves or device id. It runs while the player keeps
// "Learn from how I play" on and the admin dashboard has learning on for
// everyone and for NINETIMESNINE, and never without CLOUD_URL.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';
import { feature, numberPlace } from './remote-config.js';

const OUTBOX = 'npOutbox';
const SHARED = 'npShared';
const TUNING_EVERY_MS = 6 * 3600 * 1000;
let timer = null;

const on = () => !!CLOUD_URL && feature('learning') && numberPlace().learning !== false && store.loadSettings().learn;

function platform() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return 'desktop';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua) && window.NativeBridge) return 'android';
  if (/iPhone|iPad/i.test(ua) && window.webkit?.messageHandlers) return 'ios';
  return 'web';
}

// A module play record, as the service takes it.
export function toPlay(rec) {
  return {
    platform: platform(), level: rec.d, size: rec.size, variants: rec.variants || [], mode: rec.mode, outcome: rec.outcome, feel: rec.feel,
    minutes: Math.round(rec.ms / 6000) / 10, hints: rec.hints, mistakes: rec.mistakes, checks: rec.checks,
    tuned: rec.tuned, score: rec.toughness, stuck: rec.stuck, pid: rec.pid, version: CLOUD.appVersion || null,
  };
}

// Each record waits in an outbox until it is sent; a rating sent later
// replaces the waiting copy (the service updates the same game by its pid).
export function record(rec) {
  if (!on() || !rec?.pid) return;
  const box = (store.getLocal(OUTBOX) || []).filter((p) => p.pid !== rec.pid);
  box.push(toPlay(rec));
  store.setLocal(OUTBOX, box.slice(-200));
  clearTimeout(timer);
  timer = setTimeout(flush, 4000);
}

export async function flush() {
  if (!on()) return;
  const box = store.getLocal(OUTBOX) || [];
  if (!box.length) return;
  const batch = box.slice(0, 50);
  try {
    const res = await fetch(`${CLOUD_URL}/v1/learn/np/plays`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plays: batch }) });
    if (!res.ok) return;
    // Keep a record rated while this was sending: it goes next time.
    const sent = new Set(batch.map((p) => JSON.stringify(p)));
    store.setLocal(OUTBOX, (store.getLocal(OUTBOX) || []).filter((p) => !sent.has(JSON.stringify(p))));
  } catch (e) { /* offline: try again later */ }
}

// What everyone's NINETIMESNINE games taught, kept on this device.
export const shared = () => store.getLocal(SHARED) || null;

export async function refresh(force = false) {
  if (!on()) return shared();
  const s = shared();
  if (!force && s && Date.now() - s.fetchedAt < TUNING_EVERY_MS) return s;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/learn/np/tuning`);
    if (res.ok) {
      const next = { ...(await res.json()), fetchedAt: Date.now() };
      store.setLocal(SHARED, next);
      return next;
    }
  } catch (e) { /* offline: keep what we have */ }
  return s;
}
