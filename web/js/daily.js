// The daily puzzle: one new puzzle a day, the same for everyone, published by
// the website build (scripts/seo.mjs) as daily/latest.json and
// daily/puzzles/<date>.json. Days run on US Eastern time, like the website:
// a new puzzle comes out at midnight Eastern.
//
// Streaks: a day counts when its daily puzzle is solved (not revealed) within
// 48 hours of the day starting, so every time zone gets a fair chance. The
// streak lives in the solve log (stats.js), which syncs with an account.
import { CLOUD } from './cloud-config.js';
import * as store from './store.js';

const CACHE_KEY = 'dailyCache';
export const STREAK_GRACE_MS = 48 * 3600 * 1000;

const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const EASTERN = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
// Today's daily puzzle date (US Eastern).
export const puzzleDay = (t = Date.now()) => EASTERN.format(new Date(t));
// When a puzzle day starts: midnight Eastern (04:00 or 05:00 UTC).
export const dayStart = (d) => { const est = Date.parse(`${d}T05:00:00Z`); return puzzleDay(est - 3600_000) === d ? est - 3600_000 : est; };
export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return isoDay(x.getTime()); };
export const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

// The website build marks its game page (meta flg-daily), so there the files
// come from the same site. Elsewhere (the desktop app, other hosts) they come
// from the public website. A local test copy without the files has none.
function bases() {
  const out = [];
  const meta = document.querySelector('meta[name="flg-daily"]');
  if (meta) out.push(new URL(meta.content || 'daily/', document.baseURI).href);
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const site = (CLOUD.siteUrl || '').replace(/\/+$/, '');
  if (site && !local && !out.some((b) => b.startsWith(site))) out.push(`${site}/daily/`);
  return out;
}
export const available = () => bases().length > 0;

async function getJson(file) {
  let last;
  for (const b of bases()) {
    try {
      const res = await fetch(b + file, { cache: 'no-cache' });
      if (!res.ok) { last = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (e) { last = e; }
  }
  throw last || new Error('No website to read the daily puzzle from');
}

// Any file of the website next to daily/ (the puzzle of the week, special
// editions: editions.js).
export async function siteJson(path) {
  let last;
  for (const b of bases()) {
    try {
      const res = await fetch(new URL(`../${path}`, b).href, { cache: 'no-cache' });
      if (!res.ok) { last = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (e) { last = e; }
  }
  throw last || new Error('No website to read the puzzle from');
}

// { date, title, themeName, difficultyName, days: [dates, newest first] }.
// Offline, the last one seen is used.
export async function latest() {
  try {
    const l = await getJson('latest.json');
    if (!l || !/^\d{4}-\d{2}-\d{2}$/.test(l.date) || !l.title) throw new Error('The daily puzzle list is not ready');
    const cache = await store.getMeta(CACHE_KEY, {});
    await store.setMeta(CACHE_KEY, { ...cache, latest: l });
    return l;
  } catch (e) {
    const cache = await store.getMeta(CACHE_KEY, {}).catch(() => ({}));
    if (cache.latest) return { ...cache.latest, offline: true };
    throw e;
  }
}

// The Hand-picked collection: [{ date, title, themeName, difficultyName,
// hand | average, rated }]. Empty when the site has none or is out of reach.
export async function picks() {
  try {
    const body = await getJson('picks.json');
    return Array.isArray(body?.picks) ? body.picks.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.title) : [];
  } catch (e) { return []; }
}

// The full puzzle for a day. Kept on this device once read.
export async function puzzleFor(date) {
  const cache = await store.getMeta(CACHE_KEY, {});
  if (cache.puzzles && cache.puzzles[date]) return cache.puzzles[date];
  const body = await getJson(`puzzles/${date}.json`);
  const p = body && body.puzzle;
  if (!p || !p.clues || !p.solution || body.date !== date) throw new Error('That daily puzzle could not be read');
  const fresh = await store.getMeta(CACHE_KEY, {});
  const puzzles = { ...(fresh.puzzles || {}), [date]: p };
  // Keep the last few days only.
  for (const d of Object.keys(puzzles).sort().slice(0, -7)) delete puzzles[d];
  await store.setMeta(CACHE_KEY, { ...fresh, puzzles });
  return p;
}

// Days whose daily puzzle was solved in time, from the solve log.
export function streakDays(solves) {
  const days = new Set();
  for (const s of solves) {
    if (!s.daily || s.revealed) continue;
    // Days before the switch from UTC came out at midnight UTC, so a solve
    // from then on counts; the 48 hours run from midnight Eastern.
    const opened = Date.parse(`${s.daily}T00:00:00Z`);
    if (s.at >= opened && s.at - dayStart(s.daily) <= STREAK_GRACE_MS) days.add(s.daily);
  }
  return days;
}

// { current, best, todayDone }. The current streak still counts while today's
// puzzle is unsolved, as long as yesterday's was solved.
export function streak(solves, today = puzzleDay()) {
  const days = streakDays(solves);
  const sorted = [...days].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) { current++; d = addDays(d, -1); }
  return { current, best, todayDone: days.has(today), days };
}
