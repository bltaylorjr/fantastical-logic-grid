// Printable puzzle packs: run with `npm test` in server/.
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
const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const player = (sub, email, verified = true) => signer.token({ sub, email, email_verified: verified });

const set = (key, value) => call('/admin/v1/settings', { auth: owner(), body: { key, value } });
const pack = (auth, stories) => call('/v1/print-packs', { auth, body: { stories } });

test('a signed-in player gets the allowance; signed out gets nothing', async () => {
  assert.equal((await call('/v1/print-packs', { method: 'GET' })).status, 401);
  assert.equal((await pack(undefined, ['a|1'])).status, 401);
  const r = await call('/v1/print-packs', { method: 'GET', auth: player('uid-a', 'a@example.com') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { on: true, size: 5, perPeriod: 2, periodDays: 7, used: 0, left: 2, nextAt: null });
});

test('packs count down, stories are never handed out twice, and the limit holds', async () => {
  const a = player('uid-b', 'b@example.com');
  const first = await pack(a, ['mystery|t1|o2', 'scifi/robots|t0|o5|i4|m2|lpart.0|e2']);
  assert.equal(first.status, 200);
  assert.equal(first.body.left, 1);
  // The same story again, even in a new pack, is refused and named.
  const again = await pack(a, ['pets|t1', 'mystery|t1|o2']);
  assert.equal(again.status, 409);
  assert.deepEqual(again.body.stories, ['mystery|t1|o2']);
  assert.equal(again.body.left, 1, 'a refused pack does not count');
  // Too many puzzles, repeats inside one pack and odd ids are refused.
  assert.equal((await pack(a, ['1', '2', '3', '4', '5', '6'])).body.error, 'too_many');
  assert.equal((await pack(a, ['x|1', 'x|1'])).status, 400);
  assert.equal((await pack(a, ['<script>'])).status, 400);
  assert.equal((await pack(a, [])).status, 400);
  assert.equal((await pack(a, ['pets|t1'])).body.left, 0);
  const done = await pack(a, ['pets|t2']);
  assert.equal(done.status, 429);
  assert.equal(done.body.error, 'limit');
  assert.ok(done.body.nextAt > Date.now() + 6 * 86400_000, 'says when the next pack frees up');
  // Another player has their own allowance and their own stories.
  assert.equal((await pack(player('uid-c', 'c@example.com'), ['mystery|t1|o2'])).status, 200);
});

test('the admin settings change the limits and the switch turns packs off', async () => {
  const a = player('uid-d', 'd@example.com');
  assert.equal((await set('print_pack_size', 2)).status, 200);
  assert.equal((await set('print_packs_per_period', 1)).status, 200);
  assert.equal((await set('print_pack_size', 0)).status, 400);
  assert.equal((await pack(a, ['1', '2', '3'])).body.error, 'too_many');
  assert.equal((await pack(a, ['1', '2'])).status, 200);
  assert.equal((await pack(a, ['3'])).body.error, 'limit');
  assert.equal((await set('print_packs_enabled', false)).status, 200);
  const off = await pack(player('uid-e', 'e@example.com'), ['4']);
  assert.equal(off.status, 403);
  assert.equal(off.body.error, 'off');
  const cfg = await mf.dispatchFetch('https://api.test/v1/config', { headers: { Origin: ORIGIN } });
  assert.equal((await cfg.json()).features.printPacks, false);
});

test('deleting the account removes its packs', async () => {
  const now = Math.floor(Date.now() / 1000);
  const r = await mf.dispatchFetch('https://api.test/v1/account', { method: 'DELETE', headers: { Authorization: `Bearer ${signer.token({ sub: 'uid-b', email: 'b@example.com', email_verified: true, auth_time: now })}`, Origin: ORIGIN } });
  assert.equal(r.status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM print_packs WHERE uid = ?1').bind('uid-b').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM print_pack_stories WHERE uid = ?1').bind('uid-b').first()).n, 0);
});
