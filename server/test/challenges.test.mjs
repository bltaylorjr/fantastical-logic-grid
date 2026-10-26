// Challenge a friend links: run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { generatePuzzle } from '../../engine/src/index.js';

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
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), OWNER_EMAIL: OWNER },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = async (path, { method = 'POST', body, auth } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};

const puzzle = generatePuzzle({ difficulty: 'easy', categories: 3, items: 4, seed: 'challenge-test' });

test('a solved puzzle becomes a link anyone can open, with the time to beat', async () => {
  const made = await call('/v1/challenges', { body: { puzzle, elapsedMs: 300_000, hints: 1 } });
  assert.equal(made.status, 200);
  assert.match(made.body.code, /^[A-Z0-9]{6}$/);
  const got = await call(`/v1/challenges/${made.body.code}`, { method: 'GET' });
  assert.equal(got.status, 200);
  assert.equal(got.body.puzzle.story.id, puzzle.story.id);
  assert.equal(got.body.elapsedMs, 300_000);
  assert.equal(got.body.hints, 1);
  assert.equal(got.body.plays, 0);

  const slower = await call(`/v1/challenges/${made.body.code}/result`, { body: { elapsedMs: 400_000 } });
  assert.deepEqual(slower.body, { plays: 1, beat: 0, faster: false });
  const quicker = await call(`/v1/challenges/${made.body.code}/result`, { body: { elapsedMs: 200_000 } });
  assert.deepEqual(quicker.body, { plays: 2, beat: 1, faster: true });
});

test('bad times, bad puzzles and unknown codes are refused', async () => {
  assert.equal((await call('/v1/challenges', { body: { puzzle, elapsedMs: 10 } })).body.error, 'bad_time');
  assert.equal((await call('/v1/challenges', { body: { puzzle: { title: 'x' }, elapsedMs: 60_000 } })).body.error, 'bad_puzzle');
  assert.equal((await call('/v1/challenges/ZZZZZZ', { method: 'GET' })).status, 404);
  const rude = structuredClone(puzzle);
  rude.title = 'shit happens';
  assert.equal((await call('/v1/challenges', { body: { puzzle: rude, elapsedMs: 60_000 } })).body.error, 'puzzle_words');
});

test('old links expire, and the switch and daily cap are kept', async () => {
  await db.prepare("INSERT INTO challenges (code, puzzle, story_id, tier, title, elapsed_ms, created_at) VALUES ('OLDOLD', '{}', 's', 'easy', 't', 60000, 1)").run();
  assert.equal((await call('/v1/challenges/OLDOLD', { method: 'GET' })).status, 404);
  const owner = signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
  const set = (key, value) => call('/admin/v1/settings', { auth: owner, body: { key, value } });
  assert.equal((await set('challenges_daily_cap', 0)).status, 200);
  assert.equal((await call('/v1/challenges', { body: { puzzle, elapsedMs: 60_000 } })).body.error, 'daily_limit');
  assert.equal((await set('challenges_enabled', false)).status, 200);
  assert.equal((await call('/v1/challenges', { body: { puzzle, elapsedMs: 60_000 } })).status, 403);
  const cfg = await mf.dispatchFetch('https://api.test/v1/config', { headers: { Origin: ORIGIN } });
  assert.equal((await cfg.json()).features.challenges, false);
});
