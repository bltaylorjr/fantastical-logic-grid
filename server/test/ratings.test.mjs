// Puzzle ratings and insights: late ratings update the same anonymous row,
// the report groups and trends ratings, the rules say what is working and
// what to improve, and the AI summary is capped and kept for the day.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { findings } from '../src/ratings.js';

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
      OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'test-web-key', DAILY_TTS_CAP: '300', TEST_RATINGS_AI: '1',
    },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const viewer = () => signer.token({ sub: 'v-uid', email: 'viewer@example.com', email_verified: true });

async function call(path, { auth, method, body, origin = ORIGIN } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, body: json };
}

const DAY = 24 * 3600_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

test('a rating sent after the game updates the same anonymous row', async () => {
  const play = {
    platform: 'web', tier: 'easy', theme: 'mystery', topic: 'whodunit', size: '3x4', clueTypes: { not: 3, is: 1 }, effort: 0, signal: 0,
    outcome: 'solved', rating: null, feel: null, parts: { o: '1', i: '2' }, minutes: 4, hints: 0, mistakes: 0,
    pid: 'abcDEF123456xyz', story: 'mystery|t1|o1|i2|m0|lname.0|e3', chars: ['captain-mo'], version: '1.8.0', mode: 'daily', whatif: 0,
  };
  assert.equal((await call('/v1/learn/plays', { body: { plays: [play] } })).status, 200);
  assert.equal((await call('/v1/learn/plays', { body: { plays: [{ ...play, rating: 4, feel: 'right' }] } })).status, 200);
  const rows = (await db.prepare("SELECT * FROM plays WHERE pid = 'abcDEF123456xyz'").all()).results;
  assert.equal(rows.length, 1, 'counted once');
  assert.equal(rows[0].rating, 4);
  assert.equal(rows[0].feel, 'right');
  assert.deepEqual([rows[0].topic, rows[0].mode, rows[0].version, rows[0].chars, rows[0].whatif], ['whodunit', 'daily', '1.8.0', '["captain-mo"]', 0]);
  // A later "abandoned" never undoes a solve; junk fields are dropped.
  await call('/v1/learn/plays', { body: { plays: [{ ...play, outcome: 'abandoned', rating: 4, topic: 'not-a-topic', version: '<b>', mode: 'x', chars: ['Bad Id!'] }] } });
  const again = await db.prepare("SELECT outcome FROM plays WHERE pid = 'abcDEF123456xyz'").first();
  assert.equal(again.outcome, 'solved');
  await call('/v1/learn/plays', { body: { plays: [{ ...play, pid: 'zzzzzzzzzzzzzz', topic: 'not-a-topic', version: '<b>', mode: 'x', chars: ['Bad Id!'] }] } });
  const junk = await db.prepare("SELECT topic, version, mode, chars FROM plays WHERE pid = 'zzzzzzzzzzzzzz'").first();
  assert.deepEqual([junk.topic, junk.version, junk.mode, junk.chars], [null, null, null, '[]']);
  await db.prepare('DELETE FROM plays').run();
});

