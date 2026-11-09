// Passwords, the owner's password manager (src/vault.js).
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




const b64 = (n) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64');
const meta = () => ({ salt: b64(16), iterations: 600000, keyIv: b64(12), keyCt: b64(48) });
const item = () => ({ iv: b64(12), ct: b64(200) });

test('vault: only the owner, signed in as themselves, can open it', async () => {
  await db.prepare("INSERT OR REPLACE INTO admins (email, role, added_by, added_at) VALUES ('admin@example.com', 'admin', 'test', 0)").run().catch(() => {});
  const asAdmin = await call('/admin/v1/vault', { auth: token('admin-uid', 'admin@example.com') });
  assert.ok([403].includes(asAdmin.status), `admin refused: ${asAdmin.status}`);
  const glass = await call('/admin/v1/vault', { auth: 'break-glass-token-for-tests-1234' });
  assert.equal(glass.status, 403, 'not the break-glass key');
  assert.equal(glass.body.error, 'owner_only');
  const made = await call('/admin/v1/admin-keys', { auth: token('owner-uid', OWNER), body: { name: 'Helper', role: 'admin', days: 1 } });
  const viaKey = await call('/admin/v1/vault', { auth: made.body.key });
  assert.equal(viaKey.status, 403, 'not an assistant key');
});

test('vault: set up once, add, change, bin, restore, purge, new master, reset', async () => {
  const owner = token('owner-uid', OWNER);
  let v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.meta, null);
  assert.equal((await call('/admin/v1/vault/setup', { auth: owner, body: { ...meta(), iterations: 1000 } })).status, 400, 'too few rounds');
  const m = meta();
  assert.equal((await call('/admin/v1/vault/setup', { auth: owner, body: m })).status, 200);
  assert.equal((await call('/admin/v1/vault/setup', { auth: owner, body: meta() })).status, 409, 'only once');

  assert.equal((await call('/admin/v1/vault/items', { auth: owner, body: { items: [{ iv: 'x', ct: 'plain text password' }] } })).status, 400, 'only base64');
  const add = await call('/admin/v1/vault/items', { auth: owner, body: { items: [item(), item(), item()] } });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const [a, b] = add.body.ids;
  const changed = item();
  assert.equal((await call(`/admin/v1/vault/items/${a}`, { auth: owner, body: changed })).status, 200);
  assert.equal((await call(`/admin/v1/vault/items/${b}/purge`, { auth: owner, body: {} })).status, 404, 'purge only from the bin');
  assert.equal((await call(`/admin/v1/vault/items/${b}/bin`, { auth: owner, body: {} })).status, 200);
  v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.meta.keyCt, m.keyCt);
  assert.equal(v.body.items.length, 3);
  assert.equal(v.body.items.find((x) => x.id === a).ct, changed.ct);
  assert.ok(v.body.items.find((x) => x.id === b).deletedAt);
  assert.equal((await call(`/admin/v1/vault/items/${b}/restore`, { auth: owner, body: {} })).status, 200);
  await call(`/admin/v1/vault/items/${b}/bin`, { auth: owner, body: {} });
  assert.equal((await call(`/admin/v1/vault/items/${b}/purge`, { auth: owner, body: {} })).status, 200);

  // The bin empties itself after 30 days.
  const c = add.body.ids[2];
  await db.prepare('UPDATE vault_items SET deleted_at = ?1 WHERE id = ?2').bind(Date.now() - 31 * DAY, c).run();
  v = await call('/admin/v1/vault', { auth: owner });
  assert.deepEqual(v.body.items.map((x) => x.id), [a]);

  const m2 = meta();
  assert.equal((await call('/admin/v1/vault/master', { auth: owner, body: m2 })).status, 200);
  v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.meta.salt, m2.salt);

  // The audit log says what was done, never the scrambled text.
  const { results } = await db.prepare("SELECT action, detail FROM admin_audit WHERE action LIKE 'vault.%'").all();
  assert.ok(results.some((r) => r.action === 'vault.open'));
  assert.ok(!results.some((r) => String(r.detail || '').includes(changed.ct)));

  assert.equal((await call('/admin/v1/vault/reset', { auth: owner, body: {} })).status, 400, 'needs DELETE');
  assert.equal((await call('/admin/v1/vault/reset', { auth: owner, body: { confirm: 'DELETE' } })).status, 200);
  v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.meta, null);
  assert.equal(v.body.items.length, 0);
});

