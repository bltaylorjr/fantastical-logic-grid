// Puzzles for contributors: the team attaches a puzzle file to a reply, the
// player finds it under Puzzles for you in Messages, can open it, and it is
// deleted after 30 days (or with its conversation or account).
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { generatePuzzle } from '../../engine/src/index.js';
import { runUpkeep } from '../src/upkeep.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const ORIGIN = 'https://thelogicgrid.com';
const OWNER = 'owner@example.com';
const DAY = 24 * 3600_000;
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: 'break-glass-token-for-tests-1234',
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

const token = (sub, email) => signer.token({ sub, email, email_verified: true });
async function call(path, { auth, body } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${await auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('the team sends a puzzle made from a suggestion; the player plays it for 30 days', async () => {
  const owner = token('owner-uid', OWNER);
  const ann = token('ann-uid', 'ann@example.com');
  const bob = token('bob-uid', 'bob@example.com');
  const sent = await call('/v1/messages', { auth: ann, body: { topic: 'idea', text: 'A lighthouse keeper with a pet crab' } });
  assert.equal(sent.status, 200);
  const conv = sent.body.id;

  const puzzle = generatePuzzle({ difficulty: 'easy', categories: 3, items: 4, seed: 'contributor-test' });
  const file = { format: 'fantastical-logic-grid', version: 1, save: { name: puzzle.title, puzzle } };
  assert.equal((await call(`/admin/v1/conversations/${conv}/reply`, { auth: owner, body: { text: 'Here it is!', puzzle: { nope: 1 } } })).status, 400, 'only real puzzle files');
  const r = await call(`/admin/v1/conversations/${conv}/reply`, { auth: owner, body: { text: 'We made a puzzle from your idea!', puzzle: file } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.puzzle.title, puzzle.title);
  assert.ok(Math.abs(r.body.puzzle.expiresAt - (Date.now() + 30 * DAY)) < 60_000, 'kept 30 days');

  const view = (await call(`/admin/v1/conversations/${conv}`, { auth: owner })).body;
  assert.equal(view.puzzles.length, 1);

  const mine = (await call('/v1/messages', { auth: ann })).body;
  assert.equal(mine.puzzles.length, 1);
  assert.equal(mine.puzzles[0].openedAt, null);
  const id = mine.puzzles[0].id;
  const got = await call(`/v1/messages/puzzles/${id}`, { auth: ann });
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.puzzle.solution, puzzle.solution);
  assert.equal((await call(`/v1/messages/puzzles/${id}`, { auth: bob })).status, 404, 'only for that player');
  assert.equal((await call(`/v1/messages/puzzles/${id}/opened`, { auth: ann, body: {} })).status, 200);
  assert.ok((await call('/v1/messages', { auth: ann })).body.puzzles[0].openedAt);

  const storage = (await call('/admin/v1/puzzle-storage', { auth: owner })).body;
  assert.equal(storage.puzzles, 1);
  assert.equal(storage.keepDays, 30);

  // After 30 days it is gone, and the nightly cleanup removes it.
  await db.prepare('UPDATE player_puzzles SET expires_at = ?1').bind(Date.now() - 1).run();
  assert.equal((await call(`/v1/messages/puzzles/${id}`, { auth: ann })).status, 404);
  assert.deepEqual((await call('/v1/messages', { auth: ann })).body.puzzles, []);
  await runUpkeep({ DB: db });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM player_puzzles').first()).n, 0);

  // The team can remove one early.
  const again = await call(`/admin/v1/conversations/${conv}/reply`, { auth: owner, body: { text: 'One more', puzzle } });
  assert.equal(again.status, 200);
  const pid = (await call(`/admin/v1/conversations/${conv}`, { auth: owner })).body.puzzles[0].id;
  assert.equal((await call(`/admin/v1/conversations/${conv}/puzzles/${pid}/delete`, { auth: owner, body: {} })).status, 200);
  assert.deepEqual((await call('/v1/messages', { auth: ann })).body.puzzles, []);
});
