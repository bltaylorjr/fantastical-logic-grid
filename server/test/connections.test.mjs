// The admin dashboard's Connections and setup guide: live status from Worker
// env names, the GitHub Action's report (names only), website and DNS checks
// (stubbed here) and dashboard switches. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const TOKEN = 'break-glass-token-for-tests-1234';
const signer = makeSigner(PROJECT);
let mf;
const fetched = [];

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: 'https://thelogicgrid.com', TEST_JWKS: JSON.stringify(signer.jwks),
      ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com', GEMINI_API_KEY: 'test-key', GOOGLE_TTS_KEY: ' ',
    },
    // Stands in for the website and Cloudflare's DNS-over-HTTPS.
    outboundService: async (req) => {
      const url = new URL(req.url);
      fetched.push(url.href);
      if (url.hostname === 'cloudflare-dns.com') {
        const name = url.searchParams.get('name');
        const answers = { 'thelogicgrid.com': ['185.199.108.153'], 'www.thelogicgrid.com': ['bltaylorjr.github.io.'] }[name] || [];
        return Response.json({ Status: 0, Answer: answers.map((data) => ({ name, data })) });
      }
      if (url.href === 'https://thelogicgrid.com/') return new Response('<html>game</html>');
      if (url.pathname === '/fae88a004ad87116c0e93df007b2de7e.txt') return new Response('wrong');
      return new Response('nope', { status: 404 });
    },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function call(path, { auth = TOKEN, body } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

test('needs an admin sign-in', async () => {
  assert.equal((await call('/admin/v1/connections', { auth: null })).status, 401);
});

test('Worker names: set, unset and blank', async () => {
  const { status, body } = await call('/admin/v1/connections');
  assert.equal(status, 200);
  assert.equal(body.names['worker-secret:GEMINI_API_KEY'], true);
  assert.equal(body.names['worker-secret:OWNER_EMAIL'], true);
  assert.equal(body.names['worker-secret:GOOGLE_TTS_KEY'], false, 'a blank secret is not set');
  assert.equal(body.names['worker-secret:BING_WEBMASTER_KEY'], false);
  assert.equal(body.names['worker-binding:DB'], true);
  assert.equal(body.names['worker-var:FIREBASE_PROJECT_ID'], true);
  // GitHub has not reported yet.
  assert.equal(body.names['github-secret:GMAIL_APP_PASSWORD'], null);
  assert.equal(body.github, null);
  // No value ever comes back.
  assert.ok(!JSON.stringify(body).includes('test-key'));
  assert.ok(!JSON.stringify(body).includes(TOKEN));
});

test('website and DNS checks', async () => {
  const { body } = await call('/admin/v1/connections');
  assert.deepEqual(body.checks['domain-dns#0'], { ok: true });
  assert.deepEqual(body.checks['domain-dns#1'], { ok: true });
  assert.equal(body.checks['github-pages#0'].ok, true);
  assert.equal(body.checks['indexnow#0'].ok, false, 'the key file must hold the key');
  assert.equal(body.checks['resend#0'].ok, false);
  assert.equal(body.checks['weekly-archive#0'].ok, false, 'the archive switch starts off');
  assert.equal(body.checks['github-pages#1'].ok, null, 'Pages not reported yet');
  // Cached: a second look does not fetch again.
  const before = fetched.length;
  await call('/admin/v1/connections');
  assert.equal(fetched.length, before);
});

test('the GitHub report: names only, checked, then shown', async () => {
  assert.equal((await call('/admin/v1/connections/github', { body: { secrets: 'GMAIL_USER', variables: [] } })).status, 400);
  assert.equal((await call('/admin/v1/connections/github', { body: { secrets: ['has space'], variables: [] } })).status, 400);
  const ok = await call('/admin/v1/connections/github', {
    body: { secrets: ['GMAIL_USER', 'FLG_ADMIN_TOKEN', 'OLD_THING'], variables: ['FLG_CLOUD_URL'], pages: { build_type: 'workflow', cname: 'thelogicgrid.com', https_enforced: true, status: 'built', extra: 'x' } },
  });
  assert.equal(ok.status, 200);
  const { body } = await call('/admin/v1/connections');
  assert.equal(body.names['github-secret:GMAIL_USER'], true);
  assert.equal(body.names['github-secret:GMAIL_APP_PASSWORD'], false);
  assert.equal(body.names['github-variable:FLG_CLOUD_URL'], true);
  assert.equal(body.names['github-variable:FLG_FIREBASE_API_KEY'], false);
  assert.deepEqual(body.github.unlisted, ['OLD_THING']);
  assert.equal(body.checks['github-pages#1'].ok, true);
  assert.equal(body.checks['github-pages#3'].ok, true);
});

test('a viewer cannot send a report', async () => {
  const db = await mf.getD1Database('DB');
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at) VALUES ('viewer@example.com', 'viewer', 'test', 0)").run();
  const viewer = signer.token({ sub: 'viewer-uid', email: 'viewer@example.com', email_verified: true });
  assert.equal((await call('/admin/v1/connections', { auth: viewer })).status, 200);
  assert.equal((await call('/admin/v1/connections/github', { auth: viewer, body: { secrets: [], variables: [] } })).status, 403);
});
