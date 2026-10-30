// Signs a signed-in player out after a while with no activity (no tap, click,
// key, scroll or mouse movement, and no video or voice playing), so an account
// left open on a shared or lost device does not stay open. The time comes from
// the admin dashboard (remote-config idleMinutes, 30 by default, 0 = never).
//
// The last activity time is kept on the device (localStorage flg.lastActive),
// so it counts across tabs and while the game is closed: opening the game
// again after the time has passed signs the player out straight away.
// account-ui.js decides what happens: a warning WARN_MS before (or halfway,
// for a very short time), then saving,
// syncing and signing out (or locking, with fingerprint or face sign-in on).
import * as account from './account.js';
import * as store from './store.js';
import { idleMinutes } from './remote-config.js';

const KEY = 'lastActive';
export const WARN_MS = 2 * 60_000;
const CHECK_MS = 5_000;
const WRITE_MS = 15_000;
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

let hooks = { onWarn: () => {}, onIdle: () => {} };
let last = 0;
let written = 0;
let warning = false;
let firing = false;

const limitMs = () => idleMinutes() * 60_000;
export const minutes = () => idleMinutes();

function stored() { return Number(store.getLocal(KEY)) || 0; }
const lastActive = () => Math.max(last, stored());

// Something happened: the player is here. While the warning shows, only its
// buttons count (account-ui calls touch()), so a stray mouse nudge does not
// hide it unread.
function activity() {
  if (warning) return;
  touch();
}

export function touch() {
  warning = false;
  const now = Date.now();
  last = now;
  if (now - written > WRITE_MS) { written = now; store.setLocal(KEY, now); }
}

function busyWithMedia() {
  try {
    if (window.speechSynthesis && speechSynthesis.speaking) return true;
    return [...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended);
  } catch (e) { return false; }
}

async function check() {
  if (firing || !account.current()) return;
  const limit = limitMs();
  if (!limit) return;
  if (busyWithMedia()) { touch(); return; }
  const idle = Date.now() - lastActive();
  if (idle >= limit) {
    firing = true;
    warning = false;
    try { await hooks.onIdle(); } finally { firing = false; touch(); }
  } else if (idle >= Math.max(limit - WARN_MS, limit / 2) && !warning) {
    warning = true;
    hooks.onWarn(limit - idle);
  }
}

// Starts watching. A first visit (no time stored yet) counts as activity now.
export function init(h) {
  hooks = { ...hooks, ...h };
  if (!stored()) touch();
  account.onChange((user) => { if (user) touch(); }); // a fresh sign-in starts the clock again
  for (const k of EVENTS) window.addEventListener(k, activity, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, CHECK_MS);
  return check();
}
