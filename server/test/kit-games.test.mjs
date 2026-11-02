// Cage Math, Sum Cross and Picture Grid's part of the learning service and their admin sections: run with
// `npm test` in server/. The whole Worker runs in Miniflare with a local D1
// database, so nothing leaves this computer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { computeKitTuning, cleanKitPlay } from '../src/kit-games.js';

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
    ratelimits: Object.fromEntries(['LIMIT_PLAYS', 'LIMIT_ADMIN'].map((n, i) => [n, { namespace_id: String(42101 + i), simple: { limit: 1000, period: 60 } }])),
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

const play = (p) => ({ level: 'medium', size: 6, mode: 'free', outcome: 'solved', feel: null, minutes: 6, hints: 0, mistakes: 0, checks: 0, tuned: 0.5, score: 40, stuck: [], platform: 'web', version: '1.18.1', ...p });

test('a play record is cleaned: unknown games, levels, sizes and techniques are dropped', () => {
  assert.equal(cleanKitPlay('zz', play()), null);
  assert.equal(cleanKitPlay('cm', { ...play(), level: 'impossible' }), null);
  assert.equal(cleanKitPlay('cm', { ...play(), size: 12 }), null, 'Cage Math has no 12 x 12');
  assert.ok(cleanKitPlay('sc', { ...play(), size: 12 }), 'Sum Cross does');
  const r = cleanKitPlay('cm', { ...play(), stuck: ['cageLine', 'cageLine', 'overlap', 'guessing'], pid: 'Bad PID!', name: 'Ann' });
  assert.equal(r.stuck, '["cageLine"]', 'only Cage Math techniques are kept');
  assert.equal(r.pid, null);
  assert.equal('name' in r, false);
});

test('shared tuning moves a level only after 10 games, and gently', () => {
  assert.deepEqual(computeKitTuning('pg', Array.from({ length: 9 }, () => ({ level: 'hard', outcome: 'solved', feel: 'easy', hints: 0, minutes: 3 }))).toughness, {});
  const easy = computeKitTuning('pg', Array.from({ length: 12 }, () => ({ level: 'hard', outcome: 'solved', feel: 'easy', hints: 0, minutes: 3 })));
  assert.ok(easy.toughness.hard > 0.5 && easy.toughness.hard <= 0.8);
  assert.equal(computeKitTuning('sc', Array.from({ length: 12 }, () => ({ level: 'hard', outcome: 'abandoned', feel: 'hard' }))).toughness.hard, 0.2);
});

test('each game keeps its own plays, and a rating sent later updates the same game', async () => {
  const r = await call('/v1/learn/cm/plays', { body: { plays: [play({ pid: 'abcd1234efgh' }), play({ level: 'easy', size: 4 })] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 2);
  await call('/v1/learn/cm/plays', { body: { plays: [play({ pid: 'abcd1234efgh', feel: 'hard' })] } });
  assert.deepEqual((await db.prepare("SELECT feel FROM kit_plays WHERE game = 'cm' AND pid = 'abcd1234efgh'").all()).results, [{ feel: 'hard' }]);
  // The same random key in another game is another game's record.
  assert.equal((await call('/v1/learn/pg/plays', { body: { plays: [play({ pid: 'abcd1234efgh', size: 10 })] } })).body.saved, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM kit_plays WHERE game = 'cm'").first()).n, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM kit_plays WHERE game = 'pg'").first()).n, 1);
  assert.equal((await call('/v1/learn/zz/plays', { body: { plays: [play()] } })).status, 404, 'unknown games are not routes');
});

test('the tuning endpoint reports toughness per level from that game only', async () => {
  await call('/v1/learn/sc/plays', { body: { plays: Array.from({ length: 12 }, () => play({ level: 'expert', size: 9, outcome: 'abandoned', feel: 'hard' })) } });
  const r = await call('/v1/learn/sc/tuning');
  assert.equal(r.status, 200);
  assert.equal(r.body.toughness.expert, 0.2);
  assert.deepEqual((await call('/v1/learn/cm/tuning')).body.toughness, {});
});

test('each game has its own admin section and its own settings', async () => {
  assert.equal((await call('/admin/v1/kit-game/cm')).status, 401);
  const r = await call('/admin/v1/kit-game/cm', { token: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Cage Math');
  assert.ok(r.body.levels.find((l) => l.level === 'medium').games >= 1);
  assert.equal((await call('/admin/v1/kit-game/zz', { token: ADMIN })).status, 404);
  const s = await call('/admin/v1/settings', { token: ADMIN });
  for (const [id, group] of [['cm', 'Cage Math'], ['sc', 'Sum Cross'], ['pg', 'Picture Grid']]) {
    const keys = s.body.settings.filter((x) => x.group === group).map((x) => x.key);
    for (const k of ['enabled', 'learning_enabled', 'max_level', 'daily_enabled', 'adapt_strength', 'shared_weight']) assert.ok(keys.includes(`${id}_${k}`), `${id}_${k} is in the ${group} group`);
  }
});

test('the dashboard can switch a game and its learning off', async () => {
  let cfg = await call('/v1/config');
  assert.equal(cfg.body.kitGames.pg.enabled, true);
  assert.equal(cfg.body.kitGames.pg.adaptStrength, 1);
  assert.equal((await call('/admin/v1/settings', { token: ADMIN, body: { key: 'pg_max_level', value: 'hard' } })).status, 200);
  assert.equal((await call('/admin/v1/settings', { token: ADMIN, body: { key: 'pg_learning_enabled', value: false } })).status, 200);
  cfg = await call('/v1/config');
  assert.equal(cfg.body.kitGames.pg.maxLevel, 'hard');
  assert.equal(cfg.body.kitGames.pg.learning, false);
  assert.equal(cfg.body.kitGames.cm.learning, true, 'the other games keep learning');
  const r = await call('/v1/learn/pg/plays', { body: { plays: [play({ size: 10 })] } });
  assert.equal(r.body.saved, 0, 'plays are accepted and dropped while learning is off');
});
