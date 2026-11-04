// Tests for the engine doctor (engine/doctor.js) and the adaptive speed
// judgement in engine/health.js. The doctor must pass a healthy engine and
// catch a broken one, so each kind of breakage is planted in a copy of the engine.
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkPuzzle, canary, useEngine } from '../doctor.js';
import { judge, SPEED } from '../health.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
let failures = 0;
const check = (name, cond, extra = '') => { if (cond) console.log(`ok   ${name}`); else { failures++; console.log(`FAIL ${name} ${extra}`); } };

// --- speed judgement
{
  const e = { norm: 10, wobble: 0.1, nights: 5, slowNights: 0 };
  check('a new level starts a baseline', judge(undefined, 3, 30).status === 'new');
  check('within the usual wobble is ok', judge(e, 12, 30).status === 'ok');
  check('much slower is flagged', judge(e, 25, 30).status === 'slower');
  check('a flagged slowdown does not move the baseline', judge(e, 25, 30).next.norm === 10);
  check('a tiny slowdown in milliseconds is not flagged', judge({ norm: 0.1, wobble: 0.1, nights: 5, slowNights: 0 }, 0.5, 30).status === 'ok');
  check('a wobbly level gets more room', judge({ ...e, wobble: 0.5 }, 22, 30).status === 'ok');
  let entry = e;
  let last;
  for (let n = 0; n < SPEED.acceptAfter; n++) { last = judge(entry, 25, 30); entry = last.next; }
  check(`a slowdown held for ${SPEED.acceptAfter} nights becomes the new normal`, last.status === 'accepted' && entry.norm === 25);
  const f = judge(e, 4, 30);
  check('a real speed-up is reported and adopted quickly', f.status === 'faster' && f.next.norm < 8);
  const s = judge(e, 12, 30);
  check('a small slowdown moves the baseline slowly', s.next.norm > 10 && s.next.norm < 11);
}

// --- a healthy engine passes
{
  const r = await checkPuzzle('sk', { level: 'easy', seed: 'doctor-test' });
  check('a healthy Skyline puzzle passes', r.ok, r.problems.join('; '));
  const f = await checkPuzzle('flg', { level: 'medium', seed: 'doctor-test' });
  check('a healthy Logic Grid puzzle passes', f.ok, f.problems.join('; '));
  const c = await canary({ seed: 'doctor-test' });
  check('the canary passes every game', c.ok, JSON.stringify(c.results.filter((x) => !x.ok)));
}

// --- broken engines are caught
const plant = (name, body) => {
  const dir = mkdtempSync(join(tmpdir(), 'flg-doctor-'));
  cpSync(src, dir, { recursive: true });
  writeFileSync(join(dir, 'sk-ops.js'), body);
  return dir;
};
const cases = [
  ['a wrong answer', `import { generateSkyline, getSkylineHint } from './skyline.js';
export const OPS = { generate: (a) => { const p = generateSkyline(a); const i = p.solution.findIndex((d, c) => !p.givens[c]); p.solution[i] = p.solution[i] % p.size + 1; return p; }, hint: (a) => getSkylineHint(a.puzzle, a.entries) };`, /not the one the clues lead to/],
  ['a seed that is ignored', `import { generateSkyline, getSkylineHint } from './skyline.js';
export const OPS = { generate: (a) => generateSkyline({ ...a, seed: String(Math.random()) }), hint: (a) => getSkylineHint(a.puzzle, a.entries) };`, /different puzzle/],
  ['a hint that crashes', `import { generateSkyline } from './skyline.js';
export const OPS = { generate: (a) => generateSkyline(a), hint: () => { throw new Error('boom'); } };`, /hint failed/],
  ['a hint that misses mistakes', `import { generateSkyline, getSkylineHint } from './skyline.js';
export const OPS = { generate: (a) => generateSkyline(a), hint: (a) => getSkylineHint(a.puzzle, []) };`, /did not spot/],
  ['a build that depends on the clock', `import { generateSkyline, getSkylineHint } from './skyline.js';
const start = Date.now();
export const OPS = { generate: (a) => { const t = Date.now(); const p = generateSkyline(a); return Date.now() - t > 1000 ? generateSkyline({ ...a, seed: a.seed + 'x' }) : p; }, hint: (a) => getSkylineHint(a.puzzle, a.entries) };`, /slow device/],
  ['a build that throws', `export const OPS = { generate: () => { throw new Error('no puzzle'); }, hint: () => ({}) };`, /build failed/],
  ['a puzzle with two answers', `import { generateSkyline, getSkylineHint } from './skyline.js';
export const OPS = { generate: (a) => { const p = generateSkyline(a); for (const side of Object.keys(p.clues)) p.clues[side] = p.clues[side].map(() => 0); p.givens = p.givens.map(() => 0); return p; }, hint: (a) => getSkylineHint(a.puzzle, a.entries) };`, /answers found by brute force|cannot finish/],
];
for (const [name, body, expect] of cases) {
  const dir = plant(name, body);
  try {
    useEngine(dir);
    const r = await checkPuzzle('sk', { level: 'easy', seed: 'doctor-test' });
    check(`catches ${name}`, !r.ok && r.problems.some((p) => expect.test(p)), JSON.stringify(r.problems));
    const c = await canary({ seed: 'doctor-test' });
    check(`the canary fails on ${name}`, !c.ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
useEngine(src);

console.log(failures ? `\n${failures} doctor test(s) failed.` : '\nAll doctor tests passed.');
process.exit(failures ? 1 : 0);
