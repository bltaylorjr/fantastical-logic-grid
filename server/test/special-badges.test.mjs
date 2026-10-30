// Special badges (special-badges.js): awarding by hand, milestone badges from
// the synced solve log, the scoreboard, the switch, roles and account deletion.
// Run with `npm test` in server/.
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
const TOKEN = 'break-glass-token-for-badge-tests';
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


const mod = (path, body) => call(`/admin/v1/${path}`, { auth: TOKEN, body });
const DAY = 86400_000;
const solve = (over = {}) => ({ at: Date.now(), storyId: `s${Math.random()}`, tier: 'easy', theme: 'pets', ms: 60000, hints: 1, checks: 0, mistakes: 0, revealed: false, cells: 48, categories: 3, daily: null, race: false, ...over });
async function syncSolves(uid, log) {
  const auth = player(uid);
  const rev = (await db.prepare("SELECT rev FROM sync_records WHERE user_id = ?1 AND kind = 'meta' AND key = 'solves'").bind(uid).first())?.rev || 0;
  const r = await call('/v1/sync', { auth, body: { changes: [{ kind: 'meta', key: 'solves', data: JSON.stringify(log), updatedAt: Date.now(), baseRev: rev }] } });
  assert.equal(r.body.applied.length, 1, JSON.stringify(r.body));
}
const mine = (uid, email) => call('/v1/badges', { auth: player(uid, email) }).then((r) => r.body);
const byName = async (name) => (await mod('badges')).body.badges.find((b) => b.name === name);

test('the starting badges are there, with Tester and Contributor awarded by hand', async () => {
  assert.equal((await call('/v1/badges')).status, 401);
  const list = (await mod('badges')).body;
  assert.equal(list.enabled, true);
  assert.deepEqual(list.badges.map((b) => b.name), ['Tester', 'Contributor', 'Bug Hunter', 'Puzzle Master', 'Quantum Mind']);
  assert.equal((await byName('Tester')).how, 'Awarded by the team.');
  assert.equal((await byName('Quantum Mind')).how, 'Solve 25 Quantum Physicist puzzles.');
  assert.ok(list.kinds.some((k) => k.id === 'tier' && k.needsTier));
  assert.equal(list.tiers[0].id, 'basic');
});

