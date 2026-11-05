// Mode-off check: the Lab modes (src/modes.js) must not change any puzzle a
// live player gets. Run once to save a baseline, then again after a change:
//   node test/mode-off-check.js save  /tmp/flg-baseline.json
//   node test/mode-off-check.js check /tmp/flg-baseline.json
// Every case is generated with no time limit (timeLimitMs is set very high),
// so the result depends only on the options and the seed, never on how fast
// the machine is. generationMs is the only field left out of the comparison.
import { writeFileSync, readFileSync } from 'node:fs';
import { generatePuzzle, getHint, describeOptions } from '../src/index.js';

const [, , cmd = 'check', file = '/tmp/flg-baseline.json'] = process.argv;
const TIERS = ['basic', 'easy', 'medium', 'hard', 'expert', 'mensa', 'theorist'];
const THEMES = ['mystery', 'action', 'adventure', 'holiday', 'occasion', 'fantasy', 'scifi', 'sports', 'cooking', 'pets', 'town', 'parks', 'travel', 'wonders', 'music', 'nautical', 'farm', 'science', 'math', 'biology', 'astronomy', 'paradox', 'seasons', 'random'];
const cases = [];
let n = 0;
for (const seed of ['a1', 'b2', 'c3', 'd4', 'e5']) {
  for (const tier of TIERS) {
    if (tier === 'theorist' && !['a1', 'd4'].includes(seed)) continue;
    const theme = THEMES[n++ % THEMES.length];
    cases.push({ difficulty: tier, theme, seed });
  }
}
// Sizes, topics, clue counts, clue types, cast names and the mode option
// itself (mode off: missing, null, '' or 'standard').
const extra = [
  { difficulty: 'easy', theme: 'mystery', topic: 'heist', categories: 4, items: 5, seed: 's1' },
  { difficulty: 'medium', theme: 'holiday', topic: 'halloween', categories: 3, items: 6, seed: 's2' },
  { difficulty: 'hard', theme: 'sports', categories: 5, items: 4, seed: 's3' },
  { difficulty: 'basic', theme: 'pets', categories: 3, items: 3, seed: 's4' },
  { difficulty: 'expert', theme: 'scifi', categories: 4, items: 6, seed: 's5' },
  { difficulty: 'medium', theme: 'cooking', clueCount: 14, seed: 's6' },
  { difficulty: 'hard', theme: 'music', clueTypes: ['not', 'less', 'diff', 'either'], seed: 's7' },
  { difficulty: 'easy', theme: 'occasion', customNames: ['Mia', 'Leo', 'Grandpa Joe', 'Ava'], seed: 's8' },
  { difficulty: 'medium', theme: 'random', seed: 's9', questions: 5 },
  { difficulty: 'easy', theme: 'mystery', seed: 'm1', mode: null },
  { difficulty: 'easy', theme: 'mystery', seed: 'm1', mode: '' },
  { difficulty: 'medium', theme: 'fantasy', seed: 'm2', mode: 'standard' },
  { difficulty: 'hard', theme: 'travel', seed: 'm3', mode: undefined },
  { difficulty: 'easy', theme: 'stories', seed: 'p1' },
  { difficulty: 'mensa', theme: 'nautical', categories: 5, items: 6, seed: 's10' },
  { difficulty: 'basic', theme: 'farm', categories: 3, items: 4, seed: 's11', usedStories: ['farm|t0|o0|i0|m0|lanimal.0|e0'] },
  { difficulty: 'easy', theme: 'math', seed: 's12', learning: { effort: 0.5 } },
  { difficulty: 'medium', theme: 'biology', seed: 's13' },
  { difficulty: 'hard', theme: 'astronomy', seed: 's14' },
  { difficulty: 'expert', theme: 'wonders', seed: 's15' },
  { difficulty: 'easy', theme: 'parks', items: 5, seed: 's16' },
  { difficulty: 'basic', theme: 'town', seed: 's17' },
  { difficulty: 'medium', theme: 'paradox', seed: 's18' },
  { difficulty: 'easy', theme: 'seasons', seed: 's19' },
  { difficulty: 'hard', theme: 'adventure', topic: 'pirates', seed: 's20' },
  { difficulty: 'basic', theme: 'action', seed: 's21' },
  { difficulty: 'easy', theme: 'science', seed: 's22' },
  { difficulty: 'medium', theme: 'farm', seed: 's23' },
  { difficulty: 'expert', theme: 'mystery', seed: 's24' },
];
cases.push(...extra);

const out = { options: JSON.stringify(describeOptions()), puzzles: [] };
const t0 = Date.now();
for (const c of cases) {
  const p = generatePuzzle({ ...c, timeLimitMs: 1e9 });
  delete p.stats.generationMs;
  const hint = getHint(p, []);
  out.puzzles.push({ case: c, json: JSON.stringify(p), hint: JSON.stringify(hint) });
}
console.log(`${cases.length} puzzles in ${Math.round((Date.now() - t0) / 1000)} s`);
if (cmd === 'save') {
  writeFileSync(file, JSON.stringify(out));
  console.log(`Saved baseline to ${file}`);
} else {
  const base = JSON.parse(readFileSync(file, 'utf8'));
  let bad = 0;
  if (base.options !== out.options) { bad++; console.log('DIFF describeOptions()'); }
  if (base.puzzles.length !== out.puzzles.length) { bad++; console.log('DIFF case count'); }
  base.puzzles.forEach((b, i) => {
    const o = out.puzzles[i];
    if (!o || b.json !== o.json) { bad++; console.log('DIFF puzzle', JSON.stringify(b.case)); }
    else if (b.hint !== o.hint) { bad++; console.log('DIFF hint', JSON.stringify(b.case)); }
  });
  console.log(bad ? `${bad} differences` : `All ${base.puzzles.length} puzzles, their first hints and describeOptions() are byte-identical.`);
  process.exit(bad ? 1 : 0);
}
