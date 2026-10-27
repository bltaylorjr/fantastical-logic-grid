// The Fantastical Logic Grid: puzzle generator.
//
// Follows the design process: pick theme and categories, build the solution
// first, write a mix of true clues, then test for a single solution with the
// human-style solver, adding clues while it gets stuck and removing any it
// does not need. The result is graded against the chosen difficulty tier.
import { makeRng, hashString } from './rng.js';
import { THEMES, getTheme } from './themes.js';
import { resolveTopic, buildScenario } from './topics.js';
import { TIERS, CLUE_TYPES, SIZE_LIMITS } from './tiers.js';
import { candidateStream, clueHolds } from './clues.js';
import { isSolvable, solveWithTrace, TECHNIQUE_NAMES } from './solver.js';
import { makeLanguage, clueText } from './language.js';
import { buildStory, buildQuestions } from './story.js';
import { customWorld, customStory } from './classroom.js';

export const ENGINE_NAME = 'The Fantastical Logic Grid';
export const ENGINE_VERSION = '1.0.0';

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

function resolveOptions(opts = {}) {
  const tier = TIERS[opts.difficulty] || TIERS.easy;
  const seed = opts.seed != null ? String(opts.seed) : Math.floor(Math.random() * 2 ** 32).toString(36);
  const rng = makeRng(`${seed}|${tier.id}|${opts.theme || ''}|${opts.topic || ''}|${opts.categories || ''}x${opts.items || ''}`);
  const learn = opts.learning || {};
  // custom: an educator's own theme, cast and categories (classroom.js).
  const world = opts.custom ? customWorld(opts.custom) : null;
  // A "random" theme leans toward themes the player enjoys (learning.themeWeights).
  const themeWeights = learn.themeWeights && Object.fromEntries(THEMES.map((t) => [t.id, clamp(Number(learn.themeWeights[t.id]) || 1, [0.3, 3])]));
  const theme = world ? world.theme : opts.theme && opts.theme !== 'random' ? getTheme(opts.theme) : themeWeights ? getTheme(rng.weighted(themeWeights)) : rng.pick(THEMES);
  if (!theme) throw new Error(`Unknown theme "${opts.theme}". Try one of: ${THEMES.map((t) => t.id).join(', ')}`);
  // A topic only makes sense within a chosen theme; a random theme gets a random topic.
  const topic = world ? world.topic : resolveTopic(theme, opts.theme && opts.theme !== 'random' ? opts.topic : null, rng);
  const scenario = world ? world.scenario : buildScenario(theme, topic);
  let K = clamp(opts.categories || tier.defaultSize[0], SIZE_LIMITS.categories);
  let N = clamp(opts.items || tier.defaultSize[1], SIZE_LIMITS.items);
  // A custom world has only the categories and items the educator wrote.
  if (world) {
    K = Math.max(SIZE_LIMITS.categories[0], Math.min(K, scenario.categories.length + 1));
    N = Math.max(SIZE_LIMITS.items[0], Math.min(N, world.maxItems));
  }
  const customSize = K < tier.categories[0] || K > tier.categories[1] || N < tier.items[0] || N > tier.items[1];

  let weights = { ...tier.weights };
  if (Array.isArray(opts.clueTypes) && opts.clueTypes.length) {
    weights = {};
    for (const t of opts.clueTypes) if (CLUE_TYPES[t]) weights[t] = tier.weights[t] || 2;
    if (!Object.keys(weights).length) throw new Error('clueTypes has no known clue types');
  }
  // Learning only re-weights the tier's own clue types, within limits, so a
  // tier always keeps its character.
  if (learn.clueWeights) for (const t in weights) weights[t] *= clamp(Number(learn.clueWeights[t]) || 1, [0.5, 2]);
  // Exact gaps in an educator's own ordered list ("2 places earlier") read
  // awkwardly, so custom worlds use plain earlier/later clues instead.
  if (world && Object.keys(weights).length > 1) delete weights.diff;
  // effort -1 (gentler) to 1 (tougher): which of several puzzles that all meet
  // the tier is kept.
  const effort = clamp(Number(learn.effort) || 0, [-1, 1]);
  const clueCount = opts.clueCount ? Math.max(1, Math.floor(opts.clueCount)) : null;
  const questions = clamp(opts.questions ?? 3, [1, 6]);
  return { tier, seed, rng, theme, topic, scenario, K, N, customSize, weights, clueCount, questions, effort,
    extraParts: opts.storyParts, storyPrefs: opts.storyPrefs,
    customNames: opts.customNames, customTitle: opts.title, usedStories: opts.usedStories || [], timeLimitMs: opts.timeLimitMs ?? 15000,
    maxAttempts: opts.maxAttempts ?? 60 };
}

