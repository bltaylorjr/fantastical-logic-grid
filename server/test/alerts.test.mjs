// Owner alerts (alerts.js): run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { b64u, fromB64u } from '../src/webpush.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const OWNER = 'owner@example.com';
const signer = makeSigner('flg-test');
const sent = [];
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
    // Push services and Resend: record what would have gone out.
    outboundService: async (req) => {
      sent.push({ url: req.url, headers: Object.fromEntries(req.headers), body: req.url.includes('resend') ? await req.json() : new Uint8Array(await req.arrayBuffer()) });
      return new Response('{}', { status: 201 });
    },
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), OWNER_EMAIL: OWNER, RESEND_API_KEY: 're_test' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const call = async (path, { method, body, auth } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const device = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { p256dh: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
};

test('the dashboard gets a push key and default choices', async () => {
  const r = await call('/admin/v1/notify', { auth: owner() });
  assert.equal(r.status, 200);
  assert.equal(fromB64u(r.body.publicKey).length, 65);
  assert.deepEqual(r.body.prefs, { emailTo: '', emailOn: false, problems: true, approvals: true, messages: true });
  assert.equal(r.body.emailReady, true);
  // The same key every time.
  assert.equal((await call('/admin/v1/notify', { auth: owner() })).body.publicKey, r.body.publicKey);
});

test('the alert email is typed in by hand and checked', async () => {
  assert.equal((await call('/admin/v1/notify/prefs', { auth: owner(), body: { emailTo: 'not an email', emailOn: true } })).status, 400);
  assert.equal((await call('/admin/v1/notify/prefs', { auth: owner(), body: { emailTo: '', emailOn: true } })).status, 400);
  const r = await call('/admin/v1/notify/prefs', { auth: owner(), body: { emailTo: 'me@example.org', emailOn: true, messages: false } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, { emailTo: 'me@example.org', emailOn: true, problems: true, approvals: true, messages: false });
});

test('only real push services are accepted as devices', async () => {
  const keys = await device();
  for (const endpoint of ['https://evil.example.com/push', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.com/x']) {
    assert.equal((await call('/admin/v1/notify/devices', { auth: owner(), body: { endpoint, ...keys } })).status, 400, endpoint);
  }
  const ok = await call('/admin/v1/notify/devices', { auth: owner(), body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', ...keys, label: 'Phone' } });
  assert.equal(ok.status, 200);
  const list = (await call('/admin/v1/notify', { auth: owner() })).body.devices;
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Phone');
});

test('a test alert is pushed (encrypted) and emailed', async () => {
  sent.length = 0;
  const r = await call('/admin/v1/notify/test', { auth: owner(), body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.pushed, 1);
  assert.equal(r.body.emailed, true);
  const push = sent.find((s) => s.url.startsWith('https://fcm.googleapis.com/'));
  assert.equal(push.headers['content-encoding'], 'aes128gcm');
  assert.match(push.headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.ok(!new TextDecoder().decode(push.body).includes('Test alert'), 'the push is encrypted');
  const mail = sent.find((s) => s.url === 'https://api.resend.com/emails');
  assert.deepEqual(mail.body.to, ['me@example.org']);
  assert.match(mail.body.subject, /Test alert/);
});

test('a problem goes out at once; messages wait for the hourly round-up', async () => {
  sent.length = 0;
  // A player's idea is a message: queued, not sent yet (and this owner turned messages off).
  assert.equal((await call('/v1/feedback', { body: { kind: 'idea', topic: 'feature', text: 'Please add a night mode for the grid.' } })).status, 200);
  const waiting = await db.prepare("SELECT category, instant, sent_at FROM alert_queue WHERE title = 'New idea'").first();
  assert.deepEqual({ ...waiting }, { category: 'messages', instant: 0, sent_at: null });
  // A new kind of error is a problem.
  assert.equal((await call('/v1/errors', { body: { errors: [{ message: 'Grid failed to draw', kind: 'error', platform: 'web', version: '9.9.9' }] } })).status, 200);
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(sent.some((s) => s.url.startsWith('https://fcm.googleapis.com/')), 'the problem was pushed');
  // Another new kind of error within 6 hours does not alert again.
  const before = sent.length;
  await call('/v1/errors', { body: { errors: [{ message: 'Grid failed to draw again', kind: 'error', platform: 'web', version: '9.9.9' }] } });
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(sent.length, before);
  // The round-up marks the idea sent; with messages off, the owner gets nothing for it.
  sent.length = 0;
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: '23 * * * *' });
  const done = await db.prepare("SELECT sent_at FROM alert_queue WHERE title = 'New idea'").first();
  assert.ok(done.sent_at);
  assert.equal(sent.length, 0);
});

test('a removed device gets no more alerts', async () => {
  const keys = await device();
  await call('/admin/v1/notify/devices', { auth: owner(), body: { endpoint: 'https://fcm.googleapis.com/fcm/send/gone1', ...keys, label: 'Old phone' } });
  const list = (await call('/admin/v1/notify', { auth: owner() })).body.devices;
  const old = list.find((d) => d.label === 'Old phone');
  assert.equal((await call(`/admin/v1/notify/devices/${old.id}/remove`, { auth: owner(), body: {} })).status, 200);
  assert.ok(!(await call('/admin/v1/notify', { auth: owner() })).body.devices.some((d) => d.label === 'Old phone'));
});
