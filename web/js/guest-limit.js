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
// The count is kept on this device by local day. With accounts switched off
// (a build with no cloud settings, or a game portal) there is no limit, since
// there would be no way to sign in. The dashboard can change the number with
// game.guestDailyLimit in the remote config (0 turns the limit off).
import * as account from './account.js';
import * as remote from './remote-config.js';

export const DEFAULT_LIMIT = 3;
const KEY = 'flg.guestPlays';

let hooks = { signedIn: () => false, openAccount: () => {}, confirm: async () => false, onChange: null };
export function init(h) {
  hooks = { ...hooks, ...h };
  account.onChange(() => hooks.onChange?.());
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

export function limit() {
  const v = remote.guestDailyLimit();
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_LIMIT;
}
// Whether the limit applies to this player right now.
export const applies = () => account.enabled() && !hooks.signedIn() && limit() > 0;
export const used = () => read();
export const left = () => (applies() ? Math.max(0, limit() - read()) : Infinity);

// Before a new puzzle: true to go ahead; false (after offering sign-in) when
// today's guest puzzles are used up. Call started() once the puzzle opens.
export async function allowNew() {
  if (!applies() || read() < limit()) return true;
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
export function started() { if (applies()) { write(read() + 1); hooks.onChange?.(); } }

// A short line for a game's setup screen, or '' when there is no limit.
export function note() {
  if (!applies()) return '';
  const l = left(), n = limit();
  return l > 0
    ? `Guest: ${l} of ${n} new puzzle${n === 1 ? '' : 's'} left today. A free account gives you unlimited puzzles.`
    : `You've played today's ${n} guest puzzle${n === 1 ? '' : 's'}. Sign in or create a free account for more.`;
}
