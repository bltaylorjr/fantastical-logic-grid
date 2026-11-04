// The Vox link: where Vox (the voice engine on the owner's PC) is online, so the
// Voice engine page on any device can open it. Run with `npm test` in server/.
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 40, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks),
      // A trailing line break, as a secret pasted into the Cloudflare dashboard can have: it must still match.
      ADMIN_TOKEN: `${TOKEN}\n`,
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
const player = (uid) => signer.token({ sub: uid });


test('Vox link: admins share where Vox is online, and only that address is allowed to the dashboard', async () => {
  const url = 'https://brave-cat-sun.trycloudflare.com';
  const token = 'abcdefghijklmnopqrstuvwx';
  assert.equal((await call('/admin/v1/vox-link', { auth: owner(), body: { url: 'https://evil.example.com', token } })).status, 400);
  assert.equal((await call('/admin/v1/vox-link', { auth: owner(), body: { url, token: 'short' } })).status, 400);
  assert.equal((await call('/admin/v1/vox-link', { auth: owner(), body: { url: `${url}/`, token } })).status, 200);
  assert.deepEqual((({ url: u, token: t }) => ({ u, t }))((await call('/admin/v1/vox-link', { auth: owner() })).body), { u: url, t: token });
  assert.equal((await call('/admin/v1/vox-link')).status, 401);
  const page = await call('/admin/', { origin: null });
  assert.match(page.headers.get('content-security-policy'), new RegExp(`connect-src ${url.replace(/\./g, '\\.')} `));
  assert.doesNotMatch(page.headers.get('content-security-policy'), /\*\.trycloudflare/);
  assert.equal((await call('/admin/v1/vox-link', { auth: owner(), method: 'DELETE' })).status, 200);
  assert.deepEqual((await call('/admin/v1/vox-link', { auth: owner() })).body, {});
  assert.doesNotMatch((await call('/admin/', { origin: null })).headers.get('content-security-policy'), /trycloudflare/);
});
