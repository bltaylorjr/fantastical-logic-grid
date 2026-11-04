// Story themes for the grid-kit games. The player can pick one of the main
// game's themes (themes.js) or "Surprise me", and the puzzle's title, opening,
// ending and story moments then follow that theme. The words live in
// kit-story-words.js.
//
// The story is only a wrapper: it is worked out after the puzzle is made, from
// its own seeded random numbers, so the grid and clues are exactly the same
// with or without it. The same seed and theme always tell the same story.
//
//   kitThemeStory(game, seed, { theme, used, classic, picture })
//     theme   a theme id, 'surprise' (picked from the seed), or nothing for
//             the game's own classic story (classic(), the old behaviour).
//     used    story ids already seen, so free play does not repeat a story.
//   -> { id, title, intro, ending, theme, beats: [early, middle, late] }
import { THEMES, THEME_GROUPS } from './themes.js';
import { makeRng } from './rng.js';
import { GAMES, DEFAULT, THEMES as WORDS } from './kit-story-words.js';

export const KIT_THEME_IDS = THEMES.map((t) => t.id);
// For setup screens: every theme with its name and group.
export const KIT_THEME_CHOICES = THEME_GROUPS.map((g) => ({ id: g.id, name: g.name, themes: g.themes.map((id) => ({ id, name: THEMES.find((t) => t.id === id).name })) }));

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const list = (own, key) => (own && Array.isArray(own[key]) && own[key].length ? own[key] : DEFAULT[key]);
const beatList = (own, stage) => (own?.beats?.[stage]?.length ? own.beats[stage] : DEFAULT.beats[stage]);

// A theme option as given to generate: a known id, 'surprise', or null (classic).
export function themeChoice(theme) {
  if (theme == null || theme === '' || theme === false) return null;
  if (theme === 'surprise' || typeof theme !== 'string') return 'surprise';
  return KIT_THEME_IDS.includes(theme) ? theme : 'surprise';
}

function fillWith(vars) {
  return (t) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Three story moments for a puzzle. They use only theme words and the cast,
// never anything from the solution.
function beatsFor(game, seed, themeId, vars) {
  const own = themeId ? WORDS[themeId] : null;
  const r = makeRng(`${seed}:beats:${themeId || 'classic'}`);
  const fill = fillWith(vars);
  return ['early', 'middle', 'late'].map((stage) => fill(r.pick(beatList(own, stage))));
}

export function kitThemeStory(game, seed, { theme = null, used = [], classic = null, picture = '' } = {}) {
  const g = GAMES[game];
  const choice = themeChoice(theme);
  if (!choice) {
    const s = classic ? classic() : null;
    if (!s) return s;
    return { ...s, theme: null, beats: beatsFor(game, seed, null, { bits: g.bits }) };
  }
  const seen = new Set(used);
  let pick = null;
  for (let i = 0; i < 40 && !pick; i++) {
    const r = makeRng(`${seed}:theme-story:${choice}:${i}`);
    const themeId = choice === 'surprise' ? r.pick(KIT_THEME_IDS) : choice;
    const t = THEMES.find((x) => x.id === themeId);
    const own = WORDS[themeId];
    const place = r.pick(list(own, 'places')), thing = r.pick(list(own, 'things'));
    const id = slug(`${game}-${themeId}-${place}-${thing}`);
    if (seen.has(id) && i < 39) continue;
    const name = r.pick(t.names);
    const vars = { place, thing, one: t.cast.one, One: cap(t.cast.one), many: t.cast.many, Many: cap(t.cast.many), name, bits: g.bits, picture };
    const fill = fillWith(vars);
    pick = {
      id,
      title: `The ${place} ${thing}`,
      intro: `${fill(r.pick(list(own, 'intros')))} ${g.task}`,
      ending: `${fill(g.done)} ${fill(r.pick(list(own, 'endings')))}`,
      theme: themeId,
      beats: beatsFor(game, seed, themeId, vars),
    };
  }
  return pick;
}
