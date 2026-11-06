// Vox on the Oracle server, through the dashboard (src/vox.js): admins only,
// the key added by the Worker, audio passed through. A stand-in plays Vox
// behind the VPC binding. Run with `npm test` in server/.
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
const KEY = 'k'.repeat(40);
const seen = [];
// The stand-in Vox: records what reached it and answers like Vox does.
async function voxStandIn(req) {
  const u = new URL(req.url);
  seen.push({ path: u.pathname + u.search, method: req.method, key: req.headers.get('X-Vox-Admin-Token'), auth: req.headers.get('Authorization') });
  if (u.pathname === '/v1/health') return Response.json({ status: 'ok', release: 'abc123def456' });
  if (u.pathname === '/v1/speak') return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'audio/wav', 'X-Vox-Take-Id': 't1', 'Set-Cookie': 'x=1' } });
  if (u.pathname === '/v1/admin/check') return Response.json({ ok: true });
  return Response.json({ detail: 'nope' }, { status: 404 });
}

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
    serviceBindings: { VOX: voxStandIn },
    bindings: {
      VOX_KEY: KEY,
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



test('Vox on the server: admins reach it through the dashboard, with the key added here', async () => {
  // anyone: only whether it answers, and on which release
  const h = await call('/admin/v1/vox-health', { origin: null });
  assert.equal(h.status, 200); assert.deepEqual(h.body, { ok: true, release: 'abc123def456' });
  // not signed in, or not an admin: no
  assert.equal((await call('/admin/v1/vox-server')).status, 401);
  assert.equal((await call('/admin/v1/vox/v1/health', { auth: player('p1') })).status, 403);
  const s = await call('/admin/v1/vox-server', { auth: owner() });
  assert.equal(s.status, 200); assert.equal(s.body.ready, true);
  // passed on, with Vox's key and never the admin's sign-in
  const r = await mf.dispatchFetch('https://api.test/admin/v1/vox/v1/speak', { method: 'POST', headers: { Authorization: `Bearer ${owner()}`, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hi', voice: 'narrator' }) });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'audio/wav'); assert.equal(r.headers.get('X-Vox-Take-Id'), 't1');
  assert.equal(r.headers.get('Set-Cookie'), null);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [82, 73, 70, 70]);
  const last = seen.at(-1);
  assert.equal(last.path, '/v1/speak'); assert.equal(last.key, KEY); assert.equal(last.auth, null);
  // query strings go along; odd paths don't
  await call('/admin/v1/vox/v1/admin/check?x=1', { auth: owner() });
  assert.equal(seen.at(-1).path, '/v1/admin/check?x=1');
  assert.equal((await call('/admin/v1/vox/etc/passwd', { auth: owner() })).status, 404);
  assert.equal((await call('/admin/v1/vox/v1/../x', { auth: owner() })).status, 404);
  // Vox's own errors come back as they are
  assert.equal((await call('/admin/v1/vox/v1/nothing', { auth: owner() })).status, 404);
});
