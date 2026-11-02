// Cage Math, Sum Cross and Picture Grid tests: node test/kit-games-tests.js
// Cage Math uniqueness is checked with the brute-force counter, independent of
// the logic solver. Sum Cross and Picture Grid are checked by solving from the
// clues with sound deductions only, which can reach just one answer.
import { generateCageMath, countCageMath, solveCageMath, getCageMathHint, checkCageMath, CM_TIERS, CM_TECHNIQUES } from '../src/cage-math.js';
import { generateSumCross, solveSumCross, getSumCrossHint, checkSumCross, SC_TIERS, SC_TECHNIQUES, runsOf, combosFor } from '../src/sum-cross.js';
import { generatePictureGrid, solvePictureGrid, getPictureGridHint, checkPictureGrid, PG_TIERS, PG_TECHNIQUES, cluesOf } from '../src/picture-grid.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

// Play a puzzle by hints alone: every hint must move it on correctly.
function playByHints(p, hint, isSolved, apply) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 2000; guard++) {
    if (isSolved(entries)) return true;
    const h = hint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean)) return false;
    apply(entries, h);
  }
  return false;
}

const levels = (tiers) => (quick ? Object.keys(tiers).filter((_, i) => i % 2 === 0) : Object.keys(tiers));
const seeds = quick ? ['a'] : ['a', 'b'];

// ---------- Cage Math ----------
for (const difficulty of levels(CM_TIERS)) for (const seed of seeds) {
  const p = generateCageMath({ difficulty, seed });
  const name = `cm ${p.id}`;
  if (p.size <= 7) check(`${name} unique`, countCageMath(p, 2) === 1);
  const res = solveCageMath(p, p.givens);
  check(`${name} logic solves it`, res.solved && res.values.every((d, i) => d === p.solution[i]));
  check(`${name} latin answer`, [...Array(p.size).keys()].every((r) => new Set(p.solution.slice(r * p.size, r * p.size + p.size)).size === p.size));
  check(`${name} every cell in one cage`, p.cages.flatMap((c) => c.cells).sort((a, b) => a - b).every((c, i) => c === i));
  check(`${name} every step named`, p.solvePath.every((s) => CM_TECHNIQUES[s.technique] && s.why));
  check(`${name} same seed same puzzle`, generateCageMath({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p, getCageMathHint, (e) => checkCageMath(p, e).solved, (e, h) => { e[h.cell] = h.value ?? h.digit; }));
}
{
  const p = generateCageMath({ difficulty: 'easy', seed: 'm' });
  const e = Array(p.solution.length).fill(0);
  e[0] = (p.solution[0] % p.size) + 1;
  check('cm a wrong number is caught', getCageMathHint(p, e).kind === 'mistake');
  const q = generateCageMath({ difficulty: 'easy', seed: 'n', avoid: [p.fingerprint] });
  check('cm avoid gives a different puzzle', q.fingerprint !== p.fingerprint);
}

// ---------- Sum Cross ----------
for (const difficulty of levels(SC_TIERS)) for (const seed of seeds) {
  const p = generateSumCross({ difficulty, seed });
  const name = `sc ${p.id}`;
  const res = solveSumCross(p, p.givens);
  check(`${name} logic solves it`, res.solved && res.values.every((d, i) => d === p.solution[i]));
  const white = p.solution.map((d) => d > 0);
  const runs = runsOf(p.size, p.cols, white);
  check(`${name} runs add up, no repeats`, runs.every((r) => {
    const ds = r.cells.map((c) => p.solution[c]);
    return new Set(ds).size === ds.length && combosFor(ds.length, ds.reduce((a, b) => a + b, 0)).length > 0;
  }));
  check(`${name} givens are part of answer`, p.givens.every((d, i) => !d || d === p.solution[i]));
  check(`${name} every step named`, p.solvePath.every((s) => SC_TECHNIQUES[s.technique] && s.why));
  check(`${name} same seed same puzzle`, generateSumCross({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p, getSumCrossHint, (e) => checkSumCross(p, e).solved, (e, h) => { e[h.cell] = h.value ?? h.digit; }));
}

// ---------- Picture Grid ----------
for (const difficulty of levels(PG_TIERS)) for (const seed of seeds) {
  const p = generatePictureGrid({ difficulty, seed });
  const name = `pg ${p.id}`;
  const res = solvePictureGrid(p, p.givens);
  check(`${name} logic solves it`, res.solved && res.values.every((v, i) => (v === 1) === (p.solution[i] === 1)));
  const row = (r) => p.solution.slice(r * p.cols, (r + 1) * p.cols);
  const col = (c) => p.solution.filter((_, i) => i % p.cols === c);
  check(`${name} clues match the picture`, p.rowClues.every((cl, r) => JSON.stringify(cl) === JSON.stringify(cluesOf(row(r))))
    && p.colClues.every((cl, c) => JSON.stringify(cl) === JSON.stringify(cluesOf(col(c)))));
  check(`${name} has a picture name`, !!p.picture?.name);
  check(`${name} every step named`, p.solvePath.every((s) => PG_TECHNIQUES[s.technique] && s.why));
  check(`${name} same seed same puzzle`, generatePictureGrid({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p, getPictureGridHint, (e) => checkPictureGrid(p, e).solved, (e, h) => { for (const [c, v] of h.marks) e[c] = v; }));
}
{
  const p = generatePictureGrid({ difficulty: 'easy', seed: 'u' });
  const q = generatePictureGrid({ difficulty: 'easy', seed: 'v', usedPictures: [p.picture.id] });
  check('pg a used picture is not drawn again', q.picture.id !== p.picture.id);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
