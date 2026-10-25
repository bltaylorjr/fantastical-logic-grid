// The weekly archive (src/archive.js): what goes in the zip, that player ids
// are replaced, that nothing is removed unless the email was sent and both
// switches are on, and that the admin viewer (admin/archive-zip.js) reads the
// zip back. Run with `npm test` in server/.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { runArchive, buildArchive, archiveStatus, toCsv } from '../src/archive.js';
import { runUpkeep } from '../src/upkeep.js';
import { saveSetting, clearSettingsCache } from '../src/settings.js';
import { readZip, parseCsv } from '../../admin/archive-zip.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 24 * 3600_000;
const NOW = Date.UTC(2026, 9, 26, 4, 47);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
let mf;
let db;

before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("") } }', compatibilityDate: '2026-08-01', d1Databases: ['DB'] });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const TABLES = ['races', 'race_entries', 'race_invites', 'plays', 'app_errors', 'usage', 'parts', 'announcements', 'admin_audit', 'upkeep_log', 'archive_log', 'scores', 'players', 'sync_users', 'sync_records', 'bans', 'settings'];
const count = async (t) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;

async function seed() {
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
  clearSettingsCache();
  const old = NOW - 50 * DAY;
  const oldDay = isoDay(NOW - 120 * DAY);
  await db.batch([
    db.prepare("INSERT INTO races (code, host_id, tier, cells, story_id, title, puzzle, created_at, closes_at) VALUES ('OLD1', 'uid-alice', 'easy', 9, 's1', 'Old', '{\"a\":1}', ?1, ?1), ('NEW1', 'uid-alice', 'easy', 9, 's2', 'New', '{}', ?2, ?2)").bind(old, NOW),
    db.prepare("INSERT INTO race_entries (code, user_id, joined_at) VALUES ('OLD1', 'uid-alice', ?1), ('OLD1', 'uid-bob', ?1), ('NEW1', 'uid-bob', ?2)").bind(old, NOW),
    db.prepare("INSERT INTO race_invites (code, from_id, to_id, created_at) VALUES ('OLD1', 'uid-alice', 'uid-bob', ?1)").bind(old),
    db.prepare("INSERT INTO plays (day, platform, tier, theme, outcome) VALUES (?1, 'web', 'easy', 'pets', 'solved'), (?2, 'web', 'easy', 'pets', 'solved')").bind(oldDay, isoDay(NOW)),
    db.prepare("INSERT INTO app_errors (day, fingerprint, platform, version, kind, message) VALUES (?1, 'f', 'web', '1', 'error', '=SUM(A1), \"quoted\"')").bind(oldDay),
    db.prepare("INSERT INTO admin_audit (at, actor, action, status) VALUES (?1, 'admin@example.com', 'settings.change', 200), (?2, 'admin@example.com', 'me', 200)").bind(NOW - 100 * DAY, NOW),
    db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES ('uid-alice', 's1', 'race', 'easy', 9, 1, 0, 0, 10, ?1)").bind(NOW - 900 * DAY),
    db.prepare("INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES ('uid-alice', 'Sky Fox', 'skyfox', ?1, ?1)").bind(old),
    db.prepare("INSERT INTO sync_users (user_id, rev, created_at) VALUES ('uid-alice', 1, ?1)").bind(NOW - 900 * DAY),
    db.prepare("INSERT INTO sync_records (user_id, kind, key, data, updated_at, rev) VALUES ('uid-alice', 'save', 'x', '{}', ?1, 1)").bind(NOW - 900 * DAY),
    db.prepare("INSERT INTO bans (user_id, banned_by, banned_at) VALUES ('uid-bob', 'admin@example.com', ?1)").bind(NOW - 900 * DAY),
  ]);
}

function fakeEmail({ fail } = {}) {
  const sent = [];
  return { sent, send: async (msg) => { if (fail) { const e = new Error('nope'); e.code = 'E_DELIVERY_FAILED'; throw e; } sent.push(msg); return { messageId: 'm1' }; } };
}
const envWith = (email) => ({ DB: db, ARCHIVE_EMAIL: email, ARCHIVE_TO: 'owner@example.com', ARCHIVE_FROM: 'backups@example.com', ADMIN_TOKEN: 'admin-token-for-tests-1234' });
const switches = async (emailOn, removeOn) => {
  await saveSetting({ DB: db }, 'archive_email_enabled', emailOn, 'test');
  await saveSetting({ DB: db }, 'archive_delete_enabled', removeOn, 'test');
};

beforeEach(seed);

