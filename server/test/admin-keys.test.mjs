// Assistant keys for the admin API (src/admin-keys.js).
// Run with `npm test` in server/.
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
const OWNER = 'owner@example.com';
const DAY = 24 * 3600_000;
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
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: 'break-glass-token-for-tests-1234',
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

const token = (sub, email) => signer.token({ sub, email, email_verified: true });
async function call(path, { auth, body } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${await auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}



test('assistant keys: the owner makes one, it works at its role, and stops when revoked', async () => {
  const owner = token('owner-uid', OWNER);
  const bad = await call('/admin/v1/admin-keys', { auth: owner, body: { name: 'Claude', role: 'owner', days: 7 } });
  assert.equal(bad.status, 400, 'never the owner role');
  const made = await call('/admin/v1/admin-keys', { auth: owner, body: { name: 'Claude', role: 'moderator', days: 7 } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const key = made.body.key;
  assert.match(key, /^flgk_[\w-]{40,}$/);
  const list = (await call('/admin/v1/admin-keys', { auth: owner })).body.keys;
  assert.equal(list[0].state, 'active');
  assert.ok(!JSON.stringify(list).includes(key), 'the key is never shown again');
  const audit = await db.prepare("SELECT detail FROM admin_audit WHERE action = 'admin-keys.create'").first();
  assert.ok(!audit.detail.includes(key), 'nor written to the audit log');

  // A moderator page works; an owner page does not.
  const page = await call('/admin/v1/story-submissions', { auth: key });
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal((await call('/admin/v1/admin-keys', { auth: key })).status, 403, 'a key cannot make keys');
  assert.equal((await call('/admin/v1/me', { auth: key })).body.role, 'moderator');
  const used = await db.prepare("SELECT actor FROM admin_audit WHERE actor = 'key: Claude' LIMIT 1").first();
  assert.ok(used, 'what a key does is in the audit log under its name');
  assert.ok((await db.prepare('SELECT last_used_at FROM admin_keys WHERE id = ?1').bind(made.body.id).first()).last_used_at);

  assert.equal((await call(`/admin/v1/admin-keys/${made.body.id}/revoke`, { auth: owner, body: {} })).status, 200);
  assert.equal((await call('/admin/v1/story-submissions', { auth: key })).status, 401, 'revoked: stops at once');

  // Ended keys stop too.
  const short = (await call('/admin/v1/admin-keys', { auth: owner, body: { name: 'Short', role: 'viewer', days: 1 } })).body;
  await db.prepare('UPDATE admin_keys SET expires_at = ?1 WHERE id = ?2').bind(Date.now() - 1000, short.id).run();
  assert.equal((await call('/admin/v1/me', { auth: short.key })).status, 401);
  assert.equal((await call('/admin/v1/me', { auth: 'flgk_' + 'x'.repeat(43) })).status, 401);
});
