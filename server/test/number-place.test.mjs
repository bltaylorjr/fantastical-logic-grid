// NINETIMESNINE's part of the learning service and its admin section: run with
// `npm test` in server/. The whole Worker runs in Miniflare with a local D1
// database, so nothing leaves this computer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { computeNpTuning, cleanNpPlay } from '../src/number-place.js';

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
    ratelimits: Object.fromEntries(['LIMIT_PLAYS', 'LIMIT_ADMIN'].map((n, i) => [n, { namespace_id: String(42001 + i), simple: { limit: 1000, period: 60 } }])),
    bindings: { ALLOWED_ORIGINS: ORIGIN, ADMIN_TOKEN: ADMIN, FIREBASE_PROJECT_ID: 'flg-test' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function call(path, { method, body, token } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const play = (p) => ({ level: 'medium', size: 9, variants: [], mode: 'free', outcome: 'solved', feel: null, minutes: 6, hints: 0, mistakes: 0, checks: 0, tuned: 0.5, score: 120, stuck: [], platform: 'web', version: '1.11.2', ...p });

test('a play record is cleaned: unknown levels, techniques and fields are dropped', () => {
  assert.equal(cleanNpPlay({ ...play(), level: 'impossible' }), null);
  assert.equal(cleanNpPlay({ ...play(), size: 7 }), null);
  const r = cleanNpPlay({ ...play(), stuck: ['xWing', 'xWing', 'guessing'], variants: ['parity', 'diagonal'], pid: 'Bad PID!', name: 'Ann' });
  assert.equal(r.stuck, '["xWing"]');
  assert.equal(r.variants, 'diagonal+parity');
  assert.equal(r.pid, null);
  assert.equal('name' in r, false);
});

test('shared tuning moves a level only after 10 games, and gently', () => {
  assert.deepEqual(computeNpTuning(Array.from({ length: 9 }, () => ({ level: 'hard', outcome: 'solved', feel: 'easy', hints: 0, minutes: 3 }))).toughness, {});
  const easy = computeNpTuning(Array.from({ length: 12 }, () => ({ level: 'hard', outcome: 'solved', feel: 'easy', hints: 0, minutes: 3 })));
  assert.ok(easy.toughness.hard > 0.5 && easy.toughness.hard <= 0.8);
  const hard = computeNpTuning(Array.from({ length: 12 }, () => ({ level: 'hard', outcome: 'abandoned', feel: 'hard' })));
  assert.equal(hard.toughness.hard, 0.2);
  const races = computeNpTuning(Array.from({ length: 12 }, () => ({ level: 'hard', mode: 'race', outcome: 'abandoned' })));
  assert.deepEqual(races.toughness, {}, 'race games never tune free play');
});

test('plays are saved, and a rating sent later updates the same game', async () => {
  const r = await call('/v1/learn/np/plays', { body: { plays: [play({ pid: 'abcd1234efgh' }), play({ level: 'easy', size: 6 })] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 2);
  await call('/v1/learn/np/plays', { body: { plays: [play({ pid: 'abcd1234efgh', feel: 'hard' })] } });
  const rows = (await db.prepare("SELECT feel FROM np_plays WHERE pid = 'abcd1234efgh'").all()).results;
  assert.deepEqual(rows, [{ feel: 'hard' }]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM np_plays').first()).n, 2);
});

test('the tuning endpoint reports toughness per level from everyone\'s games', async () => {
  await call('/v1/learn/np/plays', { body: { plays: Array.from({ length: 12 }, () => play({ level: 'expert', outcome: 'abandoned', feel: 'hard' })) } });
  const r = await call('/v1/learn/np/tuning');
  assert.equal(r.status, 200);
  assert.equal(r.body.toughness.expert, 0.2);
});

test('the admin section shows how each level is going and its own settings', async () => {
  assert.equal((await call('/admin/v1/number-place')).status, 401);
  const r = await call('/admin/v1/number-place', { token: ADMIN });
  assert.equal(r.status, 200);
  const medium = r.body.levels.find((l) => l.level === 'medium');
  assert.ok(medium && medium.games >= 1, 'medium games are counted');
  const s = await call('/admin/v1/settings', { token: ADMIN });
  const np = s.body.settings.filter((x) => x.group === 'NINETIMESNINE').map((x) => x.key);
  for (const k of ['np_enabled', 'np_learning_enabled', 'np_max_level', 'np_adapt_strength']) assert.ok(np.includes(k), `${k} is in the NINETIMESNINE group`);
});

test('the dashboard can switch NINETIMESNINE and its learning off', async () => {
  let cfg = await call('/v1/config');
  assert.equal(cfg.body.numberPlace.enabled, true);
  assert.equal(cfg.body.numberPlace.adaptStrength, 1);
  assert.equal((await call('/admin/v1/settings', { token: ADMIN, body: { key: 'np_max_level', value: 'hard' } })).status, 200);
  assert.equal((await call('/admin/v1/settings', { token: ADMIN, body: { key: 'np_learning_enabled', value: false } })).status, 200);
  cfg = await call('/v1/config');
  assert.equal(cfg.body.numberPlace.maxLevel, 'hard');
  assert.equal(cfg.body.numberPlace.learning, false);
  const before = (await db.prepare('SELECT COUNT(*) AS n FROM np_plays').first()).n;
  const r = await call('/v1/learn/np/plays', { body: { plays: [play()] } });
  assert.equal(r.body.saved, 0, 'plays are accepted and dropped while learning is off');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM np_plays').first()).n, before);
});
