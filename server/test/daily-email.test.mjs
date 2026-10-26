// Daily puzzle by email: run with `npm test` in server/.
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

const call = async (path, { method = 'POST', body, auth } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch (e) { /* a page */ }
  return { status: r.status, body: parsed };
};
const today = new Date().toISOString().slice(0, 10);
const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const player = (sub, email, verified = true) => signer.token({ sub, email, email_verified: verified });

test('a signed-in player with a confirmed email can switch it on and off', async () => {
  assert.equal((await call('/v1/daily-email', { method: 'GET' })).status, 401);
  const a = player('uid-a', 'A@Example.com');
  assert.deepEqual((await call('/v1/daily-email', { method: 'GET', auth: a })).body, { on: false, verified: true });
  assert.deepEqual((await call('/v1/daily-email', { auth: a, body: { on: true } })).body, { on: true, verified: true });
  const row = await db.prepare('SELECT email, token FROM daily_email WHERE uid = ?1').bind('uid-a').first();
  assert.equal(row.email, 'a@example.com');
  assert.match(row.token, /^[0-9a-f]{32}$/);
  assert.deepEqual((await call('/v1/daily-email', { auth: a, body: { on: false } })).body, { on: false, verified: true });
  assert.equal(await db.prepare('SELECT * FROM daily_email WHERE uid = ?1').bind('uid-a').first(), null);

  const u = player('uid-u', 'u@example.com', false);
  const r = await call('/v1/daily-email', { auth: u, body: { on: true } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'unverified');
});

test('the sender gets each address once a day, failures are tried again, and the link unsubscribes', async () => {
  await call('/v1/daily-email', { auth: player('uid-b', 'b@example.com'), body: { on: true } });
  await call('/v1/daily-email', { auth: player('uid-c', 'c@example.com'), body: { on: true } });
  assert.equal((await call('/admin/v1/daily-email/claim', { auth: owner(), body: { day: '2020-01-01' } })).status, 400);
  const first = await call('/admin/v1/daily-email/claim', { auth: owner(), body: { day: today } });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.list.map((x) => x.email).sort(), ['b@example.com', 'c@example.com']);
  assert.equal((await call('/admin/v1/daily-email/claim', { auth: owner(), body: { day: today } })).body.list.length, 0);
  const b = first.body.list.find((x) => x.email === 'b@example.com');
  const c = first.body.list.find((x) => x.email === 'c@example.com');
  assert.deepEqual((await call('/admin/v1/daily-email/done', { auth: owner(), body: { failed: [b.token] } })).body, { retry: 1, removed: 0 });
  const again = await call('/admin/v1/daily-email/claim', { auth: owner(), body: { day: today } });
  assert.deepEqual(again.body.list.map((x) => x.email), ['b@example.com']);
  // Players cannot claim the list.
  assert.equal((await call('/admin/v1/daily-email/claim', { auth: player('uid-b', 'b@example.com'), body: { day: today } })).status, 403);

  const page = await call(`/v1/daily-email/unsubscribe?t=${c.token}`, { method: 'GET' });
  assert.equal(page.status, 200);
  assert.match(page.body, /You are unsubscribed/);
  assert.equal(await db.prepare('SELECT * FROM daily_email WHERE token = ?1').bind(c.token).first(), null);
  // The mail programs' one-click unsubscribe.
  const oneClick = await mf.dispatchFetch(`https://api.test/v1/daily-email/unsubscribe?t=${b.token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
  assert.equal(oneClick.status, 204);
  assert.equal(await db.prepare('SELECT * FROM daily_email WHERE token = ?1').bind(b.token).first(), null);
});

test('deleting the account removes the address', async () => {
  await call('/v1/daily-email', { auth: player('uid-d', 'd@example.com'), body: { on: true } });
  const r = await call('/v1/account', { method: 'DELETE', auth: player('uid-d', 'd@example.com') });
  assert.equal(r.status, 200);
  assert.equal(await db.prepare('SELECT * FROM daily_email WHERE uid = ?1').bind('uid-d').first(), null);
});

test('the cap stops new sign-ups and the switch stops sending', async () => {
  const set = (key, value) => call('/admin/v1/settings', { auth: owner(), body: { key, value } });
  await call('/v1/daily-email', { auth: player('uid-e', 'e@example.com'), body: { on: true } });
  assert.equal((await set('daily_email_daily_cap', 1)).status, 200);
  assert.equal((await call('/v1/daily-email', { auth: player('uid-f', 'f@example.com'), body: { on: true } })).body.error, 'full');
  assert.equal((await set('daily_email_enabled', false)).status, 200);
  assert.deepEqual((await call('/admin/v1/daily-email/claim', { auth: owner(), body: { day: today } })).body, { off: true, list: [] });
  const cfg = await mf.dispatchFetch('https://api.test/v1/config', { headers: { Origin: ORIGIN } });
  assert.equal((await cfg.json()).features.dailyEmail, false);
});
