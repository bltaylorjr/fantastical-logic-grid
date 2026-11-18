// Player profiles in the admin dashboard (src/profiles.js): rough place and
// time from the signed-in game's check-ins, puzzles and stats from the synced
// solve log and saves. Run with `npm test` in server/.
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
const TOKEN = 'break-glass-token-for-tests-1234';
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
    assets: { directory: join(root, '..', 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 40, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks),
      // A trailing line break, as a secret pasted into the Cloudflare dashboard can have: it must still match.
      ADMIN_TOKEN: `${TOKEN}\n`,
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

const idToken = (sub, email, verified = true) => signer.token({ sub, email, email_verified: verified });
const owner = () => idToken('owner-uid', OWNER);

async function call(path, { auth, method, body, origin = ORIGIN } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, body: json, text, headers: r.headers };
}
const player = (uid) => signer.token({ sub: uid });
// Every account has a screen name before its first sync (sync.js): give the
// test players one, as the game's sign-up form does.
const named = (db, uid) => db.prepare('INSERT OR IGNORE INTO players (user_id, screen_name, name_key, created_at, updated_at, accept_invites) VALUES (?1, ?1, ?1, 1, 1, 1)').bind(uid).run();


const sync = (uid, changes, cf, ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0') => mf.dispatchFetch('https://api.test/v1/sync', {
  method: 'POST', cf,
  headers: { Authorization: `Bearer ${player(uid)}`, Origin: ORIGIN, 'Content-Type': 'application/json', 'User-Agent': ua },
  body: JSON.stringify({ changes }),
}).then((r) => r.json());

test('a signed-in game notes a rough place, device and time, never the address', async () => {
  const uid = 'prof-a';
  await named(db, uid);
  await sync(uid, [], { country: 'US', region: 'Ohio', city: 'Columbus', regionCode: 'OH', latitude: '39.96', longitude: '-83.00', postalCode: '43215' });
  const rows = (await db.prepare('SELECT * FROM account_places WHERE user_id = ?1').bind(uid).all()).results;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].country, rows[0].region, rows[0].city, rows[0].os, rows[0].device], ['US', 'Ohio', 'Columbus', 'windows', 'desktop']);
  assert.ok(!JSON.stringify(rows).includes('43215') && !JSON.stringify(rows).includes('39.96'), 'no postcode or coordinates');

  // Check-ins 5 minutes apart add play time; a long gap starts a new visit.
  const t = rows[0].first_at;
  await db.prepare('UPDATE account_places SET first_at = ?2, last_at = ?2 WHERE user_id = ?1').bind(uid, t - 5 * 60_000).run();
  await sync(uid, [], { country: 'US', region: 'Ohio', city: 'Columbus' });
  let r = await db.prepare('SELECT minutes, sessions FROM account_places WHERE user_id = ?1').bind(uid).first();
  assert.deepEqual([r.minutes, r.sessions], [5, 1]);
  await sync(uid, [], { country: 'US', region: 'Ohio', city: 'Columbus' }); // straight away: not written again
  r = await db.prepare('SELECT minutes, sessions FROM account_places WHERE user_id = ?1').bind(uid).first();
  assert.deepEqual([r.minutes, r.sessions], [5, 1]);
  await db.prepare('UPDATE account_places SET last_at = last_at - 3600000 WHERE user_id = ?1').bind(uid).run();
  await sync(uid, [], { country: 'US', region: 'Ohio', city: 'Columbus' });
  r = await db.prepare('SELECT minutes, sessions FROM account_places WHERE user_id = ?1').bind(uid).first();
  assert.deepEqual([r.minutes, r.sessions], [5, 2]);

  // A phone somewhere else is its own row.
  await sync(uid, [], { country: 'CA', region: 'Ontario', city: 'Toronto' }, 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM account_places WHERE user_id = ?1').bind(uid).first();
  assert.equal(n.n, 2);
});

