// Island Bridges tests: node test/ib-tests.js [--quick]
// Every level and seed: one answer by brute force (where the map is small
// enough), the logic solver alone reaches it, every step is named, the same
// seed gives the same puzzle, and the puzzle plays to the end by hints alone.
import { generateIslandBridges, countIslandBridges, solveIslandBridges, getIslandBridgesHint, checkIslandBridges, ibLinks, IB_TIERS, IB_TECHNIQUES } from '../src/island-bridges.js';
import { OPS } from '../src/ib-ops.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

function playByHints(p) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 3000; guard++) {
    if (checkIslandBridges(p, entries).solved) return true;
    const h = getIslandBridgesHint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean) || !h.marks.length) return false;
    for (const [e, v] of h.marks) entries[e] = v;
  }
  return false;
}

function rulesHold(p) {
  const n = p.islands.map(() => 0);
  p.links.forEach((l, e) => { if (p.solution[e] !== 3) { n[l.a] += p.solution[e]; n[l.b] += p.solution[e]; } });
  if (n.some((x, i) => x !== p.islands[i].n)) return 'counts';
  const I = p.islands;
  for (const [e, h] of p.links.entries()) for (const [f, v] of p.links.entries()) {
    if (h.dir !== 'h' || v.dir !== 'v' || p.solution[e] === 3 || p.solution[f] === 3) continue;
    const r = I[h.a].r, c = I[v.a].c;
    if (I[v.a].r < r && r < I[v.b].r && I[h.a].c < c && c < I[h.b].c) return 'crossing';
  }
  const parent = I.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
  p.links.forEach((l, e) => { if (p.solution[e] !== 3) parent[find(l.a)] = find(l.b); });
  if (new Set(I.map((_, i) => find(i))).size !== 1) return 'not joined';
  if (JSON.stringify(ibLinks(p.size, p.cols, I)) !== JSON.stringify(p.links)) return 'links';
  return '';
}

const levels = Object.keys(IB_TIERS).filter((_, i) => !quick || i % 2 === 0 || i === 5);
const seeds = quick ? ['a'] : ['a', 'b'];
for (const difficulty of levels) for (const seed of seeds) {
  const p = generateIslandBridges({ difficulty, seed });
  const name = `ib ${p.id}`;
  const bad = rulesHold(p);
  check(`${name} answer keeps every rule`, !bad, bad);
  if (p.size <= 10) check(`${name} unique (brute force)`, countIslandBridges(p, 2) === 1);
  const res = solveIslandBridges(p);
  check(`${name} logic solves it`, res.solved && res.values.every((v, i) => v === p.solution[i]));
  check(`${name} hardest step fits the level`, p.hardestTechnique <= IB_TIERS[difficulty].maxTech, `${p.hardestTechnique}`);
  check(`${name} every step named`, p.solvePath.every((s) => IB_TECHNIQUES[s.technique] && s.why));
  check(`${name} same seed same puzzle`, generateIslandBridges({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p));
  check(`${name} has a story`, !!p.story?.title && !!p.story?.ending);
}
{
  const p = generateIslandBridges({ difficulty: 'easy', seed: 'm' });
  const e = Array(p.solution.length).fill(0);
  const w = p.solution.findIndex((v) => v === 3);
  e[w] = 1;
  const h = getIslandBridgesHint(p, e);
  check('ib a wrong bridge is caught', h.kind === 'mistake' && h.cells.includes(w));
  const q = generateIslandBridges({ difficulty: 'easy', seed: 'm', avoid: [p.fingerprint] });
  check('ib avoid gives a different puzzle', q.fingerprint !== p.fingerprint);
  const r = OPS.hint({ puzzle: JSON.parse(JSON.stringify(p)), entries: Array(p.solution.length).fill(0) });
  check('ib ops give a hint through plain JSON', r.kind === 'step' && r.levels.length === 3);
  const t = generateIslandBridges({ difficulty: 'medium', seed: 'p', practice: 'isolate' });
  check('ib practice asks for a step', t.techniques.includes('isolate'));
  // A square of 3s can be bridged two ways: the brute force must see both.
  const two = { size: 7, cols: 7, islands: [{ r: 0, c: 0, n: 3 }, { r: 0, c: 3, n: 3 }, { r: 3, c: 0, n: 3 }, { r: 3, c: 3, n: 3 }] };
  two.links = ibLinks(7, 7, two.islands);
  check('ib counter sees two answers for a square of 3s', countIslandBridges(two, 3) === 2);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
