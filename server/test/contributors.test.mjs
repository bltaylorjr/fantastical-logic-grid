// Contributor badges (contributors.js): ideas, problem reports and character
// suggestions a signed-in player sends count once the team uses them, with
// Bronze to Platinum badges at the admin's numbers, credits by hand, the
// scoreboard badge and account deletion. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { tierOf } from '../src/contributors.js';

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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com', TEST_CHARACTERS: '1' },
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
const player = (uid) => signer.token({ sub: uid, email: `${uid}@example.com`, email_verified: true });
const admin = (path, body) => call(`/admin/v1/${path}`, { auth: TOKEN, body });
const mine = (uid) => call('/v1/contributor', { auth: player(uid) });
const idea = (uid, text, credit = true) => call('/v1/feedback', { auth: uid ? player(uid) : undefined, body: { kind: 'idea', topic: 'story', text, credit } });
const feedbackId = async (text) => (await db.prepare('SELECT id FROM feedback WHERE text = ?1').bind(text).first()).id;

test('badge tiers follow the admin\'s numbers', () => {
  const s = { contributor_bronze_from: 2, contributor_silver_from: 5, contributor_gold_from: 10, contributor_platinum_from: 25 };
  assert.deepEqual([0, 1, 2, 4, 5, 9, 10, 24, 25, 99].map((n) => tierOf(n, s)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('the badge needs a signed-in player', async () => {
  assert.equal((await call('/v1/contributor')).status, 401);
  assert.deepEqual((await mine('nobody')).body, { enabled: true, count: 0, waiting: 0, tier: 0, nextAt: 2 });
});

test('an idea counts once it is marked addressed, and only when ticked', async () => {
  assert.equal((await idea('p-a', 'A pirate ship story please')).body.credit, 'waiting');
  assert.equal((await idea('p-a', 'Add a space station theme', false)).body.credit, 'none');
  assert.equal((await idea(null, 'A story about bakers')).body.credit, 'signed_out');
  assert.deepEqual((await mine('p-a')).body, { enabled: true, count: 0, waiting: 1, tier: 0, nextAt: 2 });
  const id = await feedbackId('A pirate ship story please');
  assert.equal((await admin(`feedback/${id}`, { status: 'addressed', note: 'We added a pirate ship story.' })).status, 200);
  assert.deepEqual((await mine('p-a')).body, { enabled: true, count: 1, waiting: 0, tier: 0, nextAt: 2 });
  // Moved back by mistake: it waits again; addressed again: it counts.
  await admin(`feedback/${id}`, { status: 'new' });
  assert.equal((await mine('p-a')).body.count, 0);
  await admin(`feedback/${id}`, { status: 'addressed', note: 'We added a pirate ship story.' });
  // Still counted after the idea itself is deleted.
  await admin(`feedback/${id}`, { status: 'delete' });
  assert.equal((await mine('p-a')).body.count, 1);
  // The dashboard's idea list stays anonymous.
  const list = (await admin('feedback?kind=idea&status=all')).body;
  assert.ok(!JSON.stringify(list).includes('p-a'));
});

test('a fixed problem report counts unless the admin turns that off', async () => {
  await call('/v1/feedback', { auth: player('p-a'), body: { kind: 'problem', topic: 'play', text: 'The grid froze on my phone', credit: true } });
  await admin(`feedback/${await feedbackId('The grid froze on my phone')}`, { status: 'addressed', note: 'We fixed the frozen grid.' });
  assert.deepEqual((await mine('p-a')).body, { enabled: true, count: 2, waiting: 0, tier: 1, nextAt: 5 });
  await admin('settings', { key: 'contributor_problems_count', value: false });
  assert.equal((await mine('p-a')).body.count, 1);
  await admin('settings', { key: 'contributor_problems_count', value: true });
});

test('a suggested character counts once published', async () => {
  const r = await call('/v1/characters/suggest', { auth: player('p-b'), body: { name: 'Zara', gender: 'f', look: 'curly red hair', personality: 'brave and curious', voiceStyle: 'lively', themes: ['scifi'], credit: true } });
  assert.equal(r.status, 201);
  assert.equal(r.body.credit, 'waiting');
  const zara = (await admin('characters')).body.characters.find((c) => c.name === 'Zara');
  assert.equal((await mine('p-b')).body.waiting, 1);
  const saved = await admin('characters/save', { ...zara, id: zara.id, lines: { clue: [], hint: [], solve: [] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await admin(`characters/${zara.id}/publish`, {})).status, 200);
  assert.equal((await mine('p-b')).body.count, 1);
});

test('admins add and remove credits by hand, and see everyone\'s counts', async () => {
  const now = Date.now();
  await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind('p-b', 'Bea Bright', 'bea bright', now).run();
  assert.equal((await admin('contributors', { name: 'Bea Bright' })).status, 400, 'a note is needed');
  assert.equal((await admin('contributors', { name: 'Nobody Here', note: 'x' })).status, 404);
  assert.equal((await admin('contributors', { name: 'bea bright', note: 'Tested the new levels' })).status, 200);
  assert.equal((await mine('p-b')).body.tier, 1);
  const d = (await admin('contributors')).body;
  const bea = d.players.find((p) => p.uid === 'p-b');
  assert.equal(bea.counted, 2);
  assert.equal(bea.tier, 1);
  assert.equal(bea.name, 'Bea Bright');
  assert.equal(d.credits.length, 1);
  assert.equal((await admin(`contributors/${d.credits[0].id}/remove`, {})).status, 200);
  assert.equal((await mine('p-b')).body.count, 1);
});

test('contributors get a badge on the scoreboard; switching it off hides everything', async () => {
  const now = Date.now();
  await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind('p-a', 'Ada Sleuth', 'ada sleuth', now).run();
  for (const [uid, points] of [['p-a', 50], ['p-b', 40]]) {
    await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES (?1, ?2, 'solo', 'easy', 48, 60000, 0, 0, ?3, ?4)").bind(uid, `s-${uid}`, points, now).run();
  }
  const rows = (await call('/v1/scoreboard?period=all')).body.rows;
  assert.equal(rows.find((r) => r.points === 50).contributor, 1);
  assert.equal(rows.find((r) => r.points === 40).contributor, undefined, 'one used idea is not a badge yet');
  await admin('settings', { key: 'contributor_badges_enabled', value: false });
  assert.equal((await call('/v1/scoreboard?period=week')).body.rows.find((r) => r.points === 50).contributor, undefined);
  assert.equal((await mine('p-a')).body.enabled, false);
  assert.equal((await idea('p-a', 'One more idea for you')).body.credit, 'off');
  assert.equal((await call('/v1/config')).body.features.contributors, false);
  await admin('settings', { key: 'contributor_badges_enabled', value: true });
});

test('deleting an account removes its contributions', async () => {
  await call('/v1/account', { auth: player('p-a'), method: 'DELETE' });
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE user_id = 'p-a'").first();
  assert.equal(n, 0);
});
