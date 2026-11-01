// Classroom package builders (see classroom.js for the shared choices and checks):
// - customWorld(def): an educator's own theme (cast, names, categories, story)
//   as an engine scenario; generatePuzzle({ custom }) uses it.
// - customStory(...): the story for a custom world (the educator's own words).
// - packagePlan(request, seed): the generatePuzzle options for every puzzle.
// - gradeStory(puzzle, band): the story paragraphs at the grade's reading level.
// Kept apart from classroom.js so the Educators forms never need them; in
// server mode (docs/PUZZLE-SERVER.md) this file stays on the puzzle server.
import { TIERS } from './tiers.js';
import { THEMES, plural } from './themes.js';
import { cap, joinList } from './language.js';
import { hashString } from './rng.js';
import { checkCustom, bandOf, PRINT_LIMITS, ORDER_WORDS } from './classroom.js';

// ---------------------------------------------------------------- custom worlds
export function customWorld(def) {
  const d = def && def.categories ? def : checkCustom(def).value;
  if (!d) throw new Error('This custom theme is not complete.');
  const theme = { id: 'custom', name: d.theme };
  const topic = { id: 'custom', name: d.theme, description: d.story.slice(0, 120) };
  const categories = d.categories.map((c, i) => {
    const noun = c.name.toLowerCase();
    const id = `c${i + 1}`;
    const pos = c.pos ? `${c.pos} {x}` : `has {x} as their ${noun}`;
    const neg = c.pos ? `${c.neg} {x}` : `does not have {x} as their ${noun}`;
    if (!c.order) return { id, name: c.name, noun, pos, neg, items: c.items.slice() };
    const w = ORDER_WORDS[c.order];
    const an = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');
    const own = c.less && c.more;
    return {
      id, name: c.name, noun, pos, neg,
      // Which way the list runs, so "higher" and "ahead of" are never a guess.
      note: own ? `The ${noun} list runs in order from ${c.items[0]} to ${c.items[c.items.length - 1]}.`
        : `In the ${noun} list, ${c.items[0]} is the ${w.least} and ${c.items[c.items.length - 1]} is the ${w.most}.`,
      ordinal: {
        start: 0, step: 1, count: c.items.length, label: (v) => c.items[v],
        less: own ? c.less : `has ${an(w.less)} ${w.less} ${noun} than`, more: own ? c.more : `has ${an(w.more)} ${w.more} ${noun} than`,
        lessBy: `has a ${noun} {d} ${w.less} than`, moreBy: `has a ${noun} {d} ${w.more} than`,
        gap: (s) => plural(s, 'place', 'places'),
      },
    };
  });
  // Ordered items run in the educator's order, so a puzzle uses the first N of them.
  const names = d.names.length >= 3 ? d.names : [];
  const maxItems = Math.min(...d.categories.map((c) => c.items.length), names.length ? Math.max(names.length, 3) : 8);
  const key = `custom/${hashString(JSON.stringify([d.theme, d.story, d.categories.map((c) => [c.name, c.items])])).toString(36)}`;
  return {
    def: d, theme, topic, maxItems,
    scenario: {
      custom: d, theme, topic, key,
      cast: d.cast, names: names.length ? names : FILL_NAMES.slice(),
      categories, story: null, art: { setting: d.theme, mood: 'calm' },
    },
  };
}

