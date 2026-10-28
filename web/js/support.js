// Gentle asks to support the game (the Supporter plan). A thank-you on the
// solved panel after the 3rd, 10th and 25th solved puzzle, a note at a 7- and
// 30-day daily streak, the Supporters window, and a line on printed puzzles.
// All of it shows only when the admin turns on Support asks in the game and
// the Support the game link (remote-config.js supportAsks).
//
// Fair play: at most one ask a week, never during a puzzle or a race, never
// after a revealed solution, and "Don't ask again" stops them for good on this
// device. Kept on this device only: when the last ask showed, which ones have
// had their turn, and Don't ask again.
import * as remote from './remote-config.js';
import * as store from './store.js';

const KEY = 'supportAsk';
const WEEK_MS = 7 * 24 * 3600 * 1000;
export const SOLVE_MARKS = [3, 10, 25];
export const STREAK_MARKS = [7, 30];

export const TEXT = {
  solve: 'Nicely solved! The Fantastical Logic Grid is free, has no ads, and is made by one person. If you enjoy it, you can help keep it going.',
  streak: (days) => `${days} days in a row! Thanks for playing every day. Supporters keep the daily puzzle coming.`,
  page: 'Every puzzle here is free and always will be. Running the game costs about $100 a month for the tools and the website. Supporters cover that, and get a ★ badge and extra themes as a thank-you.',
  print: 'The Fantastical Logic Grid is free, has no ads, and is made by one person. You can support it at thelogicgrid.com.',
};

const load = () => ({ last: 0, never: false, solves: [], streaks: [], ...(store.getLocal(KEY) || {}) });
const save = (s) => { try { store.setLocal(KEY, s); } catch (e) { /* private window */ } };

export const on = () => remote.supportAsks();
export const url = () => remote.supportUrl();
export const printLine = () => (on() ? TEXT.print : '');

// Which ask, if any, to show for a puzzle just solved. solvedCount counts
// puzzles solved without revealing the answer, this one included; streak is
// the daily streak this solve reached (0 when it is not a daily puzzle).
// Every mark reached is used up here even when the weekly limit holds it
// back, so a skipped ask never turns up later at an odd moment.
export function pick({ solvedCount = 0, streak = 0, revealed = false, race = false }, now = Date.now()) {
  if (!on() || revealed || race) return null;
  const s = load();
  if (s.never) return null;
  const streakMark = STREAK_MARKS.filter((d) => streak >= d && !s.streaks.includes(d)).pop();
  const solveMarks = SOLVE_MARKS.filter((n) => solvedCount >= n && !s.solves.includes(n));
  if (!streakMark && !solveMarks.length) return null;
  if (streakMark) s.streaks = [...new Set([...s.streaks, ...STREAK_MARKS.filter((d) => d <= streakMark)])];
  s.solves = [...new Set([...s.solves, ...solveMarks])];
  const allowed = now - (s.last || 0) >= WEEK_MS;
  if (allowed) s.last = now;
  save(s);
  if (!allowed) return null;
  return streakMark ? { kind: 'streak', days: streakMark, text: TEXT.streak(streakMark) } : { kind: 'solve', text: TEXT.solve };
}

export function neverAgain() { save({ ...load(), never: true }); }
