// Story themes and story moments on the kit's game screen.
//
// THEME_GROUPS is the main game's theme list (engine/src/themes.js: ids, names
// and groups), copied here so the page does not need the engine's theme data
// (on the puzzle server the engine stays off the page). The test
// engine/test/kit-games-tests.js checks it still matches themes.js.
// The story words themselves are in engine/src/kit-story-words.js.
export const THEME_GROUPS = [
  { id: 'mystery', name: 'Mystery & Action', themes: [['mystery', 'Mystery'], ['action', 'Action'], ['adventure', 'Adventure']] },
  { id: 'imagination', name: 'Imagination', themes: [['fantasy', 'Fantasy'], ['scifi', 'Sci-Fi'], ['paradox', 'Surreal Paradox']] },
  { id: 'science', name: 'Science & Learning', themes: [['science', 'Science'], ['math', 'Math'], ['biology', 'Biology'], ['astronomy', 'Astronomy']] },
  { id: 'fun', name: 'Celebrations & Fun', themes: [['holiday', 'Holiday'], ['occasion', 'Parties & Milestones'], ['music', 'Music'], ['sports', 'Sports']] },
  { id: 'places', name: 'Places & Everyday Life', themes: [['town', 'Around Town'], ['parks', 'National Parks'], ['travel', 'Vacation Destinations'], ['wonders', 'Architectural Wonders'], ['nautical', 'Nautical'], ['farm', 'Farm Life'], ['pets', 'Pets & Animals'], ['cooking', 'Cooking'], ['seasons', 'Seasons']] },
].map((g) => ({ ...g, themes: g.themes.map(([id, name]) => ({ id, name })) }));
export const THEME_IDS = THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.id));
export const themeName = (id) => THEME_GROUPS.flatMap((g) => g.themes).find((t) => t.id === id)?.name || null;

// The same theme for everyone on a given day, so daily puzzles stay shared.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const themeForDay = (date) => THEME_IDS[hash(`kit-theme:${date}`) % THEME_IDS.length];

// Story moments show as progress passes these points (a third, two thirds,
// just before the end). One moment per point, never more than once.
export const BEAT_AT = [1 / 3, 2 / 3, 0.9];
export const beatsReached = (fraction) => BEAT_AT.filter((t) => fraction >= t - 1e-9).length;

// A saved or opened puzzle's story, checked field by field (each game's cleanPuzzle).
export function cleanStory(s) {
  if (!s || typeof s !== 'object') return null;
  const str = (x, n = 400) => String(x ?? '').slice(0, n);
  return {
    id: str(s.id, 80), title: str(s.title, 80), intro: str(s.intro), ending: str(s.ending),
    theme: THEME_IDS.includes(s.theme) ? s.theme : null,
    beats: Array.isArray(s.beats) ? s.beats.slice(0, BEAT_AT.length).map((b) => str(b, 200)).filter(Boolean) : [],
  };
}
