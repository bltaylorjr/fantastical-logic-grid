// The signed-in player's special badges (server/src/special-badges.js): ones
// the team gives by hand, like Tester or Contributor, and ones earned
// automatically at a milestone the team sets. Kept on this device, so My stats
// and badges shows them offline. The game's own badges are in stats.js.
import { CLOUD, cloudEnabled } from './cloud-config.js';
import * as account from './account.js';
import * as store from './store.js';
import { whileVisible } from './pace.js';

const KEY = 'specialBadges';
const SEEN_KEY = 'specialBadgesSeen';
const EVERY_MS = 15 * 60_000;
const listeners = new Set();
let mine = null; // { uid, badges: [{ id, name, icon, description, at }], goals: [...] }

function load() {
  const user = account.current();
  const saved = store.getLocal(KEY);
  mine = user && saved && saved.uid === user.uid ? saved : null;
}
const emit = (fresh) => { for (const fn of listeners) { try { fn(fresh); } catch (e) { /* ignore */ } } };

export const earned = () => (mine ? mine.badges : []);
export const goals = () => (mine ? mine.goals : []);
// fn(fresh): fresh lists badges this player has not been told about yet.
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function refresh() {
  const user = account.current();
  if (!cloudEnabled() || !user || !CLOUD.syncUrl) return;
  try {
    const res = await fetch(`${CLOUD.syncUrl.replace(/\/$/, '')}/v1/badges`, { headers: { Authorization: `Bearer ${await account.getIdToken()}` } });
    if (!res.ok) return;
    const body = await res.json();
    const clean = (b) => ({ id: Number(b.id), name: String(b.name || ''), icon: String(b.icon || ''), description: String(b.description || '') });
    const next = {
      uid: user.uid,
      badges: (Array.isArray(body.badges) ? body.badges : []).map((b) => ({ ...clean(b), at: Number(b.at) || null })),
      goals: (Array.isArray(body.goals) ? body.goals : []).map((b) => ({ ...clean(b), how: String(b.how || ''), have: Number(b.have) || 0, need: Number(b.need) || 0 })),
    };
    // The first check on a device only remembers what is there; later ones
    // tell the player about badges that are new.
    const seenAll = store.getLocal(SEEN_KEY) || {};
    const seen = seenAll[user.uid];
    const fresh = seen ? next.badges.filter((b) => !seen.includes(b.id)) : [];
    store.setLocal(SEEN_KEY, { ...seenAll, [user.uid]: next.badges.map((b) => b.id) });
    if (JSON.stringify(next) === JSON.stringify(mine) && !fresh.length) return;
    mine = next;
    store.setLocal(KEY, next);
    emit(fresh);
  } catch (e) { /* offline: keep the last copy */ }
}

export function init() {
  load();
  account.onChange(() => { load(); emit([]); refresh(); });
  refresh();
  whileVisible(refresh, EVERY_MS);
  addEventListener('online', refresh);
}
