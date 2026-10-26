// Account sync Worker tests: run with `npm test` in server/. They start the
// Worker in Miniflare (the same workerd runtime Cloudflare uses) with a local
// D1 database and sign their own tokens with a throwaway key.
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
let mf;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'), // learn.js uses the engine's story-part rules
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: `${ORIGIN},http://tauri.localhost`, TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = (path, { token, method = 'POST', body, origin = ORIGIN } = {}) => mf.dispatchFetch(`https://api.test${path}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const sync = async (token, body) => { const r = await call('/v1/sync', { token, body }); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
const save = (id, extra = {}) => ({ kind: 'save', key: id, data: JSON.stringify({ id, name: `Puzzle ${id}`, ...extra }), updatedAt: Date.now(), baseRev: 0 });

test('rejects requests without a valid token', async () => {
  assert.equal((await call('/v1/sync', { body: {} })).status, 401);
  assert.equal((await call('/v1/sync', { token: 'abc.def.ghi', body: {} })).status, 401);
  assert.equal((await call('/v1/sync', { token: signer.token({ sub: 'u1' }, { aud: 'other-project' }), body: {} })).status, 401);
  assert.equal((await call('/v1/sync', { token: signer.token({ sub: 'u1' }, { exp: Math.floor(Date.now() / 1000) - 10 }), body: {} })).status, 401);
  assert.equal((await call('/v1/sync', { token: makeSigner(PROJECT).token({ sub: 'u1' }), body: {} })).status, 401, 'signed by a different key');
});

test('CORS allows only the game origins', async () => {
  const ok = await call('/v1/sync', { method: 'OPTIONS', origin: 'http://tauri.localhost' });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'http://tauri.localhost');
  const bad = await call('/v1/sync', { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('push, then pull on another device', async () => {
  const t = signer.token({ sub: 'alice' });
  const r = await sync(t, { changes: [save('a1'), save('a2'), { kind: 'meta', key: 'usedStories', data: '["s1"]', updatedAt: 1, baseRev: 0 }] });
  assert.equal(r.applied.length, 3);
  assert.deepEqual(r.conflicts, []);
  const other = await sync(t, { since: 0 });
  assert.equal(other.changes.length, 3);
  assert.equal(JSON.parse(other.changes.find((c) => c.key === 'a1').data).name, 'Puzzle a1');
  assert.equal(other.cursor, Math.max(...r.applied.map((a) => a.rev)));
  const again = await sync(t, { since: other.cursor });
  assert.deepEqual(again.changes, []);
  assert.equal(again.more, false);
});

test('players never see each other\'s data', async () => {
  const bob = await sync(signer.token({ sub: 'bob' }), { since: 0 });
  assert.deepEqual(bob.changes, []);
});

test('a stale write comes back as a conflict with the server copy', async () => {
  const t = signer.token({ sub: 'carol' });
  const [first] = (await sync(t, { changes: [save('c1')] })).applied;
  // Device A updates from rev `first.rev`.
  const a = await sync(t, { changes: [{ ...save('c1', { name: 'From A' }), baseRev: first.rev }] });
  assert.equal(a.applied.length, 1);
  // Device B still thinks the record is at `first.rev`.
  const b = await sync(t, { changes: [{ ...save('c1', { name: 'From B' }), baseRev: first.rev }] });
  assert.equal(b.applied.length, 0);
  assert.equal(b.conflicts.length, 1);
  assert.equal(JSON.parse(b.conflicts[0].data).name, 'From A');
  // B merges and retries on top of the server copy.
  const b2 = await sync(t, { changes: [{ ...save('c1', { name: 'Merged' }), baseRev: b.conflicts[0].rev }] });
  assert.equal(b2.applied.length, 1);
  // A brand-new record that already exists on the server is also a conflict.
  const dup = await sync(t, { changes: [save('c1')] });
  assert.equal(dup.conflicts.length, 1);
});

test('deletions reach other devices', async () => {
  const t = signer.token({ sub: 'dave' });
  const [d] = (await sync(t, { changes: [save('d1')] })).applied;
  const del = await sync(t, { changes: [{ kind: 'save', key: 'd1', deleted: true, updatedAt: Date.now(), baseRev: d.rev }] });
  assert.equal(del.applied.length, 1);
  const pulled = await sync(t, { since: d.rev });
  assert.equal(pulled.changes.length, 1);
  assert.equal(pulled.changes[0].deleted, true);
  assert.equal(pulled.changes[0].data, null);
});

test('large pulls come in pages', async () => {
  const t = signer.token({ sub: 'erin' });
  const big = 'x'.repeat(400_000);
  for (let i = 0; i < 6; i++) await sync(t, { changes: [save(`e${i}`, { big })] });
  let since = 0;
  let pages = 0;
  const seen = new Set();
  for (;;) {
    const r = await sync(t, { since });
    r.changes.forEach((c) => seen.add(c.key));
    pages++;
    since = r.cursor;
    if (!r.more) break;
  }
  assert.equal(seen.size, 6);
  assert.ok(pages >= 2, `expected paging, got ${pages} page(s)`);
});

test('rejects bad and oversized changes', async () => {
  const t = signer.token({ sub: 'frank' });
  assert.equal((await call('/v1/sync', { token: t, body: { changes: [{ kind: 'nope', key: 'k', data: '1', updatedAt: 1 }] } })).status, 400);
  assert.equal((await call('/v1/sync', { token: t, body: { changes: [{ ...save('f1'), data: 'x'.repeat(1_000_001) }] } })).status, 413);
});

test('deleting an account needs a recent sign-in and removes everything', async () => {
  const now = Math.floor(Date.now() / 1000);
  await sync(signer.token({ sub: 'gina' }), { changes: [save('g1')] });
  const old = signer.token({ sub: 'gina' }, { auth_time: now - 3600 });
  assert.equal((await call('/v1/account', { token: old, method: 'DELETE' })).status, 403);
  const fresh = signer.token({ sub: 'gina' });
  assert.equal((await call('/v1/account', { token: fresh, method: 'DELETE' })).status, 200);
  // Another device still holding a token cannot write the account back.
  assert.equal((await call('/v1/sync', { token: fresh, body: { changes: [save('g2')], since: 0 } })).status, 401);
});

test('every answer carries security headers', async () => {
  for (const r of [await call('/v1/health', { method: 'GET' }), await call('/v1/sync', { body: {} }), await call('/nowhere', { method: 'GET' })]) {
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('strict-transport-security'), /max-age=\d{8}/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'none'/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    await r.arrayBuffer();
  }
});

test('bodies over the limit are cut off while still arriving', async () => {
  const stream = (kb) => new ReadableStream({ start(c) { for (let i = 0; i < kb; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024))); c.close(); } });
  // The Worker answers before the whole body is sent, so the local connection
  // can close under the sender ("fetch failed") now and then. That is the cut-off
  // working, but the status is what is checked, so try again for an answer.
  const post = async (path, kb) => {
    for (let i = 0; ; i++) {
      try { return await mf.dispatchFetch(`https://api.test${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: stream(kb), duplex: 'half' }); } catch (e) { if (i >= 4) throw e; }
    }
  };
  for (const [path, kb] of [['/v1/errors', 20], ['/v1/feedback', 20], ['/v1/learn/plays', 100]]) {
    const r = await post(path, kb);
    assert.ok([400, 413].includes(r.status), `${path} gave ${r.status}`);
    await r.arrayBuffer();
  }
  const r = await post('/v1/errors', 20);
  assert.equal(r.status, 413);
  await r.arrayBuffer();
});
