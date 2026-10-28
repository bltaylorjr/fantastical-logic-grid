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
  assert.deepEqual((await call('/v1/perks', { auth: player('nobody') })).body, { supporter: false, premium: false, tier: 0, until: null, contributor: false });
});

test('an admin grant by email reaches the player with that confirmed email', async () => {
  assert.equal((await admin('supporters', { kind: 'gold', email: 'a@example.com' })).status, 400);
  assert.equal((await admin('supporters', { kind: 'supporter' })).status, 400);
  assert.equal((await admin('supporters', { kind: 'supporter', email: 'A@Example.com', note: 'GitHub Sponsors' })).status, 200);
  // Not confirmed yet: no link, no badge.
  assert.equal((await call('/v1/perks', { auth: player('p-a', 'a@example.com', false) })).body.supporter, false);
  const perks = (await call('/v1/perks', { auth: player('p-a', 'a@example.com') })).body;
  assert.deepEqual(perks, { supporter: true, premium: false, tier: 1, until: null, contributor: false });
  // Linked: still a supporter after changing email.
  assert.equal((await call('/v1/perks', { auth: player('p-a', 'new@example.com') })).body.supporter, true);
  const list = (await admin('supporters')).body.supporters;
  assert.equal(list[0].uid, 'p-a');
  assert.equal(list[0].email, 'a@example.com');
});

test('premium with an end date, and ending it early', async () => {
  const until = Date.now() + 30 * 86400_000;
  assert.equal((await admin('supporters', { kind: 'premium', uid: 'p-b', until: Date.now() - 1000 })).status, 400);
  assert.equal((await admin('supporters', { kind: 'premium', uid: 'p-b', tier: 5, until })).status, 400);
  assert.equal((await admin('supporters', { kind: 'premium', uid: 'p-b', tier: 3, until })).status, 200);
  assert.deepEqual((await call('/v1/perks', { auth: player('p-b') })).body, { supporter: true, premium: true, tier: 3, until, contributor: false });
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
  // Rows are found by points: typed screen names show as a new player until approved.
  // The highest running tier shows: Ada has Bronze, then Silver until yesterday, then Gold.
  await db.prepare("INSERT INTO supporters (user_id, kind, tier, source, ref, created_at, until) VALUES ('p-a', 'supporter', 2, 'admin', 'old', ?1, ?1)").bind(now - 86400_000).run();
  assert.equal((await admin('supporters', { kind: 'supporter', uid: 'p-a', tier: 3 })).status, 200);
  // Hidden until the owner switches badges on.
  let rows = (await call('/v1/scoreboard?period=all')).body.rows;
  assert.equal(rows.find((r) => r.points === 50).supporter, undefined, 'no badges while switched off');
  assert.equal((await admin('settings', { key: 'supporter_badges_enabled', value: true })).status, 200);
  rows = (await call('/v1/scoreboard?period=week')).body.rows; // a fresh board, not the cached one
  assert.equal(rows.find((r) => r.points === 50).supporter, 3);
  assert.equal(rows.find((r) => r.points === 40).supporter, undefined);
  assert.ok(rows.every((r) => !('uid' in r)), 'player ids stay private');
});

test('payments get a badge tier from the tier name or the amount', async () => {
  const { tierFor } = await import('../src/supporters.js');
  const { clearSettingsCache } = await import('../src/settings.js');
  const env = { DB: db };
  clearSettingsCache();
  assert.equal(await tierFor(env, { amount: 3 }), 1);
  assert.equal(await tierFor(env, { amount: 5 }), 2);
  assert.equal(await tierFor(env, { amount: '15.00' }), 3);
  assert.equal(await tierFor(env, { amount: 100 }), 4);
  assert.equal(await tierFor(env, { amount: 1, name: 'Gold supporters' }), 3);
  assert.equal(await tierFor(env, { amount: 100, name: 'Bronze club' }), 1);
  await db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('tier_silver_from', '2', 0, 'test')").run();
  clearSettingsCache();
  assert.equal(await tierFor(env, { amount: 3 }), 2);
  await db.prepare("DELETE FROM settings WHERE key = 'tier_silver_from'").run();
  clearSettingsCache();
});

test('supporter extra themes and the extras link reach the game config', async () => {
  let game = (await call('/v1/config')).body.game;
  assert.deepEqual([game.premiumThemes, game.extrasUrl], [[], '']);
  assert.equal((await admin('settings', { key: 'premium_themes', value: ['no-such-theme'] })).status, 400);
  const themes = (await admin('settings')).body.themes;
  assert.equal((await admin('settings', { key: 'premium_themes', value: [themes[1].id] })).status, 200);
  assert.equal((await admin('settings', { key: 'extras_url', value: 'https://ko-fi.com/example/tiers' })).status, 200);
  game = (await call('/v1/config')).body.game;
  assert.deepEqual([game.premiumThemes, game.extrasUrl], [[], ''], 'nothing locked or shown while extras are switched off');
  assert.equal((await admin('settings', { key: 'premium_extras_enabled', value: true })).status, 200);
  game = (await call('/v1/config')).body.game;
  assert.deepEqual([game.premiumThemes, game.extrasUrl], [[themes[1].id], 'https://ko-fi.com/example/tiers']);
});

