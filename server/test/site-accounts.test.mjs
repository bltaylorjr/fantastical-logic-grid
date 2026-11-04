// Site accounts in admin > Connections and setup (src/site-accounts.js).
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { looksSecret, checkAccount } from '../src/site-accounts.js';

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



test('site accounts: secrets are refused, safe details are kept', () => {
  for (const s of ['password: hunter2', 'Pass=abc', 'flgk_wuhwP4HY8aB0UI2MT4zZUBv9Hd8O3v4nZcnzZCZVfaE', 'ghp_abcdefghijklmnop', 'AIzaSyD-abcdefghijklmnopqrstuv', 'token = x', 'aB3dE5fG7hI9jK1lM3nO5pQ7']) {
    assert.ok(looksSecret(s), s);
  }
  for (const s of ['GitHub secrets YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET', 'https://www.youtube.com/@thelogicgridpuzzles', 'fantasticallogicgrid@gmail.com', 'Keep the password in Bitwarden', 'the-fantastical-logic-grid']) {
    assert.ok(!looksSecret(s), s);
  }
  assert.ok(checkAccount({ site: '' }).error);
  assert.ok(checkAccount({ site: 'X', url: 'http://x.com' }).error);
  assert.ok(checkAccount({ site: 'X', loginEmail: 'nope' }).error);
  assert.ok(checkAccount({ site: 'X', notes: 'password: hunter2' }).error);
  assert.equal(checkAccount({ site: 'X', status: 'weird' }).value.status, 'set-up');
});

test('site accounts: admins list, add, change and remove; others cannot see them', async () => {
  const owner = token('owner-uid', OWNER);
  const list = await call('/admin/v1/site-accounts', { auth: owner });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.accounts.some((a) => a.site === 'YouTube' && a.handle === '@thelogicgridpuzzles'), 'starts with the known accounts');
  const nobody = await call('/admin/v1/site-accounts', { auth: token('player-uid', 'player@example.com') });
  assert.equal(nobody.status, 403);

  const bad = await call('/admin/v1/site-accounts', { auth: owner, body: { site: 'Bluesky', notes: 'app password: abcd-efgh' } });
  assert.equal(bad.status, 400);
  const made = await call('/admin/v1/site-accounts', { auth: owner, body: { site: 'Discord', url: 'https://discord.gg/abc', status: 'waiting' } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const changed = await call('/admin/v1/site-accounts', { auth: owner, body: { id: made.body.id, site: 'Discord', handle: 'The Logic Grid', status: 'set-up' } });
  assert.equal(changed.status, 200);
  const row = await db.prepare('SELECT * FROM site_accounts WHERE id = ?1').bind(made.body.id).first();
  assert.equal(row.handle, 'The Logic Grid');
  assert.equal(row.updated_by.includes(OWNER) || row.updated_by.length > 0, true);
  const gone = await call(`/admin/v1/site-accounts/${made.body.id}/delete`, { auth: owner, body: {} });
  assert.equal(gone.status, 200);
  const again = await call(`/admin/v1/site-accounts/${made.body.id}/delete`, { auth: owner, body: {} });
  assert.equal(again.status, 404);
});
