// Ideas and problem reports kept apart by game, and learning pooled across all
// games: run with `npm test` in server/. The whole Worker runs in Miniflare
// with a local D1 database, so nothing leaves this computer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { computeCrowd, shrink, BANDS, CROWD_MIN } from '../src/shared-learning.js';
import { computeNpTuning } from '../src/number-place.js';
import { computeTuning } from '../src/learn.js';
import { TIER_ORDER } from '../../engine/src/tiers.js';
import { NP_LEVELS } from '../src/number-place.js';
import { generatePuzzle } from '../../engine/src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const ADMIN = 'test-admin-token-1234567890';
let mf;
let db;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRoot: join(root, '..'),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    ratelimits: Object.fromEntries(['LIMIT_PLAYS', 'LIMIT_ADMIN'].map((n, i) => [n, { namespace_id: String(43001 + i), simple: { limit: 1000, period: 60 } }])),
    bindings: { ALLOWED_ORIGINS: ORIGIN, ADMIN_TOKEN: ADMIN, FIREBASE_PROJECT_ID: 'flg-test' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function call(path, { body, token } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('every level of both games is in a band', () => {
  for (const t of TIER_ORDER) assert.ok(BANDS[t], `Logic Grid ${t}`);
  for (const l of NP_LEVELS) assert.ok(BANDS[l], `Number Place ${l}`);
});

test('ideas and problems record their game, and the inbox shows one game at a time', async () => {
  assert.equal((await call('/v1/feedback', { body: { kind: 'idea', topic: 'story', text: 'A grid where the numbers are planets', theme: 'adventure', game: 'number-place' } })).status, 200);
  assert.equal((await call('/v1/feedback', { body: { kind: 'idea', topic: 'story', text: 'A pirate ship lost in the fog', theme: 'adventure' } })).status, 200);
  assert.equal((await call('/v1/feedback', { body: { kind: 'problem', topic: 'play', text: 'Notes vanish after undo', game: 'chess' } })).status, 200);
  const rows = (await db.prepare('SELECT text, game, theme FROM feedback ORDER BY id').all()).results;
  assert.deepEqual(rows.map((r) => r.game), ['number-place', 'logic-grid', 'logic-grid'], 'unknown games count as the Logic Grid');
  assert.equal(rows[0].theme, null, 'the Logic Grid theme list is not used for Number Place');
  assert.equal(rows[1].theme, 'adventure');

  const np = await call('/admin/v1/inbox?game=number-place', { token: ADMIN });
  assert.equal(np.status, 200);
  assert.equal(np.body.game, 'number-place');
  assert.deepEqual(np.body.items.map((i) => i.text), ['A grid where the numbers are planets']);
  assert.equal(np.body.items[0].meta.gameName, 'Number Place');
  const lg = await call('/admin/v1/inbox?type=idea&game=logic-grid', { token: ADMIN });
  assert.deepEqual(lg.body.items.map((i) => i.text), ['A pirate ship lost in the fog']);
  const all = await call('/admin/v1/inbox?type=idea', { token: ADMIN });
  assert.equal(all.body.items.length, 2);
  const old = await call('/admin/v1/feedback?kind=idea&game=number-place', { token: ADMIN });
  assert.equal(old.body.items.length, 1);
  assert.equal(old.body.items[0].game, 'number-place');
});

test('Report a Problem records its game, and another game\'s puzzle is never sent to the doctor', async () => {
  const puzzle = generatePuzzle({ difficulty: 'easy', categories: 3, items: 4, seed: 'np-game-test' });
  const np = await call('/v1/puzzle-report', { body: { kind: 'puzzle', text: 'This one has two answers', page: 'Number Place screen', puzzle, game: 'number-place' } });
  assert.equal(np.status, 200, JSON.stringify(np.body));
  const lg = await call('/v1/puzzle-report', { body: { kind: 'puzzle', text: 'Clue 3 is wrong here', puzzle, page: 'Puzzle screen: Test' } });
  assert.equal(lg.status, 200);
  const r = await db.prepare('SELECT game, status, puzzle IS NULL AS bare FROM puzzle_reports WHERE tracking = ?1').bind(np.body.tracking).first();
  assert.deepEqual({ ...r }, { game: 'number-place', status: 'manual', bare: 1 });
  const fb = await db.prepare('SELECT f.game FROM feedback f JOIN puzzle_reports p ON p.feedback_id = f.id WHERE p.tracking = ?1').bind(np.body.tracking).first();
  assert.equal(fb.game, 'number-place', 'its words in the inbox are Number Place\'s too');
  assert.equal((await db.prepare('SELECT game FROM puzzle_reports WHERE tracking = ?1').bind(lg.body.tracking).first()).game, 'logic-grid');

  const list = await call('/admin/v1/error-tracking?game=number-place', { token: ADMIN });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.reports.map((x) => x.tracking), [np.body.tracking]);
  assert.equal(list.body.counts.reduce((n, c) => n + c.n, 0), 1, 'the tiles count only that game');
  assert.equal((await call('/admin/v1/error-tracking', { token: ADMIN })).body.reports.length, 2);
});

test('the Number Place admin page counts its own ideas and problems', async () => {
  const r = await call('/admin/v1/number-place', { token: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.body.feedback.idea.new, 1);
  assert.equal(r.body.feedback.problem.new, 1, 'the Number Place puzzle report');
  assert.equal(r.body.feedback.reports.puzzle, 1);
  assert.equal(r.body.sharedLearning, true);
});

// ---------------------------------------------------------- learning across games
const lgPlay = (tier, signal, mode = 'free') => ({ tier, signal, mode, effort: 0, theme: 'x', rating: null, clue_types: '{}' });
const npPlay = (level, outcome, feel, extra = {}) => ({ level, outcome, feel, mode: 'free', hints: 0, minutes: 5, ...extra });

test('the pooled reading puts both games on one scale by band', () => {
  const crowd = computeCrowd(
    Array.from({ length: 30 }, () => lgPlay('basic', 1)).concat(Array.from({ length: 5 }, () => lgPlay('basic', -1, 'race'))),
    Array.from({ length: 10 }, () => ({ level: 'easy', lean: 0, mode: 'free' })),
  );
  assert.deepEqual(crowd.games, { logicGrid: 30, numberPlace: 10 }, 'race games are left out');
  assert.equal(crowd.lean.gentle, 0.75);
  assert.equal(crowd.lean.middle, undefined, `a band needs ${CROWD_MIN} games`);
  assert.equal(shrink([], 0.5), 0.5);
  assert.equal(shrink([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 0), 0.5);
});

test('a Number Place level with few games follows what all players found', () => {
  // Logic Grid players find the gentle levels far too easy.
  const crowd = computeCrowd(Array.from({ length: 40 }, () => lgPlay('easy', 1)), []);
  const t = computeNpTuning([npPlay('easy', 'solved', null)], crowd);
  assert.ok(t.toughness.easy > 0.75, `easy moves with only one game of its own (${t.toughness.easy})`);
  assert.ok(t.toughness.basic > 0.75, 'basic too, with none');
  assert.equal(t.toughness.hard, undefined, 'a band with no games stays put');
  assert.deepEqual(t.crowd.games, { logicGrid: 40, numberPlace: 0 });
  // With many games of its own, its own reading wins.
  const own = Array.from({ length: 200 }, () => npPlay('easy', 'abandoned', 'hard'));
  assert.ok(computeNpTuning(own, crowd).toughness.easy < 0.3);
  // No pooled reading: the same as before.
  assert.deepEqual(computeNpTuning([npPlay('easy', 'solved', null)]).toughness, {});
});

test('a Logic Grid tier with few games follows what all players found', () => {
  // Number Place players find the tough levels far too hard.
  const np = Array.from({ length: 30 }, () => ({ level: 'master', lean: -1, mode: 'free' }));
  const crowd = computeCrowd([], np);
  const t = computeTuning([lgPlay('theorist', 0)], [], crowd);
  assert.ok(t.effort.theorist < -0.2, `theorist gets gentler (${t.effort.theorist})`);
  assert.ok(t.effort.mensa < -0.2, 'mensa too');
  assert.equal(t.effort.easy, undefined);
  assert.deepEqual(computeTuning([lgPlay('theorist', 0)], []).effort, {}, 'no pooled reading: the same as before');
});

test('the tuning endpoints pool both games, and the switch turns it off', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const stmt = db.prepare("INSERT INTO np_plays (day, level, size, mode, outcome, feel, hints, minutes) VALUES (?1, 'hard', 9, 'free', 'abandoned', 'hard', 3, 30)");
  await db.batch(Array.from({ length: 25 }, () => stmt.bind(day)));
  let r = await call('/v1/learn/tuning');
  assert.equal(r.status, 200);
  assert.equal(r.body.crowd.games.numberPlace, 25);
  assert.ok(r.body.effort.medium < 0, 'Logic Grid medium gets gentler from Number Place\'s hard games');
  const np = await call('/v1/learn/np/tuning');
  assert.ok(np.body.toughness.medium < 0.5, 'Number Place medium too');

  assert.equal((await call('/admin/v1/settings', { token: ADMIN, body: { key: 'shared_learning_enabled', value: false } })).status, 200);
  // The tuning replies are cached for 15 minutes; clear them as a new day would.
  const caches = await mf.getCaches();
  await caches.default.delete('https://flg-cloud.internal/v1/learn/tuning');
  await caches.default.delete('https://flg-cloud.internal/v1/learn/np/tuning');
  r = await call('/v1/learn/tuning');
  assert.equal(r.body.crowd, undefined);
  assert.deepEqual(r.body.effort, {});
  assert.equal((await call('/admin/v1/number-place', { token: ADMIN })).body.sharedLearning, false);
});
