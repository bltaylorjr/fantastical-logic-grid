// Contributor badges (contributors.js): an admin awards one from the player's
// page, the player gets it through /v1/perks, it shows on the scoreboard,
// and it goes with the account when the account is deleted. Run with `npm test` in server/.
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
const TOKEN = 'break-glass-token-for-contributor-tests';
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
const player = (uid) => signer.token({ sub: uid });
const admin = (path, body) => call(`/admin/v1/${path}`, { auth: TOKEN, body });

async function addPlayer(uid, name, points) {
  const now = Date.now();
  await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(uid, name, name.toLowerCase(), now).run();
  await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES (?1, ?2, 'solo', 'easy', 48, 60000, 0, 0, ?3, ?4)").bind(uid, `s-${uid}`, points, now).run();
}

test('an admin awards the Contributor badge and the player gets it', async () => {
  await addPlayer('c-a', 'CobaltSockMonkey18', 30);
  await addPlayer('c-b', 'Other Player', 20);
  assert.equal((await call('/v1/perks', { auth: player('c-a') })).body.contributor, false);
  assert.equal((await admin('players/no-such-player/contributor', { note: 'x' })).status, 404);
  assert.equal((await admin('players/c-a/contributor', { note: 'Wrote 7 Player Stories' })).status, 200);
  assert.equal((await admin('players/c-a/contributor', {})).status, 200, 'awarding again is fine and keeps the note');
  assert.equal((await call('/v1/perks', { auth: player('c-a') })).body.contributor, true);
  assert.equal((await call('/v1/perks', { auth: player('c-b') })).body.contributor, false);
  const detail = (await admin('players/c-a')).body;
  assert.equal(detail.contributor.note, 'Wrote 7 Player Stories');
  const list = (await admin('contributors')).body.contributors;
  assert.deepEqual(list.map((c) => c.name), ['CobaltSockMonkey18']);
});

test('contributors show on the scoreboard without any switch', async () => {
  const rows = (await call('/v1/scoreboard?period=all')).body.rows;
  assert.equal(rows.find((r) => r.points === 30).contributor, true);
  assert.equal(rows.find((r) => r.points === 20).contributor, undefined);
  assert.ok(rows.every((r) => !('uid' in r)), 'player ids stay private');
});

test('taking the badge back, and account deletion, remove it', async () => {
  assert.equal((await admin('players/c-b/contributor', {})).status, 200);
  assert.equal((await admin('players/c-b/contributor/remove', {})).body.removed, 1);
  assert.equal((await call('/v1/perks', { auth: player('c-b') })).body.contributor, false);
  const rows = (await call('/v1/scoreboard?period=week')).body.rows;
  assert.equal(rows.find((r) => r.points === 20).contributor, undefined, 'the scoreboard updates at once');
  assert.equal((await admin('players/c-a/delete', { confirm: 'c-a' })).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM contributors WHERE user_id = 'c-a'").first()).n, 0);
});