// Choose the goal category, the other categories and their items. Exported
// for the tests, which build stories for every topic and size.
export function buildModel(o) {
  const { rng, scenario, K, N, weights } = o;
  const wantsOrdinal = 'less' in weights || 'diff' in weights;
  const goalDef = rng.pick(scenario.categories);

  const pool = scenario.categories.slice();
  const chosen = [];
  const take = (c) => { if (c && !chosen.includes(c) && chosen.length < K - 1) chosen.push(c); };
  take(goalDef);
  if (wantsOrdinal && !chosen.some((c) => c.ordinal)) take(rng.pick(pool.filter((c) => c.ordinal)));
  for (const c of rng.shuffle(pool)) take(c);
  // Keep a stable column order: named categories first, numbered ones last.
  chosen.sort((p, q) => (p.ordinal ? 1 : 0) - (q.ordinal ? 1 : 0) || pool.indexOf(p) - pool.indexOf(q));

  let names = Array.isArray(o.customNames) ? [...new Set(o.customNames.map((s) => String(s).trim()).filter(Boolean))] : [];
  if (names.length < N) names = names.concat(rng.sample(scenario.names.filter((n) => !names.includes(n)), N - names.length));
  else names = names.slice(0, N);
  names.sort((p, q) => p.localeCompare(q));

  const cats = [{ id: 'name', name: cap(scenario.cast.one), labels: names, pos: 'is {x}', neg: 'is not {x}', ordinal: null }];
  for (const c of chosen) {
    if (c.ordinal) {
      const od = c.ordinal;
      const offset = rng.int(od.count - N + 1);
      const values = Array.from({ length: N }, (_, i) => od.start + (offset + i) * od.step);
      const gaps = Array.from({ length: N }, (_, d) => (d ? od.gap(d) : ''));
      cats.push({ id: c.id, name: c.name, noun: c.noun, note: c.note, labels: values.map(od.label), values, pos: c.pos, neg: c.neg,
        ordinal: { less: od.less, more: od.more, lessBy: od.lessBy, moreBy: od.moreBy, gaps } });
    } else {
      cats.push({ id: c.id, name: c.name, noun: c.noun, note: c.note, labels: rng.sample(c.items, N).sort((p, q) => p.localeCompare(q)), pos: c.pos, neg: c.neg, ordinal: null });
    }
  }
  return {
    K, N, cats, cast: scenario.cast,
    goal: { cat: cats.findIndex((c) => c.id === goalDef.id) },
    ordinals: cats.map((c, i) => (c.ordinal ? i : -1)).filter((i) => i > 0),
  };
}

export function randomSolution(rng, K, N) {
  const sol = [[...Array(N).keys()]];
  for (let c = 1; c < K; c++) sol.push(rng.shuffle([...Array(N).keys()]));
  return sol;
}

function grade(K, N, clues, tier, L) {
  const res = solveWithTrace(K, N, clues, tier.maxLevel, L, [], tier.whatIfDepth);
  const levels = [0, 0, 0, 0];
  let maxDepth = 0;
  for (const s of res.steps) {
    levels[s.level]++;
    maxDepth = Math.max(maxDepth, s.depth || 0);
  }
  const hardest = levels.reduce((m, n, i) => (n ? i : m), 0);
  const advanced = levels[2] + levels[3];
  const reasons = [];
  if (!res.solved) reasons.push('not solvable by deduction');
  if (hardest < tier.requireLevel) reasons.push(`too easy (hardest step is level ${hardest}, tier needs ${tier.requireLevel})`);
  if (advanced < tier.minAdvancedSteps) reasons.push(`needs at least ${tier.minAdvancedSteps} advanced steps, has ${advanced}`);
  if (levels[3] > tier.maxWhatIf) reasons.push(`too many what-if steps (${levels[3]})`);
  const score = res.steps.reduce((s, st) => s + [1, 2, 5, 12][st.level] + 3 * (st.depth || 0), 0);
  return { ...res, levels, hardest, advanced, maxDepth, reasons, meets: reasons.length === 0, score };
}

