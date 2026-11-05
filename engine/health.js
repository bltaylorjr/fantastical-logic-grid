#!/usr/bin/env node
// Engine health: rule-based checks and speed tracking for every game's engine.
// No AI and no network: it builds puzzles with the engine itself and checks
// them with engine/doctor.js.
//
//   node engine/health.js --quick                  every game, two levels: the deploy canary
//   node engine/health.js                          every game and level, fixed and rotating seeds
//   node engine/health.js --update                 ...and adapt the speed baseline
//
// Options:
//   --engine-dir DIR   check another copy of engine/src (a release before it goes live)
//   --baseline FILE    speed baseline (default engine/health/baseline.json)
//   --watch FILE       seeds that failed before, re-checked until they pass 3 nights running
//                      (default engine/health/watch.json)
//   --update           write the adapted baseline and watch list back
//   --seeds N          fixed seeds per level for timing (default 3)
//   --day YYYY-MM-DD   the day used for the rotating seeds (default today, UTC)
//   --report FILE      write the full result as JSON
//   --md FILE          write a short report in Markdown (also appended to $GITHUB_STEP_SUMMARY)
//   --budget-min N     stop starting new checks after N minutes (default 25)
//   --fail-on-slow     exit 1 when a level got slower, not only when something is broken
//
// How speed is judged, so it adapts instead of crying wolf:
//   - every timing is divided by a fixed piece of CPU work timed on the same
//     machine (doctor.js machineSpeed), so a slower runner is not a slower engine
//   - each level keeps a running typical time and how much it normally wobbles;
//     "slower" means past max(1.6x, 1 + 3x its wobble) and at least 25 ms more
//   - on a clean night, typical times move toward tonight's: quickly when faster
//     (improvements stick), slowly when a bit slower
//   - a slowdown keeps being reported (and does not move the baseline) until it
//     is fixed, or until it has held for 5 nights, when it is accepted as the
//     new normal and reported once as accepted
// Exit code: 1 when any puzzle check failed (or --fail-on-slow and something is slower).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { checkPuzzle, canary, gameLevels, machineSpeed, useEngine } from './doctor.js';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
if (flag('help')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 33).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

const ENGINE_DIR = opt('engine-dir') ? resolve(opt('engine-dir')) : null;
const BASELINE = resolve(opt('baseline', join(here, 'health', 'baseline.json')));
const WATCH = resolve(opt('watch', join(here, 'health', 'watch.json')));
const SEEDS = Math.max(1, Number(opt('seeds', 3)));
const DAY = opt('day', new Date().toISOString().slice(0, 10));
const BUDGET = Number(opt('budget-min', 25)) * 60000;
const UPDATE = flag('update');

// Tuning for the adaptive speed judgement.
export const SPEED = { minRatio: 1.6, wobbleTimes: 3, minExtraMs: 25, fasterWeight: 0.5, slowerWeight: 0.2, wobbleWeight: 0.25, acceptAfter: 5, passesToClear: 3 };