test('the ratings report groups, spreads and trends ratings, and says what to improve', async () => {
  const now = Date.now();
  const early = iso(now - 20 * DAY);
  const late = iso(now - 2 * DAY);
  const ins = db.prepare(`INSERT INTO plays (day, platform, tier, theme, size, clue_types, outcome, rating, feel, parts, topic, version, mode, whatif)
    VALUES (?1, 'web', ?2, ?3, '4x5', ?4, ?5, ?6, ?7, '{"o":"3"}', ?8, ?9, 'free', ?10)`);
  const rows = [];
  // Quantum Physicist Fantasy: low, often given up, too hard, lots of what-if steps.
  for (let i = 0; i < 8; i++) rows.push(ins.bind(late, 'mensa', 'fantasy', '{"ifthen":3,"less":2}', i < 4 ? 'abandoned' : 'solved', i < 6 ? 1 : 3, 'hard', 'dragons', '1.8.0', 9));
  // Easy Mystery: loved.
  for (let i = 0; i < 10; i++) rows.push(ins.bind(i < 5 ? early : late, 'easy', 'mystery', '{"not":3,"is":1}', 'solved', 5, 'right', 'whodunit', i < 5 ? '1.7.1' : '1.8.0', 0));
  // Medium Sports: in between, and unrated games.
  for (let i = 0; i < 10; i++) rows.push(ins.bind(early, 'medium', 'sports', '{"not":2,"either":2}', 'solved', i < 6 ? 4 : null, null, null, '1.7.1', 1));
  await db.batch(rows);

  assert.equal((await call('/admin/v1/ratings')).status, 401, 'signed in only');
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at) VALUES ('viewer@example.com', 'viewer', 'test', 0)").run();
  const r = await call('/admin/v1/ratings?days=30&by=themeTier', { auth: viewer() });
  assert.equal(r.status, 200);
  const o = r.body.overall;
  assert.equal(o.games, 28);
  assert.equal(o.rated, 24);
  assert.deepEqual(o.spread, [6, 0, 2, 6, 10]);
  assert.equal(r.body.trend.length, 30);
  assert.equal(r.body.trend.at(-3).rated, 13);
  const mensa = r.body.groups.find((g) => g.id === 'mensa fantasy');
  assert.equal(mensa.name, 'Quantum Physicist Fantasy');
  assert.equal(mensa.avg, 1.5);
  assert.equal(mensa.quitRate, 0.5);

  const improve = r.body.improve.map((f) => f.text).join('\n');
  assert.match(improve, /Quantum Physicist Fantasy puzzles average 1\.5 stars from 8 ratings/);
  assert.match(improve, /50% gave up/);
  assert.match(r.body.improve.find((f) => f.dim === 'themeTier').advice, /what-if/);
  assert.ok(!r.body.improve.some((f) => f.dim === 'theme' || f.dim === 'tier'), 'the same games are not called out three times');
  assert.ok(r.body.good.some((f) => /Easy Mystery puzzles average 5\.0/.test(f.text)));
  assert.ok(r.body.findings.some((f) => f.dim === 'trend'), 'the change over time is described');

  // Other groupings.
  const byClue = await call('/admin/v1/ratings?days=30&by=clue', { auth: viewer() });
  assert.ok(byClue.body.groups.some((g) => g.name === 'If / then clues' && g.rated === 8));
  const byVersion = await call('/admin/v1/ratings?days=30&by=version', { auth: viewer() });
  assert.deepEqual(byVersion.body.groups.map((g) => g.id), ['1.8.0', '1.7.1'], 'newest version first');
  const byPart = await call('/admin/v1/ratings?days=30&by=part', { auth: viewer() });
  assert.match(byPart.body.groups[0].name, /opening 4/);
  assert.equal((await call('/admin/v1/ratings?by=nope', { auth: viewer() })).status, 400);

  // The AI summary is written once for the day, and kept.
  assert.equal(r.body.summary.status, 'ok');
  assert.ok(!/\*/.test(r.body.summary.text), 'markdown is removed');
  assert.equal(r.body.summary.usedToday, 1);
  const brief = await call('/admin/v1/ratings?days=30&brief=1', { auth: TOKEN });
  assert.equal(brief.body.summary.usedToday, 1, 'the nightly report reuses the day\'s summary');
  assert.ok(!brief.body.groups && brief.body.improve.length);
  assert.match(brief.body.headline, /^24 ratings in the last 30 days, average 3\.6 of 5 stars/);
  assert.ok(brief.body.actionNeeded.some((x) => /Quantum Physicist Fantasy/.test(x)));
  assert.equal((await call('/admin/v1/ratings/summary', { auth: viewer(), body: { days: 30 } })).status, 403, 'viewers cannot spend the AI allowance');
  const again = await call('/admin/v1/ratings/summary', { auth: owner(), body: { days: 30 } });
  assert.equal(again.body.summary.usedToday, 2);
  await call('/admin/v1/settings', { auth: owner(), body: { key: 'ratings_ai_daily_cap', value: 2 } });
  const capped = await call('/admin/v1/ratings/summary', { auth: owner(), body: { days: 30 } });
  assert.equal(capped.body.summary.status, 'ok', 'over the cap the kept summary stays');
  assert.equal(capped.body.summary.usedToday, 2);

  // The weekly summary email gets a Puzzle ratings part.
  const s = await call('/admin/v1/summary?days=7', { auth: TOKEN });
  assert.equal(s.status, 200);
  assert.ok(s.body.ratings && s.body.ratings.rated === 13);
});

test('findings with no ratings say so plainly', () => {
  const empty = { overall: { games: 3, rated: 0 }, groups: {} };
  assert.deepEqual(findings(empty).map((f) => f.kind), ['note']);
  assert.match(findings(empty)[0].text, /none rated yet/);
});
