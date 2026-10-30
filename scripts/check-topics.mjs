// Checks topics and their stories quickly, for one or more themes, with the
// same story rules as the engine tests (engine/test/run-tests.js), plus the
// content upgrade's bar: at least 10 storylines (incidents) and 10 openings
// per topic, and a puzzle builds for every topic.
// Usage: node scripts/check-topics.mjs [theme ...]   (no theme = every theme)
import { THEMES, getTopics, generatePuzzle } from '../engine/src/index.js';
import { buildScenario } from '../engine/src/topics.js';
import { buildModel, randomSolution } from '../engine/src/generator.js';
import { buildStory } from '../engine/src/story.js';
import { makeLanguage } from '../engine/src/language.js';
import { makeRng } from '../engine/src/rng.js';
import { SIZE_LIMITS } from '../engine/src/tiers.js';

const ONLY = process.argv.slice(2);
const quick = true;
let failed = 0;
function check(name, cond, detail = '') {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` ${detail}`}`);
}

// The content bar: 10 storylines and 10 openings per topic, a puzzle for each.
{
  const short = [];
  let topics = 0;
  for (const theme of THEMES.filter((t) => !ONLY.length || ONLY.includes(t.id))) {
    for (const topic of getTopics(theme.id)) {
      topics++;
      const S = buildScenario(theme, topic).story;
      if (S.incidents.length < 10) short.push(`${theme.id}/${topic.id}: ${S.incidents.length} storylines (incidents), needs 10`);
      if (S.openings.length < 10) short.push(`${theme.id}/${topic.id}: ${S.openings.length} openings, needs 10`);
      const names = S.incidents.map((i) => i.name);
      if (new Set(names).size !== names.length) short.push(`${theme.id}/${topic.id}: two storylines share a name`);
      for (const tier of ['easy', 'hard']) {
        try { generatePuzzle({ difficulty: tier, theme: theme.id, topic: topic.id, seed: `check-${topic.id}-${tier}`, timeLimitMs: 4000 }); } catch (e) { short.push(`${theme.id}/${topic.id} ${tier}: ${e.message}`); }
      }
    }
  }
  for (const s of short.slice(0, 40)) console.log(`  ${s}`);
  check(`${topics} topics have 10 storylines, 10 openings and build puzzles`, short.length === 0, `${short.length} problems`);
}

{
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = (text, word) => new RegExp(`(^|[^\\w'-])${esc(word)}(?=$|'s\\b|[^\\w'-])`, 'i').test(text);
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const labelsOf = (c) => (c.ordinal ? [] : c.items.filter((x) => x.length > 1));
  const problems = [];
  const problem = (where, msg) => problems.push(`${where}: ${msg}`);
  for (const theme of THEMES.filter((t) => !ONLY.length || ONLY.includes(t.id))) {
    const topics = getTopics(theme.id);
    const casts = new Set([theme.cast, ...topics.map((t) => t.cast).filter(Boolean)].flatMap((c) => [c.one, c.many]));
    for (const topic of topics) {
      const where = `${theme.id}/${topic.id}`;
      const sc = buildScenario(theme, topic);
      const S = sc.story;
      if (topic.story) {
        for (const kind of ['adjs', 'openings', 'incidents', 'mishaps', 'endings']) if (!(topic.story[kind] || []).length) problem(where, `borrows the classic ${kind}`);
        for (const c of sc.categories) if (!(topic.story.leads || {})[c.id]) problem(where, `borrows the classic leads for "${c.id}"`);
      }
      for (const c of sc.categories) {
        const leads = S.leads[c.id] || [];
        if (!leads.length) problem(where, `no lead for "${c.id}"`);
        for (const l of leads) if (!l.includes('{x}')) problem(where, `lead "${l}" does not name the item`);
      }
      const words = [...sc.categories.flatMap((c) => labelsOf(c).map((w) => [w, `${c.name} item`])), ...sc.names.map((n) => [n, 'cast name'])];
      const seen = new Map();
      for (const [w, what] of words) {
        const k = w.toLowerCase();
        if (seen.has(k)) problem(where, `"${w}" is both a ${seen.get(k)} and a ${what}`);
        seen.set(k, what);
      }
      for (const c of sc.categories) for (const w of labelsOf(c)) for (const n of sc.names) if (w !== n && has(w, n)) problem(where, `the ${c.name} item "${w}" has the cast name "${n}" in it`);
      const otherCasts = [...casts].filter((w) => w !== sc.cast.one && w !== sc.cast.many && !has(sc.cast.many, w) && !has(sc.cast.one, w));
      const texts = [
        ...S.adjs.map((t) => ['title word', t]), ...S.openings.map((t) => ['opening', t]), ...S.mishaps.map((t) => ['mix-up', t]),
        ...S.endings.map((t) => ['ending', t]), ...S.incidents.flatMap((i) => [['event', i.name], ['event', i.text], ['event', i.prize]]),
        ...sc.categories.flatMap((c) => (S.leads[c.id] || []).map((t) => [`${c.id} lead`, t])),
        ...sc.categories.filter((c) => c.note).map((c) => [`${c.id} note`, c.note]),
      ];
      // Numbered categories say which way they run. "Holds a higher rank"
      // means nothing until the player knows whether rank 1 is the top
      // (player report, 2026-10-26), so any comparison in higher/lower or
      // above/below terms needs a note that settles it.
      for (const c of sc.categories) {
        if (!c.ordinal) continue;
        const o = c.ordinal;
        const words = [o.less, o.more, o.lessBy, o.moreBy].join(' ');
        if (/\b(higher|lower|above|below|top|bottom)\b/i.test(words) && !c.note) problem(where, `"${c.id}" compares with higher/lower but has no note saying which way its numbers run`);
        if (c.note && /\brank|place|grade|year|lane|score\b/i.test(c.name) && !/\b(1|bigger|higher|better|first)\b/.test(c.note)) problem(where, `"${c.id}" note does not say which end is the top`);
      }
      for (const [kind, raw] of texts) {
        const text = raw.replace(/\{\w+\}/g, ' ');
        for (const [w, what] of words) if (has(text, w)) problem(where, `${kind} "${raw}" names the ${what} "${w}"`);
        for (const w of otherCasts) if (has(text, w)) problem(where, `${kind} "${raw}" calls the cast "${w}"`);
      }
    }
  }
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  check('story parts name only their own topic\'s cast, and no grid items', problems.length === 0, `${problems.length} problems`);

  // Built stories at every size: the cast, categories and goal item are the
  // puzzle's own, and nothing else from the topic's item lists is mentioned.
  let built = 0;
  const bad = [];
  for (const theme of THEMES.filter((t) => !ONLY.length || ONLY.includes(t.id))) {
    for (const topic of getTopics(theme.id)) {
      const sc = buildScenario(theme, topic);
      for (let K = SIZE_LIMITS.categories[0]; K <= SIZE_LIMITS.categories[1]; K++) {
        for (let N = SIZE_LIMITS.items[0]; N <= SIZE_LIMITS.items[1]; N++) {
          for (const seed of quick ? ['a'] : ['a', 'b', 'c']) {
            const rng = makeRng(`match|${theme.id}|${topic.id}|${K}x${N}|${seed}`);
            const model = buildModel({ rng, scenario: sc, K, N, weights: { less: 1 } });
            model.sol = randomSolution(rng, K, N);
            const goal = { cat: model.goal.cat, item: rng.int(N) };
            const story = buildStory({ rng, scenario: sc, goal, model, L: makeLanguage(model) });
            built++;
            const where = `${theme.id}/${topic.id} ${K}x${N}`;
            const all = `${story.title}\n${story.text}\n${story.ending}`;
            const goalLabel = model.cats[goal.cat].labels[goal.item];
            const names = model.cats[0].labels;
            if (!has(story.text, sc.cast.many)) bad.push(`${where}: never calls the cast "${sc.cast.many}"`);
            if (!new RegExp(`\\b${NUMBER_WORDS[N]}\\b`, 'i').test(story.text)) bad.push(`${where}: the head count is not ${NUMBER_WORDS[N]}`);
            if (!has(story.text, goalLabel)) bad.push(`${where}: the goal "${goalLabel}" is not in the story`);
            // The goal question ties the grid answer to the story's event
            // (a song-request story must not end on "who ordered the Tacos?"
            // without saying why that matters).
            const incident = sc.story.incidents.find((i) => story.title.endsWith(i.name));
            const last = story.paragraphs.at(-1);
            if (!incident || !last.includes(incident.prize)) bad.push(`${where}: the goal question does not link "${goalLabel}" to the story's event`);
            if (!last.endsWith('?') || !has(last, goalLabel)) bad.push(`${where}: the story does not end on its goal question`);
            for (const c of model.cats.slice(1)) {
              if (c.note && !story.text.includes(c.note.replace(/\{one\}/g, sc.cast.one).replace(/\{many\}/g, sc.cast.many).slice(1))) bad.push(`${where}: the ${c.name} note is missing from the story`);
            }
            const task = story.paragraphs.find((x) => x.startsWith('Use the clues'));
            for (const c of model.cats.slice(1)) if (!task.toLowerCase().includes(c.name.toLowerCase())) bad.push(`${where}: the task leaves out ${c.name}`);
            for (const n of sc.names) if (!names.includes(n) && has(all, n)) bad.push(`${where}: names "${n}", who is not in the puzzle`);
            for (const c of sc.categories) {
              for (const w of labelsOf(c)) {
                if (w === goalLabel || has(goalLabel, w)) continue;
                if (has(all, w)) bad.push(`${where}: names the ${c.name} item "${w}", which is not the answer`);
              }
            }
          }
        }
      }
    }
  }
  for (const b of bad.slice(0, 20)) console.log(`  ${b}`);
  check(`built stories match their grids (${built} stories, every topic and size)`, bad.length === 0, `${bad.length} problems`);

}
console.log(failed ? `${failed} checks failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
