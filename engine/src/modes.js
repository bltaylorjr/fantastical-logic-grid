// Puzzle styles: two more ways to play the story logic grid, picked under
// Puzzle style on the setup screen (web/js/lab.js; Classic is the default).
//
//   timeline  Timeline Case: a whodunit. Suspects, places, an object and the
//             clock times in a logbook. Clues lean on time order (before,
//             right after, an hour before, between, first and last). The
//             crime's time is told in the story; the ending names the culprit
//             from the solved grid.
//   seating   Seating Plan: guests round one table, seats numbered clockwise.
//             Clues: sits next to, directly across from, two seats to the
//             left of, does not sit next to. Seats wrap round (the last seat
//             is next to Seat 1), and the solver reasons with that.
//
// Nothing here runs unless generatePuzzle gets mode 'timeline' or 'seating':
// with no mode (the default) every puzzle is byte-for-byte what it was before
// (test/mode-off-check.js proves it). The new clue types live in clues.js,
// solver.js and language.js, and no tier ever weights them.
//
// Themes: a Lab puzzle is set in the theme the player chose, with that
// theme's cast and categories, and its story from lab-stories.js (all the
// words live there, with notes on how to write them). "Surprise me" picks a
// theme. A theme that cannot host the mode (a Player Story, an educator's
// own world, or a theme with no Lab story) falls back to a stand-alone story
// with a note, never an error.
import { makeRng } from './rng.js';
import { TIERS } from './tiers.js';
import { THEMES, getTheme, clock, plural } from './themes.js';
import { TIMELINE_STORIES, SEATING_STORIES, FALLBACK_TIMELINE, FALLBACK_SEATING } from './lab-stories.js';
import { LAB_SIZES, LAB_LIMITS } from './lab-play.js';
import { orderItems } from './order.js';
import { cap, joinList } from './language.js';
import { countWords } from './story-parts.js';

export const LAB_MODES = {
  timeline: { id: 'timeline', name: 'Timeline Case', summary: 'A whodunit told by the clock: before, right after, between, first and last.' },
  seating: { id: 'seating', name: 'Seating Plan', summary: 'Guests round one table: next to, across from, two seats to the left.' },
};

export const isLabMode = (mode) => typeof mode === 'string' && Object.prototype.hasOwnProperty.call(LAB_MODES, mode);

// Names for the new clue types (the standard CLUE_TYPES list is left alone,
// so the setup screen's clue type list does not change).
export const MODE_CLUE_TYPES = {
  next: 'Right after',
  between: 'Between',
  first: 'First',
  last: 'Last',
  nextTo: 'Sits next to',
  across: 'Directly across',
  left2: 'Two seats to the left',
  notNext: 'Not next to',
};

// ---------------------------------------------------------------------------
// Sizes and tiers. Each mode keeps every tier's grading (advanced steps,
// what-if chains, score), with its own clue types. The new clue types are
// reasoned at the advanced level, so Basic and Easy may use that level here
// (a Basic Timeline Case still only needs "read it and carry it").

// [categories, items] per tier live in lab-play.js (the setup screen shows them).
const SIZES = LAB_SIZES;
const LIMITS = LAB_LIMITS;

