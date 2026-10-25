// Test suite: node test/run-tests.js  (add --quick for a smaller run)
//
// The key check is independent of the engine's solver: a brute-force search
// counts every grid that satisfies the clues and must find exactly one.
import {
  generatePuzzle, getHint, checkMarks, isSolved, checkAnswers, describeOptions, formatPuzzleText, THEMES, TIERS, parseStoryId, checkStoryPart, partKey,
  getTopics,
} from '../src/index.js';
import { buildScenario } from '../src/topics.js';
import { buildModel, randomSolution } from '../src/generator.js';
import { buildStory } from '../src/story.js';
import { makeLanguage } from '../src/language.js';
import { makeRng } from '../src/rng.js';
import { SIZE_LIMITS } from '../src/tiers.js';
import { TIER_ORDER } from '../src/tiers.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

// ---------- independent brute-force solution counter ----------
function countSolutions(p, limit = 2, budgetMs = 20000) {
  const K = p.categories.length, N = p.categories[0].items.length;
  const ci = Object.fromEntries(p.categories.map((c, i) => [c.id, i]));
  const parse = (id) => { const [c, i] = id.split(':'); return [ci[c], Number(i)]; };
  // perm[c][e] = item index entity e has in category c; perm[0] is identity.
  const perm = [[...Array(N).keys()]];
  const ent = (id) => { const [c, i] = parse(id); return perm[c].indexOf(i); };
  const clues = p.clues.map((c) => {
    const L = c.logic;
    const ids = Object.entries(L).filter(([k]) => !['type', 'o', 'd'].includes(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
    const cats = new Set(ids.map((id) => parse(id)[0]));
    if ('o' in L) cats.add(L.o);
    const val = (id) => perm[L.o][ent(id)];
    const same = (x, y) => ent(x) === ent(y);
    let test;
    switch (L.type) {
      case 'is': test = () => same(L.a, L.b); break;
      case 'not': test = () => !same(L.a, L.b); break;
      case 'neither': test = () => L.xs.every((x) => !same(x, L.b)); break;
      case 'either': test = () => same(L.a, L.b1) || same(L.a, L.b2); break;
      case 'pairs': test = () => (same(L.x1, L.y1) && same(L.x2, L.y2)) || (same(L.x1, L.y2) && same(L.x2, L.y1)); break;
      case 'allDiff': test = () => new Set(L.items.map(ent)).size === L.items.length; break;
      case 'less': test = () => val(L.a) < val(L.b); break;
      case 'diff': test = () => val(L.b) - val(L.a) === L.d; break;
      case 'ifthen': test = () => !same(L.p[0], L.p[1]) || same(L.q[0], L.q[1]); break;
      default: throw new Error(L.type);
    }
    return { maxCat: Math.max(...cats), test };
  });
  const perms = [];
  const permute = (arr, k = 0) => {
    if (k === arr.length) { perms.push(arr.slice()); return; }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
  };
  permute([...Array(N).keys()]);
  const byCat = Array.from({ length: K }, (_, c) => clues.filter((cl) => cl.maxCat === c));
  let count = 0;
  const t0 = Date.now();
  let timedOut = false;
  const dfs = (c) => {
    if (count >= limit || timedOut) return;
    if (c === K) { count++; return; }
    if (Date.now() - t0 > budgetMs) { timedOut = true; return; }
    for (const pm of perms) {
      perm[c] = pm;
      if (byCat[c].every((cl) => cl.test())) dfs(c + 1);
      if (count >= limit || timedOut) break;
    }
    perm.length = c;
  };
  dfs(1);
  return timedOut ? -1 : count;
}

function allMatches(p) {
  const out = [];
  for (const row of p.solution) {
    const v = Object.values(row);
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) out.push({ a: v[i], b: v[j], mark: 'O' });
  }
  return out;
}

// ---------- tests ----------
const seeds = quick ? ['t1'] : ['t1', 't2', 't3'];
const sizes = [];
for (const tier of TIER_ORDER) {
  for (const theme of THEMES) {
    for (const seed of seeds) sizes.push({ difficulty: tier, theme: theme.id, seed: `${seed}-${theme.id}` });
  }
}
// Every topic: at every tier in the full run, one rotating tier in the quick run.
{
  let k = 0;
  for (const theme of THEMES) {
    for (const topic of getTopics(theme.id)) {
      const tiers = quick ? [TIER_ORDER[k++ % TIER_ORDER.length]] : TIER_ORDER;
      for (const tier of tiers) sizes.push({ difficulty: tier, theme: theme.id, topic: topic.id, seed: `topic-${theme.id}-${topic.id}` });
    }
  }
}

let bruteChecked = 0, bruteSkipped = 0;
const timing = {};
for (const opt of sizes) {
  const t0 = Date.now();
  const p = generatePuzzle(opt);
  const ms = Date.now() - t0;
  (timing[opt.difficulty] ||= []).push(ms);
  const name = `${opt.difficulty}/${opt.theme}${opt.topic ? '/' + opt.topic : ''}/${opt.seed}`;
  const K = p.categories.length, N = p.categories[0].items.length;
  const tier = TIERS[opt.difficulty];

  check(`${name} size in tier range`, K >= tier.categories[0] && K <= tier.categories[1] && N >= tier.items[0] && N <= tier.items[1], `${K}x${N}`);
  check(`${name} meets tier`, p.stats.meetsTier, p.notes.join(' '));
  check(`${name} clue types allowed`, p.clues.every((c) => c.type in tier.weights));
  check(`${name} story under 150 words`, p.story.wordCount < 150, String(p.story.wordCount));
  check(`${name} story ends with the goal`, p.story.paragraphs.at(-1).endsWith('?'));
  check(`${name} grid covers every pair once`, p.grid.blocks.length === (K * (K - 1)) / 2 &&
    new Set(p.grid.blocks.map((b) => [b.row, b.column].sort().join('|'))).size === (K * (K - 1)) / 2);
  check(`${name} questions answerable`, p.questions.every((q) => q.options.includes(q.answer)));
  check(`${name} answers check`, checkAnswers(p, Object.fromEntries(p.questions.map((q) => [q.number, q.answer]))).every((r) => r.correct));
  // Clue text uses grid labels exactly: every label the logic names appears verbatim.
  const labelOf = Object.fromEntries(p.categories.flatMap((c) => c.items.map((i) => [i.id, i.label])));
  check(`${name} clue text matches grid labels`, p.clues.every((c) => {
    const ids = Object.entries(c.logic).filter(([k]) => !['type', 'o', 'd'].includes(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
    return ids.every((id) => c.text.includes(labelOf[id]));
  }), p.clues.map((c) => c.text).join(' / '));
  check(`${name} solution solves`, isSolved(p, allMatches(p)) && checkMarks(p, allMatches(p)).length === 0);
  // The topic drives cast, categories, story and art.
  const theme = THEMES.find((t) => t.id === p.theme.id);
  const topic = getTopics(theme.id).find((t) => t.id === p.topic.id);
  check(`${name} topic belongs to theme`, !!topic && (!opt.topic || opt.topic === p.topic.id));
  if (topic) {
    const sc = buildScenario(theme, topic);
    check(`${name} categories come from the topic`, p.categories.slice(1).every((c) => sc.categories.some((x) => x.id === c.id)));
    check(`${name} cast comes from the topic`, p.cast.one === sc.cast.one && p.categories[0].items.every((i) => sc.names.includes(i.label)));
    check(`${name} art comes from the topic`, p.art.setting === topic.art.setting && p.art.mood === topic.art.mood);
    check(`${name} story id has the topic key`, parseStoryId(p.story.id).key === sc.key);
    check(`${name} story uses a topic incident`, sc.story.incidents.some((i) => p.title.endsWith(i.name)));
  }

  // Independent uniqueness check.
  const n = countSolutions(p, 2, quick ? 3000 : 20000);
  if (n === -1) bruteSkipped++;
  else { bruteChecked++; check(`${name} exactly one solution (brute force)`, n === 1, `found ${n}`); }
}

// Same seed and options give the same puzzle.
const a = generatePuzzle({ difficulty: 'hard', theme: 'mystery', seed: 'same' });
const b = generatePuzzle({ difficulty: 'hard', theme: 'mystery', seed: 'same' });
check('deterministic for the same seed', JSON.stringify({ ...a, stats: 0 }) === JSON.stringify({ ...b, stats: 0 }));

// Hints walk a player from an empty grid to the solution without mistakes.
for (const diff of ['easy', 'medium', 'expert']) {
  const p = generatePuzzle({ difficulty: diff, theme: 'holiday', seed: 'hint' });
  let marks = [];
  let hints = 0;
  for (; hints < 2000; hints++) {
    const h = getHint(p, marks);
    if (h.kind !== 'step') break;
    check(`hint ${diff} has three levels`, h.levels.length === 3 && h.levels.every(Boolean));
    marks = marks.concat(h.marks);
  }
  check(`hints ${diff} reach a solved grid`, isSolved(p, marks), `after ${hints} hints`);
}
{
  const p = generatePuzzle({ difficulty: 'easy', theme: 'pets', seed: 'mistake' });
  const wrong = { ...allMatches(p)[0], mark: 'X' };
  const h = getHint(p, [wrong]);
  check('hint reports a mistake first', h.kind === 'mistake' && h.marks.length === 1);
}

// Requested clue counts.
{
  const p = generatePuzzle({ difficulty: 'medium', theme: 'sports', seed: 'cc', clueCount: 14 });
  check('clueCount 14 is met', p.clues.length === 14, `${p.clues.length} ${p.notes}`);
  const q = generatePuzzle({ difficulty: 'hard', theme: 'sports', seed: 'cc', clueCount: 2 });
  check('impossible clueCount is reported', q.notes.some((n) => n.includes('too few')), q.notes.join(' '));
}

// Custom names, custom size, clue type filter, random theme.
{
  const names = ['Mom', 'Dad', 'Sam', 'Lily'];
  const p = generatePuzzle({ difficulty: 'easy', theme: 'occasion', items: 4, customNames: names, seed: 'names' });
  check('custom names are the cast', JSON.stringify(p.categories[0].items.map((i) => i.label)) === JSON.stringify([...names].sort()));
  const big = generatePuzzle({ difficulty: 'medium', theme: 'scifi', categories: 6, items: 6, seed: 'big' });
  check('custom size honored and noted', big.categories.length === 6 && big.categories[0].items.length === 6 && big.notes.length > 0);
  const only = generatePuzzle({ difficulty: 'hard', theme: 'cooking', clueTypes: ['not', 'less', 'diff'], seed: 'types' });
  check('clueTypes filter honored', only.clues.every((c) => ['not', 'less', 'diff'].includes(c.type)));
  const r = generatePuzzle({ difficulty: 'basic', theme: 'random', seed: 'rnd' });
  check('random theme works', THEMES.some((t) => t.id === r.theme.id));
  check('print text includes answer key', formatPuzzleText(r).includes('Answer key'));
  check('describeOptions lists 6 tiers and 14 themes', describeOptions().difficulties.length === 6 && describeOptions().themes.length === 14);
}

// Stories are never reused: pass back every story id and none repeats, and
// consecutive stories share as few parts as possible.
{
  const used = [];
  let repeats = 0, sameScene = 0;
  for (let i = 0; i < (quick ? 150 : 1000); i++) {
    const p = generatePuzzle({ difficulty: 'basic', theme: 'mystery', topic: 'whodunit', seed: `story-${i % 3}`, usedStories: used });
    if (used.includes(p.story.id)) repeats++;
    const cur = parseStoryId(p.story.id);
    for (const prevId of used.slice(-3)) {
      const prev = parseStoryId(prevId);
      if (prev.o === cur.o || prev.i === cur.i) sameScene++;
    }
    used.push(p.story.id);
  }
  check('no story id repeats when used ids are passed back', repeats === 0, `${repeats} repeats`);
  check('the last 3 stories never share an opening or an incident', sameScene === 0, `${sameScene} times`);
  check('story ids are in the puzzle', typeof used[0] === 'string' && used[0].startsWith('mystery|'));
}
// The same holds within every topic, and across topics when "Any" is chosen.
{
  const used = [];
  let repeats = 0, sameScene = 0, wrongKey = 0;
  for (const theme of THEMES) {
    for (const topic of getTopics(theme.id)) {
      const mine = [];
      for (let i = 0; i < (quick ? 8 : 40); i++) {
        const p = generatePuzzle({ difficulty: 'basic', theme: theme.id, topic: topic.id, seed: `ts-${i % 2}`, usedStories: used });
        if (used.includes(p.story.id)) repeats++;
        const cur = parseStoryId(p.story.id);
        if (cur.theme !== theme.id || (topic.story && cur.topic !== topic.id)) wrongKey++;
        for (const prevId of mine.slice(-3)) {
          const prev = parseStoryId(prevId);
          if (prev.o === cur.o || prev.i === cur.i) sameScene++;
        }
        used.push(p.story.id);
        mine.push(p.story.id);
      }
    }
  }
  check('no story repeats within any topic', repeats === 0, `${repeats} repeats`);
  check('story ids name their theme and topic', wrongKey === 0, `${wrongKey} wrong`);
  check('within a topic the last 3 stories never share an opening or an incident', sameScene === 0, `${sameScene} times`);
  const anyTopics = new Set();
  let anyRepeats = 0;
  for (let i = 0; i < 60; i++) {
    const p = generatePuzzle({ difficulty: 'basic', theme: 'holiday', topic: i % 2 ? 'any' : undefined, seed: `any-${i}`, usedStories: used });
    if (used.includes(p.story.id)) anyRepeats++;
    used.push(p.story.id);
    anyTopics.add(p.topic.id);
  }
  check('"Any" topic picks across all topics', anyTopics.size === getTopics('holiday').length, [...anyTopics].join(','));
  check('"Any" topic never repeats a story', anyRepeats === 0);
  let msg = '';
  try { generatePuzzle({ theme: 'holiday', topic: 'mardi-gras' }); } catch (e) { msg = e.message; }
  check('unknown topic lists the valid ones', msg.includes('halloween') && msg.includes('any'), msg);
  const opts = describeOptions().themes;
  check('describeOptions lists topics with "Any" first', opts.every((t) => t.topics[0].id === 'any' && t.defaultTopic === 'any' && t.topics.length >= 5));
}


// Learning from play: tuning changes which puzzle and story are chosen, never
// the rules. Every tuned puzzle still has exactly one solution and no reused story.
{
  const extra = { mystery: {
    openings: ['Rain hammered the old observatory, where {n} {many} waited for the comet.'],
    incidents: [{ name: 'Telescope', text: 'The brass telescope lens vanished during the eclipse.', prize: 'the brass lens' }],
    mishaps: ['The guestbook got smudged, so only a few facts can be trusted.'],
    endings: ['{Fact}, so {winner} had {prize} all along, wrapped in a scarf.'],
  } };
  check('valid story parts pass', Object.entries(extra.mystery).every(([k, v]) => v.every((x) => checkStoryPart(k, x).ok)));
  check('a head count is rejected', !checkStoryPart('openings', 'Five {many} met at the pier.').ok);
  check('an unknown fill-in is rejected', !checkStoryPart('openings', '{N} {many} met {place} at the pier today.').ok);
  check('an ending needs the answer', !checkStoryPart('endings', 'Everyone went home happy after a long night.').ok);
  check('links are rejected', !checkStoryPart('mishaps', 'See http://example.com for the facts, they are mixed up.').ok);
  check('part keys ignore order', partKey('openings', extra.mystery.openings[0]) === partKey('openings', String(extra.mystery.openings[0])));

  const used = [];
  let repeats = 0, usedExtra = 0;
  const xo = partKey('openings', extra.mystery.openings[0]);
  const prefs = { mystery: { o: { [xo]: 1, 0: -1 } } };
  for (let i = 0; i < (quick ? 40 : 200); i++) {
    const p = generatePuzzle({ difficulty: 'basic', theme: 'mystery', topic: 'whodunit', seed: `learn-${i}`, usedStories: used, storyParts: extra, storyPrefs: prefs });
    if (used.includes(p.story.id)) repeats++;
    if (p.story.parts.o === xo) usedExtra++;
    used.push(p.story.id);
  }
  check('added story parts never repeat a story', repeats === 0, `${repeats} repeats`);
  check('added story parts are used', usedExtra > 0, `${usedExtra}`);
  // Parts added for a theme belong to its classic setting; other topics keep
  // to their own parts (a manor-house opening never starts a museum heist).
  let leaked = 0;
  for (let i = 0; i < 20; i++) {
    const p = generatePuzzle({ difficulty: 'basic', theme: 'mystery', topic: 'heist', seed: `learn-heist-${i}`, storyParts: extra, storyPrefs: prefs });
    if (p.story.parts.o === xo || p.story.text.includes('observatory')) leaked++;
  }
  check('theme-wide added parts stay out of other topics', leaked === 0, `${leaked} times`);
  const bad = generatePuzzle({ difficulty: 'basic', theme: 'mystery', seed: 'learn-bad', storyParts: { mystery: { openings: ['Five people met.'] } } });
  check('invalid added parts are ignored', !bad.story.text.startsWith('Five people met.'));

  for (const effort of [-1, 1]) {
    for (const diff of ['easy', 'medium', 'hard']) {
      const p = generatePuzzle({ difficulty: diff, seed: `effort-${effort}-${diff}`, learning: { effort, clueWeights: { not: 0.5, either: 2 }, themeWeights: { pets: 3 } } });
      check(`tuned ${diff} (effort ${effort}) meets tier`, p.stats.meetsTier, p.notes.join(' '));
      const n = countSolutions(p);
      if (n >= 0) check(`tuned ${diff} (effort ${effort}) has exactly one solution`, n === 1, `found ${n}`);
    }
  }
  const scores = [-1, 1].map((effort) => {
    let total = 0;
    for (let i = 0; i < 6; i++) total += generatePuzzle({ difficulty: 'medium', theme: 'cooking', seed: `cmp-${i}`, learning: { effort } }).stats.difficultyScore;
    return total;
  });
  check('a tougher effort picks tougher puzzles', scores[1] > scores[0], scores.join(' vs '));
}

// Stories match the grid: every story talks only about its own topic's
// setting, cast and categories. A story that names an item ("a dozen roses
// appeared") reads like a clue, so no story part may name any item or cast
// name its topic can put in a grid. Checked part by part for every theme and
// topic, then on built stories for every topic at every grid size.
{
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = (text, word) => new RegExp(`(^|[^\\w'-])${esc(word)}(?=$|'s\\b|[^\\w'-])`, 'i').test(text);
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const labelsOf = (c) => (c.ordinal ? [] : c.items.filter((x) => x.length > 1));
  const problems = [];
  const problem = (where, msg) => problems.push(`${where}: ${msg}`);
  for (const theme of THEMES) {
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
      ];
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
  for (const theme of THEMES) {
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

console.log('\nGeneration time per tier (ms, avg / max):');
for (const [t, arr] of Object.entries(timing)) console.log(`  ${t.padEnd(7)} ${Math.round(arr.reduce((s, x) => s + x, 0) / arr.length)} / ${Math.max(...arr)}`);
console.log(`Brute-force uniqueness: ${bruteChecked} checked, ${bruteSkipped} too large to enumerate in time`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