test('support asks stay hidden until the switch, the link and a page are all set', async () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await call('/v1/config')).body.game.supportAsks, false);
  assert.equal((await admin('settings', { key: 'support_asks_enabled', value: true })).status, 200);
  assert.equal((await call('/v1/config')).body.game.supportAsks, false, 'no asks without the Support the game link');
  assert.equal((await admin('settings', { key: 'support_url', value: 'https://example.com/support' })).status, 200);
  assert.equal((await admin('settings', { key: 'support_link_enabled', value: true })).status, 200);
  assert.equal((await call('/v1/config')).body.game.supportAsks, true);
  // The daily puzzle email gets the one support line too.
  assert.equal((await admin('settings', { key: 'daily_email_enabled', value: true })).status, 200);
  assert.equal((await admin('daily-email/claim', { day: today })).body.support, 'https://example.com/support');
  assert.equal((await admin('settings', { key: 'support_asks_enabled', value: false })).status, 200);
  assert.equal((await call('/v1/config')).body.game.supportAsks, false);
  assert.equal((await admin('daily-email/claim', { day: today })).body.support, '');
  for (const key of ['support_link_enabled', 'daily_email_enabled']) await admin('settings', { key, value: false });
  // The weekly summary counts supporters.
  const sup = (await call('/admin/v1/summary?days=7', { auth: TOKEN })).body.supporters;
  assert.ok(sup.active >= 1 && sup.added >= 1, JSON.stringify(sup));
});

test('refunds and chargebacks end perks, a chargeback blocks new payments, and the evidence downloads', async () => {
  const { grant } = await import('../src/supporters.js');
  const env = { DB: db };
  const now = Date.now();
  await db.prepare("INSERT INTO sync_users (user_id, rev, created_at) VALUES ('p-z', 0, ?1)").bind(now - 5 * 86400_000).run();
  assert.deepEqual(await grant(env, { uid: 'p-z', email: 'z@example.com', kind: 'premium', tier: 2, source: 'kofi', ref: 'k1' }, now - 86400_000), { blocked: false });
  assert.equal((await admin('supporters', { kind: 'supporter', email: 'z@example.com', tier: 3 })).status, 200);
  const perks = () => call('/v1/perks', { auth: player('p-z', 'z@example.com') }).then((r) => r.body);
  assert.equal((await perks()).premium, true);
  const rows = () => admin('supporters').then((r) => r.body.supporters.filter((x) => x.email === 'z@example.com'));
  const k1 = (await rows()).find((x) => x.ref === 'k1');
  // The evidence for the payment service.
  const ev = await mf.dispatchFetch(`https://api.test/admin/v1/supporters/${k1.id}/evidence`, { headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN } });
  assert.equal(ev.status, 200);
  assert.match(ev.headers.get('content-type'), /text\/plain/);
  const text = await ev.text();
  assert.ok(text.includes('Payment id: k1') && text.includes('Silver level') && text.includes('terms/#tips') && text.includes('created 20'), text);
  assert.equal((await mf.dispatchFetch('https://api.test/admin/v1/supporters/999999/evidence', { headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN } })).status, 404);
  // A chargeback ends everything this player has, keeps the records, and blocks them.
  const cb = await admin(`supporters/${k1.id}/remove`, { reason: 'chargeback' });
  assert.deepEqual(cb.body, { ended: 2, blocked: true });
  assert.deepEqual(await perks(), { supporter: false, premium: false, tier: 0, until: null, contributor: false });
  assert.deepEqual((await rows()).map((x) => x.endedReason).sort(), ['chargeback', 'chargeback']);
  const blocks = (await admin('supporters/blocks')).body.blocks;
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].email, 'z@example.com');
  // The same payment sent again does not bring it back; a new payment is recorded but adds nothing.
  await grant(env, { uid: 'p-z', email: 'z@example.com', kind: 'premium', source: 'kofi', ref: 'k1', until: now + 30 * 86400_000 }, now);
  assert.deepEqual(await grant(env, { email: 'Z@example.com', kind: 'premium', source: 'kofi', ref: 'k2' }, now), { blocked: true });
  assert.equal((await perks()).supporter, false);
  assert.equal((await rows()).find((x) => x.ref === 'k2').endedReason, 'blocked');
  // An admin can still add perks by hand, and can lift the block.
  assert.equal((await admin(`supporters/blocks/${blocks[0].id}/remove`, {})).body.lifted, 1);
  assert.deepEqual(await grant(env, { uid: 'p-z', kind: 'supporter', source: 'kofi', ref: 'k3' }, now), { blocked: false });
  assert.equal((await perks()).supporter, true);
  // A refund ends only that payment and blocks nothing.
  const k3 = (await admin('supporters')).body.supporters.find((x) => x.ref === 'k3');
  assert.equal((await admin(`supporters/${k3.id}/remove`, { reason: 'refund' })).body.ended, 1);
  assert.equal((await admin('supporters/blocks')).body.blocks.length, 0);
  assert.equal((await admin('supporters')).body.supporters.find((x) => x.ref === 'k3').endedReason, 'refund');
});

test('deleting an account keeps the payment record but unlinks it', async () => {
  assert.equal((await call('/v1/account', { auth: player('p-a', 'new@example.com'), method: 'DELETE' })).status, 200);
  const row = await db.prepare("SELECT user_id, email FROM supporters WHERE email = 'a@example.com'").first();
  assert.deepEqual(row, { user_id: null, email: 'a@example.com' });
});