const WEIGHTS = {
  timeline: {
    basic: { is: 1.5, not: 3, neither: 1, less: 2, next: 3, first: 1.5, last: 1.5 },
    easy: { is: 1, not: 3, neither: 1.5, either: 1.5, less: 3, next: 3, between: 2, first: 1, last: 1 },
    medium: { is: 0.5, not: 3, neither: 1.5, either: 2, less: 3, next: 3, between: 2.5, diff: 1.5, first: 0.7, last: 0.7 },
    hard: { is: 0.3, not: 2.5, neither: 1.5, either: 2, pairs: 1, allDiff: 1, less: 3, next: 3, between: 2.5, diff: 2, first: 0.5, last: 0.5 },
    expert: { is: 0.2, not: 2.5, neither: 1.5, either: 2, pairs: 1.5, allDiff: 1, less: 3, next: 3, between: 2.5, diff: 2, first: 0.4, last: 0.4, ifthen: 1.2 },
    mensa: { is: 0.1, not: 2, neither: 1.5, either: 2, pairs: 2, allDiff: 1, less: 3, next: 3, between: 3, diff: 2.5, first: 0.3, last: 0.3, ifthen: 1.5 },
    theorist: { is: 0.1, not: 1.5, neither: 1.5, either: 2, pairs: 2, allDiff: 1, less: 3, next: 3, between: 3, diff: 3, first: 0.2, last: 0.2, ifthen: 2 },
  },
  seating: {
    basic: { is: 2, not: 3, neither: 1, nextTo: 3, across: 2, notNext: 1 },
    easy: { is: 1.5, not: 3, neither: 1.5, either: 1.5, nextTo: 3, across: 2, left2: 2, notNext: 1.5 },
    medium: { is: 0.7, not: 3, neither: 1.5, either: 2, nextTo: 3, across: 2, left2: 2.5, notNext: 2 },
    hard: { is: 0.4, not: 2.5, neither: 1.5, either: 2, pairs: 1, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2 },
    expert: { is: 0.3, not: 2.5, neither: 1.5, either: 2, pairs: 1.5, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2, ifthen: 1 },
    mensa: { is: 0.2, not: 2, neither: 1.5, either: 2, pairs: 2, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2.5, ifthen: 1.5 },
    theorist: { is: 0.1, not: 1.5, neither: 1.5, either: 2, pairs: 2, allDiff: 1, nextTo: 3, across: 2, left2: 3, notNext: 2.5, ifthen: 2 },
  },
};
// Types tried for removal first go first; the mode's own clue types last, so
// they are the ones kept.
const REMOVE_FIRST = {
  timeline: ['is', 'not', 'neither', 'allDiff', 'either', 'pairs', 'ifthen', 'first', 'last', 'less', 'diff', 'between', 'next'],
  seating: ['is', 'not', 'neither', 'allDiff', 'either', 'pairs', 'ifthen', 'notNext', 'across', 'nextTo', 'left2'],
};

export function modeTier(mode, tierId) {
  const base = TIERS[tierId] || TIERS.easy;
  const size = SIZES[mode][base.id];
  return {
    ...base,
    summary: `${LAB_MODES[mode].name} (Lab), ${base.name}: ${LAB_MODES[mode].summary}`,
    categories: [size[0], size[0]], items: [size[1], size[1]], defaultSize: size,
    weights: { ...WEIGHTS[mode][base.id] },
    maxLevel: Math.max(2, base.maxLevel),
    removeFirst: REMOVE_FIRST[mode],
  };
}

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

// The story frame for a theme, built from its lab-stories.js entry and the
// theme's own cast and categories, or null when the theme cannot host the
// mode (no entry, or the entry names a category the theme does not have, a
// numbered one, or one with too few items).
const SEAT = { name: 'Seat', noun: 'seat', pos: 'sat in {x}', neg: 'did not sit in {x}' };
export function themeFrame(mode, theme) {
  const entry = theme && (mode === 'timeline' ? TIMELINE_STORIES : SEATING_STORIES)[theme.id];
  if (!entry) return null;
  const catOf = (id) => {
    const c = theme.categories.find((x) => x.id === id);
    return c && !c.ordinal && Array.isArray(c.items) && c.items.length >= LIMITS[mode].items[1]
      ? { name: c.name, noun: c.noun, pos: c.pos, neg: c.neg, items: c.items } : null;
  };
  const base = {
    id: theme.id, themed: true, name: entry.titles[0], setting: entry.setting, mood: entry.mood,
    names: theme.names, cast: theme.cast, thing: entry.thing, titles: entry.titles, openings: entry.openings, endings: entry.endings,
  };
  if (mode === 'timeline') {
    const [place, object, extra] = [entry.place, entry.object, entry.extra].map(catOf);
    if (!place || !object || !extra || new Set([entry.place, entry.object, entry.extra]).size < 3) return null;
    return { ...base, scene: entry.scene, crime: entry.crime, log: entry.log, place, object, extra, time: entry.time };
  }
  const cats = (entry.cats || []).map((id) => { const c = catOf(id); return c && { id, ...c }; });
  if (cats.length < LIMITS.seating.categories[1] - 2 || cats.some((c) => !c || c.id === 'seat' || c.id === 'name')) return null;
  return { ...base, scene: entry.occasion, incident: entry.incident, cats, seat: { ...SEAT, ...(entry.seat || {}) } };
}

