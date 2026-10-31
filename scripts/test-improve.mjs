// Tests for the weekly improvement run (scripts/improve.mjs) and the house
// tuning it writes (engine/src/house-tuning.js). Run: node scripts/test-improve.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyze, renderReport, loadEngine, readLighthouse, whyLine, writeTuning, lookFindings, LIMITS } from './improve.mjs';
import { houseTuningFor, houseDailyOptions, HOUSE_TUNING } from '../engine/src/house-tuning.js';
import { generatePuzzle } from '../engine/src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = await loadEngine();
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

const signals = (over = {}) => ({
  notes: [],
  ratingsTier: { headline: '40 ratings in the last 30 days, average 3.9 of 5 stars.', overall: { games: 120, rated: 40, avg: 3.9 },
    improve: [{ dim: 'clue', text: 'Puzzles with exact gap clues average 2.8 stars.', advice: 'Consider using fewer exact gap clues.', rated: 12 }] },
  ratingsMode: { groups: [{ id: 'daily', games: 30, rated: 10, avg: 3.6, quitRate: 0.5, tooHard: 0.45, tooEasy: 0.05 }] },
  ratingsPart: { groups: [
    { id: 'mystery//o/2', name: 'Mystery, opening 3 ("A storm")', rated: 8, avg: 2.1 },
    { id: 'mystery//e/0', name: 'Mystery, ending 1', rated: 6, avg: 4.8 },
    { id: 'mystery//i/1', name: 'Mystery, incident 2', rated: 2, avg: 1 },
    { id: 'nosuchtheme//o/1', name: 'x', rated: 9, avg: 1 },
  ] },
  quality: { rows: [{ theme: 'space', tier: 'hard', games: 20, attention: 3, issues: [{ code: 'quit', text: '45% gave up or revealed the answer' }] }] },
  alerts: { alerts: [{ level: 'warn', label: 'Free server voices today', percent: 85, text: '85% used.' }] },
  summary: { errorCount: 7, errorKinds: 2, feedbackWaiting: { idea: 3, problem: 1 } },
  tuning: { effort: { medium: 0.4, hard: -0.3 }, clueWeights: { diff: 0.8, either: 1.3 } },
  github: { issues: [{ label: 'nightly-maintenance', number: 9, title: 'Nightly', url: '', lines: ['Lighthouse, /: Performance is 0.82 (the budget is >= 0.9).', 'Website build: /themes/ is missing a description tag.', 'Set the secret in the Cloudflare dashboard.'] }],
    merged: [{ number: 70, title: 'Puzzle ratings', url: '', mergedAt: '2026-10-26T06:19:00Z', why: 'Players can rate.' }] },
  lighthouse: [
    ...[0.95, 0.94, 0.96].map((speed, i) => ({ at: `2026-10-1${i}`, path: '/', speed, seo: 1, access: 1 })),
    ...[0.86, 0.85, 0.87].map((speed, i) => ({ at: `2026-10-2${i}`, path: '/', speed, seo: 0.92, access: 1 })),
  ],
  ...over,
});

await test('findings are ranked and tagged', async () => {
  const r = await analyze(signals(), { today: '2026-11-02', current: [], engine });
  assert.ok(r.findings.length >= 8);
  for (let i = 1; i < r.findings.length; i++) assert.ok(r.findings[i - 1].priority >= r.findings[i].priority);
  assert.ok(r.findings.some((f) => f.area === 'speed' && /fell from 95 to 86/.test(f.text) && f.forClaude));
  assert.ok(r.findings.some((f) => f.area === 'seo' && /search score is 92/.test(f.text)));
  assert.ok(r.findings.some((f) => f.area === 'limits'));
  assert.ok(r.findings.some((f) => f.area === 'daily' && f.auto));
  // Dashboard work is for Bobby, not for a code change.
  assert.equal(r.findings.find((f) => /Cloudflare dashboard/.test(f.text)).forClaude, false);
});

