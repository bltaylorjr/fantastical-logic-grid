// Shared learning for Cage Math, Sum Cross and Picture Grid: the one thing
// their screens share with the rest of the app. Anonymous summaries of
// finished puzzles go to the learning service (POST /v1/learn/<game>/plays,
// game cm, sc or pg) and what everyone's games taught comes back
// (GET /v1/learn/<game>/tuning). Nothing personal is sent: no name, saves or
// device id. It runs while the player keeps "Learn from how I play" on and the
// admin dashboard has learning on for everyone and for that game, and never
// without CLOUD_URL. The same shape as NINETIMESNINE's (np-share.js).
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';
import { feature, kitGame } from './remote-config.js';

const GAMES = new Set(['cm', 'sc', 'pg']);
const TUNING_EVERY_MS = 6 * 3600 * 1000;
const timers = {};

const on = (game) => GAMES.has(game) && !!CLOUD_URL && feature('learning') && kitGame(game).learning !== false && store.loadSettings().learn;

function platform() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return 'desktop';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua) && window.NativeBridge) return 'android';
  if (/iPhone|iPad/i.test(ua) && window.webkit?.messageHandlers) return 'ios';
  return 'web';
}

// A play record as the service takes it. `game` goes with every record.
export function toPlay(game, rec) {
  return {
    game, platform: platform(), level: rec.d, size: rec.size, mode: rec.mode, outcome: rec.outcome, feel: rec.feel,
    minutes: Math.round(rec.ms / 6000) / 10, hints: rec.hints, mistakes: rec.mistakes, checks: rec.checks,
    tuned: rec.tuned, score: rec.toughness, stuck: rec.stuck, pid: rec.pid, version: CLOUD.appVersion || null,
  };
}

export function record(game, rec) {
  if (!on(game) || !rec?.pid) return;
  const key = `${game}Outbox`;
  const box = (store.getLocal(key) || []).filter((p) => p.pid !== rec.pid);
  box.push(toPlay(game, rec));
  store.setLocal(key, box.slice(-200));
  clearTimeout(timers[game]);
  timers[game] = setTimeout(() => flush(game), 4000);
}

export async function flush(game) {
  if (!on(game)) return;
  const key = `${game}Outbox`;
  const box = store.getLocal(key) || [];
  if (!box.length) return;
  const batch = box.slice(0, 50);
  try {
    const res = await fetch(`${CLOUD_URL}/v1/learn/${game}/plays`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plays: batch }) });
    if (!res.ok) return;
    const sent = new Set(batch.map((p) => JSON.stringify(p)));
    store.setLocal(key, (store.getLocal(key) || []).filter((p) => !sent.has(JSON.stringify(p))));
  } catch (e) { /* offline: try again later */ }
}

export const shared = (game) => store.getLocal(`${game}Shared`) || null;

export async function refresh(game, force = false) {
  if (!on(game)) return shared(game);
  const s = shared(game);
  if (!force && s && Date.now() - s.fetchedAt < TUNING_EVERY_MS) return s;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/learn/${game}/tuning`);
    if (res.ok) {
      const next = { ...(await res.json()), fetchedAt: Date.now() };
      store.setLocal(`${game}Shared`, next);
      return next;
    }
  } catch (e) { /* offline: keep what we have */ }
  return s;
}