// Themes a Lab mode can be set in ("Surprise me" picks among them).
export const modeThemes = (mode) => THEMES.filter((t) => themeFrame(mode, t));

// generator.js resolveOptions hands a lab-mode request here. Returns the same
// shape of options the generator uses, with the mode's tier, world and story.
export function resolveModeOptions(opts) {
  const mode = opts.mode;
  const seed = opts.seed != null ? String(opts.seed) : Math.floor(Math.random() * 2 ** 32).toString(36);
  const tier = modeTier(mode, opts.difficulty);
  const rng = makeRng(`${seed}|lab-${mode}|${tier.id}|${opts.theme && opts.theme !== 'random' ? opts.theme : ''}|${opts.topic || ''}|${opts.categories || ''}x${opts.items || ''}`);
  const learn = opts.learning || {};
  const notes = [];
  // The theme: the one chosen, or for "Surprise me" one picked here (leaning
  // toward themes the player enjoys, as the main game does).
  const fallbacks = mode === 'timeline' ? FALLBACK_TIMELINE : FALLBACK_SEATING;
  let frame = opts.topic ? fallbacks.find((f) => f.id === opts.topic) : null;
  let theme = null;
  if (!frame) {
    if (!opts.custom && (!opts.theme || opts.theme === 'random')) {
      const pool = modeThemes(mode);
      const w = learn.themeWeights;
      theme = w ? getTheme(rng.weighted(Object.fromEntries(pool.map((t) => [t.id, clamp(Number(w[t.id]) || 1, [0.3, 3])])))) : rng.pick(pool);
    } else if (!opts.custom) theme = getTheme(opts.theme) || null;
    frame = themeFrame(mode, theme);
    if (!frame) {
      frame = rng.pick(fallbacks);
      const what = opts.custom ? 'Your own world' : opts.theme === 'stories' ? 'Player Stories' : theme ? `The ${theme.name} theme` : 'That theme';
      notes.push(`${what} cannot be used for a ${LAB_MODES[mode].name} yet, so this one is set at ${frame.name}.`);
      theme = null;
    }
  }
  const K = clamp(opts.categories || tier.defaultSize[0], LIMITS[mode].categories);
  const N = clamp(opts.items || tier.defaultSize[1], LIMITS[mode].items);
  const customSize = K !== tier.defaultSize[0] || N !== tier.defaultSize[1];
  let weights = { ...tier.weights };
  if (Array.isArray(opts.clueTypes) && opts.clueTypes.length) {
    const want = Object.fromEntries(opts.clueTypes.filter((t) => t in tier.weights).map((t) => [t, tier.weights[t]]));
    if (Object.keys(want).length) weights = want;
  }
  if (mode === 'seating' && N % 2) delete weights.across;
  const effort = clamp(Number(learn.effort) || 0, [-1, 1]);
  const themeOut = theme ? { id: theme.id, name: theme.name }
    : { id: mode === 'timeline' ? 'mystery' : 'occasion', name: `${LAB_MODES[mode].name} (Lab)` };
  const topic = frame.themed ? { id: `lab-${mode}`, name: LAB_MODES[mode].name, description: LAB_MODES[mode].summary }
    : { id: frame.id, name: frame.name, description: LAB_MODES[mode].summary };
  const cast = frame.cast || (mode === 'timeline' ? { one: 'suspect', many: 'suspects' } : { one: 'guest', many: 'guests' });
  const scenario = {
    theme: themeOut, topic, cast, names: frame.names, art: { setting: frame.setting, mood: frame.mood },
    // finalize() asks the scenario for its story when it has its own writer.
    modeStory: (args) => (mode === 'timeline' ? timelineStory : seatingStory)({ ...args, frame, usedStories: opts.usedStories || [], mode }),
  };
  return {
    mode, frame, tier, seed, rng, theme: themeOut, topic, scenario, K, N, customSize, weights, modeNotes: notes,
    clueCount: opts.clueCount ? Math.max(1, Math.floor(opts.clueCount)) : null,
    questions: clamp(opts.questions ?? 3, [1, 6]), effort,
    customNames: opts.customNames, customTitle: opts.title, usedStories: opts.usedStories || [],
    timeLimitMs: opts.timeLimitMs ?? tier.timeLimitMs ?? 15000, maxAttempts: opts.maxAttempts ?? 60,
  };
}

