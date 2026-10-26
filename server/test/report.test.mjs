// Daily puzzle planner, puzzle quality report, free-limit alerts, the weekly
// summary and spreadsheet downloads. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const ORIGIN = 'https://thelogicgrid.com';
const TOKEN = 'break-glass-token-for-tests-1234';
const OWNER = 'owner@example.com';
const signer = makeSigner(PROJECT);
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
    assets: { directory: join(root, '..', 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN,
      OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'test-web-key', DAILY_TTS_CAP: '300',
    },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const idToken = (sub, email, verified = true) => signer.token({ sub, email, email_verified: verified });
const owner = () => idToken('owner-uid', OWNER);

async function call(path, { auth, method, body, origin = ORIGIN } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, body: json, text, headers: r.headers };
}

const DAY = 24 * 3600_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

test('the daily planner changes only days to come, and the build reads the plan', async () => {
  const tomorrow = iso(Date.now() + DAY);
  const today = iso(Date.now());
  const viewer = idToken('v-uid', 'viewer@example.com');
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at) VALUES ('viewer@example.com', 'viewer', 'test', 0), ('mod@example.com', 'moderator', 'test', 0)").run();
  assert.equal((await call('/admin/v1/daily', { auth: viewer })).status, 403, 'viewers do not see the planner');
  const view = await call('/admin/v1/daily', { auth: idToken('m-uid', 'mod@example.com') });
  assert.equal(view.status, 200);
  assert.ok(view.body.themes.length > 5 && view.body.tiers.length === 6);
  assert.equal((await call(`/admin/v1/daily/${tomorrow}`, { auth: idToken('m-uid', 'mod@example.com'), body: { theme: 'mystery' } })).status, 403, 'moderators cannot change it');

  const past = await call(`/admin/v1/daily/${today}`, { auth: owner(), body: { theme: 'mystery' } });
  assert.equal(past.status, 400, "today's puzzle cannot change");
  assert.equal((await call(`/admin/v1/daily/${tomorrow}`, { auth: owner(), body: { theme: 'nope' } })).status, 400);
  assert.equal((await call(`/admin/v1/daily/${tomorrow}`, { auth: owner(), body: { size: '9x9' } })).status, 400);
  const ok = await call(`/admin/v1/daily/${tomorrow}`, { auth: owner(), body: { theme: 'mystery', difficulty: 'hard', size: '4x5', note: 'Halloween' } });
  assert.equal(ok.status, 200);
  const again = await call(`/admin/v1/daily/${tomorrow}`, { auth: owner(), body: { theme: 'mystery', difficulty: 'hard', size: '4x5', newStory: true } });
  assert.equal(again.body.plan.reroll, 1, 'New story counts up');

  const plan = await call('/v1/daily/plan');
  assert.equal(plan.status, 200);
  assert.deepEqual(plan.body.plan, [{ date: tomorrow, theme: 'mystery', difficulty: 'hard', categories: 4, items: 5, reroll: 1 }], 'the public plan leaves out who changed it');

  assert.equal((await call(`/admin/v1/daily/${tomorrow}/reset`, { auth: owner(), body: {} })).status, 200);
  assert.deepEqual((await call('/v1/daily/plan')).body.plan, []);
});

test('the quality report flags themes players give up on or find too hard', async () => {
  const day = iso(Date.now());
  const ins = db.prepare("INSERT INTO plays (day, platform, tier, theme, size, outcome, rating, feel, minutes, hints) VALUES (?1, 'web', ?2, ?3, '4x4', ?4, ?5, ?6, 10, 2)");
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(ins.bind(day, 'hard', 'space', i < 5 ? 'abandoned' : 'solved', 2, 'hard'));
  for (let i = 0; i < 8; i++) rows.push(ins.bind(day, 'easy', 'mystery', 'solved', 5, 'right'));
  for (let i = 0; i < 2; i++) rows.push(ins.bind(day, 'expert', 'fantasy', 'abandoned', 1, 'hard'));
  await db.batch(rows);
  const q = await call('/admin/v1/quality?days=30', { auth: owner() });
  assert.equal(q.status, 200);
  const [first] = q.body.rows;
  assert.deepEqual([first.theme, first.tier], ['space', 'hard'], 'the worst group comes first');
  assert.deepEqual(first.issues.map((x) => x.code).sort(), ['hard', 'quit', 'rating']);
  assert.equal(q.body.rows.find((r) => r.theme === 'mystery').issues.length, 0);
  assert.equal(q.body.rows.find((r) => r.theme === 'fantasy').issues.length, 0, 'too few games are never flagged');
});

