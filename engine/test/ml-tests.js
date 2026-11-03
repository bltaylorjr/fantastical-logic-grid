// More or Less tests: node engine/test/ml-tests.js [--quick]
// Uniqueness is checked with the brute-force counter, independent of the logic
// solver, on grids up to 7×7.
import { generateMoreOrLess, countMoreOrLess, solveMoreOrLess, getMoreOrLessHint, checkMoreOrLess, ML_TIERS, ML_TECHNIQUES, edgesOf } from '../src/more-or-less.js';
import { def } from '../../modules/more-or-less/game.js';
import { themeStoryChecks } from './kit-story-checks.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

// Play a puzzle by hints alone: every hint must move it on correctly.
function playByHints(p) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 2000; guard++) {
    if (checkMoreOrLess(p, entries).solved) return true;
    const h = getMoreOrLessHint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean) || h.digit !== p.solution[h.cell]) return false;
    entries[h.cell] = h.digit;
  }
  return false;
}

const levels = quick ? Object.keys(ML_TIERS).filter((_, i) => i % 2 === 0) : Object.keys(ML_TIERS);
const seeds = quick ? ['a'] : ['a', 'b'];
for (const difficulty of levels) for (const seed of seeds) {
  const p = generateMoreOrLess({ difficulty, seed });
  const N = p.size, name = `ml ${p.id}`;
  if (N <= 7) check(`${name} unique`, countMoreOrLess(p, 2) === 1);
  const res = solveMoreOrLess(p);
  check(`${name} logic solves it`, res.solved && res.values.every((d, i) => d === p.solution[i]));
  check(`${name} level fits`, res.hardest <= ML_TIERS[difficulty].maxTech && p.hardestTechnique === res.hardest);
  check(`${name} latin answer`, [...Array(N).keys()].every((k) => new Set(p.solution.slice(k * N, k * N + N)).size === N && new Set(p.solution.filter((_, i) => i % N === k)).size === N));
  check(`${name} signs fit the answer`, edgesOf(N, p.signs).every(([a, b]) => p.solution[a] < p.solution[b]));
  check(`${name} givens are part of the answer`, p.givens.every((d, i) => !d || d === p.solution[i]));
  check(`${name} every step named`, p.solvePath.length > 0 && p.solvePath.every((s) => ML_TECHNIQUES[s.technique] && s.techniqueName && s.why));
  check(`${name} has a story`, !!p.story?.title && !!p.story.intro && !!p.story.ending);
  check(`${name} same seed same puzzle`, generateMoreOrLess({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p));
  check(`${name} survives cleanPuzzle`, JSON.stringify(def.cleanPuzzle(JSON.parse(JSON.stringify(p)))?.signs) === JSON.stringify(p.signs));
  check(`${name} notes never rule out the answer`, p.solution.every((d, i) => def.allowed(p, i, (x) => p.givens[x]) & (1 << (d - 1))));
  check(`${name} labels name the signs`, p.signs.length === 0 || p.solution.some((_, i) => /than the cell/.test(def.cellLabel(p, i))));
}
{
  const p = generateMoreOrLess({ difficulty: 'easy', seed: 'm' });
  const e = Array(p.solution.length).fill(0);
  const c = p.givens.findIndex((d) => !d);
  e[c] = (p.solution[c] % p.size) + 1;
  check('ml a wrong number is caught', getMoreOrLessHint(p, e).kind === 'mistake');
  const q = generateMoreOrLess({ difficulty: 'easy', seed: 'm', avoid: [p.fingerprint] });
  check('ml avoid gives a different puzzle', q.fingerprint !== p.fingerprint);
  const bad = JSON.parse(JSON.stringify(p));
  bad.signs[0].lt = !bad.signs[0].lt;
  check('ml cleanPuzzle refuses a sign that does not fit', def.cleanPuzzle(bad) === null);
  check('ml cleanPuzzle refuses junk', def.cleanPuzzle({ size: 5, signs: 'x' }) === null && def.cleanPuzzle(null) === null);
  const prac = generateMoreOrLess({ difficulty: 'medium', seed: 'p', practice: 'signChain' });
  check('ml practice puzzles use the step', prac.techniques.includes('signChain'));
  const s5 = generateMoreOrLess({ difficulty: 'easy', size: 4, seed: 's' });
  check('ml size option is honoured', s5.size === 4);
}

// ---------- story themes ----------
themeStoryChecks(check, 'ml', generateMoreOrLess, def);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
