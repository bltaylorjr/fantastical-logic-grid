// Guest puzzles: the server counts a guest's new puzzles per device and per
// internet connection each day, so clearing the browser does not reset them.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { decide, localDay } from '../src/guest-plays.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
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
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  // Set before the first request: the Worker keeps settings for 30 seconds.
  await db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('guest_network_daily_limit', '4', 0, 'test')").run();
});
after(() => mf.dispose());

const play = async (d, take, ip = '203.0.113.7') => {
  const r = await mf.dispatchFetch('https://api.test/v1/guest-play', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip }, body: JSON.stringify({ d, take }) });
  return { status: r.status, ...(await r.json()) };
};

test('the rule: the smaller of what the device and the connection have left', () => {
  assert.deepEqual(decide({ device: 0, network: 0 }, { limit: 3, networkLimit: 60 }), { ok: true, left: 3, limit: 3 });
  assert.deepEqual(decide({ device: 3, network: 3 }, { limit: 3, networkLimit: 60 }), { ok: false, left: 0, limit: 3 });
  assert.deepEqual(decide({ device: 0, network: 59 }, { limit: 3, networkLimit: 60 }), { ok: true, left: 1, limit: 3 });
  assert.deepEqual(decide({ device: 0, network: 999 }, { limit: 3, networkLimit: 0 }), { ok: true, left: 3, limit: 3 });
  assert.equal(decide({ device: 9, network: 9 }, { limit: 0, networkLimit: 60 }).ok, true, '0 is no limit');
  assert.match(localDay('Asia/Tokyo', Date.UTC(2026, 10, 4, 20)), /^2026-11-05$/);
  assert.match(localDay('Not/AZone', Date.UTC(2026, 10, 4, 20)), /^2026-11-04$/);
});

test('a device gets 3 a day; asking does not use one; the 4th is refused', async () => {
  const d = 'deviceAAAAAAAAAAAAAAAA';
  assert.deepEqual(await play(d, false), { status: 200, ok: true, left: 3, limit: 3 });
  for (const left of [2, 1, 0]) assert.equal((await play(d, true)).left, left);
  assert.deepEqual(await play(d, true), { status: 200, ok: false, left: 0, limit: 3 });
  const { results } = await db.prepare('SELECT who FROM guest_plays').all();
  assert.ok(results.every((r) => /^[dn]:[0-9a-f]{32}$/.test(r.who)), 'only hashes are stored');
});

test('a fresh browser on the same connection is held to the connection limit', async () => {
  const fresh = await play('deviceBBBBBBBBBBBBBBBB', false);
  assert.deepEqual([fresh.ok, fresh.left], [true, 1], 'the connection has used 3 of 4');
  assert.equal((await play('deviceBBBBBBBBBBBBBBBB', true)).ok, true);
  assert.equal((await play('deviceCCCCCCCCCCCCCCCC', true)).ok, false, 'a third browser gets none');
  assert.equal((await play('deviceCCCCCCCCCCCCCCCC', true, '198.51.100.4')).ok, true, 'another connection is counted on its own');
});

test('the game reads the limit from /v1/config, and bad ids are refused', async () => {
  const cfg = await (await mf.dispatchFetch('https://api.test/v1/config', { headers: { Origin: ORIGIN } })).json();
  assert.equal(cfg.game.guestDailyLimit, 3, 'the game reads the limit from /v1/config');
  assert.equal((await play('bad id!', true)).status, 400);
});