test('the profile shows puzzles, stats, places and devices, and only to moderators and up', async () => {
  const uid = 'prof-a';
  const now = Date.now();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const solves = [
    { at: now - 3 * 86400_000, storyId: 's1', tier: 'easy', theme: 'pirate-cove', ms: 240_000, expectedMs: 300_000, hints: 0, checks: 0, mistakes: 0, revealed: false, cells: 48, categories: 3, daily: null, race: false },
    { at: now - 2 * 86400_000, storyId: 's2', tier: 'hard', theme: 'pirate-cove', ms: 900_000, hints: 3, checks: 1, mistakes: 2, revealed: true, cells: 75, categories: 4, daily: null, race: false },
    { at: now - 60_000, storyId: 's3', tier: 'medium', theme: 'space', ms: 600_000, hints: 1, checks: 0, mistakes: 1, revealed: false, cells: 48, categories: 3, daily: today, race: false },
  ];
  const save = { id: 'g1', name: 'The Lost Lantern', storyId: 's4', puzzle: { difficulty: { id: 'expert' }, theme: { id: 'space', name: 'Space' } }, elapsedMs: 120_000, percent: 40, hintsUsed: 2, solved: false, created: now - 7200_000, myNotes: 'private note', marks: { a: 1 } };
  const out = await sync(uid, [
    { kind: 'meta', key: 'solves', data: JSON.stringify(solves), updatedAt: now, baseRev: 0 },
    { kind: 'save', key: 'g1', data: JSON.stringify(save), updatedAt: now, baseRev: 0 },
  ], { country: 'US', region: 'Ohio', city: 'Columbus' });
  assert.ok(!out.error, JSON.stringify(out));

  const r = await call(`/admin/v1/players/${uid}/profile?days=30`, { auth: owner() });
  assert.equal(r.status, 200);
  const p = r.body;
  assert.equal(p.stats.played, 3);
  assert.equal(p.stats.solved, 2);
  assert.equal(p.stats.revealed, 1);
  assert.equal(p.stats.hints, 4);
  assert.equal(p.stats.noHints, 1);
  assert.equal(p.stats.daily, 1);
  assert.equal(p.stats.streak.current, 1);
  assert.equal(p.stats.totalMs, 1_740_000);
  assert.deepEqual(p.byTheme[0], { theme: 'pirate-cove', played: 2 });
  assert.equal(p.byTier.find((x) => x.tier === 'easy').bestMs, 240_000);
  assert.equal(p.recent[0].storyId, 's3');
  assert.equal(p.inProgress.length, 1);
  assert.deepEqual([p.inProgress[0].name, p.inProgress[0].tier, p.inProgress[0].theme, p.inProgress[0].percent], ['The Lost Lantern', 'expert', 'Space', 40]);
  assert.ok(!JSON.stringify(p).includes('private note'), 'notes and marks are never shown');
  assert.ok(p.activity.places.some((x) => x.city === 'Columbus' && x.country === 'US'));
  assert.ok(p.activity.places.some((x) => x.city === 'Toronto'));
  assert.ok(p.activity.devices.some((x) => x.os === 'android' && x.device === 'mobile'));
  assert.ok(p.activity.daysActive >= 1);

  // A player with nothing synced gets an empty profile, not an error.
  const empty = await call('/admin/v1/players/nobody-here/profile', { auth: owner() });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.stats.played, 0);

  // Viewers cannot see it.
  await call('/admin/v1/admins', { auth: owner(), body: { email: 'view@example.com', role: 'viewer' } });
  assert.equal((await call(`/admin/v1/players/${uid}/profile`, { auth: idToken('view-uid', 'view@example.com') })).status, 403);
});

test('deleting an account removes its places too', async () => {
  const uid = 'prof-a';
  assert.equal((await call(`/admin/v1/players/${uid}/delete`, { auth: owner(), body: { confirm: uid } })).status, 200);
  const n = await db.prepare('SELECT COUNT(*) AS n FROM account_places WHERE user_id = ?1').bind(uid).first();
  assert.equal(n.n, 0);
  // A deleted account's token still works for a while: it is not noted again.
  await sync(uid, [], { country: 'US' });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM account_places WHERE user_id = ?1').bind(uid).first()).n, 0);
});
