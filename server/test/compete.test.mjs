// Screen names, races and scoreboard tests: run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { checkName, nameKey, hasBlockedWords } from '../src/names.js';
import { pointsFor } from '../src/compete.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const ORIGIN = 'https://thelogicgrid.com';
const signer = makeSigner(PROJECT);
let mf;
let db;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'), // learn.js uses the engine's story-part rules
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = async (path, { as, method = 'POST', body } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method,
    headers: { ...(as ? { Authorization: `Bearer ${signer.token({ sub: as })}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const name = (as, screenName) => call('/v1/profile', { as, method: 'PUT', body: { screenName } });

// A small 3 x 3 puzzle in the engine's shape.
function puzzle(storyId, extra = {}) {
  const cats = ['who', 'pet', 'hat'].map((id) => ({ id, name: id, items: [0, 1, 2].map((i) => ({ id: `${id}:${i}`, label: `${id} ${['Ada', 'Bo', 'Cy'][i]}` })) }));
  return {
    title: 'The Case of the Missing Hat', difficulty: { id: 'easy', name: 'Easy' }, categories: cats,
    solution: [0, 1, 2].map((i) => ({ who: `who:${i}`, pet: `pet:${(i + 1) % 3}`, hat: `hat:${(i + 2) % 3}` })),
    story: { id: storyId, paragraphs: ['Three friends lost a hat.'], ending: 'Found it.' },
    clues: [{ number: 1, text: 'Ada has no cat.' }], questions: [], cast: ['Ada', 'Bo', 'Cy'], ...extra,
  };
}
const answers = (p) => p.solution.flatMap((r) => [[r.who, r.pet], [r.who, r.hat], [r.pet, r.hat]]);

test('name rules: length, characters, words and look-alikes', () => {
  assert.equal(checkName('Sky Fox'), null);
  assert.equal(checkName('Scunthorpe Sleuth'), null, 'place names with a hidden word are fine');
  assert.equal(checkName('Classic Cassie'), null);
  assert.equal(checkName('ab').code, 'name_length');
  assert.equal(checkName('a'.repeat(21)).code, 'name_length');
  assert.equal(checkName('<script>').code, 'name_chars');
  assert.equal(checkName('12345').code, 'name_digits');
  assert.equal(checkName('Admin Bobby').code, 'name_reserved');
  for (const bad of ['sh1t', 'Big_Fuk', 'S.H.I.T man', 'f u c k', 'B1TCHY', 'shiiiit', 'Ass']) assert.equal(checkName(bad)?.code, 'name_blocked', bad);
  assert.equal(nameKey('Sky_Fox'), nameKey('sky fox'));
  assert.equal(nameKey('SKYF0X'), nameKey('skyfox'));
  assert.equal(hasBlockedWords('The wrapped gift was trapped in the cocker spaniel\'s basket.', { strict: false }), false);
});

test('points reward harder, bigger, faster and less helped solves', () => {
  const base = { tier: 'easy', cells: 48, elapsedMs: 8 * 60_000, hints: 0, checks: 0 };
  assert.ok(pointsFor({ ...base, tier: 'hard' }) > pointsFor(base));
  assert.ok(pointsFor({ ...base, cells: 150 }) > pointsFor(base));
  assert.ok(pointsFor({ ...base, elapsedMs: 3 * 60_000 }) > pointsFor(base));
  assert.ok(pointsFor({ ...base, hints: 3 }) < pointsFor(base));
  assert.ok(pointsFor({ ...base, hints: 100 }) >= 1);
});

test('screen names need sign-in and must be unique', async () => {
  assert.equal((await call('/v1/profile', { method: 'GET' })).status, 401);
  assert.equal((await call('/v1/profile', { as: 'ann', method: 'GET' })).body.screenName, null);
  assert.equal((await name('ann', '  Sky   Fox ')).body.screenName, 'Sky Fox', 'spaces are tidied');
  const dup = await name('ben', 'sky_f0x');
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /already has that screen name/);
  const rude = await name('ben', 'Sh1thead');
  assert.equal(rude.status, 422);
  assert.equal(rude.body.error, 'name_blocked');
  assert.equal((await name('ben', 'Bold Badger')).status, 200);
  assert.equal((await name('ann', 'Sky Fox II')).body.screenName, 'Sky Fox II', 'a player can change their name');
  assert.equal((await name('cal', 'Sky Fox')).status, 200, 'the old name is free again');
});

test('scores need a screen name, count once, and fill the scoreboard', async () => {
  const s = { storyId: 'st-1', tier: 'medium', categories: 4, items: 4, elapsedMs: 600_000, hints: 1, checks: 0 };
  assert.equal((await call('/v1/scores', { as: 'nobody', body: s })).status, 403);
  const first = await call('/v1/scores', { as: 'ben', body: s });
  assert.equal(first.status, 200);
  assert.ok(first.body.points > 0 && first.body.counted);
  assert.equal((await call('/v1/scores', { as: 'ben', body: s })).body.counted, false, 'the same puzzle cannot score twice');
  assert.equal((await call('/v1/scores', { as: 'ben', body: { ...s, storyId: 'st-2', elapsedMs: -100 } })).status, 400, 'impossible times are refused');
  assert.equal((await call('/v1/scores', { as: 'ben', body: { ...s, storyId: 'st-2', tier: 'legendary' } })).status, 400);
  await call('/v1/scores', { as: 'ann', body: { ...s, storyId: 'st-9', tier: 'easy' } });

  const board = await call('/v1/scoreboard?period=week', { method: 'GET' });
  assert.equal(board.status, 200, 'anyone can see the scoreboard');
  assert.deepEqual(board.body.rows.map((r) => r.name), ['Bold Badger', 'Sky Fox II']);
  assert.equal(board.body.rows[0].rank, 1);
  assert.equal(board.body.me, null);
  assert.ok(!('uid' in board.body.rows[0]), 'player ids are never shown');
  const mine = await call('/v1/scoreboard?period=all', { as: 'ann', method: 'GET' });
  assert.equal(mine.body.me.rank, 2);
  assert.equal(mine.body.rows.find((r) => r.me).name, 'Sky Fox II');
});

test('a race: host and rival solve the same puzzle, fastest wins', async () => {
  const p = puzzle('race-story-1');
  assert.equal((await call('/v1/races', { as: 'nobody', body: { puzzle: p } })).status, 403, 'racing needs a screen name');
  assert.equal((await call('/v1/races', { as: 'ann', body: { puzzle: { ...p, solution: [] } } })).status, 400);
  const rude = await call('/v1/races', { as: 'ann', body: { puzzle: puzzle('x', { title: 'The Sh1t Case' }) } });
  assert.equal(rude.status, 422, 'puzzles with blocked words cannot be shared');
  const made = await call('/v1/races', { as: 'ann', body: { puzzle: p } });
  assert.equal(made.status, 200);
  const code = made.body.code;
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(made.body.players.length, 1);
  assert.equal(made.body.players[0].status, 'solving');

  // Ben finds it as an open race and joins.
  const found = await call('/v1/races/find', { as: 'ben', body: { tier: 'easy' } });
  assert.equal(found.body.code, code);
  assert.equal(found.body.storyId, 'race-story-1');
  assert.equal((await call('/v1/races/find', { as: 'ann', body: {} })).status, 404, 'you are not matched with your own race');
  const joined = await call(`/v1/races/${code}/join`, { as: 'ben' });
  assert.equal(joined.status, 200);
  assert.deepEqual(joined.body.puzzle.solution, p.solution, 'the rival gets the very same puzzle');
  assert.equal((await call('/v1/races/find', { as: 'ben', body: {} })).status, 404, 'a joined race is not offered again');

  // Wrong answers are refused; a too-short time is raised to the real clock.
  assert.equal((await call(`/v1/races/${code}/finish`, { as: 'ben', body: { elapsedMs: 60_000, hints: 0, checks: 0, pairs: answers(p).slice(1) } })).status, 422);
  const ben = await call(`/v1/races/${code}/finish`, { as: 'ben', body: { elapsedMs: 60_000, hints: 0, checks: 0, pairs: answers(p) } });
  assert.equal(ben.status, 200);
  assert.ok(ben.body.points > 0);
  assert.ok(ben.body.race.players.find((x) => x.me).elapsedMs <= 10_000, 'time is never longer than the server saw');
  assert.equal(ben.body.race.players[0].name, 'Bold Badger');

  const ann = await call(`/v1/races/${code}/finish`, { as: 'ann', body: { elapsedMs: 4_000, hints: 2, checks: 0, pairs: answers(p) } });
  const standings = ann.body.race.players;
  assert.deepEqual(standings.map((x) => [x.name, x.place]), [['Bold Badger', 1], ['Sky Fox II', 2]], 'hints add a penalty to the race time');
  assert.equal(standings[1].raceMs, 5_000 + 2 * 60_000);
  const again = await call(`/v1/races/${code}/finish`, { as: 'ann', body: { elapsedMs: 1, hints: 0, checks: 0, pairs: answers(p) } });
  assert.equal(again.body.points, null, 'a result cannot be changed');

  // Cal gives up (reveals the solution).
  await call(`/v1/races/${code}/join`, { as: 'cal' });
  const cal = await call(`/v1/races/${code}/finish`, { as: 'cal', body: { elapsedMs: 20_000, hints: 0, checks: 0, revealed: true } });
  assert.equal(cal.body.race.players[2].status, 'gave_up');
  assert.equal(cal.body.points, null);

  const view = await call(`/v1/races/${code}`, { as: 'cal', method: 'GET' });
  assert.equal(view.body.players.length, 3);
  assert.equal((await call('/v1/races/ZZZZZZ', { as: 'cal', method: 'GET' })).status, 404);

  const board = await call('/v1/scoreboard?period=week', { method: 'GET' });
  assert.equal(board.body.rows.find((r) => r.name === 'Bold Badger').wins, 1, 'the winner gets a race win');
  assert.equal(board.body.rows.find((r) => r.name === 'Sky Fox II').wins, 0);
});

test('private races are not offered to strangers', async () => {
  const made = await call('/v1/races', { as: 'ann', body: { puzzle: puzzle('private-1'), public: false } });
  const found = await call('/v1/races/find', { as: 'ben', body: {} });
  assert.notEqual(found.body.code, made.body.code);
  assert.equal((await call(`/v1/races/${made.body.code}/join`, { as: 'ben' })).status, 200, 'but anyone with the code can join');
});

test('leaving the scoreboard and deleting the account remove everything', async () => {
  await call('/v1/profile', { as: 'ben', method: 'DELETE' });
  assert.equal((await call('/v1/profile', { as: 'ben', method: 'GET' })).body.screenName, null);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM scores WHERE user_id = 'ben'").first()).n, 0);
  const board = await call('/v1/scoreboard?period=all', { method: 'GET' });
  assert.ok(!board.body.rows.some((r) => r.name === 'Bold Badger'));

  const r = await mf.dispatchFetch('https://api.test/v1/account', { method: 'DELETE', headers: { Authorization: `Bearer ${signer.token({ sub: 'ann' })}`, Origin: ORIGIN } });
  assert.equal(r.status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM players WHERE user_id = 'ann'").first()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM race_entries WHERE user_id = 'ann'").first()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM races WHERE host_id = 'ann'").first()).n, 0, 'hosted races stay for the others, without the host');
  assert.equal((await name('ann', 'Back Again')).status, 401, 'a deleted account cannot come back');
});

test('the in-game rules table matches the real points formula', () => {
  const html = readFileSync(join(root, '..', 'web', 'index.html'), 'utf8');
  const table = html.slice(html.indexOf('id="dlg-rules"'), html.indexOf('</table>', html.indexOf('id="dlg-rules"')));
  const rows = [...table.matchAll(/<th scope="row">(\w+) (\d) × (\d)<\/th><td>[^<]*<\/td><td>(\d+)<\/td><td>(\d+)<\/td><td>(\d+)<\/td>/g)];
  assert.equal(rows.length, 6);
  const PAR = { basic: 0.12, easy: 0.16, medium: 0.22, hard: 0.3, expert: 0.36, mensa: 0.42 };
  for (const [, label, k, n, atPar, fast, slow] of rows) {
    const tier = label.toLowerCase();
    const cells = (k * (k - 1) / 2) * n * n;
    const par = cells * PAR[tier] * 60_000;
    const pts = (ms) => pointsFor({ tier, cells, elapsedMs: ms, hints: 0, checks: 0 });
    assert.deepEqual([+atPar, +fast, +slow], [pts(par), pts(par / 2), pts(par * 3)], label);
  }
});
