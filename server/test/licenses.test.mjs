// App keys (licenses.js): admin-made keys, activation with device seats, the
// signed pass the apps check offline, daily checks after a key is cancelled,
// website download checks, keys players get for themselves, and the config
// switch that stays off until the signing key is set. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const ORIGIN = 'https://thelogicgrid.com';
const TOKEN = 'break-glass-token-for-license-tests';
const signer = makeSigner(PROJECT);
let mf;
let bare;
let pub;

async function worker(bindings) {
  const m = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com', ...bindings },
  });
  const db = await m.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  return m;
}

before(async () => {
  const k = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await webcrypto.subtle.exportKey('jwk', k.privateKey);
  pub = k.publicKey;
  mf = await worker({ LICENSE_SIGNING_KEY: JSON.stringify(priv) });
  bare = await worker({});
});
after(async () => { await mf.dispose(); await bare.dispose(); });

async function call(path, { auth, method, body, on = mf } = {}) {
  const r = await on.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const admin = (path, body) => call(`/admin/v1/${path}`, { auth: TOKEN, body });
const player = (uid, email, verified = true) => signer.token({ sub: uid, ...(email ? { email, email_verified: verified } : {}) });
const device = (n) => `device-${String(n).padStart(12, '0')}`;

test('the apps do not ask for a key until the signing key is set', async () => {
  assert.equal((await call('/v1/config', { on: bare })).body.features.licenseRequired, false);
  assert.equal((await call('/v1/license/check', { on: bare, body: { pass: 'x.y' } })).body.ok, true);
  assert.equal((await call('/v1/license/activate', { on: bare, body: { key: 'FLG-22222-22222-22222-22222', device: device(1), platform: 'desktop' } })).status, 503);
  const f = (await call('/v1/config')).body.features;
  assert.equal(f.licenseRequired, true);
  assert.equal(f.licenseDownload, true);
  assert.equal(f.licenseOwn, 'signed_in');
});

test('an admin key activates on its devices, and the pass is signed', async () => {
  assert.equal((await admin('licenses', { count: 0 })).status, 400);
  // At most 2 installs per key.
  assert.equal((await admin('licenses', { maxDevices: 3 })).status, 400);
  const made = await admin('licenses', { label: 'Bobby', maxDevices: 2 });
  assert.equal(made.status, 200);
  const [key] = made.body.keys;
  assert.match(key, /^FLG(-[2-9A-HJ-NP-Z]{5}){4}$/);

  // Typed carelessly: lower case, spaces, no dashes.
  const typed = key.toLowerCase().replace(/-/g, ' ');
  const a = await call('/v1/license/activate', { body: { key: typed, device: device(1), platform: 'desktop' } });
  assert.equal(a.status, 200);
  assert.equal(a.body.devices, 1);
  const [body, sig] = a.body.pass.split('.');
  const dec = (s) => Uint8Array.from(Buffer.from(s, 'base64url'));
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, dec(sig), new TextEncoder().encode(body)), true);
  assert.equal(JSON.parse(Buffer.from(body, 'base64url').toString()).d, device(1));

  // The same device again uses no new seat.
  assert.equal((await call('/v1/license/activate', { body: { key, device: device(1), platform: 'desktop' } })).body.devices, 1);
  assert.equal((await call('/v1/license/activate', { body: { key, device: device(2), platform: 'android' } })).body.devices, 2);
  const full = await call('/v1/license/activate', { body: { key, device: device(3), platform: 'android' } });
  assert.equal(full.status, 403);
  assert.equal(full.body.error, 'full');

  assert.deepEqual((await call('/v1/license/check', { body: { pass: a.body.pass } })).body, { ok: true, expiresAt: null, required: true });
  const forged = `${body}.${sig.slice(0, -4)}AAAA`;
  assert.equal((await call('/v1/license/check', { body: { pass: forged } })).body.reason, 'bad');

  // Freeing a seat locks that device on its next check and lets another in.
  const list = (await admin('licenses')).body;
  const row = list.keys.find((k) => k.key === key);
  assert.equal(row.devices, 2);
  assert.equal((await admin(`licenses/${row.id}/devices/${device(1)}/remove`, {})).status, 200);
  assert.equal((await call('/v1/license/check', { body: { pass: a.body.pass } })).body.reason, 'removed');
  assert.equal((await call('/v1/license/activate', { body: { key, device: device(3), platform: 'android' } })).status, 200);

  // Cancelled: every device stops on its next check, and the key cannot be used.
  assert.equal((await admin(`licenses/${row.id}/revoke`, {})).status, 200);
  const d2 = await call('/v1/license/activate', { body: { key, device: device(2), platform: 'android' } });
  assert.equal(d2.body.error, 'revoked');
  assert.equal((await call('/v1/license/download', { body: { key } })).body.reason, 'revoked');
  assert.equal((await admin(`licenses/${row.id}/restore`, {})).status, 200);

  // Two website downloads, then a new key is needed.
  assert.deepEqual((await call('/v1/license/download', { body: { key } })).body, { ok: true, downloadsLeft: 1 });
  assert.deepEqual((await call('/v1/license/download', { body: { key } })).body, { ok: true, downloadsLeft: 0 });
  assert.equal((await call('/v1/license/download', { body: { key } })).body.reason, 'downloads_used');
  const after = (await admin('licenses')).body.keys.find((k) => k.key === key);
  assert.equal(after.downloads, 2);
  assert.ok(after.lastDownloadAt);
});