test('awarding by screen name, email or id, once each, and taking it back', async () => {
  const now = Date.now();
  await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind('p-t', 'Tess Tester', 'tesstester', now).run();
  const tester = await byName('Tester');
  assert.equal((await mod(`badges/${tester.id}/award`, { who: 'nobody-here' })).status, 404);
  const r = await mod(`badges/${tester.id}/award`, { who: 'tess tester', note: 'Beta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.who, 'Tess Tester');
  assert.equal((await mod(`badges/${tester.id}/award`, { uid: 'p-t' })).status, 409, 'not twice');
  let b = await mine('p-t');
  assert.deepEqual(b.badges.map((x) => [x.name, x.icon]), [['Tester', '🧪']]);
  assert.equal(b.goals.length, 2, 'the two automatic badges are goals');
  assert.deepEqual(b.goals[0], { id: b.goals[0].id, name: 'Puzzle Master', icon: '🏆', description: 'Solved 250 puzzles.', how: 'Solve 250 puzzles.', need: 250, have: 0 });
  // By email: reaches the player once they sign in with that confirmed email.
  const contrib = await byName('Contributor');
  assert.equal((await mod(`badges/${contrib.id}/award`, { who: 'Helper@Example.com' })).status, 200);
  assert.equal((await mine('p-h', 'helper@example.com')).badges[0].name, 'Contributor');
  // The admin's player page lists them; removing one takes it away.
  const detail = (await mod('players/p-t')).body;
  assert.equal(detail.specialBadges[0].name, 'Tester');
  assert.equal(detail.specialBadges[0].note, 'Beta');
  assert.equal((await mod(`badges/awards/${detail.specialBadges[0].awardId}/remove`, {})).body.removed, 1);
  assert.equal((await mine('p-t')).badges.length, 0);
  const holders = (await mod(`badges/${tester.id}/holders`)).body.holders;
  assert.ok(holders[0].removedAt, 'the removed award stays on record');
  // And it can be given again by hand.
  assert.equal((await mod(`badges/${tester.id}/award`, { uid: 'p-t' })).status, 200);
  assert.equal((await mine('p-t')).badges.length, 1);
});

test('milestone badges are given automatically from the synced solve log', async () => {
  const add = await mod('badges', { name: 'Hard Worker', icon: '💪', description: '', rule: { kind: 'tier', tier: 'hard', count: 3 } });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal((await mod('badges', { name: 'X', icon: '⭐', rule: { kind: 'tier', count: 3 } })).status, 400, 'tier needed');
  assert.equal((await mod('badges', { name: 'X', icon: '⭐', rule: { kind: 'solved', count: 0 } })).status, 400);
  assert.equal((await mod('badges', { name: 'X', icon: '<b>', rule: null })).status, 400);
  assert.equal((await mod('badges', { name: '', icon: '⭐' })).status, 400);
  const streak = await mod('badges', { name: 'Week Streak', icon: '🔥', rule: { kind: 'streak', count: 3 } });
  assert.equal(streak.status, 200);
  await syncSolves('p-auto', [solve({ tier: 'hard' }), solve({ tier: 'hard' }), solve({ tier: 'hard', revealed: true })]);
  let b = await mine('p-auto');
  assert.equal(b.badges.length, 0);
  const goal = b.goals.find((g) => g.name === 'Hard Worker');
  assert.deepEqual([goal.have, goal.need, goal.how, goal.description], [2, 3, 'Solve 3 Hard puzzles.', 'Solve 3 Hard puzzles.']);
  const day = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
  const dailies = [3, 2, 1].map((n) => solve({ daily: day(n), at: Date.parse(`${day(n)}T12:00:00Z`) }));
  await syncSolves('p-auto', [solve({ tier: 'hard' }), solve({ tier: 'hard' }), solve({ tier: 'hard' }), ...dailies]);
  b = await mine('p-auto');
  assert.deepEqual(b.badges.map((x) => x.name).sort(), ['Hard Worker', 'Week Streak']);
  assert.ok(!b.goals.some((g) => g.name === 'Hard Worker'));
  // Removed by an admin: the next check does not give it back.
  const hw = (await mod(`badges/${add.body.id}/holders`)).body.holders.find((h) => h.uid === 'p-auto');
  assert.equal(hw.source, 'auto');
  await mod(`badges/awards/${hw.id}/remove`, {});
  b = await mine('p-auto');
  assert.ok(!b.badges.some((x) => x.name === 'Hard Worker') && !b.goals.some((g) => g.name === 'Hard Worker'));
  // Paused: shows nowhere.
  assert.equal((await mod(`badges/${streak.body.id}`, { name: 'Week Streak', icon: '🔥', rule: { kind: 'streak', count: 3 }, active: false })).status, 200);
  assert.ok(!(await mine('p-auto')).badges.some((x) => x.name === 'Week Streak'));
  assert.equal((await mod(`badges/${streak.body.id}/delete`, {})).body.awards, 1);
});

test('special badges show on the scoreboard, and the switch hides everything', async () => {
  const now = Date.now();
  await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES ('p-t', 's-t', 'solo', 'easy', 48, 60000, 0, 0, 70, ?1)").bind(now).run();
  let rows = (await call('/v1/scoreboard?period=all')).body.rows;
  assert.deepEqual(rows.find((r) => r.points === 70).badges, [{ name: 'Tester', icon: '🧪' }]);
  assert.equal((await mod('settings', { key: 'special_badges_enabled', value: false })).status, 200);
  rows = (await call('/v1/scoreboard?period=week')).body.rows;
  assert.equal(rows.find((r) => r.points === 70).badges, undefined);
  assert.deepEqual(await mine('p-t'), { badges: [], goals: [] });
  assert.equal((await mod('settings', { key: 'special_badges_enabled', value: true })).status, 200);
});

test('roles: viewers can look, moderators award, only admins make badges', async () => {
  for (const [email, role] of [['view@example.com', 'viewer'], ['mod@example.com', 'moderator']]) assert.equal((await mod('admins', { email, role })).status, 200);
  const as = (email, path, body) => call(`/admin/v1/${path}`, { auth: player(`a-${email}`, email), body });
  const tester = await byName('Bug Hunter');
  assert.equal((await as('view@example.com', 'badges')).status, 200);
  assert.equal((await as('view@example.com', `badges/${tester.id}/award`, { uid: 'p-t' })).status, 403);
  assert.equal((await as('mod@example.com', `badges/${tester.id}/award`, { uid: 'p-t' })).status, 200);
  assert.equal((await as('mod@example.com', 'badges', { name: 'Nope', icon: '⭐' })).status, 403);
});

test('deleting an account removes its badges', async () => {
  assert.equal((await call('/v1/account', { auth: player('p-t'), method: 'DELETE' })).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM badge_awards WHERE user_id = 'p-t'").first()).n, 0);
});
