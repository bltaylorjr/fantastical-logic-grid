// Weekly and special edition puzzle emails: run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const OWNER = 'owner@example.com';
const signer = makeSigner('flg-test');
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), OWNER_EMAIL: OWNER, SITE_URL: 'https://site.invalid' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = async (path, { method = 'POST', body, auth, form } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'text/plain' },
    body: form ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch (e) { /* a page */ }
  return { status: r.status, body: parsed };
};
const DAY = 24 * 3600_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const player = (sub, email, verified = true) => signer.token({ sub, email, email_verified: verified });
const row = (email) => db.prepare('SELECT * FROM puzzle_mail WHERE email = ?1').bind(email).first();
const set = (key, value) => call('/admin/v1/settings', { auth: owner(), body: { key, value } });
// Hands out the confirm emails waiting, as the GitHub Action does.
const confirms = async () => (await call('/admin/v1/mail/claim', { auth: owner(), body: { send: 'confirm' } })).body.list;

test('a guest confirms with the button in the email, not by opening the link', async () => {
  const r = await call('/v1/mail/signup', { body: { email: ' Guest@Example.com ', weekly: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'check_email');
  let g = await row('guest@example.com');
  assert.equal(g.weekly, 0, 'nothing is on before the confirm link');
  const list = await confirms();
  const mine = list.find((x) => x.email === 'guest@example.com');
  assert.deepEqual(mine.lists, ['weekly']);
  assert.match(mine.token, /^[0-9a-f]{32}$/);
  assert.equal((await confirms()).length, 0, 'each confirm email is handed out once');

  // A mail scanner opening the link does not confirm.
  const shown = await call(`/v1/mail/confirm?t=${mine.token}`, { method: 'GET' });
  assert.equal(shown.status, 200);
  assert.match(shown.body, /Confirm your puzzle emails/);
  assert.match(shown.body, /<form method="post"/);
  assert.equal((await row('guest@example.com')).weekly, 0);
  const done = await call('/v1/mail/confirm', { form: { t: mine.token } });
  assert.match(done.body, /You are signed up/);
  g = await row('guest@example.com');
  assert.equal(g.weekly, 1);
  assert.equal(g.special, 0);
  assert.equal(g.confirm, null);
  // The link only works once.
  assert.equal((await call('/v1/mail/confirm', { form: { t: mine.token } })).status, 404);
  assert.equal((await call('/v1/mail/signup', { body: { email: 'nope', weekly: true } })).body.error, 'bad_email');
  assert.equal((await call('/v1/mail/signup', { body: { email: 'x@example.com' } })).body.error, 'no_lists');
});

test('someone else typing your address gets nothing past a confirm email, and only a few', async () => {
  await call('/v1/mail/signup', { body: { email: 'target@example.com', special: true } });
  const first = await call('/v1/mail/signup', { body: { email: 'target@example.com', weekly: true } });
  assert.equal(first.body.status, 'check_email', 'the answer looks the same');
  const t = await row('target@example.com');
  assert.equal(t.confirm_n, 1, 'a second ask within 10 minutes sends no second email');
  assert.equal(t.want, 'special,weekly', 'but the confirm link covers both');
  // A failed send is put back for the next run; one the mail service refuses removes the address.
  const all = await confirms();
  const c = all.find((x) => x.email === 'target@example.com');
  await call('/admin/v1/mail/done', { auth: owner(), body: { send: 'confirm', failed: [c.token] } });
  assert.equal((await confirms()).find((x) => x.email === 'target@example.com').token, c.token);
  await call('/admin/v1/mail/done', { auth: owner(), body: { send: 'confirm', refused: [c.token] } });
  assert.equal(await row('target@example.com'), null);
});

test('a signed-in player with a confirmed email needs no confirm link', async () => {
  const a = player('uid-a', 'A@Example.com');
  assert.equal((await call('/v1/mail', { method: 'GET' })).status, 401);
  assert.equal((await call('/v1/mail', { method: 'GET', auth: a })).body.weekly, false);
  const r = await call('/v1/mail/signup', { auth: a, body: { weekly: true, special: true } });
  assert.equal(r.body.status, 'on');
  const st = await call('/v1/mail', { method: 'GET', auth: a });
  assert.equal(st.body.weekly, true);
  assert.equal(st.body.special, true);
  assert.deepEqual(st.body.open, ['weekly', 'special']);
  assert.equal((await row('a@example.com')).uid, 'uid-a');
  assert.equal((await call('/v1/mail', { auth: a, body: { weekly: false, special: true } })).body.weekly, false);
  assert.equal((await row('a@example.com')).special, 1);
  // An unconfirmed account still goes through the confirm link.
  const u = await call('/v1/mail/signup', { auth: player('uid-u', 'u@example.com', false), body: { weekly: true } });
  assert.equal(u.body.status, 'check_email');
  assert.equal((await call('/v1/mail', { auth: player('uid-u', 'u@example.com', false), body: { weekly: true } })).status, 403);
  // Deleting the account removes the address.
  await call('/v1/mail/signup', { auth: player('uid-d', 'd@example.com'), body: { weekly: true } });
  assert.equal((await call('/v1/account', { method: 'DELETE', auth: player('uid-d', 'd@example.com') })).status, 200);
  assert.equal(await row('d@example.com'), null);
});

test('unsubscribe takes one click, from one list or both, and the settings page changes them', async () => {
  await call('/v1/mail/signup', { auth: player('uid-b', 'b@example.com'), body: { weekly: true, special: true } });
  const b = await row('b@example.com');
  const page = await call(`/v1/mail/unsubscribe?t=${b.token}&l=weekly`, { method: 'GET' });
  assert.match(page.body, /You are unsubscribed/);
  assert.match(page.body, /You still get special edition puzzles/);
  assert.equal((await row('b@example.com')).weekly, 0);
  assert.equal((await row('b@example.com')).special, 1);
  const settings = await call(`/v1/mail/settings?t=${b.token}`, { method: 'GET' });
  assert.match(settings.body, /name="special" value="1" checked/);
  await call('/v1/mail/settings', { form: { t: b.token, weekly: '1', special: '1' } });
  assert.equal((await row('b@example.com')).weekly, 1);
  // The mail programs' one-click unsubscribe.
  const oneClick = await mf.dispatchFetch(`https://api.test/v1/mail/unsubscribe?t=${b.token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
  assert.equal(oneClick.status, 204);
  assert.equal(await row('b@example.com'), null);
  // An unknown token gets the same page.
  assert.match((await call(`/v1/mail/unsubscribe?t=${'0'.repeat(32)}`, { method: 'GET' })).body, /You are unsubscribed/);
});

test('special editions are planned ahead, locked on their day, and each address gets one once', async () => {
  const tomorrow = iso(Date.now() + DAY);
  assert.equal((await call('/admin/v1/specials', { auth: owner(), body: { date: iso(Date.now()), title: 'Too late', note: 'This one is today.' } })).status, 400);
  const made = await call('/admin/v1/specials', { auth: owner(), body: { date: tomorrow, title: 'Harvest special', note: 'A puzzle for the harvest.', theme: '', difficulty: 'hard', size: '4x5' } });
  assert.equal(made.status, 200);
  assert.match(made.body.id, /^se-/);
  assert.equal((await call('/admin/v1/specials', { auth: player('uid-a', 'a@example.com'), body: { date: tomorrow, title: 'Nope', note: 'Not an admin.' } })).status, 403);
  const pub = await call('/v1/specials', { method: 'GET' });
  const e = pub.body.specials.find((x) => x.id === made.body.id);
  assert.deepEqual([e.date, e.title, e.difficulty, e.categories, e.items], [tomorrow, 'Harvest special', 'hard', 4, 5]);
  assert.equal(e.createdBy, undefined, 'who planned it stays in the dashboard');
  // One whose day has come (yesterday's) is locked and due.
  const past = 'se-past-1';
  await db.prepare("INSERT INTO special_editions (id, date, title, note, status, created_at, updated_at) VALUES (?1, ?2, 'Past special', 'Hello players.', 'planned', 0, 0)").bind(past, iso(Date.now() - DAY)).run();
  assert.equal((await call(`/admin/v1/specials/${past}/cancel`, { auth: owner(), body: {} })).status, 400);
  assert.equal((await call(`/admin/v1/specials/${made.body.id}/cancel`, { auth: owner(), body: {} })).status, 200);
  assert.equal((await call('/v1/specials', { method: 'GET' })).body.specials.some((x) => x.id === made.body.id), false, 'a cancelled edition is not built');

  const due = await call('/admin/v1/mail/due', { auth: owner(), body: {} });
  assert.deepEqual(due.body.specials.map((x) => x.id), [past]);
  assert.equal((await call('/admin/v1/mail/claim', { auth: owner(), body: { send: `special-${made.body.id}` } })).status, 400, 'only what is due can be sent');
  const send = `special-${past}`;
  const first = await call('/admin/v1/mail/claim', { auth: owner(), body: { send } });
  const emails = first.body.list.map((x) => x.email).sort();
  assert.deepEqual(emails, ['a@example.com'], 'only the special edition list');
  assert.equal((await call('/admin/v1/mail/claim', { auth: owner(), body: { send } })).body.list.length, 0, 'never twice');
  await call('/admin/v1/mail/done', { auth: owner(), body: { send, failed: [first.body.list[0].token] } });
  assert.equal((await call('/admin/v1/mail/claim', { auth: owner(), body: { send } })).body.list.length, 1, 'a failed one is tried again');
  assert.equal((await call('/admin/v1/mail/claim', { auth: player('uid-a', 'a@example.com'), body: { send } })).status, 403, 'players cannot claim the list');
});

test('the weekly send goes to the weekly list from Monday morning', async () => {
  const due = (await call('/admin/v1/mail/due', { auth: owner(), body: {} })).body;
  const now = new Date();
  const monday = iso(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  assert.equal((await call('/admin/v1/mail/claim', { auth: owner(), body: { send: 'weekly-2020-01-06' } })).status, 400, 'an old week cannot be sent');
  if (now.getUTCDay() === 1 && now.getUTCHours() < 11) { assert.equal(due.weekly, null); return; }
  assert.equal(due.weekly, monday);
  const r = await call('/admin/v1/mail/claim', { auth: owner(), body: { send: `weekly-${monday}` } });
  assert.deepEqual(r.body.list.map((x) => x.email).sort(), ['guest@example.com']);
});

test('admins find, add and remove addresses; the cap and the switches hold', async () => {
  assert.equal((await call('/admin/v1/mail/find?q=guest', { method: 'GET', auth: owner() })).body.rows[0].email, 'guest@example.com');
  const ov = (await call('/admin/v1/mail', { method: 'GET', auth: owner() })).body;
  assert.ok(ov.counts.weekly >= 1);
  const add = await call('/admin/v1/mail/add', { auth: owner(), body: { email: 'friend@example.com', special: true } });
  assert.equal(add.body.status, 'sent');
  assert.equal((await row('friend@example.com')).special, 0, 'added by an admin still needs their confirm');
  const csv = await mf.dispatchFetch('https://api.test/admin/v1/export/mail.csv', { headers: { Authorization: `Bearer ${owner()}` } });
  assert.match(await csv.text(), /guest@example\.com,yes,no,no/);
  const id = (await row('guest@example.com')).id;
  assert.equal((await call(`/admin/v1/mail/${id}/remove`, { auth: owner(), body: {} })).status, 200);
  assert.equal(await row('guest@example.com'), null);

  assert.equal((await set('puzzle_mail_daily_cap', 0)).status, 200);
  assert.deepEqual((await call('/admin/v1/mail/claim', { auth: owner(), body: { send: 'confirm' } })).body.list, [], 'nothing over the daily cap');
  assert.equal((await set('weekly_mail_enabled', false)).status, 200);
  assert.equal((await call('/v1/mail/signup', { body: { email: 'w@example.com', weekly: true } })).body.error, 'off');
  let cfg = await (await mf.dispatchFetch('https://api.test/v1/config', { headers: { Origin: ORIGIN } })).json();
  assert.equal(cfg.features.weeklyMail, false);
  assert.equal(cfg.features.puzzleMail, true);
  assert.equal((await set('puzzle_mail_enabled', false)).status, 200);
  assert.equal((await call('/admin/v1/mail/claim', { auth: owner(), body: { send: 'confirm' } })).body.off, true);
  cfg = await (await mf.dispatchFetch('https://api.test/v1/config', { headers: { Origin: ORIGIN } })).json();
  assert.equal(cfg.features.puzzleMail, false);
});
