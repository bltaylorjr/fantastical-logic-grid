// Automatic deletion of inactive accounts and of accounts with no screen name
// (src/inactive-accounts.js), against a fake Firebase. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { nameKey } from '../src/names.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const TOKEN = 'admin-token-for-tests-1234';
const DAY = 24 * 3600_000;
const now = Date.now();
let mf;
let db;

// The fake Firebase: uid -> account, and the uids it was asked to delete.
const accounts = new Map();
const deletedInFirebase = [];
const account = (uid, { email = '', verified = true, login = now - 90 * DAY } = {}) =>
  accounts.set(uid, { localId: uid, email, emailVerified: verified, lastLoginAt: String(login), lastRefreshAt: new Date(login).toISOString() });

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: {
      FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN, ADMIN_TOKEN: TOKEN, DAILY_TTS_CAP: '300', OWNER_EMAIL: 'owner@example.com',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'sa@example.com', private_key: 'test' }), TEST_FIREBASE_API: 'https://firebase.test/v1',
    },
    outboundService: async (req) => {
      const url = new URL(req.url);
      if (url.hostname !== 'firebase.test') return new Response('offline', { status: 503 });
      const body = await req.json();
      if (url.pathname.endsWith('accounts:lookup')) return Response.json({ users: body.localId.map((u) => accounts.get(u)).filter(Boolean) });
      if (url.pathname.endsWith('accounts:batchDelete')) {
        for (const u of body.localIds) { deletedInFirebase.push(u); accounts.delete(u); }
        return Response.json({});
      }
      return new Response('?', { status: 404 });
    },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at) VALUES ('mod@example.com', 'moderator', 'owner', 0)").run();
  await db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('inactive_delete_enabled', 'true', 0, 'test')").run();

  const named = (uid, name, seen, email = null) => db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at, email) VALUES (?1, ?2, ?3, ?4, ?4, ?5)')
    .bind(uid, name, nameKey(name), seen, email);
  const synced = (uid, seen) => db.prepare('INSERT INTO sync_users (user_id, created_at, rev) VALUES (?1, ?2, 0)').bind(uid, seen);
  await db.batch([
    named('old', 'Old One', now - 40 * DAY), synced('old', now - 40 * DAY),
    named('quiet', 'Quiet', now - 40 * DAY),
    named('admin', 'Fan_Logic_Admin', now - 400 * DAY),
    named('cobalt', 'CobaltSockMonkey18', now - 400 * DAY),
    named('boss', 'Boss', now - 400 * DAY),
    named('mod', 'Moddy', now - 400 * DAY, 'MOD@example.com'),
    named('back', 'Came Back', now - 40 * DAY),
    named('fresh', 'Fresh', now - DAY),
    named('banned', 'Banned', now - 400 * DAY),
    db.prepare("INSERT INTO bans (user_id, reason, banned_by, banned_at, until) VALUES ('banned', 'x', 'owner', 0, NULL)"),
    synced('noname-mail', now - DAY),
    synced('noname-quiet', now - DAY),
  ]);
  account('old', { email: 'old@example.com' });
  account('quiet'); // no email: deleted without a warning
  account('admin', { email: 'fan@example.com' });
  account('cobalt', { email: 'cobalt@example.com' });
  account('boss', { email: 'owner@example.com' });
  account('mod');
  account('back', { email: 'back@example.com', login: now - 2 * DAY }); // signed in two days ago
  account('fresh', { email: 'fresh@example.com' });
  account('banned', { email: 'banned@example.com' });
  account('noname-mail', { email: 'noname@example.com' });
  account('noname-quiet');
});
after(() => mf.dispose());