function selectClues(o, model, sol) {
  const { rng, tier, weights } = o;
  const { K, N } = model;
  const ctx = { K, N, sol, ordinals: model.ordinals, rng };
  const next = candidateStream(ctx, weights);

  // 1. Add clues until the puzzle can be solved (unique, no guessing).
  const chosen = [];
  const batch = Math.max(2, Math.ceil(K * N / 6));
  const cap = K * N * 6;
  while (!isSolvable(K, N, chosen, tier.maxLevel, tier.whatIfDepth)) {
    if (chosen.length >= cap) return null;
    for (let i = 0; i < batch; i++) {
      const c = next();
      if (!c) return null;
      chosen.push(c);
    }
  }

  // 2. Remove clues that are not needed, in the tier's preferred order.
  const rank = (c) => { const r = tier.removeFirst.indexOf(c.type); return r < 0 ? 99 : r; };
  const order = rng.shuffle(chosen).sort((p, q) => rank(p) - rank(q));
  let kept = chosen.slice();
  const removed = [];
  for (const c of order) {
    const trial = kept.filter((x) => x !== c);
    if (isSolvable(K, N, trial, tier.maxLevel, tier.whatIfDepth)) {
      kept = trial;
      removed.push(c);
    }
  }

  // 3. Grow toward the requested clue count with extra true clues that keep
  //    the tier's hardest technique necessary.
  if (o.clueCount && kept.length < o.clueCount) {
    const extras = rng.shuffle(removed);
    let tries = 0;
    while (kept.length < o.clueCount && tries++ < o.clueCount * 20) {
      const c = extras.length ? extras.pop() : next();
      if (!c) break;
      const trial = kept.concat([c]);
      if (tier.requireLevel > 0 && isSolvable(K, N, trial, tier.requireLevel - 1)) continue;
      kept = trial;
    }
  }

  // 4. Fix the display order now. Clue order is part of the puzzle for life
  //    (guideline), and what-if chain length can depend on it, so the order is
  //    checked again before it is accepted.
  for (let i = 0; i < 20; i++) {
    const order = rng.shuffle(kept);
    if (isSolvable(K, N, order, tier.maxLevel, tier.whatIfDepth)) return order;
  }
  return isSolvable(K, N, kept, tier.maxLevel, tier.whatIfDepth) ? kept : null;
}

// A puzzle is never repeated for a player: pass the fingerprints of puzzles
// they have played as `usedPuzzles` and the engine tries fresh answer tables
// until it finds one they have not seen. A puzzle asked for by its seed (a
// race, the daily puzzle, a shared link) is meant to be the same for
// everyone, so it is returned as is.
export function generatePuzzle(options = {}) {
  const used = new Set(options.usedPuzzles || []);
  if (options.seed != null || !used.size) return makePuzzle(options);
  const base = Math.floor(Math.random() * 2 ** 32).toString(36);
  let p = null;
  for (let i = 0; i < 6; i++) {
    p = makePuzzle({ ...options, seed: i ? `${base}~${i}` : base });
    if (!used.has(p.fingerprint)) return p;
  }
  p.notes.push('Could not find a puzzle this player has not seen; this one repeats an earlier grid.');
  return p;
}

// What makes two puzzles the same for a player: the same grid, answers and
// clues (the story is checked separately through usedStories).
export function puzzleFingerprint(p) {
  const grid = p.categories.map((c) => `${c.id}:${c.items.map((i) => i.label).join(',')}`).join(';');
  const answers = p.solution.map((row) => Object.values(row).join(',')).join(';');
  const clues = p.clues.map((c) => c.text).join('|');
  return `${p.theme.id}/${p.topic.id}-${hashString(`${grid}#${answers}#${clues}`).toString(36)}`;
}