test('a key installs on one device unless an admin allows a second', async () => {
  const [key] = (await admin('licenses', {})).body.keys;
  assert.equal((await call('/v1/license/activate', { body: { key, device: device(30), platform: 'desktop' } })).body.maxDevices, 1);
  assert.equal((await call('/v1/license/activate', { body: { key, device: device(31), platform: 'desktop' } })).body.error, 'full');
  const row = (await admin(`licenses?q=${key.slice(-5)}`)).body.keys[0];
  assert.equal(row.key, key);
  assert.equal((await admin(`licenses/${row.id}/devices`, { maxDevices: 3 })).status, 400);
  assert.equal((await admin(`licenses/${row.id}/devices`, { maxDevices: 2 })).status, 200);
  assert.equal((await call('/v1/license/activate', { body: { key, device: device(31), platform: 'desktop' } })).body.devices, 2);
  assert.equal((await admin('licenses?status=active')).status, 200);
});

test('unknown and badly shaped keys are refused', async () => {
  assert.equal((await call('/v1/license/download', { body: { key: 'hello' } })).body.ok, false);
  assert.equal((await call('/v1/license/activate', { body: { key: 'FLG-22222-22222-22222-22222', device: device(9), platform: 'desktop' } })).body.error, 'unknown');
  assert.equal((await call('/v1/license/activate', { body: { key: 'FLG-22222-22222-22222-22222', device: 'short', platform: 'desktop' } })).body.error, 'bad_device');
});

test('a key with an end date stops working after it', async () => {
  const until = Date.now() + 60_000;
  const [key] = (await admin('licenses', { until })).body.keys;
  const a = await call('/v1/license/activate', { body: { key, device: device(20), platform: 'desktop' } });
  assert.equal(a.body.expiresAt, until);
  assert.equal((await admin('licenses', { until: Date.now() - 1 })).status, 400);
});

test('signed-in players with a confirmed email get one key of their own', async () => {
  assert.equal((await call('/v1/license/mine')).status, 401);
  assert.equal((await call('/v1/license/mine', { auth: player('p-x', 'x@example.com', false), body: {} })).body.error, 'confirm_email');
  const p = player('p-me', 'me@example.com');
  assert.equal((await call('/v1/license/mine', { auth: p })).body.key, null);
  const made = await call('/v1/license/mine', { auth: p, body: {} });
  assert.equal(made.status, 200);
  assert.equal(made.body.maxDevices, 1);
  assert.equal(made.body.downloadsLeft, 2);
  assert.equal((await call('/v1/license/mine', { auth: p, body: {} })).body.key, made.body.key);
  assert.equal((await call('/v1/license/mine', { auth: p })).body.key, made.body.key);

  // Only Supporters: someone without a grant is refused.
  assert.equal((await admin('settings', { key: 'license_self_serve', value: 'supporters' })).status, 200);
  assert.equal((await call('/v1/license/mine', { auth: player('p-other', 'o@example.com'), body: {} })).body.error, 'not_allowed');
  assert.equal((await admin('supporters', { kind: 'supporter', email: 'o@example.com' })).status, 200);
  assert.equal((await call('/v1/license/mine', { auth: player('p-other', 'o@example.com'), body: {} })).status, 200);
  assert.equal((await admin('settings', { key: 'license_self_serve', value: 'off' })).status, 200);
  assert.equal((await call('/v1/license/mine', { auth: player('p-3', 't@example.com'), body: {} })).body.error, 'not_allowed');
});

test('turning the switch off opens the apps without a key', async () => {
  assert.equal((await admin('settings', { key: 'license_required', value: false })).status, 200);
  const f = (await call('/v1/config')).body.features;
  assert.equal(f.licenseRequired, false);
  assert.equal(f.licenseDownload, false);
  assert.equal((await admin('settings', { key: 'license_required', value: true })).status, 200);
});