const readJson = (f, d) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d; } catch (e) { return d; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

// Judge one level's speed against its baseline entry and work out the adapted entry.
export function judge(entry, norm, unit, s = SPEED) {
  if (norm == null) return { status: 'no-data', next: entry };
  if (!entry) return { status: 'new', next: { norm: r4(norm), wobble: 0.15, nights: 1, slowNights: 0 } };
  const allowed = entry.norm * Math.max(s.minRatio, 1 + s.wobbleTimes * entry.wobble);
  const extraMs = (norm - entry.norm) * unit;
  const slow = norm > allowed && extraMs > s.minExtraMs;
  const dev = Math.abs(norm - entry.norm) / Math.max(entry.norm, 1e-6);
  if (slow) {
    const slowNights = (entry.slowNights || 0) + 1;
    if (slowNights >= s.acceptAfter) return { status: 'accepted', ratio: norm / entry.norm, next: { norm: r4(norm), wobble: Math.min(1, entry.wobble + 0.1), nights: entry.nights + 1, slowNights: 0 } };
    return { status: 'slower', ratio: norm / entry.norm, allowed, next: { ...entry, slowNights } };
  }
  const w = norm < entry.norm ? s.fasterWeight : s.slowerWeight;
  const next = {
    norm: r4(entry.norm + w * (norm - entry.norm)),
    wobble: r2(Math.min(1, entry.wobble + s.wobbleWeight * (Math.min(dev, 1) - entry.wobble))),
    nights: entry.nights + 1,
    slowNights: 0,
  };
  return { status: norm < entry.norm / s.minRatio && -extraMs > s.minExtraMs ? 'faster' : 'ok', ratio: norm / entry.norm, next };
}

async function main() {
  const started = Date.now();
  if (ENGINE_DIR) useEngine(ENGINE_DIR);

  if (flag('quick')) {
    const c = await canary({ budgetMs: BUDGET });
    for (const r of c.results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.game}/${r.level} ${r.ms.generate ?? '-'} ms${r.problems.length ? `: ${r.problems.join('; ')}` : ''}`);
    console.log(c.ok ? `Canary passed in ${c.ms} ms.` : 'Canary FAILED.');
    if (opt('report')) writeJson(resolve(opt('report')), c);
    process.exit(c.ok ? 0 : 1);
  }

  const unit = machineSpeed();
  const baseline = readJson(BASELINE, { version: 1, unitNote: 'times are divided by machineSpeed() in engine/doctor.js', entries: {} });
  const watch = readJson(WATCH, { seeds: [] });
  const levels = await gameLevels();
  const results = [];
  let outOfTime = false;
  const run = async (id, level, seed, kind) => {
    if (Date.now() - started > BUDGET) { outOfTime = true; return null; }
    let r = await checkPuzzle(id, { level, seed });
    if (!r.ok) {
      // Once more, to tell a real bug (same answer every time) from a hiccup.
      const again = await checkPuzzle(id, { level, seed });
      r = { ...r, repeatable: !again.ok };
      if (again.ok) { r.ok = true; r.warnings.push(`failed once, then passed: ${r.problems.join('; ')}`); r.problems = []; }
    }
    r.kind = kind;
    results.push(r);
    return r;
  };

  // 1. Fixed seeds: the same puzzles every night, so timings compare.
  const speed = {};
  for (const [id, list] of Object.entries(levels)) {
    // One untimed build first, so loading and warming up the code is not counted.
    await checkPuzzle(id, { level: list[0], seed: 'warm-up', determinism: false, uniqueness: false });
    for (const level of list) {
      const times = [];
      for (let k = 1; k <= SEEDS; k++) { const r = await run(id, level, `base-${k}`, 'fixed'); if (r && r.ok) times.push(r.ms.generate); }
      speed[`${id}/${level}`] = { ms: median(times), norm: times.length ? median(times) / unit : null };
    }
  }
  // 2. Rotating seeds: new puzzles every night, to find rare failures.
  for (const [id, list] of Object.entries(levels)) for (const level of list) await run(id, level, `${DAY}-${id}-${level}`, 'rotating');
  // 3. Seeds that failed before.
  const watchNext = [];
  for (const w of watch.seeds) {
    const r = await run(w.game, w.level, w.seed, 'watch');
    if (!r) { watchNext.push(w); continue; }
    const passes = r.ok ? (w.passes || 0) + 1 : 0;
    if (passes < SPEED.passesToClear) watchNext.push({ ...w, passes, lastProblem: r.ok ? w.lastProblem : r.problems[0] });
  }
  for (const r of results) {
    if (r.ok || r.kind === 'watch') continue;
    if (!watchNext.some((w) => w.game === r.game && w.level === r.level && w.seed === r.seed)) watchNext.push({ game: r.game, level: r.level, seed: r.seed, since: DAY, passes: 0, lastProblem: r.problems[0] });
  }

  // Speed judgement and the adapted baseline.
  const broken = results.filter((r) => !r.ok);
  const judged = [];
  const nextEntries = { ...baseline.entries };
  for (const [key, s] of Object.entries(speed)) {
    const j = judge(baseline.entries[key], s.norm, unit);
    judged.push({ key, ms: s.ms, typicalMs: baseline.entries[key] ? Math.round(baseline.entries[key].norm * unit) : null, ...j });
    nextEntries[key] = j.next;
  }
  const slower = judged.filter((j) => j.status === 'slower');
  const accepted = judged.filter((j) => j.status === 'accepted');
  const faster = judged.filter((j) => j.status === 'faster');
  const warnings = results.filter((r) => r.warnings.length);

  if (UPDATE) {
    // A night with broken puzzles says nothing reliable about speed: keep the old baseline.
    if (!broken.length && !outOfTime) writeJson(BASELINE, { ...baseline, updated: DAY, machineUnitMs: unit, entries: nextEntries });
    writeJson(WATCH, { updated: DAY, seeds: watchNext });
  }

  const report = {
    day: DAY, ok: !broken.length, minutes: r2((Date.now() - started) / 60000), machineUnitMs: unit, outOfTime,
    checked: results.length, broken, slower, accepted, faster, watch: watchNext, judged,
    warnings: warnings.map((r) => ({ game: r.game, level: r.level, seed: r.seed, warnings: r.warnings })),
  };
  if (opt('report')) writeJson(resolve(opt('report')), report);

  // Markdown report.
  const L = [];
  L.push(`## Engine health, ${DAY}`, '');
  L.push(`${results.length} puzzles checked across ${Object.keys(levels).length} games in ${report.minutes} min (machine unit ${unit} ms).${outOfTime ? ' **Ran out of time; some checks were skipped.**' : ''}`, '');
  if (broken.length) {
    L.push('### Broken (needs a fix)', '', '| Game/level | Seed | Problem | Repeats |', '|---|---|---|---|');
    for (const r of broken) L.push(`| ${r.game}/${r.level} | \`${r.seed}\` | ${r.problems.join('; ')} | ${r.repeatable ? 'every time' : 'once'} |`);
    L.push('', `Reproduce: \`node engine/health.js --quick\` or \`node -e "import('./engine/doctor.js').then(d=>d.checkPuzzle('GAME',{level:'LEVEL',seed:'SEED'})).then(r=>console.log(r))"\``, '');
  }
  if (slower.length) {
    L.push('### Slower than usual', '', '| Game/level | Tonight | Typical | Times slower | Nights |', '|---|---|---|---|---|');
    for (const j of slower) L.push(`| ${j.key} | ${Math.round(j.ms)} ms | ${j.typicalMs} ms | ${r2(j.ratio)}x | ${j.next.slowNights} of ${SPEED.acceptAfter} |`);
    L.push('');
  }
  if (accepted.length) L.push(`Accepted as the new normal after ${SPEED.acceptAfter} nights: ${accepted.map((j) => `${j.key} (${Math.round(j.ms)} ms)`).join(', ')}.`, '');
  if (faster.length) L.push(`Faster than usual: ${faster.map((j) => `${j.key} ${Math.round(j.ms)} ms (was ${j.typicalMs} ms)`).join(', ')}.`, '');
  if (watchNext.length) L.push(`Seeds being watched: ${watchNext.map((w) => `${w.game}/${w.level} \`${w.seed}\` (${w.passes || 0}/${SPEED.passesToClear} clean nights)`).join(', ')}.`, '');
  const slowest = judged.filter((j) => j.ms != null).sort((a, b) => b.ms - a.ms).slice(0, 5);
  L.push(`Slowest builds tonight: ${slowest.map((j) => `${j.key} ${Math.round(j.ms)} ms`).join(', ')}.`, '');
  if (!broken.length && !slower.length) L.push('Everything passed and nothing got slower.', '');
  const md = L.join('\n');
  if (opt('md')) { mkdirSync(dirname(resolve(opt('md'))), { recursive: true }); writeFileSync(resolve(opt('md')), md); }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  console.log(md);
  process.exit(broken.length || (flag('fail-on-slow') && slower.length) ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(2); });