function makePuzzle(options = {}) {
  const o = resolveOptions(options);
  const started = Date.now();
  let best = null;
  // With an effort setting, keep a few puzzles that meet the tier and choose
  // the gentlest or toughest; each one is still fully checked.
  const pool = [];
  const want = Math.abs(o.effort) >= 0.15 ? 4 : 1;

  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    const model = buildModel(o);
    const sol = randomSolution(o.rng, model.K, model.N);
    model.sol = sol;
    const L = makeLanguage(model);
    const clues = selectClues(o, model, sol);
    if (!clues) continue;
    const g = grade(model.K, model.N, clues, o.tier, L);
    const countGap = o.clueCount ? Math.abs(clues.length - o.clueCount) : 0;
    const fit = (g.meets ? 0 : 1000 + g.reasons.length * 100) + countGap * 10;
    if (!best || fit < best.fit) best = { fit, model, clues, attempt, score: g.score };
    if (fit === 0) pool.push({ fit, model, clues, attempt, score: g.score });
    if (pool.length >= want) break;
    // Searching for a better effort match gets half the time budget.
    if (pool.length && Date.now() - started > o.timeLimitMs / 2) break;
    if (Date.now() - started > o.timeLimitMs) break;
  }
  if (pool.length > 1) {
    pool.sort((p, q) => p.score - q.score);
    best = pool[Math.round(((o.effort + 1) / 2) * (pool.length - 1))];
  }
  if (!best) throw new Error('Could not build a puzzle with these options. Try a smaller size or more clue types.');
  return finalize(o, best, Date.now() - started);
}

function finalize(o, best, elapsedMs) {
  const { rng, tier, theme, topic, scenario } = o;
  const { model } = best;
  const { K, N, cats, sol } = model;
  const L = makeLanguage(model);

  const clues = best.clues;
  const g = grade(K, N, clues, tier, L);
  const ctx = { N, sol };
  if (!g.solved || clues.some((c) => !clueHolds(ctx, c))) throw new Error('Internal check failed: puzzle is not uniquely solvable');

  const itemId = (gl) => `${cats[Math.floor(gl / N)].id}:${gl % N}`;
  const ref = (gl) => ({ category: cats[Math.floor(gl / N)].id, item: gl % N, id: itemId(gl), label: L.label(gl) });

  const goal = { cat: model.goal.cat, item: rng.int(N) };
  const story = scenario.custom ? customStory({ scenario, goal, model, L, customTitle: o.customTitle, seed: o.seed })
    : buildStory({ rng, scenario, goal, model, L, customTitle: o.customTitle, usedStories: o.usedStories,
      extraParts: o.extraParts, storyPrefs: prefsFor(o.storyPrefs, theme.id, scenario.key) });
  const goalAbout = { cat: model.goal.cat, item: null };
  // buildStory picked the goal item; recover it from the answer for questions.
  goalAbout.item = sol[model.goal.cat][story.goalAnswer.item];
  const questions = buildQuestions({ rng, model, L, story, goal: goalAbout, count: o.questions });

  const notes = [];
  if (o.customSize) notes.push(`Custom size ${K} x ${N} is outside the ${tier.name} range (${tier.categories.join('-')} categories, ${tier.items.join('-')} items).`);
  if (o.clueCount && clues.length !== o.clueCount) {
    notes.push(clues.length > o.clueCount
      ? `${o.clueCount} clues is too few for a unique ${tier.name} solution at this size; the closest found uses ${clues.length}.`
      : `Only ${clues.length} clues could be used without making the puzzle easier than ${tier.name}.`);
  }
  if (!g.meets) notes.push(`Closest match to ${tier.name}: ${g.reasons.join('; ')}.`);

  const toRowCol = (x, y) => (Math.floor(x / N) < Math.floor(y / N) ? [x, y] : [y, x]);

  const puzzle = {
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,
    id: `${theme.id}-${topic.id}-${tier.id}-${K}x${N}-${o.seed}`,
    seed: o.seed,
    options: { difficulty: tier.id, theme: theme.id, topic: topic.id, categories: K, items: N, clueCount: o.clueCount, clueTypes: Object.keys(o.weights), questions: o.questions, ...(scenario.custom ? { custom: scenario.custom } : {}) },
    title: story.title,
    theme: { id: theme.id, name: theme.name },
    topic: { id: topic.id, name: topic.name, description: topic.description },
    // A true event behind the story (Echoes of History): shown on solve.
    ...(topic.history ? { history: { ...topic.history, source: { ...topic.history.source } } } : {}),
    art: { setting: scenario.art.setting, mood: scenario.art.mood },
    difficulty: { id: tier.id, name: tier.name, summary: tier.summary },
    cast: scenario.cast,
    categories: cats.map((c) => ({
      id: c.id, name: c.name, noun: c.noun || c.name.toLowerCase(), ordinal: !!c.ordinal,
      items: c.labels.map((label, i) => ({ id: `${c.id}:${i}`, label, ...(c.values ? { value: c.values[i] } : {}) })),
      pos: c.pos, neg: c.neg, ...(c.ordinal ? { phrases: c.ordinal } : {}),
      ...(c.note ? { note: c.note.replace(/\{one\}/g, scenario.cast.one).replace(/\{many\}/g, scenario.cast.many) } : {}),
    })),
    grid: gridLayout(cats),
    story: { id: story.id, parts: story.parts, title: story.title, paragraphs: story.paragraphs, text: story.text, goal: story.goalQuestion, ending: story.ending, wordCount: story.wordCount },
    clues: clues.map((c, i) => ({ number: i + 1, text: clueText(L, c, rng), type: c.type, typeName: CLUE_TYPES[c.type], logic: encodeClue(c, itemId) })),
    questions: questions.map((q, i) => ({
      number: i + 1, text: q.text, category: cats[q.askCat].id,
      options: cats[q.askCat].labels.map((_, j) => `${cats[q.askCat].id}:${j}`),
      answer: `${cats[q.answer.cat].id}:${q.answer.item}`,
    })),
    solution: sol[0].map((_, e) => Object.fromEntries(cats.map((c, ci) => [c.id, `${c.id}:${sol[ci][e]}`]))),
    answerKey: {
      columns: cats.map((c) => c.name),
      rows: sol[0].map((_, e) => cats.map((c, ci) => c.labels[sol[ci][e]])),
      questions: questions.map((q) => ({ question: q.text, answer: cats[q.answer.cat].labels[q.answer.item] })),
    },
    solvePath: g.steps.map((s, i) => ({
      step: i + 1, level: s.level, technique: s.technique, techniqueName: TECHNIQUE_NAMES[s.technique],
      clue: s.clue >= 0 ? s.clue + 1 : null,
      marks: s.sets.map(([x, y, v]) => { const [a, b] = toRowCol(x, y); return { a: itemId(a), b: itemId(b), mark: v > 0 ? 'O' : 'X' }; }),
      explanation: s.why, ...(s.chain ? { chain: s.chain, depth: s.depth } : {}),
    })),
    stats: {
      clueCount: clues.length,
      clueTypes: countBy(clues.map((c) => c.type)),
      steps: g.steps.length,
      stepsByLevel: { direct: g.levels[0], crossGrid: g.levels[1], advanced: g.levels[2], whatIf: g.levels[3] },
      hardestLevel: g.hardest,
      maxChainDepth: g.maxDepth,
      difficultyScore: g.score,
      meetsTier: g.meets,
      attempts: best.attempt + 1,
      generationMs: elapsedMs,
      ...(o.effort ? { effort: o.effort } : {}),
    },
    notes,
  };
  puzzle.fingerprint = puzzleFingerprint(puzzle);
  return puzzle;
}

