// Loop Line tests: node test/ll-tests.js [--quick]
// Every level and seed: one answer by brute force (where the grid is small
// enough), the logic solver alone reaches it, every step is named, the same
// seed gives the same puzzle, and the puzzle plays to the end by hints alone.
import { generateLoopLine, countLoopLine, solveLoopLine, getLoopLineHint, checkLoopLine, llGeometry, LL_TIERS, LL_TECHNIQUES } from '../src/loop-line.js';
import { OPS } from '../src/ll-ops.js';
import { def } from '../../modules/loop-line/game.js';
import { themeStoryChecks } from './kit-story-checks.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

function playByHints(p) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 3000; guard++) {
    if (checkLoopLine(p, entries).solved) return true;
    const h = getLoopLineHint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean) || !h.marks.length) return false;
    for (const [e, v] of h.marks) entries[e] = v;
  }
  return false;
}

// One closed loop: every dot has 0 or 2 lines, and the lines are joined.
function oneLoop(p) {
  const g = llGeometry(p.size, p.cols);
  const deg = new Int8Array(g.D);
  const parent = [...Array(g.D).keys()];
  const find = (x) => { while (parent[x] !== x) x = parent[x]; return x; };
  let lines = 0;
  p.solution.forEach((v, e) => { if (v === 1) { lines++; const [a, b] = g.ends[e]; deg[a]++; deg[b]++; parent[find(a)] = find(b); } });
  const dots = [...deg.keys()].filter((d) => deg[d]);
  return lines >= 4 && deg.every((d) => d === 0 || d === 2) && new Set(dots.map(find)).size === 1;
}

const levels = Object.keys(LL_TIERS).filter((_, i) => !quick || i % 2 === 0 || i === 5);
const seeds = quick ? ['a'] : ['a', 'b'];
for (const difficulty of levels) for (const seed of seeds) {
  const p = generateLoopLine({ difficulty, seed });
  const name = `ll ${p.id}`;
  const g = llGeometry(p.size, p.cols);
  check(`${name} answer is one loop`, oneLoop(p));
  check(`${name} numbers match the loop`, p.clues.every((n, i) => n < 0 || g.sides[i].filter((e) => p.solution[e] === 1).length === n));
  if (p.size <= 7) check(`${name} unique (brute force)`, countLoopLine(p, 2) === 1);
  const res = solveLoopLine(p);
  check(`${name} logic solves it`, res.solved && res.values.every((v, i) => v === p.solution[i]));
  check(`${name} hardest step fits the level`, p.hardestTechnique <= LL_TIERS[difficulty].maxTech, `${p.hardestTechnique}`);
  check(`${name} every step named`, p.solvePath.every((s) => LL_TECHNIQUES[s.technique] && s.why && s.marks.length));
  check(`${name} same seed same puzzle`, generateLoopLine({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p));
  check(`${name} has a story`, !!p.story?.title && !!p.story?.ending);
}
{
  const p = generateLoopLine({ difficulty: 'easy', seed: 'm' });
  const e = Array(p.solution.length).fill(0);
  const w = p.solution.findIndex((v) => v === 2);
  e[w] = 1;
  const h = getLoopLineHint(p, e);
  check('ll a wrong line is caught', h.kind === 'mistake' && h.cells.includes(w));
  const q = generateLoopLine({ difficulty: 'easy', seed: 'm', avoid: [p.fingerprint] });
  check('ll avoid gives a different puzzle', q.fingerprint !== p.fingerprint);
  const r = OPS.hint({ puzzle: JSON.parse(JSON.stringify(p)), entries: Array(p.solution.length).fill(0) });
  check('ll ops give a hint through plain JSON', r.kind === 'step' && r.levels.length === 3);
  const t = generateLoopLine({ difficulty: 'medium', seed: 'p', practice: 'enter' });
  check('ll practice asks for a step', t.techniques.includes('enter'));
}
// Brute force agrees on a puzzle with two answers: a 2×2 block of 2s... made by
// taking every number away from a small puzzle.
{
  const p = generateLoopLine({ difficulty: 'basic', seed: 'z' });
  check('ll counter sees many answers with no numbers', countLoopLine({ ...p, clues: p.clues.map(() => -1) }, 2) === 2);
}

// ---------- story themes ----------
themeStoryChecks(check, 'll', generateLoopLine, def);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
