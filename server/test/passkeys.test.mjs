// Face ID and fingerprint sign-in for the admin dashboard (src/passkeys.js):
// setting up a device, signing in with it, the session's idle and age limits,
// and removing devices and admins. A software "phone" below makes real
// WebAuthn answers with a P-256 key. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const SITE = 'https://api.test';
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: 'break-glass-token-for-tests-1234', OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'test-web-key' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const idToken = (sub, email, over = {}) => signer.token({ sub, email, email_verified: true }, over);
const owner = (over) => idToken('owner-uid', OWNER, over);

async function call(path, { auth, body } = {}) {
  const r = await mf.dispatchFetch(`${SITE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ------------------------------------------------------------- a pretend phone
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sha = (data) => createHash('sha256').update(data).digest();

function cbor(v) {
  const head = (type, n) => (n < 24 ? Buffer.from([(type << 5) | n]) : n < 256 ? Buffer.from([(type << 5) | 24, n]) : Buffer.from([(type << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}

function makePhone({ origin = SITE, rpId = 'api.test', verified = true } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = Buffer.from(`cred-${Math.random()}`);
  let count = 0;
  const flags = (extra) => Buffer.from([0x01 | (verified ? 0x04 : 0) | extra]);
  const counter = () => { const b = Buffer.alloc(4); b.writeUInt32BE(count); return b; };
  return {
    id: b64(credId),
    create(options) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin }));
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
      const idLen = Buffer.from([credId.length >> 8, credId.length & 255]);
      const authData = Buffer.concat([sha(rpId), flags(0x40), counter(), Buffer.alloc(16), idLen, credId, cbor(cose)]);
      return { id: b64(credId), clientDataJSON: b64(clientDataJSON), attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), device: 'Test phone' };
    },
    get(options, { id = credId, bumpCount = true } = {}) {
      if (bumpCount) count++;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin }));
      const authData = Buffer.concat([sha(rpId), flags(0), counter()]);
      const signature = createSign('SHA256').update(Buffer.concat([authData, sha(clientDataJSON)])).sign(privateKey); // DER, as phones send
      return { id: b64(id), clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData), signature: b64(signature) };
    },
  };
}

async function setUp(phone, auth = owner()) {
  const options = await call('/admin/v1/passkeys/options', { auth, body: {} });
  assert.equal(options.status, 200, JSON.stringify(options.body));
  assert.equal(options.body.rp.id, 'api.test');
  assert.equal(options.body.authenticatorSelection.userVerification, 'required');
  return call('/admin/v1/passkeys/register', { auth, body: phone.create(options.body) });
}
async function signIn(phone, opts) {
  const options = await call('/admin/v1/passkeys/sign-in/options', { body: {} });
  assert.equal(options.status, 200);
  return call('/admin/v1/passkeys/sign-in', { body: phone.get(options.body, opts) });
}

// ------------------------------------------------------------- tests
test('an admin sets up Face ID or fingerprint and signs in with it', async () => {
  const phone = makePhone();
  const added = await setUp(phone);
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.device, 'Test phone');
  const list = await call('/admin/v1/passkeys', { auth: owner() });
  assert.deepEqual(list.body.passkeys.map((p) => p.id), [phone.id]);

  const s = await signIn(phone);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.email, OWNER);
  assert.match(s.body.token, /^flgp\./);
  const me = await call('/admin/v1/me', { auth: s.body.token });
  assert.deepEqual([me.status, me.body.email, me.body.role], [200, OWNER, 'owner']);
  // Only the key's hash is stored.
  const row = await db.prepare('SELECT token_hash FROM admin_sessions').first();
  assert.notEqual(row.token_hash, s.body.token);
  const { results } = await db.prepare("SELECT actor, status FROM admin_audit WHERE action = 'passkeys.sign-in'").all();
  assert.ok(results.some((r) => r.actor === OWNER && r.status === 200));

  // Signing out ends the session on the server.
  assert.equal((await call('/admin/v1/session/end', { auth: s.body.token, body: {} })).status, 200);
  assert.equal((await call('/admin/v1/me', { auth: s.body.token })).status, 401);
});

test('a challenge works once, and answers from elsewhere or without Face ID are refused', async () => {
  const phone = makePhone();
  assert.equal((await setUp(phone)).status, 200);
  const options = await call('/admin/v1/passkeys/sign-in/options', { body: {} });
  const answer = phone.get(options.body);
  assert.equal((await call('/admin/v1/passkeys/sign-in', { body: answer })).status, 200);
  const again = await call('/admin/v1/passkeys/sign-in', { body: answer });
  assert.deepEqual([again.status, again.body.error], [401, 'passkey_expired']);

  const other = makePhone({ origin: 'https://evil.example' });
  const o2 = await call('/admin/v1/passkeys/sign-in/options', { body: {} });
  assert.equal((await call('/admin/v1/passkeys/sign-in', { body: other.get(o2.body) })).body.error, 'wrong_site');

  const unknown = makePhone();
  assert.equal((await signIn(unknown)).body.error, 'unknown_passkey');

  // Someone else's key under this phone's id: the signature does not match.
  const forged = makePhone();
  assert.equal((await signIn(forged, { id: Buffer.from(phone.id, 'base64url') })).body.error, 'bad_signature');

  // A counter that does not go up means a copied key.
  assert.equal((await signIn(phone, { bumpCount: false })).body.error, 'copied_passkey');

  const noFace = makePhone({ verified: false });
  const o3 = await call('/admin/v1/passkeys/options', { auth: owner(), body: {} });
  assert.equal((await call('/admin/v1/passkeys/register', { auth: owner(), body: noFace.create(o3.body) })).body.error, 'not_verified');
});

test('setting up a device needs a recent password sign-in and a real admin', async () => {
  const stale = owner({ auth_time: Math.floor(Date.now() / 1000) - 20 * 60 });
  assert.equal((await call('/admin/v1/passkeys/options', { auth: stale, body: {} })).body.error, 'sign_in_again');
  assert.equal((await call('/admin/v1/passkeys/options', { auth: 'break-glass-token-for-tests-1234', body: {} })).body.error, 'needs_account');
  // A challenge made for one admin cannot set up a passkey for another.
  await call('/admin/v1/admins', { auth: owner(), body: { email: 'mod@example.com', role: 'moderator' } });
  const mod = idToken('mod-uid', 'mod@example.com');
  const phone = makePhone();
  const options = await call('/admin/v1/passkeys/options', { auth: owner(), body: {} });
  assert.equal((await call('/admin/v1/passkeys/register', { auth: mod, body: phone.create(options.body) })).body.error, 'passkey_expired');
});

test('sessions lock after 30 idle minutes and end after 12 hours', async () => {
  const phone = makePhone();
  await setUp(phone);
  const s = await signIn(phone);
  const hash = (await db.prepare('SELECT token_hash FROM admin_sessions ORDER BY created_at DESC LIMIT 1').first()).token_hash;
  await db.prepare('UPDATE admin_sessions SET last_seen = ?2 WHERE token_hash = ?1').bind(hash, Date.now() - 31 * 60_000).run();
  const locked = await call('/admin/v1/me', { auth: s.body.token });
  assert.deepEqual([locked.status, locked.body.error], [401, 'locked']);

  const s2 = await signIn(phone);
  const hash2 = (await db.prepare('SELECT token_hash FROM admin_sessions ORDER BY created_at DESC LIMIT 1').first()).token_hash;
  await db.prepare('UPDATE admin_sessions SET expires_at = ?2 WHERE token_hash = ?1').bind(hash2, Date.now() - 1).run();
  assert.equal((await call('/admin/v1/me', { auth: s2.body.token })).body.error, 'sign_in');
});

test('removing a device or an admin ends their passkey sign-in at once', async () => {
  await call('/admin/v1/admins', { auth: owner(), body: { email: 'view@example.com', role: 'viewer' } });
  const viewer = idToken('view-uid', 'view@example.com');
  const phone = makePhone();
  assert.equal((await setUp(phone, viewer)).status, 200);
  const s = await signIn(phone);
  assert.equal((await call('/admin/v1/me', { auth: s.body.token })).body.role, 'viewer');
  // Another admin cannot remove it; its owner can.
  assert.equal((await call(`/admin/v1/passkeys/${phone.id}/remove`, { auth: owner(), body: {} })).status, 404);
  assert.equal((await call(`/admin/v1/passkeys/${phone.id}/remove`, { auth: viewer, body: {} })).status, 200);
  assert.equal((await call('/admin/v1/me', { auth: s.body.token })).status, 401);

  const phone2 = makePhone();
  await setUp(phone2, viewer);
  const s2 = await signIn(phone2);
  await call('/admin/v1/admins/remove', { auth: owner(), body: { email: 'view@example.com' } });
  assert.equal((await call('/admin/v1/me', { auth: s2.body.token })).status, 401);
  assert.equal((await signIn(phone2)).body.error, 'unknown_passkey');
});
