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
let usage = null;
const outside = [];   // the server's free-tier guard, as Vox reports it
// The stand-in Vox: records what reached it and answers like Vox does.
async function voxStandIn(req) {
  const u = new URL(req.url);
  seen.push({ path: u.pathname + u.search, method: req.method, key: req.headers.get('X-Vox-Admin-Token'), auth: req.headers.get('Authorization') });
  if (u.pathname === '/v1/health') return Response.json({ status: 'ok', release: 'abc123def456', server_usage: usage });
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
    // Outside calls (the website checks, GitHub): answered here, never the real internet.
    outboundService: async (req) => {
      const u = new URL(req.url);
      outside.push(u.host + u.pathname);
      if (u.host === 'api.github.com') return Response.json({ workflow_runs: [
        { workflow_id: 1, name: 'Publish web version', status: 'completed', conclusion: 'success', updated_at: new Date().toISOString(), html_url: 'https://github.com/x/1', event: 'schedule' },
        { workflow_id: 2, name: 'Puzzle emails', status: 'completed', conclusion: 'failure', updated_at: new Date().toISOString(), html_url: 'https://github.com/x/2', event: 'schedule' },
        { workflow_id: 1, name: 'Publish web version', status: 'completed', conclusion: 'failure', updated_at: new Date(Date.now() - 86400000).toISOString(), html_url: 'https://github.com/x/0', event: 'schedule' },
      ] });
      if (u.host === 'cloudflare-dns.com') return Response.json({ Answer: [{ data: '185.199.108.153' }, { data: 'bltaylorjr.github.io.' }] });
      return new Response('ok');
    },
    bindings: {
      VOX_KEY: KEY, GITHUB_DISPATCH_TOKEN: 'github_pat_test',
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

test('the Oracle server near its free allowance shows on the alerts page', async () => {
  usage = null;
  let a = await call('/admin/v1/alerts', { auth: owner() });
  assert.equal(a.status, 200); assert.ok(!a.body.alerts.some((x) => x.id.startsWith('oracle')));
  usage = { at: new Date().toISOString(), level: 2, reason: 'Outbound data is on pace for 88% of this month\'s free 10 TB.', outbound: { used: 3e12, limit: 1e13, on_pace_percent: 88 }, disk_percent: 40, size: { ocpus: '4', memory_gb: '24', free: false } };
  a = await call('/admin/v1/alerts', { auth: owner() });
  const o = a.body.alerts.find((x) => x.id === 'oracle');
  assert.ok(o && o.level === 'warn' && /88%/.test(o.text));
  assert.ok(a.body.alerts.some((x) => x.id === 'oracle-size'));
  // the public check never shows it
  assert.deepEqual((await call('/admin/v1/vox-health', { origin: null })).body, { ok: true, release: 'abc123def456' });
  usage = null;
});

test('the Status page: everything in one report, problems first, and quiet in the audit log', async () => {
  assert.equal((await call('/admin/v1/status')).status, 401);
  usage = { at: new Date().toISOString(), level: 1, reason: 'The disk is 78% full.', outbound: { used: 1e12, limit: 1e13, on_pace_percent: 40 }, disk_percent: 78, vox_data_gb: 12, size: { ocpus: '2', memory_gb: '12', free: true } };
  await db.prepare("INSERT INTO feedback (kind, topic, text, platform, version, status, created_at) VALUES ('idea', 'other', 'More cats', 'web', '1', 'new', ?1)").bind(Date.now()).run();
  const before = (await db.prepare('SELECT COUNT(*) AS n FROM admin_audit').first()).n;
  const r = await call('/admin/v1/status', { auth: player('p1') });
  assert.equal(r.status, 403);
  const s = await call('/admin/v1/status', { auth: owner() });
  assert.equal(s.status, 200);
  const b = s.body;
  assert.deepEqual(b.groups.map((g) => g.id), ['online', 'oracle', 'free', 'jobs', 'waiting']);
  const find = (id) => b.groups.flatMap((g) => g.items).find((i) => i.id === id);
  assert.equal(find('api').state, 'ok');
  assert.equal(find('db').state, 'ok');
  assert.equal(find('puzzles').state, 'off');                 // no puzzle server binding in this test
  assert.equal(find('vox').state, 'ok');
  assert.equal(find('guard').state, 'warn'); assert.match(find('guard').detail, /78%/);
  assert.equal(find('disk').state, 'warn');
  assert.equal(find('size').state, 'ok');
  assert.equal(find('cf').state, 'off');                       // no Cloudflare analytics token
  // GitHub: the latest run of each workflow only
  assert.equal(find('run-Publish web version').state, 'ok');
  assert.equal(find('run-Puzzle emails').state, 'down'); assert.equal(find('run-Puzzle emails').url, 'https://github.com/x/2');
  assert.equal(find('feedback').state, 'warn'); assert.equal(find('feedback').value, '1'); assert.equal(find('feedback').link, 'communication');
  assert.equal(b.overall, 'down');
  assert.ok(b.counts.down >= 1 && b.counts.warn >= 1);
  // every item says where it's handled, in words
  for (const i of b.groups.flatMap((g) => g.items)) {
    assert.ok(['ok', 'warn', 'down', 'off', 'unknown'].includes(i.state), i.id);
    assert.ok(i.label && i.value != null, i.id);
  }
  // polling doesn't fill the audit log
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM admin_audit').first()).n, before + 1);   // only the refused player
  // GitHub is asked once, then cached
  const n = outside.filter((x) => x.startsWith('api.github.com')).length;
  await call('/admin/v1/status', { auth: owner() });
  assert.equal(outside.filter((x) => x.startsWith('api.github.com')).length, n);
  usage = null;
});
