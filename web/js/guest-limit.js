// Guest puzzles: a guest (not signed in) gets a few new puzzles a day across
// every game of The Logic Grid, one shared count; after that, starting a new
// one asks them to sign in or create a free account.
//
// Bobby: "require an account after a set amount of guest plays per day to view
// and play more puzzles". 3 a day, all games, one count. Always free: finishing
// saved puzzles, the daily puzzle (and the weekly and special edition puzzles
// from the emails), and How to play. Only new free-play puzzles and races
// against the computer count (races against players need an account already).
//
// The game server counts them (server/src/guest-plays.js), per device and per
// internet connection, so clearing the browser does not give a guest more.
// When the server can't be reached (offline, or the desktop app with no
// connection) the count kept on this device by local day is used instead.
// With accounts switched off (a build with no cloud settings, or a game
// portal) there is no limit, since there would be no way to sign in. The
// dashboard sets the number (Player sign-in > New puzzles a guest can start
// each day; 0 turns the limit off).
import * as account from './account.js';
import * as remote from './remote-config.js';
import { CLOUD, CLOUD_URL } from './cloud-config.js';

export const DEFAULT_LIMIT = 3;
const KEY = 'flg.guestPlays';
const ID_KEY = 'flg.guestId';
const TIMEOUT_MS = 6000;

let hooks = { signedIn: () => false, openAccount: () => {}, confirm: async () => false, onChange: null };
export function init(h) {
  hooks = { ...hooks, ...h };
  account.onChange(() => { hooks.onChange?.(); refresh(); });
  refresh();
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && v.day === today() && Number.isInteger(v.n) && v.n >= 0) return v.n;
  } catch (e) { /* blocked storage: treat as none played */ }
  return 0;
};
const write = (n) => { try { localStorage.setItem(KEY, JSON.stringify({ day: today(), n })); } catch (e) { /* storage blocked */ } };

// The server's last answer today: { day, left, limit }.
let server = null;
const fresh = () => (server && server.day === today() ? server : null);

export function limit() {
  if (fresh()) return fresh().limit;
  const v = remote.guestDailyLimit();
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_LIMIT;
}
// Whether the limit applies to this player right now.
export const applies = () => account.enabled() && !hooks.signedIn() && limit() > 0;
export const used = () => read();
export const left = () => (!applies() ? Infinity : fresh() ? fresh().left : Math.max(0, limit() - read()));

// This device's random id for the server's count (never linked to anything else).
function deviceId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id || '')) {
      id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch (e) { return null; }
}

// Asks the server (take: use one if any are left). null when it can't be reached.
async function ask(take) {
  const base = (CLOUD.syncUrl || CLOUD_URL || '').replace(/\/+$/, '');
  const d = deviceId();
  if (!base || !d) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    // text/plain keeps this a simple request (no CORS preflight).
    const r = await fetch(`${base}/v1/guest-play`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ d, take }), signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const v = await r.json();
    if (!v || typeof v.ok !== 'boolean' || !Number.isInteger(v.limit)) return null;
    server = { day: today(), limit: v.limit, left: v.limit ? Math.max(0, v.left | 0) : Infinity };
    // Keep the device's own count in step, for when the server can't be reached.
    if (v.limit) write(Math.max(read(), v.limit - server.left));
    return v;
  } catch (e) { return null; }
}

// Today's count from the server, for the setup screens' line (guests only).
export async function refresh() {
  if (!account.enabled() || hooks.signedIn()) return;
  if (await ask(false)) hooks.onChange?.();
}

// Whether the last go-ahead came from the device's own count (the server was not reached).
let localTake = false;

// Before a new puzzle: true to go ahead; false (after offering sign-in) when
// today's guest puzzles are used up. Call started() once the puzzle opens.
export async function allowNew() {
  localTake = false;
  if (!applies()) return true;
  const r = await ask(true);
  if (r) {
    hooks.onChange?.();
    if (r.ok) return true;
  } else if (read() < limit()) {
    localTake = true;
    return true;
  }
  const n = limit();
  const go = await hooks.confirm({
    title: 'Create a free account to keep playing',
    text: `Guests can start ${n} new puzzle${n === 1 ? '' : 's'} a day, and you've played today's. A free account gives you unlimited puzzles in every game, and keeps your progress on all your devices. Your saved puzzles, the daily puzzle and How to play are always free.`,
    yes: 'Sign in or create an account',
    no: 'Not now',
  });
  if (go) hooks.openAccount({ note: 'Sign in, or create a free account, for unlimited puzzles.' });
  return false;
}
export function started() {
  if (localTake && applies()) write(read() + 1);
  localTake = false;
  hooks.onChange?.();
}

// A short line for a game's setup screen, or '' when there is no limit.
export function note() {
  if (!applies()) return '';
  const l = left(), n = limit();
  return l > 0
    ? `Guest: ${l} of ${n} new puzzle${n === 1 ? '' : 's'} left today. A free account gives you unlimited puzzles.`
    : `You've played today's ${n} guest puzzle${n === 1 ? '' : 's'}. Sign in or create a free account for more.`;
}