const timeGap = (step) => (s) => {
  const m = s * step;
  return m % 60 === 0 ? plural(m / 60, 'hour', 'hours') : plural(m, 'minute', 'minutes');
};

// The model (categories and items) for one attempt; generator.js buildModel
// hands lab-mode options here.
export function buildModeModel(o) {
  const { rng, frame, K, N, mode } = o;
  let names = Array.isArray(o.customNames) ? [...new Set(o.customNames.map((s) => String(s).trim()).filter(Boolean))] : [];
  if (names.length < N) names = names.concat(rng.sample(frame.names.filter((n) => !names.includes(n)), N - names.length));
  else names = names.slice(0, N);
  names = orderItems(names);
  const cast = o.scenario.cast;
  const cats = [{ id: 'name', name: cap(cast.one), labels: names, pos: 'is {x}', neg: 'is not {x}', ordinal: null }];
  const named = (id, c) => ({ id, name: c.name, noun: c.noun, note: c.note, labels: orderItems(rng.sample(c.items, N)), pos: c.pos, neg: c.neg, ordinal: null });
  let clueCtx;
  if (mode === 'timeline') {
    cats.push(named('place', frame.place), named('object', frame.object));
    if (K >= 5) cats.push(named('extra', frame.extra));
    const { start, step } = frame.time;
    const values = Array.from({ length: N }, (_, i) => i * step);
    const gap = timeGap(step);
    cats.push({
      id: 'time', name: 'Time', noun: 'time in the log', labels: values.map(clock(start)), values,
      pos: 'was seen at {x}', neg: 'was not seen at {x}',
      note: `${frame.log} The times run from {low} to {high}, ${gap(1)} apart.`,
      ordinal: {
        less: 'was seen earlier than', more: 'was seen later than',
        lessBy: 'was seen {d} before', moreBy: 'was seen {d} after',
        gaps: Array.from({ length: N }, (_, d) => (d ? gap(d) : '')),
        next: 'was seen right after', prev: 'was seen right before',
        betweenA: 'was seen after', betweenB: 'but before',
        first: `was the first ${cast.one} in the log`, last: `was the last ${cast.one} in the log`,
      },
    });
    clueCtx = { time: cats.length - 1 };
  } else {
    for (const c of rng.shuffle(frame.cats).slice(0, K - 2)) cats.push(named(c.id, c));
    const s = frame.seat;
    const across = N % 2 === 0 ? ' "Directly across" means exactly halfway round the table.' : '';
    cats.push({
      id: 'seat', name: s.name, noun: s.noun, labels: Array.from({ length: N }, (_, i) => `${s.name} ${i + 1}`), values: Array.from({ length: N }, (_, i) => i + 1),
      pos: s.pos, neg: s.neg,
      note: `The ${N} ${s.name.toLowerCase()}s are numbered clockwise round one round table, so {high} is next to {low}. Everyone faces the middle, so the ${s.name.toLowerCase()} on a {one}'s left is the next one clockwise.${across}`,
      ordinal: {
        ring: true,
        nextTo: 'sat next to', across: 'sat directly across from', left2: `sat two ${s.name.toLowerCase()}s to the left of`, notNext: 'did not sit next to',
      },
    });
    clueCtx = { ring: cats.length - 1 };
  }
  const goalCat = cats.length - 1; // the crime's time, or the seat where the note was left
  return { K: cats.length, N, cats, cast, goal: { cat: goalCat }, ordinals: mode === 'timeline' ? [goalCat] : [], clueCtx };
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const capFirst = (t) => t.replace(/(^\W*|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());

// Opening and ending choices not used before on this device, if any are left.
function pickParts(rng, frame, key, usedStories) {
  const used = new Set(usedStories);
  const combos = [];
  for (let t = 0; t < frame.titles.length; t++)
    for (let op = 0; op < frame.openings.length; op++)
      for (let e = 0; e < frame.endings.length; e++) combos.push({ t, o: op, e, id: `${key}|t${t}|o${op}|e${e}` });
  const fresh = combos.filter((c) => !used.has(c.id));
  return rng.pick(fresh.length ? fresh : combos);
}

function storyShell({ frame, mode, model, scene, goalLine, ending, pick, goalQuestion, winnerEntity, customTitle }) {
  const { cats } = model;
  const cast = model.cast;
  const names = cats[0].labels;
  const castLine = `The ${cast.many} are ${joinList(names)}.`;
  const task = `Use the clues to match each ${cast.one} with their ${joinList(cats.slice(1).map((c) => c.name.toLowerCase()))}.`;
  const notes = cats.slice(1).filter((c) => c.note).map((c) => capFirst(fill(c.note, { one: cast.one, many: cast.many, low: c.labels[0], high: c.labels.at(-1) })));
  let paragraphs = [scene, castLine, task, goalLine];
  const wordCount = countWords(paragraphs.join(' '));
  paragraphs = [...paragraphs.slice(0, -1), notes.join(' '), paragraphs.at(-1)];
  return {
    id: pick.id,
    title: customTitle || frame.titles[pick.t],
    paragraphs, text: paragraphs.join('\n\n'),
    goalQuestion, goalAnswer: { cat: 0, item: winnerEntity }, ending, notes, wordCount,
    parts: { t: String(pick.t), o: String(pick.o), e: String(pick.e), mode },
    // For the story moments (beats.js): words that never give an answer away.
    beatWords: { thing: frame.thing, scene: frame.scene || frame.name.replace(/^The /, 'the ') },
  };
}

function timelineStory({ rng, goal, model, L, customTitle, frame, usedStories, mode }) {
  const { N, cats, sol } = model;
  const pick = pickParts(rng, frame, `lab-timeline/${frame.id}`, usedStories);
  const tc = model.goal.cat;
  const e = sol[tc].indexOf(goal.item);
  const time = cats[tc].labels[goal.item];
  const of = (id) => { const c = cats.findIndex((x) => x.id === id); return c < 0 ? '' : cats[c].labels[sol[c][e]]; };
  // What the culprit did, in the category's own words ("competed in Archery").
  const fact = (id) => { const c = cats.findIndex((x) => x.id === id); return c < 0 ? '' : L.pos(c * N + sol[c][e]); };
  const vars = { n: NUMBER_WORDS[N], many: model.cast.many, one: model.cast.one, time, thing: frame.thing, Thing: cap(frame.thing),
    culprit: cats[0].labels[e], place: of('place'), object: of('object'), extra: of('extra'),
    where: fact('place'), holding: fact('object') };
  const scene = [frame.openings[pick.o], frame.crime].map((t) => capFirst(fill(t, vars))).join(' ');
  const goalLine = `Whoever was seen at ${time} is the one who took ${frame.thing}. Can you work out who it was?`;
  return storyShell({ frame, mode, model, scene, goalLine, ending: capFirst(fill(frame.endings[pick.e], vars)), pick,
    goalQuestion: `Who ${L.pos(tc * N + goal.item)}?`, winnerEntity: e, customTitle });
}

function seatingStory({ rng, goal, model, L, customTitle, frame, usedStories, mode }) {
  const { N, cats, sol } = model;
  const pick = pickParts(rng, frame, `lab-seating/${frame.id}`, usedStories);
  const sc = model.goal.cat;
  const at = (v) => cats[0].labels[sol[sc].indexOf(((v % N) + N) % N)];
  const e = sol[sc].indexOf(goal.item);
  const seat = cats[sc].labels[goal.item];
  // Facing the middle, a guest's left is the next seat clockwise.
  const vars = { n: NUMBER_WORDS[N], many: model.cast.many, one: model.cast.one, seat, thing: frame.thing,
    winner: cats[0].labels[e], left: at(goal.item + 1), right: at(goal.item - 1), across: N % 2 ? '' : at(goal.item + N / 2) };
  const scene = [frame.openings[pick.o], frame.incident].map((t) => capFirst(fill(t, vars))).join(' ');
  const goalLine = `Whoever sat in ${seat} left ${frame.thing}. Can you work out who sat where?`;
  return storyShell({ frame, mode, model, scene, goalLine, ending: capFirst(fill(frame.endings[pick.e], vars)), pick,
    goalQuestion: `Who ${L.pos(sc * N + goal.item)}?`, winnerEntity: e, customTitle });
}
