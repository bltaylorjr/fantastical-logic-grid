// Quality numbers for the website and the game: run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const OWNER = 'owner@example.com';
const signer = makeSigner('flg-test');
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), OWNER_EMAIL: OWNER },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const call = async (path, { method = 'GET', body, auth } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const today = new Date().toISOString().slice(0, 10);
const play = (story, rating, mode = 'daily') => db.prepare("INSERT INTO plays (day, platform, theme, tier, outcome, rating, story, mode) VALUES (?1, 'web', 'space', 'easy', 'solved', ?2, ?3, ?4)").bind(today, rating, story, mode).run();

test('no rating is shown until there are enough, and only well-rated daily puzzles are listed', async () => {
  for (const r of [5, 5, 4]) await play('story-good', r);
  for (const r of [2, 3, 2]) await play('story-poor', r);
  await play('story-one', 5);
  let q = await call('/v1/quality');
  assert.equal(q.status, 200);
  assert.equal(q.body.rating, null);
  assert.deepEqual(q.body.daily, [{ story: 'story-good', average: 4.7, rated: 3 }]);
  assert.deepEqual(q.body.handPicked, []);
  assert.match(q.headers.get('Cache-Control'), /max-age=3600/);
  for (let i = 0; i < 5; i++) await play('free-play', 4, 'free');
  q = await call('/v1/quality');
  assert.deepEqual(q.body.rating, { average: 3.8, rated: 12, days: 90 });
});

test('an admin can hand-pick daily puzzles by date', async () => {
  const bad = await call('/admin/v1/settings', { method: 'POST', auth: owner(), body: { key: 'hand_picked_days', value: ['tomorrow'] } });
  assert.equal(bad.status, 400);
  const ok = await call('/admin/v1/settings', { method: 'POST', auth: owner(), body: { key: 'hand_picked_days', value: ['2026-11-03', '2026-10-28', '2026-11-03'] } });
  assert.equal(ok.status, 200);
  await new Promise((r) => setTimeout(r, 10));
  const q = await call('/v1/quality');
  assert.deepEqual(q.body.handPicked, ['2026-10-28', '2026-11-03']);
});
