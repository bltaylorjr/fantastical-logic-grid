// The puzzle of the week and special edition puzzles, published by the
// website build (scripts/seo.mjs) next to the daily puzzle: weekly/latest.json,
// weekly/puzzles/<Monday>.json, specials/index.json and specials/<id>.json.
// The same puzzles are emailed to the players who asked (puzzle-mail.js).
// Like the daily puzzle they earn no scoreboard points, since the answers are public.
import * as store from './store.js';
import { siteJson } from './daily.js';

const CACHE_KEY = 'editionCache';

async function cached(key, read) {
  try {
    const v = await read();
    const cache = await store.getMeta(CACHE_KEY, {});
    await store.setMeta(CACHE_KEY, { ...cache, [key]: v });
    return v;
  } catch (e) {
    const cache = await store.getMeta(CACHE_KEY, {}).catch(() => ({}));
    if (cache[key]) return cache[key];
    throw e;
  }
}

// { week, title, themeName, difficultyName, categories, items, opening, weeks }, or null.
export async function weeklyLatest() {
  try {
    return await cached('weekly', async () => {
      const l = await siteJson('weekly/latest.json');
      if (!l || !/^\d{4}-\d{2}-\d{2}$/.test(l.week) || !l.title) throw new Error('No puzzle of the week yet');
      return l;
    });
  } catch (e) { return null; }
}

// [{ id, date, editionTitle, note, title, themeName, difficultyName, categories, items }], newest first.
export async function specials() {
  try {
    return await cached('specials', async () => {
      const b = await siteJson('specials/index.json');
      return Array.isArray(b?.specials) ? b.specials.filter((x) => /^se-[\w-]+$/.test(x.id) && x.title) : [];
    });
  } catch (e) { return []; }
}

// The edition key a save carries: weekly-<Monday> or special-<id>.
export const weeklyKey = (week) => `weekly-${week}`;
export const specialKey = (id) => `special-${id}`;

// The full puzzle for an edition key, with its label for the play screen.
export async function puzzleFor(key) {
  let m = key.match(/^weekly-(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    const b = await siteJson(`weekly/puzzles/${m[1]}.json`);
    if (!b || b.week !== m[1] || !b.puzzle || !b.puzzle.clues) throw new Error('That puzzle of the week could not be read');
    return { puzzle: b.puzzle, label: 'Puzzle of the week' };
  }
  m = key.match(/^special-(se-[\w-]{1,40})$/);
  if (m) {
    const b = await siteJson(`specials/${m[1]}.json`);
    if (!b || b.id !== m[1] || !b.puzzle || !b.puzzle.clues) throw new Error('That special edition could not be read');
    return { puzzle: b.puzzle, label: `Special edition: ${b.title}`, note: b.note };
  }
  throw new Error('Unknown puzzle');
}