await test('color looks and picture clues are compared, report only', async () => {
  const quality = {
    rows: [],
    pictures: [{ id: 'solved', games: 40, quitRate: 0.1, rating: 4.4, rated: 20 }, { id: 'locked', games: 30, quitRate: 0.4, rating: 3.6, rated: 12 }, { id: 'off', games: 40, quitRate: 0.2, rating: 3.8, rated: 15 }],
    looks: [{ id: 'light', games: 60, quitRate: 0.15 }, { id: 'dark', games: 40, quitRate: 0.15 }, { id: 'contrast', games: 20, quitRate: 0.5 }],
  };
  const out = [];
  lookFindings(quality, (f) => out.push({ forClaude: false, auto: false, ...f }));
  assert.ok(out.every((f) => f.area === 'looks' && !f.auto), 'nothing changes by itself');
  assert.ok(out.some((f) => /36% of games had picture clues turned off/.test(f.text) && f.forClaude));
  assert.ok(out.some((f) => /unsolved give up more: 40% versus 10%/.test(f.text)));
  assert.ok(out.some((f) => /average 4.4 stars; with picture clues off, 3.8/.test(f.text)));
  assert.ok(out.some((f) => /high-contrast look give up more/.test(f.text) && f.forClaude));
  assert.ok(!out.some((f) => /the dark look/.test(f.text)));
  // Too few games: nothing is said.
  const few = [];
  lookFindings({ pictures: [{ id: 'off', games: 9, quitRate: 0.9 }], looks: [{ id: 'dark', games: 9, quitRate: 0.9 }] }, (f) => few.push(f));
  assert.deepEqual(few, []);
  // The full run takes them in, under their own heading.
  const r = await analyze(signals({ quality }), { today: '2026-11-02', current: [], engine });
  assert.ok(r.findings.some((f) => f.area === 'looks'));
  assert.match(renderReport(r), /Looks and picture clues/);
});

await test('the tuning entry is bounded, dated tomorrow and explained', async () => {
  const r = await analyze(signals(), { today: '2026-11-02', current: [], engine });
  const e = r.entry;
  assert.equal(e.from, '2026-11-03');
  // Daily went badly (too hard), so every level moves gentler, at most one step.
  for (const v of Object.values(e.daily.effort)) assert.ok(v >= -LIMITS.effortStep && v <= LIMITS.effortStep, `effort ${v}`);
  assert.equal(e.daily.effort.medium, undefined); // 0.4 * 0.5 - 0.2 = 0, left out // 0.4 * 0.5 - 0.2
  assert.equal(e.daily.effort.hard, -0.2);
  assert.equal(e.daily.clueWeights.diff, 0.9);
  assert.equal(e.daily.clueWeights.either, 1.15);
  assert.equal(e.storyPrefs.mystery.o['2'], -0.93);
  assert.equal(e.storyPrefs.mystery.e['0'], 0.87);
  assert.equal(e.storyPrefs.mystery.i, undefined, 'too few ratings');
  assert.ok(e.reasons.length >= 3 && e.reasons.every((x) => typeof x === 'string'));
});

await test('no new entry when nothing changes, and none with too few games', async () => {
  const s = signals();
  const first = await analyze(s, { today: '2026-11-02', current: [], engine });
  const again = await analyze({ ...s, ratingsMode: { groups: [] }, ratingsPart: { groups: [] }, tuning: {} }, { today: '2026-11-09', current: [{ from: '2026-11-03', daily: { effort: {}, clueWeights: {} }, storyPrefs: {} }], engine });
  assert.equal(again.entry, null);
  const few = await analyze({ ...s, ratingsTier: { ...s.ratingsTier, overall: { games: 5 } } }, { today: '2026-11-02', current: [], engine });
  assert.equal(few.entry, null);
  assert.ok(first.entry);
});

await test('the next week moves on from the last entry, step by step', async () => {
  const s = signals({ ratingsMode: { groups: [] }, tuning: { effort: { medium: 0.6 } }, ratingsPart: { groups: [] } });
  const r = await analyze(s, { today: '2026-11-09', current: [{ from: '2026-11-03', daily: { effort: { medium: -0.2 }, clueWeights: {} }, storyPrefs: { mystery: { o: { 2: -0.9 } } } }], engine });
  assert.equal(r.entry.daily.effort.medium, undefined); // -0.2 toward 0.3, one step of 0.2
  assert.equal(r.entry.storyPrefs.mystery.o['2'], -0.72); // fades without new ratings
});