// Standard staircase layout: every pair of categories appears exactly once.
// Columns: categories 1..K-1. Rows: category 0, then K-1 down to 2.
export function gridLayout(cats) {
  const K = cats.length;
  const columns = cats.slice(1).map((c) => c.id);
  const rowIdx = [0, ...Array.from({ length: K - 2 }, (_, i) => K - 1 - i)];
  const rows = rowIdx.map((i) => cats[i].id);
  const blocks = [];
  rowIdx.forEach((r, ri) => {
    for (let c = 1; c <= K - 1 - ri; c++) blocks.push({ row: cats[r].id, column: cats[c].id });
  });
  return { columns, rows, blocks };
}

// Part preferences are kept per story key; a theme's own entry (player-added
// parts) also applies to each of its topics.
function prefsFor(prefs, themeId, key) {
  if (!prefs) return null;
  const out = {};
  for (const src of [prefs[themeId], key !== themeId ? prefs[key] : null]) {
    for (const [k, m] of Object.entries(src || {})) out[k] = { ...(out[k] || {}), ...m };
  }
  return out;
}

function encodeClue(c, id) {
  const out = { type: c.type };
  for (const [k, v] of Object.entries(c)) {
    if (k === 'type') continue;
    if (k === 'o' || k === 'd') out[k] = v;
    else out[k] = Array.isArray(v) ? v.map(id) : id(v);
  }
  return out;
}

function countBy(arr) {
  return arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