// The story for a custom world: the educator's own scene, who is in it, what
// to match and the goal question. Each puzzle has its own id, so it is never
// counted as a reused storyline.
export function customStory({ scenario, goal, model, L, customTitle, seed }) {
  const d = scenario.custom;
  const { N, cats } = model;
  const names = cats[0].labels;
  const goalItem = goal.cat * N + goal.item;
  const winnerEntity = model.sol[goal.cat].indexOf(goal.item);
  const fact = `${names[winnerEntity]} ${L.pos(goalItem)}`;
  const castLine = `The ${d.cast.many} are ${joinList(names)}.`;
  const task = `Use the clues to match each ${d.cast.one} with their ${joinList(cats.slice(1).map((c) => c.name.toLowerCase()))}.`;
  const notes = cats.slice(1).filter((c) => c.note).map((c) => c.note);
  const question = `Who ${L.pos(goalItem)}?`;
  const scene = d.story ? d.story.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  const paragraphs = [...scene, castLine, task, ...(notes.length ? [notes.join(' ')] : []), `Can you work out who ${L.pos(goalItem)}?`];
  const text = paragraphs.join('\n\n');
  return {
    id: `${scenario.key}|${hashString(`${seed}|${names.join(',')}|${fact}`).toString(36)}`,
    title: customTitle || d.title || `The ${d.theme} Puzzle`,
    paragraphs, text,
    goalQuestion: question,
    goalAnswer: { cat: 0, item: winnerEntity },
    ending: d.ending ? d.ending : `${cap(fact)}. Well done, puzzle solver!`,
    notes,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    parts: {},
  };
}

// ---------------------------------------------------------------- planning
const SIZE_FALLBACK = (tier, [k, n]) => {
  const t = TIERS[tier];
  const fits = k >= t.categories[0] && k <= t.categories[1] && n >= t.items[0] && n <= t.items[1];
  const s = fits ? [k, n] : t.defaultSize;
  return [Math.min(PRINT_LIMITS.categories[1], Math.max(PRINT_LIMITS.categories[0], s[0])), Math.min(PRINT_LIMITS.items[1], Math.max(PRINT_LIMITS.items[0], s[1]))];
};

// The generatePuzzle options for each puzzle in a package, easiest first when
// the difficulty builds up. usedStories keeps every package story new.
export function packagePlan(req, seed, usedStories = []) {
  const band = bandOf(req.grade);
  const tiers = req.difficulty === 'progressive' ? band.tiers
    : req.difficulty === 'grade' ? [band.recommended] : [req.difficulty];
  const fixed = req.size !== 'grade' ? req.size.split('x').map(Number) : null;
  const themeKeys = req.source === 'themes' && req.themes.length ? req.themes : THEMES.map((t) => `${t.id}/any`);
  const start = hashString(String(seed)) % themeKeys.length;
  const plan = [];
  for (let i = 0; i < req.count; i++) {
    const tier = tiers[Math.min(tiers.length - 1, Math.floor((i * tiers.length) / req.count))];
    let [k, n] = fixed || SIZE_FALLBACK(tier, band.size);
    const o = { difficulty: tier, categories: k, items: n, questions: req.questions, seed: `${seed}-${i + 1}`, usedStories, timeLimitMs: 20000 };
    if (req.clueTypes.length) o.clueTypes = req.clueTypes;
    if (req.source === 'custom') {
      const w = customWorld(req.custom);
      o.custom = req.custom;
      o.categories = Math.min(k, req.custom.categories.length + 1);
      o.items = Math.min(n, w.maxItems);
    } else {
      const [theme, topic] = themeKeys[(start + i) % themeKeys.length].split('/');
      o.theme = theme;
      o.topic = topic;
      if (req.names.length) o.customNames = req.names;
    }
    plan.push(o);
  }
  return plan;
}

// The story at the grade's reading level. Early readers get who is in it,
// what to match and the question; the next band adds the opening scene; older
// students read the whole story. A custom story is the educator's own words.
export function gradeStory(p, band) {
  const all = p.story.paragraphs;
  if (p.theme.id === 'custom' || band.reading === 'full') return all.slice();
  const names = p.categories[0].items.map((x) => x.label);
  const castLine = `The ${p.cast.many} are ${joinList(names)}.`;
  const task = `Use the clues to match each ${p.cast.one} with their ${joinList(p.categories.slice(1).map((c) => c.name.toLowerCase()))}.`;
  const notes = p.story.notes && p.story.notes.length ? [p.story.notes.join(' ')] : p.categories.filter((c) => c.note).map((c) => c.note);
  // Early readers get the plain question ("Who brought the Pug?"): the full
  // goal line names the story's event, which their version leaves out.
  return band.reading === 'early' ? [castLine, task, ...notes, p.story.goal] : [all[0], castLine, task, ...notes, all[all.length - 1]];
}