test('free-limit alerts warn near the daily caps', async () => {
  const today = iso(Date.now());
  await db.prepare("INSERT INTO usage (day, name, count) VALUES (?1, 'tts', 290), (?1, 'pictures', 10)").bind(today).run();
  const a = await call('/admin/v1/alerts', { auth: owner() });
  assert.equal(a.status, 200);
  const voices = a.body.alerts.find((x) => x.id === 'voices');
  assert.ok(voices && voices.level === 'warn' && voices.percent === 97, 'voices at 97% of 300 warn');
  assert.ok(!a.body.alerts.some((x) => x.id === 'pictures'), 'pictures at 10% are fine');
  assert.equal(a.body.cloudflare, 'off');
  await call('/admin/v1/settings', { auth: owner(), body: { key: 'alert_percent', value: 100 } });
  assert.ok(!(await call('/admin/v1/alerts', { auth: owner() })).body.alerts.some((x) => x.id === 'voices'), 'the alert level is a setting');
  await call('/admin/v1/settings', { auth: owner(), body: { key: 'alert_percent', value: 80 } });
});

test('the weekly summary has the numbers, new ideas and puzzles to look at', async () => {
  const now = Date.now();
  await db.prepare("INSERT INTO feedback (kind, topic, text, platform, version, status, created_at) VALUES ('idea', 'story', 'A pirate ship in the fog', 'web', '1.6.0', 'new', ?1)").bind(now).run();
  const viewer = idToken('v-uid', 'viewer@example.com');
  assert.equal((await call('/admin/v1/summary?days=7', { auth: viewer })).status, 403);
  const s = await call('/admin/v1/summary?days=7', { auth: TOKEN });
  assert.equal(s.status, 200);
  assert.equal(s.body.days, 7);
  assert.ok(s.body.games.finished >= 18);
  assert.equal(s.body.feedback.recent[0].text, 'A pirate ship in the fog');
  assert.ok(s.body.quality.some((x) => x.theme === 'space'));
  assert.ok(s.body.alerts.some((x) => x.id === 'voices'));
  assert.equal(s.body.enabled, true);
});

test('spreadsheet downloads are CSV, admin only, and safe to open', async () => {
  const now = Date.now();
  await db.prepare("INSERT INTO feedback (kind, topic, text, platform, version, status, created_at) VALUES ('problem', 'play', '=HYPERLINK(\"x\")', 'web', '1.6.0', 'new', ?1)").bind(now).run();
  await db.prepare("INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES ('p1', 'Sleuth, Jr', 'sleuthjr', ?1, ?1)").bind(now).run();
  assert.equal((await call('/admin/v1/export/feedback.csv', { auth: idToken('m-uid', 'mod@example.com') })).status, 403);
  const fb = await call('/admin/v1/export/feedback.csv', { auth: owner() });
  assert.equal(fb.status, 200);
  assert.match(fb.headers.get('content-type'), /text\/csv/);
  assert.match(fb.headers.get('content-disposition'), /logic-grid-feedback-\d{4}-\d{2}-\d{2}\.csv/);
  assert.match(fb.text, /^﻿?When \(UTC\),Box/);
  assert.ok(fb.text.includes(`"'=HYPERLINK(""x"")"`), 'formulas are defused');
  const pl = await call('/admin/v1/export/players.csv', { auth: owner() });
  assert.ok(pl.text.includes('"Sleuth, Jr"'));
  assert.equal((await call('/admin/v1/export/scores.csv', { auth: owner() })).status, 200);
  assert.equal((await call('/admin/v1/export/admins.csv', { auth: owner() })).status, 404);
});
