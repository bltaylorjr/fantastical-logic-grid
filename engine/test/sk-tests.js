// Skyline tests: node engine/test/sk-tests.js [--quick]
// Uniqueness is checked with the brute-force counter, independent of the logic
// solver, on grids up to 6×6 (7×7 too without --quick).
import { generateSkyline, countSkyline, solveSkyline, getSkylineHint, checkSkyline, SK_TIERS, SK_TECHNIQUES, cluesOf } from '../src/skyline.js';
import { def } from '../../modules/skyline/game.js';
import { themeStoryChecks } from './kit-story-checks.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

function playByHints(p) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 2000; guard++) {
    if (checkSkyline(p, entries).solved) return true;
    const h = getSkylineHint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean) || h.digit !== p.solution[h.cell]) return false;
    entries[h.cell] = h.digit;
  }
  return false;
}

const SIDES = ['top', 'bottom', 'left', 'right'];
const levels = quick ? Object.keys(SK_TIERS).filter((_, i) => i % 2 === 0) : Object.keys(SK_TIERS);
const seeds = quick ? ['a'] : ['a', 'b'];
for (const difficulty of levels) for (const seed of seeds) {
  const p = generateSkyline({ difficulty, seed });
  const N = p.size, name = `sk ${p.id}`;
  if (N <= (quick ? 6 : 7)) check(`${name} unique`, countSkyline(p, 2) === 1);
  const res = solveSkyline(p);
  check(`${name} logic solves it`, res.solved && res.values.every((d, i) => d === p.solution[i]));
  check(`${name} level fits`, res.hardest <= SK_TIERS[difficulty].maxTech && p.hardestTechnique === res.hardest);
  check(`${name} latin answer`, [...Array(N).keys()].every((k) => new Set(p.solution.slice(k * N, k * N + N)).size === N && new Set(p.solution.filter((_, i) => i % N === k)).size === N));
  const real = cluesOf(N, p.solution);
  check(`${name} edge numbers fit the answer`, SIDES.every((s) => p.clues[s].every((v, k) => !v || v === real[s][k])));
  check(`${name} givens are part of the answer`, p.givens.every((d, i) => !d || d === p.solution[i]));
  check(`${name} every step named`, p.solvePath.length > 0 && p.solvePath.every((s) => SK_TECHNIQUES[s.technique] && s.techniqueName && s.why));
  check(`${name} has a story`, !!p.story?.title && !!p.story.intro && !!p.story.ending);
  check(`${name} same seed same puzzle`, generateSkyline({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p));
  check(`${name} survives cleanPuzzle`, JSON.stringify(def.cleanPuzzle(JSON.parse(JSON.stringify(p)))?.clues) === JSON.stringify(p.clues));
  check(`${name} notes never rule out the answer`, p.solution.every((d, i) => def.allowed(p, i, (x) => p.givens[x]) & (1 << (d - 1))));
  check(`${name} a finished answer shows no clash`, def.clashes(p, p.solution).size === 0);
}
{
  const p = generateSkyline({ difficulty: 'easy', seed: 'm' });
  const e = Array(p.solution.length).fill(0);
  const c = p.givens.findIndex((d) => !d);
  e[c] = (p.solution[c] % p.size) + 1;
  check('sk a wrong number is caught', getSkylineHint(p, e).kind === 'mistake');
  const q = generateSkyline({ difficulty: 'easy', seed: 'm', avoid: [p.fingerprint] });
  check('sk avoid gives a different puzzle', q.fingerprint !== p.fingerprint);
  const bad = JSON.parse(JSON.stringify(p));
  const side = SIDES.find((s) => bad.clues[s].some(Boolean));
  const k = bad.clues[side].findIndex(Boolean);
  bad.clues[side][k] = (bad.clues[side][k] % p.size) + 1;
  check('sk cleanPuzzle refuses an edge number that does not fit', def.cleanPuzzle(bad) === null);
  check('sk cleanPuzzle refuses junk', def.cleanPuzzle({ size: 5, clues: 3 }) === null && def.cleanPuzzle(null) === null);
  const prac = generateSkyline({ difficulty: 'medium', seed: 'p', practice: 'visibility' });
  check('sk practice puzzles use the step', prac.techniques.includes('visibility'));
  if (!quick) {
    const p7 = generateSkyline({ difficulty: 'expert', size: 7, seed: 'a' });
    check('sk a 7×7 is unique by brute force', countSkyline(p7, 2) === 1);
  }
  const sw = p.solution.slice(); [sw[0], sw[1]] = [sw[1], sw[0]];
  check('sk clashes catch a wrong row', def.clashes(p, sw).size > 0);
}

// ---------- story themes ----------
themeStoryChecks(check, 'sk', generateSkyline, def);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
