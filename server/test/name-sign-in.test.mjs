// Sign in with a screen name: run with `npm test` in server/.
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
const signer = makeSigner(PROJECT);
const UID = 'user-name-sign-in';
const EMAIL = 'sky@example.com';
const asked = [];
let mf;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), FIREBASE_WEB_API_KEY: 'test-web-key' },
    // Stand-in for Firebase's signInWithPassword.
    outboundService: async (req) => {
      const body = await req.json();
      asked.push({ url: req.url, referer: req.headers.get('Referer'), ...body });
      if (body.email === EMAIL && body.password === 'right password') return Response.json({ localId: UID, email: EMAIL, idToken: 'id-token', refreshToken: 'refresh-token', expiresIn: '3600' });
      return Response.json({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 });
    },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = async (path, { token, method = 'POST', body } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const signIn = (name, password) => call('/v1/sign-in/name', { body: { name, password } });

test('a screen name signs in with its password, and the email is never sent back', async () => {
  assert.equal((await call('/v1/profile', { token: signer.token({ sub: UID, email: EMAIL }), method: 'PUT', body: { screenName: 'Sky Fox' } })).status, 200);
  const r = await signIn('sky fox', 'right password');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { idToken: 'id-token', refreshToken: 'refresh-token', localId: UID, expiresIn: '3600' });
  const last = asked.at(-1);
  assert.equal(last.email, EMAIL);
  assert.match(last.url, /accounts:signInWithPassword\?key=test-web-key$/);
  assert.equal(last.referer, `${ORIGIN}/`);
});

test('a wrong password and an unknown name get the same answer', async () => {
  const wrong = await signIn('Sky Fox', 'wrong password');
  const unknown = await signIn('Nobody Here', 'right password');
  assert.equal(wrong.status, 400);
  assert.deepEqual(wrong.body, unknown.body);
  assert.equal(wrong.body.error.message, 'INVALID_LOGIN_CREDENTIALS');
  assert.ok(!JSON.stringify(wrong.body).includes('@'));
});

test('a missing password is asked for, and a long name is refused without asking Firebase', async () => {
  assert.equal((await signIn('Sky Fox', '')).body.error.message, 'MISSING_PASSWORD');
  const before = asked.length;
  assert.equal((await signIn('x'.repeat(60), 'right password')).body.error.message, 'INVALID_LOGIN_CREDENTIALS');
  assert.equal(asked.length, before);
});

test('a player whose email changes is found under the new one', async () => {
  const NEW = 'sky.new@example.com';
  await call('/v1/profile', { token: signer.token({ sub: UID, email: NEW }), method: 'GET' });
  await signIn('Sky Fox', 'right password');
  assert.equal(asked.at(-1).email, NEW);
});
