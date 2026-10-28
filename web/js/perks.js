// The signed-in player's perks (server/src/supporters.js): the Contributor
// badge the team awards (server/src/contributors.js), and supporter perks: a badge
// on the scoreboard (Bronze, Silver, Gold or Platinum), and for premium supporters the themes the admin marks as
// supporter extras. Kept on this device, so the extras stay open offline.
import { CLOUD, cloudEnabled } from './cloud-config.js';
import * as account from './account.js';
import * as store from './store.js';

const KEY = 'perks';
const EVERY_MS = 15 * 60_000;
const listeners = new Set();
let perks = null;

function load() {
  const user = account.current();
  const saved = store.getLocal(KEY);
  perks = user && saved && saved.uid === user.uid ? saved : null;
}
const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { /* ignore */ } } };
const live = (p) => !!p && (p.until == null || p.until > Date.now());

export const isSupporter = () => live(perks) && !!perks.supporter;
export const isPremium = () => live(perks) && !!perks.premium;
// The Contributor badge never ends, so it does not follow the supporter end date.
export const isContributor = () => !!perks && !!perks.contributor;
export const tier = () => (isSupporter() ? perks.tier || 1 : 0);
export const TIER_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Platinum'];
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function refresh() {
  const user = account.current();
  if (!cloudEnabled() || !user || !CLOUD.syncUrl) return;
  try {
    const res = await fetch(`${CLOUD.syncUrl.replace(/\/$/, '')}/v1/perks`, { headers: { Authorization: `Bearer ${await account.getIdToken()}` } });
    if (!res.ok) return;
    const body = await res.json();
    const next = { uid: user.uid, supporter: !!body.supporter, premium: !!body.premium, tier: Number(body.tier) || 0, until: body.until ?? null, contributor: !!body.contributor };
    if (JSON.stringify(next) === JSON.stringify(perks)) return;
    perks = next;
    store.setLocal(KEY, next);
    emit();
  } catch (e) { /* offline: keep the last copy */ }
}

export function init() {
  load();
  account.onChange(() => { load(); emit(); refresh(); });
  refresh();
  setInterval(refresh, EVERY_MS);
  addEventListener('online', refresh);
}