const call = async (path, body) => {
  const r = await mf.dispatchFetch(`https://api.test/admin/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const nightly = async () => assert.equal((await (await mf.getWorker()).scheduled({ cron: '17 3 * * *' })).outcome, 'ok');
const exists = async (uid) => !!(await db.prepare('SELECT 1 FROM players WHERE user_id = ?1 UNION SELECT 1 FROM sync_users WHERE user_id = ?1').bind(uid).first());

test('the overview shows who is next, and keeps protected accounts', async () => {
  const { status, body } = await call('inactive-accounts');
  assert.equal(status, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.firebase, true);
  const by = Object.fromEntries(body.accounts.map((a) => [a.uid, a]));
  assert.equal(by.admin.stage, 'kept');
  assert.equal(by.cobalt.stage, 'kept');
  assert.equal(by.boss.keep, 'admin', 'the owner, by Firebase email');
  assert.equal(by.mod.keep, 'admin', 'an admin, by the email the game kept');
  assert.equal(by.banned.keep, 'blocked');
  assert.equal(by.old.stage, 'warn');
  assert.equal(by.quiet.stage, 'delete');
  assert.equal(by['noname-mail'].stage, 'warn');
  assert.equal(by['noname-mail'].rule, 'name');
  assert.equal(by['noname-quiet'].stage, 'notice');
  assert.equal(by.back, undefined, 'a recent sign-in counts as activity');
  assert.equal(by.fresh, undefined);
});

test('warnings are claimed once, then the nightly run deletes only what is due', async () => {
  const claim = await call('inactive-warnings/claim', { limit: 100 });
  assert.equal(claim.status, 200);
  const list = claim.body.list;
  assert.deepEqual(list.map((x) => x.email).sort(), ['noname@example.com', 'old@example.com']);
  assert.ok(list.every((x) => !('uid' in x) && /^[0-9a-f]{32}$/.test(x.token)));
  assert.equal(list.find((x) => x.email === 'noname@example.com').kind, 'name');
  assert.equal(claim.body.accountUrl, 'https://thelogicgrid.com/account/');
  assert.equal((await call('inactive-warnings/claim', { limit: 100 })).body.list.length, 0, 'not claimed twice the same day');
  assert.deepEqual((await call('inactive-warnings/done', { sent: list.map((x) => x.token) })).body, { sent: 2, retry: 0, refused: 0 });

  await nightly();
  assert.deepEqual(deletedInFirebase, ['quiet']);
  assert.equal(await exists('quiet'), false);
  for (const uid of ['old', 'noname-mail', 'noname-quiet', 'admin', 'cobalt', 'boss', 'mod', 'banned', 'back', 'fresh']) assert.equal(await exists(uid), true, uid);
  const audit = await db.prepare("SELECT target, actor FROM admin_audit WHERE action = 'players.auto_delete'").all();
  assert.deepEqual(audit.results, [{ target: 'quiet', actor: 'auto-cleanup' }]);
  // The account with no name and no email got its days starting tonight.
  assert.ok((await db.prepare("SELECT sent_at FROM inactive_warnings WHERE user_id = 'noname-quiet'").first()).sent_at >= now);

  // Time passes: the warnings are old enough.
  await db.prepare('UPDATE inactive_warnings SET sent_at = sent_at - ?1').bind(8 * DAY).run();
  await nightly();
  assert.deepEqual(deletedInFirebase.slice(1).sort(), ['noname-mail', 'noname-quiet', 'old']);
  for (const uid of ['old', 'noname-mail', 'noname-quiet']) assert.equal(await exists(uid), false, uid);
  for (const uid of ['admin', 'cobalt', 'boss', 'mod', 'banned', 'back', 'fresh']) assert.equal(await exists(uid), true, uid);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM inactive_warnings').first()).n, 0, 'warning rows go with the account');
});

test('nothing is deleted while the switch is off', async () => {
  await db.prepare("UPDATE settings SET value = 'false' WHERE key = 'inactive_delete_enabled'").run();
  await db.prepare("UPDATE players SET updated_at = ?1 WHERE user_id = 'fresh'").bind(now - 400 * DAY).run();
  account('fresh', { email: 'fresh@example.com' });
  // The settings cache lasts 30 seconds; a settings change from the dashboard clears it.
  const saved = await mf.dispatchFetch('https://api.test/admin/v1/settings', {
    method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'inactive_delete_enabled', value: false }),
  });
  await saved.text();
  assert.equal((await call('inactive-warnings/claim', {})).body.off, true);
  await nightly();
  assert.equal(await exists('fresh'), true);
});
