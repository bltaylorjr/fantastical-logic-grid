// Star Field tests: node engine/test/sf-tests.js [--quick]
// Uniqueness is checked with the brute-force counter, independent of the
// logic solver; then the solver, the hints and the saved-puzzle checks.
import { generateStarField, countStarField, solveStarField, getStarFieldHint, checkStarField, SF_TIERS, SF_TECHNIQUES } from '../src/star-field.js';
import { OPS } from '../src/sf-ops.js';
import { def } from '../../modules/star-field/game.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

function playByHints(p) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 3000; guard++) {
    if (checkStarField(p, entries).solved) return true;
    const h = getStarFieldHint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean) || !h.marks.length) return false;
    for (const [c, v] of h.marks) entries[c] = v;
  }
  return false;
}

function rulesKept(p) {
  const N = p.size, K = p.stars, s = p.solution;
  for (let k = 0; k < N; k++) {
    let r = 0, c = 0, g = 0;
    for (let j = 0; j < N; j++) { r += s[k * N + j] === 1; c += s[j * N + k] === 1; }
    for (let i = 0; i < N * N; i++) g += p.regions[i] === k && s[i] === 1;
    if (r !== K || c !== K || g !== K) return false;
  }
  for (let i = 0; i < N * N; i++) {
    if (s[i] !== 1) continue;
    const r = Math.floor(i / N), c = i % N;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && cc >= 0 && rr < N && cc < N && s[rr * N + cc] === 1) return false;
    }
  }
  return true;
}

const levels = quick ? Object.keys(SF_TIERS).filter((_, i) => i % 2 === 0) : Object.keys(SF_TIERS);
const seeds = quick ? ['a'] : ['a', 'b'];

for (const difficulty of levels) {
  const tier = SF_TIERS[difficulty];
  const sizes = quick ? [tier.sizes[0]] : tier.sizes;
  for (const size of sizes) for (const seed of seeds) {
    const p = generateStarField({ difficulty, size, seed });
    const name = `sf ${p.id}`;
    check(`${name} size`, p.size === size && p.stars === tier.stars);
    check(`${name} N regions`, new Set(p.regions).size === p.size);
    check(`${name} answer keeps the rules`, rulesKept(p));
    check(`${name} unique by brute force`, countStarField(p, 2) === 1);
    const res = solveStarField(p);
    check(`${name} logic solves it`, res.solved && res.values.every((v, i) => (v === 1) === (p.solution[i] === 1)));
    check(`${name} level fits`, p.hardestTechnique <= tier.maxTech, `hardest ${p.hardestTechnique}`);
    check(`${name} every step named`, p.solvePath.every((s) => SF_TECHNIQUES[s.technique] && s.why && s.techniqueName && s.marks.length));
    check(`${name} same seed same puzzle`, generateStarField({ difficulty, size, seed }).fingerprint === p.fingerprint);
    check(`${name} plays by hints`, playByHints(p));
    check(`${name} survives cleanPuzzle`, JSON.stringify(def.cleanPuzzle(JSON.parse(JSON.stringify(p)))?.regions) === JSON.stringify(p.regions));
  }
}

{
  const p = generateStarField({ difficulty: 'easy', seed: 'm' });
  const e = Array(p.solution.length).fill(0);
  const blank = p.solution.indexOf(2);
  e[blank] = 1;
  const h = getStarFieldHint(p, e);
  check('sf a wrong star is caught', h.kind === 'mistake' && h.cells.includes(blank) && h.levels.length === 3);
  const e2 = Array(p.solution.length).fill(0);
  e2[p.solution.indexOf(1)] = 2;
  check('sf a wrong dot is caught', getStarFieldHint(p, e2).kind === 'mistake');
  check('sf a solved grid says done', getStarFieldHint(p, p.solution).kind === 'done');
  const q = generateStarField({ difficulty: 'easy', seed: 'm', avoid: [p.fingerprint] });
  check('sf avoid gives a different puzzle', q.fingerprint !== p.fingerprint);
  check('sf ops generate', OPS.generate({ difficulty: 'basic', seed: 'o' }).game === 'sf');
  check('sf ops hint', OPS.hint({ puzzle: p, entries: e }).kind === 'mistake');
  check('sf story', !!p.story?.title && !!p.story?.intro && !!p.story?.ending);

  // Saved or opened puzzles are checked strictly.
  const bad = (f) => { const x = JSON.parse(JSON.stringify(p)); f(x); return def.cleanPuzzle(x) === null; };
  check('sf clean: wrong size', bad((x) => { x.size = 13; }));
  check('sf clean: region out of range', bad((x) => { x.regions[0] = 99; }));
  check('sf clean: answer breaks a rule', bad((x) => { const i = x.solution.indexOf(1); x.solution[i] = 2; x.solution[(i + 2) % x.solution.length] = 1; }));
  check('sf clean: split region', bad((x) => {
    const N = x.size, k = x.regions[0];
    const nearK = (i) => [i - N, i + N, i % N ? i - 1 : -1, i % N < N - 1 ? i + 1 : -1].some((y) => y >= 0 && y < N * N && x.regions[y] === k);
    const far = x.regions.findIndex((r, i) => r !== k && x.solution[i] === 2 && !nearK(i));
    x.regions[far] = k;
  }));
  check('sf clean: not an object', def.cleanPuzzle('x') === null && def.cleanPuzzle(null) === null);
  const c = def.cleanPuzzle({ ...JSON.parse(JSON.stringify(p)), story: { title: '<b>x</b>'.repeat(100) }, extra: 'nope' });
  check('sf clean: trims and drops extras', c && c.story.title.length <= 80 && !('extra' in c));
}

{
  // A practice request steers the pick toward puzzles that use the step.
  const p = generateStarField({ difficulty: 'hard', seed: 'p', practice: 'groups' });
  check('sf practice step used', p.techniques.includes('groups'));
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