test('vault: Face ID devices are added, listed, noted, removed, and wiped with the vault', async () => {
  const owner = token('owner-uid', OWNER);
  const dev = () => ({ credId: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'), label: 'iPhone, Safari', prfSalt: b64(32), keyIv: b64(12), keyCt: b64(48) });
  assert.equal((await call('/admin/v1/vault/devices', { auth: owner, body: dev() })).status, 404, 'needs a vault first');
  await call('/admin/v1/vault/setup', { auth: owner, body: meta() });
  assert.equal((await call('/admin/v1/vault/devices', { auth: owner, body: { ...dev(), keyCt: 'not base64!' } })).status, 400);
  const d = dev();
  const add = await call('/admin/v1/vault/devices', { auth: owner, body: d });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const glass = await call('/admin/v1/vault/devices', { auth: 'break-glass-token-for-tests-1234', body: dev() });
  assert.equal(glass.status, 403, 'not the break-glass key');
  assert.equal((await call(`/admin/v1/vault/devices/${add.body.id}/used`, { auth: owner, body: {} })).status, 200);
  let v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.devices.length, 1);
  assert.equal(v.body.devices[0].credId, d.credId);
  assert.equal(v.body.devices[0].keyCt, d.keyCt);
  assert.ok(v.body.devices[0].lastUsedAt);
  assert.equal((await call(`/admin/v1/vault/devices/${add.body.id}/remove`, { auth: owner, body: {} })).status, 200);
  v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.devices.length, 0);
  await call('/admin/v1/vault/devices', { auth: owner, body: dev() });
  await call('/admin/v1/vault/reset', { auth: owner, body: { confirm: 'DELETE' } });
  v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.devices.length, 0, 'a wipe removes the devices too');
});

test('vault: the drop box takes locked logins from admins and assistant keys, and only the owner files them', async () => {
  const owner = token('owner-uid', OWNER);
  await call('/admin/v1/vault/setup', { auth: owner, body: meta() });
  const pub = b64(91);
  assert.equal((await call('/v1/vault-drop-key')).status, 404, 'no key until the dashboard turns it on');
  const drop = { epk: b64(91), iv: b64(12), ct: b64(300), source: 'Claude' };
  assert.equal((await call('/admin/v1/vault/inbox', { auth: owner, body: drop })).status, 404, 'needs the drop box key first');
  assert.equal((await call('/admin/v1/vault/drop-key', { auth: 'break-glass-token-for-tests-1234', body: { pub, privIv: b64(12), privCt: b64(154) } })).status, 403, 'only the owner sets the key');
  assert.equal((await call('/admin/v1/vault/drop-key', { auth: owner, body: { pub, privIv: b64(12), privCt: b64(154) } })).status, 200);
  const k = await call('/v1/vault-drop-key');
  assert.equal(k.status, 200);
  assert.equal(k.body.pub, pub, 'the public key is shared without sign-in');
  assert.equal((await call('/admin/v1/vault/inbox', { auth: owner, body: { ...drop, ct: 'plain text' } })).status, 400, 'only locked text');
  const glass = await call('/admin/v1/vault/inbox', { auth: 'break-glass-token-for-tests-1234', body: drop });
  assert.equal(glass.status, 200, 'the break-glass key (used by the workflow) can drop');
  const made = await call('/admin/v1/admin-keys', { auth: owner, body: { name: 'Claude', role: 'admin', days: 1 } });
  const viaKey = await call('/admin/v1/vault/inbox', { auth: made.body.key, body: { ...drop, source: '<b>Claude</b>' } });
  assert.equal(viaKey.status, 200, 'an assistant key can drop');
  assert.equal((await call('/admin/v1/vault', { auth: made.body.key })).status, 403, 'but cannot read the vault');
  assert.equal((await call(`/admin/v1/vault/inbox/${glass.body.id}/done`, { auth: made.body.key, body: {} })).status, 403, 'or empty the drop box');
  let v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.inbox.length, 2);
  assert.equal(v.body.meta.dropPub, pub);
  assert.ok(!v.body.inbox.some((x) => /[<>]/.test(x.source)), 'the source label is cleaned');
  assert.equal((await call(`/admin/v1/vault/inbox/${glass.body.id}/done`, { auth: owner, body: {} })).status, 200);
  v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.inbox.length, 1);
  await call('/admin/v1/vault/reset', { auth: owner, body: { confirm: 'DELETE' } });
  v = await call('/admin/v1/vault', { auth: owner });
  assert.equal(v.body.inbox.length, 0, 'a wipe empties the drop box');
  assert.equal((await call('/v1/vault-drop-key')).status, 404, 'and removes the key');
});