await test('the report holds no player text and lists the Claude work', async () => {
  const r = await analyze(signals(), { today: '2026-11-02', current: [], engine });
  const md = renderReport(r);
  if (process.env.IMPROVE_SHOW) console.log(md);
  assert.match(md, /## For the weekly Claude task/);
  assert.match(md, /## Changed automatically/);
  assert.match(md, /#70 Puzzle ratings/);
  assert.doesNotMatch(md, /undefined|NaN/);
});

await test('house tuning applies only from its date', () => {
  const list = [{ from: '2026-11-03', daily: { effort: { easy: -0.2 }, clueWeights: { not: 0.9 } }, storyPrefs: { mystery: { o: { 1: -1 } } } }, { from: '2026-11-10', daily: { effort: {} }, storyPrefs: {} }];
  assert.equal(houseTuningFor('2026-11-02', list), null);
  assert.equal(houseTuningFor('2026-11-05', list).from, '2026-11-03');
  assert.equal(houseTuningFor('2026-11-12', list).from, '2026-11-10');
  assert.deepEqual(houseDailyOptions('2026-11-02', 'easy', list), {});
  assert.deepEqual(houseDailyOptions('2026-11-04', 'easy', list), { learning: { effort: -0.2, clueWeights: { not: 0.9 } }, storyPrefs: { mystery: { o: { 1: -1 } } } });
  assert.deepEqual(houseDailyOptions('2026-11-11', 'easy', list), {});
  // The options are ones the engine takes.
  const p = generatePuzzle({ difficulty: 'easy', theme: 'mystery', seed: 'house', ...houseDailyOptions('2026-11-04', 'easy', list) });
  assert.ok(p.story.id);
  assert.ok(Array.isArray(HOUSE_TUNING));
});

await test('writing a new entry keeps the file importable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-'));
  const f = join(dir, 'house-tuning.mjs');
  copyFileSync(join(root, 'engine', 'src', 'house-tuning.js'), f);
  writeTuning([{ from: '2026-11-03', reasons: ['a "quoted" reason'], daily: { effort: { easy: -0.2 } }, storyPrefs: {} }], f);
  const m = await import(pathToFileURL(f).href);
  assert.equal(m.HOUSE_TUNING.length, 1);
  assert.equal(m.houseTuningFor('2026-11-04').reasons[0], 'a "quoted" reason');
});

await test('nightly Lighthouse files are read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lh-'));
  mkdirSync(join(dir, '101', '.lighthouseci'), { recursive: true });
  writeFileSync(join(dir, '101', '.lighthouseci', 'lhr-1.json'), JSON.stringify({ fetchTime: '2026-10-20T07:00:00Z', finalDisplayedUrl: 'https://thelogicgrid.com/daily/', categories: { performance: { score: 0.9 }, seo: { score: 1 }, accessibility: { score: 0.98 } }, audits: {} }));
  writeFileSync(join(dir, '101', '.lighthouseci', 'lhr-2.json'), '{broken');
  const l = readLighthouse(dir);
  assert.equal(l.length, 1);
  assert.equal(l[0].path, '/daily/');
  assert.deepEqual(readLighthouse(join(dir, 'missing')), []);
});

await test('the reason line of a PR skips attribution and headings', () => {
  assert.equal(whyLine('<!-- x -->\n_Requested by **Bobby**_\n\n## Summary\n\n- Adds the **weekly** run. See [docs](http://x).'), 'Adds the weekly run. See docs.');
  assert.equal(whyLine(''), '');
});

await test('ideas and problems approved in Communication come first for the Claude task, with no player text', async () => {
  const s = { ...signals(), queue: { approved: [{ id: 41, kind: 'problem', topic: 'puzzle', approvedAt: 1 }, { id: 42, kind: 'idea', topic: 'feature<b>', text: 'secret words' }] } };
  const r = await analyze(s, { today: '2026-11-02', current: [], engine });
  const md = renderReport(r);
  const first = md.split('## For the weekly Claude task')[1].split('\n').find((l) => /^1\. /.test(l));
  assert.match(first, /2 player ideas and problems approved for processing: #41 \(problem, puzzle\), #42 \(idea, featureb\)/);
  assert.doesNotMatch(md, /secret words|<b>/);
});

console.log(`${passed} improve tests passed`);
