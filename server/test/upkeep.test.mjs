// Self-maintenance tests: the daily cleanup (scheduled), the deep health check
// and anonymous error reports. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { cleanMessage, cleanStack } from '../src/errors.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const TOKEN = 'admin-token-for-tests-1234';
const DAY = 24 * 3600_000;
let mf;
let db;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN, ADMIN_TOKEN: TOKEN, DAILY_TTS_CAP: '300' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = (path, { method = 'GET', body, token, raw } = {}) => mf.dispatchFetch(`https://api.test${path}`, {
  method,
  headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'text/plain' },
  body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
});
const count = async (table) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

test('daily cleanup removes only old data and never scores', async () => {
  const now = Date.now();
  const old = now - 50 * DAY;
  await db.batch([
    db.prepare("INSERT INTO races (code, host_id, tier, cells, story_id, title, puzzle, created_at, closes_at) VALUES ('OLD1', 'u1', 'easy', 9, 's1', 'Old', '{}', ?1, ?1)").bind(old),
    db.prepare("INSERT INTO races (code, host_id, tier, cells, story_id, title, puzzle, created_at, closes_at) VALUES ('NEW1', 'u1', 'easy', 9, 's2', 'New', '{}', ?1, ?1)").bind(now),
    db.prepare("INSERT INTO race_entries (code, user_id, joined_at) VALUES ('OLD1', 'u1', ?1), ('NEW1', 'u1', ?2)").bind(old, now),
    db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES ('u1', 's1', 'race', 'easy', 9, 1, 0, 0, 10, ?1)").bind(now - 900 * DAY),
    db.prepare("INSERT INTO usage (day, name, count) VALUES (?1, 'tts', 5), (?2, 'tts', 3)").bind(isoDay(now - 61 * DAY), isoDay(now)),
    db.prepare("INSERT INTO parts (key, theme, kind, value, source, status, submitted, reviewed) VALUES ('a', 'pets', 'openings', '\"x\"', 'mine', 'rejected', ?1, ?1), ('b', 'pets', 'openings', '\"y\"', 'mine', 'approved', ?1, ?1)").bind(new Date(now - 100 * DAY).toISOString()),
    db.prepare("INSERT INTO sync_deleted_users (user_id, deleted_at) VALUES ('gone-old', ?1), ('gone-new', ?2)").bind(now - 31 * DAY, now - DAY),
    db.prepare("INSERT INTO plays (day, platform, tier, theme, outcome) VALUES (?1, 'web', 'easy', 'pets', 'solved'), (?2, 'web', 'easy', 'pets', 'solved')").bind(isoDay(now - 401 * DAY), isoDay(now)),
    db.prepare("INSERT INTO app_errors (day, fingerprint, platform, version, kind, message) VALUES (?1, 'f-old', 'web', '1', 'error', 'old')").bind(isoDay(now - 31 * DAY)),
  ]);

  let health = await (await call('/v1/health?deep=1')).json();
  assert.equal(health.db, true);
  assert.equal(health.lastUpkeep, null, 'no cleanup has run yet');
  assert.equal(health.voicesToday, 3);

  const worker = await mf.getWorker();
  const run = await worker.scheduled({ cron: '17 3 * * *' });
  assert.equal(run.outcome, 'ok');

  assert.deepEqual((await db.prepare('SELECT code FROM races').all()).results.map((r) => r.code), ['NEW1']);
  assert.deepEqual((await db.prepare('SELECT code FROM race_entries').all()).results.map((r) => r.code), ['NEW1']);
  assert.equal(await count('scores'), 1, 'scores stay for the all-time scoreboard');
  assert.equal(await count('usage'), 1);
  assert.deepEqual((await db.prepare('SELECT key FROM parts').all()).results.map((r) => r.key), ['b'], 'approved parts stay');
  assert.deepEqual((await db.prepare('SELECT user_id FROM sync_deleted_users').all()).results.map((r) => r.user_id), ['gone-new']);
  assert.equal(await count('plays'), 1);
  assert.equal(await count('app_errors'), 0);

  const log = await db.prepare('SELECT removed FROM upkeep_log').first();
  assert.equal(JSON.parse(log.removed).races, 1);
  health = await (await call('/v1/health?deep=1')).json();
  assert.ok(health.lastUpkeep > now - 60_000, 'health shows the cleanup ran');
  assert.deepEqual(await (await call('/v1/health')).json(), { ok: true }, 'the quick check stays quick');
});

test('error reports are cleaned, counted and kept free of personal details', async () => {
  assert.equal(cleanMessage('Failed to fetch https://flg.example/v1/sync?t=abc for sam@example.com id 1234567'), 'Failed to fetch <url> for <email> id #');
  assert.equal(cleanStack('TypeError: x\n    at go (https://thelogicgrid.com/js/app.js?v=3:120:7)\n    at worker.js:4:1\n    at a.js:1\n    at b.js:2'), 'app.js:120 < worker.js:4 < a.js:1');

  const report = { kind: 'error', message: 'Cannot read properties of undefined (reading "cells")', stack: 'at draw (https://thelogicgrid.com/js/grid.js:88:3)', platform: 'android', version: '1.6.0', email: 'a@b.c' };
  for (let i = 0; i < 3; i++) assert.equal((await (await call('/v1/errors', { method: 'POST', body: { errors: [report] } })).json()).saved, 1);
  assert.equal((await call('/v1/errors', { method: 'POST', raw: 'not json' })).status, 400);
  assert.equal((await (await call('/v1/errors', { method: 'POST', body: { errors: [{ message: '' }] } })).json()).saved, 0);

  const rows = (await db.prepare('SELECT * FROM app_errors').all()).results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 3, 'the same error only raises its count');
  assert.equal(rows[0].place, 'grid.js:88');
  assert.ok(!/a@b\.c|thelogicgrid\.com/.test(JSON.stringify(rows)));

  assert.equal((await call('/admin/errors')).status, 401, 'reading reports needs the admin token');
  const list = await (await call('/admin/errors', { token: TOKEN })).json();
  assert.equal(list.errors[0].count, 3);
  assert.equal(list.errors[0].platform, 'android');
  assert.equal((await (await call('/v1/health?deep=1')).json()).errorsToday, 3);
});