test('the zip holds only old rows, with player ids replaced, and reads back', async () => {
  const { zip, counts, total } = await buildArchive(envWith(), NOW);
  assert.deepEqual(counts, { races: 1, race_entries: 2, race_invites: 1, plays: 1, app_errors: 1, usage: 0, parts: 0, announcements: 0, admin_audit: 1, upkeep_log: 0 });
  assert.equal(total, 7);

  const files = await readZip(zip);
  assert.ok(files.has('manifest.json') && files.has('README.txt'));
  const text = (n) => new TextDecoder().decode(files.get(n));
  const all = [...files.keys()].map(text).join('\n');
  assert.ok(!/uid-alice|uid-bob|Sky Fox|skyfox/.test(all), 'no raw player ids or screen names');
  const races = parseCsv(text('races.csv'));
  assert.equal(races.rows[0].code, 'OLD1');
  assert.match(races.rows[0].host_id, /^p_[0-9a-f]{12}$/);
  assert.equal(races.rows[0].puzzle, '{"a":1}');
  const entries = parseCsv(text('race_entries.csv')).rows;
  assert.equal(entries.find((e) => e.user_id === races.rows[0].host_id) !== undefined, true, 'the same player gets the same code');
  const errors = parseCsv(text('app_errors.csv')).rows;
  assert.equal(errors[0].message, '=SUM(A1), "quoted"', 'commas, quotes and formula text survive');
  assert.match(text('app_errors.csv'), /'=SUM/, 'formula text is defused for spreadsheets');
  assert.equal(JSON.parse(text('manifest.json')).tables.plays.dateColumn, 'day');
  assert.equal(parseCsv(text('usage.csv')).columns.join(), 'day,name,count', 'empty tables keep their columns');
});

test('nothing is sent or removed while the weekly email is off', async () => {
  const email = fakeEmail();
  const r = await runArchive(envWith(email), NOW);
  assert.equal(r.status, 'off');
  assert.equal(email.sent.length, 0);
  assert.equal(await count('races'), 2);
});

test('with removal off the email is a copy and every row stays', async () => {
  await switches(true, false);
  const email = fakeEmail();
  const r = await runArchive(envWith(email), NOW);
  assert.equal(r.status, 'sent');
  assert.equal(r.removed, false);
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, 'owner@example.com');
  assert.equal(email.sent[0].attachments[0].type, 'application/zip');
  assert.equal(await count('races'), 2);
  assert.equal(await count('plays'), 2);

  // The daily cleanup leaves these rows for the archive while the email is on.
  await runUpkeep({ DB: db }, NOW);
  assert.equal(await count('races'), 2);
  assert.equal(await count('app_errors'), 1);
});

test('a failed email removes nothing', async () => {
  await switches(true, true);
  const r = await runArchive(envWith(fakeEmail({ fail: true })), NOW);
  assert.equal(r.status, 'failed');
  assert.match(r.message, /E_DELIVERY_FAILED/);
  assert.equal(await count('races'), 2);
  assert.equal(await count('race_entries'), 3);
});

test('without the email binding it reports that setup is missing', async () => {
  await switches(true, true);
  const r = await runArchive({ DB: db }, NOW);
  assert.equal(r.status, 'not_set_up');
  assert.equal(await count('races'), 2);
});

test('after a sent email exactly the archived rows go, and kept data stays', async () => {
  await switches(true, true);
  const email = fakeEmail();
  const r = await runArchive(envWith(email), NOW);
  assert.equal(r.status, 'sent');
  assert.equal(r.removed, true);
  assert.deepEqual((await db.prepare('SELECT code FROM races').all()).results.map((x) => x.code), ['NEW1']);
  assert.deepEqual((await db.prepare('SELECT code FROM race_entries').all()).results.map((x) => x.code), ['NEW1']);
  assert.equal(await count('race_invites'), 0);
  assert.equal(await count('plays'), 1);
  assert.equal(await count('app_errors'), 0);
  assert.equal(await count('admin_audit'), 1);
  for (const t of ['scores', 'players', 'sync_users', 'sync_records', 'bans']) assert.equal(await count(t), 1, `${t} is never archived`);

  const status = await archiveStatus(envWith(email), NOW);
  assert.equal(status.runs[0].status, 'sent');
  assert.equal(status.runs[0].removed, true);
  assert.equal(status.pending.races, 0);

  // Next week there is nothing left: a short email with no attachment.
  const again = await runArchive(envWith(email), NOW + 7 * DAY);
  assert.equal(again.status, 'empty');
  assert.equal(email.sent[1].attachments, undefined);
});

test('removal needs the weekly email on, even when run from the dashboard', async () => {
  await switches(false, true);
  const email = fakeEmail();
  const r = await runArchive(envWith(email), NOW, { trigger: 'owner@example.com' });
  assert.equal(r.status, 'sent', 'a test send works while the weekly email is off');
  assert.equal(r.removed, false);
  assert.equal(await count('races'), 2);
});

test('csv quoting', () => {
  assert.equal(toCsv([{ a: 'x,y', b: null, c: 3, d: '-5' }]), 'a,b,c,d\r\n"x,y",,3,-5\r\n');
  assert.deepEqual(parseCsv('a,b\r\n"x\r\ny",2\r\n').rows, [{ a: 'x\r\ny', b: '2' }]);
});
