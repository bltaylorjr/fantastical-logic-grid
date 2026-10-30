// Number Place tests: node test/number-place-tests.js
// Uniqueness is checked with the brute-force counter, independent of the logic solver.
import {
  generateNumberPlace, makeShape, countSolutions, solveLogically, getNumberPlaceHint,
  isNumberPlaceSolved, formatNumberPlaceText, NP_TIERS, NP_TECHNIQUES,
} from '../src/puzzles/number-place.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

const cases = [];
for (const difficulty of Object.keys(NP_TIERS)) for (const seed of ['a', 'b']) cases.push({ difficulty, seed });
cases.push({ difficulty: 'medium', seed: 'd', variants: ['diagonal'] });
cases.push({ difficulty: 'easy', seed: 'p', variants: ['parity'] });
cases.push({ difficulty: 'hard', seed: 'dp', variants: ['diagonal', 'parity'] });

for (const opts of cases) {
  const t0 = Date.now();
  const p = generateNumberPlace(opts);
  const name = p.id;
  const shape = makeShape(p.size, p.variants);
  const mask = p.variants.includes('parity') ? [...Array(p.size ** 2)].map((_, i) => p.evenCells.includes(i)) : null;
  const { count } = countSolutions(shape, p.givens, 2, mask);
  check(`${name} unique`, count === 1, `found ${count}`);
  const res = solveLogically(shape, p.givens, { maxLevel: NP_TIERS[opts.difficulty].maxLevel, evenMask: mask });
  check(`${name} solvable within tier`, res.solved);
  check(`${name} solver matches answer`, res.values.every((d, i) => d === p.solution[i]));
  check(`${name} uses its tier`, p.hardestTechnique >= NP_TIERS[opts.difficulty].minLevel, `hardest ${p.hardestTechnique}`);
  check(`${name} givens are part of answer`, p.givens.every((d, i) => !d || d === p.solution[i]));
  check(`${name} same seed same puzzle`, JSON.stringify(generateNumberPlace(opts).givens) === JSON.stringify(p.givens));
  check(`${name} every step named`, p.solvePath.every((s) => NP_TECHNIQUES[s.technique] && s.why));

  // Play through by hints alone: each hint must place a correct number.
  const entries = Array(p.size ** 2).fill(0);
  let guard = 0, hintOk = true;
  while (!isNumberPlaceSolved(p, entries) && guard++ < 200) {
    const h = getNumberPlaceHint(p, entries);
    if (h.kind !== 'step' || h.digit !== p.solution[h.cell] || h.levels.length !== 3) { hintOk = false; break; }
    entries[h.cell] = h.digit;
  }
  check(`${name} hints finish the puzzle`, hintOk && isNumberPlaceSolved(p, entries));
  const wrongCell = p.givens.findIndex((d) => !d);
  const bad = Array(p.size ** 2).fill(0);
  bad[wrongCell] = (p.solution[wrongCell] % p.size) + 1;
  check(`${name} hint spots a mistake`, getNumberPlaceHint(p, bad).kind === 'mistake');
  check(`${name} prints`, formatNumberPlaceText(p).split('\n').length > p.size - 1);
  console.log(`${name.padEnd(36)} givens ${String(p.givens.filter(Boolean).length).padStart(2)}  hardest ${p.hardestTechnique}  ${Date.now() - t0} ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
