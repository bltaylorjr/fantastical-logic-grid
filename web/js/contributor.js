// The signed-in player's Contributor badge (server/src/contributors.js): how
// many of their ideas, problem reports and suggested characters the team has
// used, and the badge that earns (Bronze, Silver, Gold or Platinum). Kept on
// this device so My stats can show it offline.
import { CLOUD, cloudEnabled } from './cloud-config.js';
import * as account from './account.js';
import * as store from './store.js';

const KEY = 'contributor';
const EVERY_MS = 30 * 60_000;
const listeners = new Set();
let info = null;

export const TIER_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Platinum'];

function load() {
  const user = account.current();
  const saved = store.getLocal(KEY);
  info = user && saved && saved.uid === user.uid ? saved : null;
}
const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { /* ignore */ } } };

// { enabled, count, waiting, tier, nextAt } or null when signed out or unknown.
export const current = () => info;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function refresh() {
  const user = account.current();
  if (!cloudEnabled() || !user || !CLOUD.syncUrl) return;
  try {
    const res = await fetch(`${CLOUD.syncUrl.replace(/\/$/, '')}/v1/contributor`, { headers: { Authorization: `Bearer ${await account.getIdToken()}` } });
    if (!res.ok) return;
    const b = await res.json();
    const next = { uid: user.uid, enabled: !!b.enabled, count: Number(b.count) || 0, waiting: Number(b.waiting) || 0, tier: Number(b.tier) || 0, nextAt: b.nextAt ?? null };
    if (JSON.stringify(next) === JSON.stringify(info)) return;
    info = next;
    store.setLocal(KEY, next);
    emit();
  } catch (e) { /* offline: keep the last copy */ }
}

// A few plain sentences for My stats.
export function describe(c) {
  if (!c || !c.enabled) return '';
  const used = `${c.count} of your ideas and suggestions ${c.count === 1 ? 'has' : 'have'} been used by the team`;
  const more = c.nextAt ? ` ${c.nextAt - c.count} more for the ${TIER_NAMES[c.tier + 1]} badge.` : ' That is the top badge. Thank you!';
  const waiting = c.waiting ? ` ${c.waiting} more ${c.waiting === 1 ? 'is' : 'are'} waiting for the team to look at.` : '';
  if (!c.count && !c.waiting) return 'Send an idea, report a problem or suggest a character while signed in, and tick "Count this toward my Contributor badge". When the team uses it, it counts toward your badge.';
  return `${used}.${more}${waiting}`;
}

export function init() {
  load();
  account.onChange(() => { load(); emit(); refresh(); });
  refresh();
  setInterval(refresh, EVERY_MS);
  addEventListener('online', refresh);
}
