// Supporters and premium extras (supporters.js): admin grants, perks for the
// signed-in player, the scoreboard badge, supporter extra themes in the game
// config, and account deletion. Run with `npm test` in server/.
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
const TOKEN = 'break-glass-token-for-supporter-tests';
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function call(path, { auth, method, body } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const player = (uid, email, verified = true) => signer.token({ sub: uid, ...(email ? { email, email_verified: verified } : {}) });
const admin = (path, body) => call(`/admin/v1/${path}`, { auth: TOKEN, body });

test('perks need a signed-in player', async () => {
  assert.equal((await call('/v1/perks')).status, 401);
  assert.deepEqual((await call('/v1/perks', { auth: player('nobody') })).body, { supporter: false, premium: false, until: null });
});

test('an admin grant by email reaches the player with that confirmed email', async () => {
  assert.equal((await admin('supporters', { kind: 'gold', email: 'a@example.com' })).status, 400);
  assert.equal((await admin('supporters', { kind: 'supporter' })).status, 400);
  assert.equal((await admin('supporters', { kind: 'supporter', email: 'A@Example.com', note: 'GitHub Sponsors' })).status, 200);
  // Not confirmed yet: no link, no badge.
  assert.equal((await call('/v1/perks', { auth: player('p-a', 'a@example.com', false) })).body.supporter, false);
  const perks = (await call('/v1/perks', { auth: player('p-a', 'a@example.com') })).body;
  assert.deepEqual(perks, { supporter: true, premium: false, until: null });
  // Linked: still a supporter after changing email.
  assert.equal((await call('/v1/perks', { auth: player('p-a', 'new@example.com') })).body.supporter, true);
  const list = (await admin('supporters')).body.supporters;
  assert.equal(list[0].uid, 'p-a');
  assert.equal(list[0].email, 'a@example.com');
});

test('premium with an end date, and ending it early', async () => {
  const until = Date.now() + 30 * 86400_000;
  assert.equal((await admin('supporters', { kind: 'premium', uid: 'p-b', until: Date.now() - 1000 })).status, 400);
  assert.equal((await admin('supporters', { kind: 'premium', uid: 'p-b', until })).status, 200);
  assert.deepEqual((await call('/v1/perks', { auth: player('p-b') })).body, { supporter: true, premium: true, until });
  const row = (await admin('supporters')).body.supporters.find((s) => s.uid === 'p-b');
  assert.equal((await admin(`supporters/${row.id}/remove`, {})).body.ended, 1);
  assert.equal((await call('/v1/perks', { auth: player('p-b') })).body.premium, false);
});

test('supporters get a badge on the scoreboard', async () => {
  const now = Date.now();
  for (const [uid, name, points] of [['p-a', 'Ada Sleuth', 50], ['p-c', 'Cy Clue', 40]]) {
    await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(uid, name, name.toLowerCase(), now).run();
    await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES (?1, ?2, 'solo', 'easy', 48, 60000, 0, 0, ?3, ?4)").bind(uid, `s-${uid}`, points, now).run();
  }
  const rows = (await call('/v1/scoreboard?period=all')).body.rows;
  assert.equal(rows.find((r) => r.name === 'Ada Sleuth').supporter, true);
  assert.equal(rows.find((r) => r.name === 'Cy Clue').supporter, undefined);
  assert.ok(rows.every((r) => !('uid' in r)), 'player ids stay private');
});

test('supporter extra themes and the extras link reach the game config', async () => {
  let game = (await call('/v1/config')).body.game;
  assert.deepEqual([game.premiumThemes, game.extrasUrl], [[], '']);
  assert.equal((await admin('settings', { key: 'premium_themes', value: ['no-such-theme'] })).status, 400);
  const themes = (await admin('settings')).body.themes;
  assert.equal((await admin('settings', { key: 'premium_themes', value: [themes[1].id] })).status, 200);
  assert.equal((await admin('settings', { key: 'extras_url', value: 'https://ko-fi.com/example/tiers' })).status, 200);
  game = (await call('/v1/config')).body.game;
  assert.deepEqual([game.premiumThemes, game.extrasUrl], [[themes[1].id], 'https://ko-fi.com/example/tiers']);
});

test('deleting an account keeps the payment record but unlinks it', async () => {
  assert.equal((await call('/v1/account', { auth: player('p-a', 'new@example.com'), method: 'DELETE' })).status, 200);
  const row = await db.prepare("SELECT user_id, email FROM supporters WHERE email = 'a@example.com'").first();
  assert.deepEqual(row, { user_id: null, email: 'a@example.com' });
});
