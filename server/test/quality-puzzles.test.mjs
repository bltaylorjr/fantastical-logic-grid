// Puzzle quality: problem puzzles from the game, their numbers against the
// normal limits, suggested fixes, and Edit, Delete and Republish.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { generatePuzzle } from '../../engine/src/index.js';
import { playReasons, suggestionsFor } from '../src/quality-puzzles.js';

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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN,
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


const today = new Date().toISOString().slice(0, 10);
const puzzle = generatePuzzle({ difficulty: 'hard', theme: 'random', seed: 'qp-test-1' });
const size = `${puzzle.categories.length}x${puzzle.categories[0].items.length}`;
const play = (over = {}) => ({
  platform: 'web', tier: puzzle.difficulty.id, theme: puzzle.theme.id, size, clueTypes: {}, effort: 0, signal: -0.8, outcome: 'abandoned',
  rating: null, feel: null, parts: {}, minutes: 30, hints: 4, mistakes: 2, pid: `pid${Math.random().toString(36).slice(2, 14)}xx`,
  topic: puzzle.topic.id, story: puzzle.story.id, version: '1.20.0', mode: 'free', whatif: 3,
  puzzleId: puzzle.id, expected: 8, clues: puzzle.clues.length, score: puzzle.stats.difficultyScore, ...over,
});

test('the reasons and suggestions follow the numbers', () => {
  assert.deepEqual(playReasons({ outcome: 'solved', minutes: 20, expected: 8, hints: 0, mistakes: 0 }), ['slow']);
  assert.deepEqual(playReasons({ outcome: 'abandoned', rating: 1, feel: 'hard', hints: 3, mistakes: 0 }).sort(), ['hints', 'low_rating', 'quit', 'too_hard']);
  assert.deepEqual(playReasons({ outcome: 'solved', minutes: 5, expected: 8, hints: 0, mistakes: 0, rating: 4 }), []);
  const hard = suggestionsFor({ reasons: { quit: 3, too_hard: 2 }, quitRate: 0.75, versions: ['1.20.0'] }, { tier: 'hard', size: '5x5', whatif: 9 });
  assert.ok(hard.some((x) => x.action && x.action.categories === 4 && x.action.items === 5), 'a smaller size is suggested');
  assert.ok(hard.some((x) => /what-if/.test(x.text)), 'too many what-if steps is named');
  assert.ok(hard.some((x) => x.action && x.action.difficulty === 'medium'), 'one level easier is suggested');
  const easy = suggestionsFor({ reasons: { too_easy: 2 }, quitRate: 0, versions: [] }, { tier: 'hard', size: '4x5' });
  assert.ok(easy.some((x) => x.action && x.action.difficulty === 'expert'), 'one level harder is suggested');
});

test('a problem puzzle is kept, listed with its numbers, and the group is flagged', async () => {
  const sent = await call('/v1/learn/plays', { body: { plays: [play(), play({ outcome: 'revealed', rating: 2, feel: 'hard' }), play({ outcome: 'solved', minutes: 24, hints: 1 })] } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.saved, 3);
  const row = await db.prepare('SELECT puzzle_id, expected, clues FROM plays WHERE puzzle_id = ?1').bind(puzzle.id).first();
  assert.equal(row.expected, 8, 'the expected time is kept');
  assert.equal((await call('/v1/learn/problem', { body: { puzzle } })).body.saved, true);
  assert.equal((await call('/v1/learn/problem', { body: { puzzle } })).body.saved, true, 'sent again: kept once');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM quality_puzzles').first()).n, 1);
  // A player's own story, a Lab mode or a broken puzzle is never kept.
  assert.equal((await call('/v1/learn/problem', { body: { puzzle: { ...puzzle, id: 'x', options: { ...puzzle.options, custom: { title: 'Mine' } } } } })).status, 400);
  assert.equal((await call('/v1/learn/problem', { body: { puzzle: { ...puzzle, solution: [] } } })).status, 400);

  const list = await call('/admin/v1/quality-puzzles', { auth: owner() });
  assert.equal(list.status, 200);
  const p = list.body.puzzles[0];
  assert.equal(p.id, puzzle.id);
  assert.equal(p.stats.games, 3);
  assert.equal(p.stats.reasons.quit, 1);
  assert.equal(p.stats.reasons.slow, 1, 'the solve took three times the expected time');
  assert.ok(p.suggestions.length >= 1);
  const one = await call(`/admin/v1/quality-puzzles/${encodeURIComponent(puzzle.id)}`, { auth: owner() });
  assert.equal(one.body.puzzle.title, puzzle.title, 'the puzzle comes back whole');
  assert.equal(one.body.fixed, null);

  // Enough timed solves for the median to count (5).
  await call('/v1/learn/plays', { body: { plays: [20, 22, 19, 25].map((m) => play({ outcome: 'solved', minutes: m, hints: 4 })) } });
  const q = await call('/admin/v1/quality?days=30', { auth: owner() });
  const g = q.body.rows.find((r) => r.theme === puzzle.theme.id && r.tier === puzzle.difficulty.id);
  assert.ok(g.issues.some((x) => x.code === 'slow'), 'the group is out of its normal time limits');
  assert.equal(g.puzzles, 1, 'the group says one problem puzzle waits');
});

test('Edit, Republish, Delete and Undo', async () => {
  const id = encodeURIComponent(puzzle.id);
  await db.prepare("INSERT OR IGNORE INTO admins (email, role, added_by, added_at) VALUES ('viewer2@example.com', 'viewer', 'test', 0)").run();
  const viewer = idToken('v2-uid', 'viewer2@example.com');
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/save`, { auth: viewer, body: { title: 'Nope' } })).status, 403, 'viewers cannot edit');
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/publish`, { auth: owner(), body: {} })).status, 409, 'nothing to republish before a fix');
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/save`, { auth: owner(), body: { title: ' ' } })).status, 400);
  const saved = await call(`/admin/v1/quality-puzzles/${id}/save`, { auth: owner(), body: { title: 'The Clearer Mystery', paragraphs: ['First part.', 'Second part.'], note: 'Shorter story' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.status, 'fixed');
  assert.equal(saved.body.fixed.title, 'The Clearer Mystery');
  assert.equal(saved.body.fixed.story.text, 'First part.\n\nSecond part.');
  assert.deepEqual(saved.body.fixed.clues, puzzle.clues, 'the clues and answer stay as they were');
  // A rebuild replaces the puzzle (checked like one from the game).
  const rebuilt = generatePuzzle({ ...puzzle.options, difficulty: 'medium', categories: undefined, items: undefined, seed: 'qp-test-2' });
  const r2 = await call(`/admin/v1/quality-puzzles/${id}/save`, { auth: owner(), body: { puzzle: rebuilt } });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.fixed.difficulty.id, 'medium');
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/save`, { auth: owner(), body: { puzzle: { ...rebuilt, solution: [] } } })).status, 400);

  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/publish`, { auth: owner(), body: {} })).body.status, 'published');
  const fixed = await call('/v1/learn/fixed');
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.puzzles.length, 1);
  assert.equal(fixed.body.puzzles[0].puzzle.difficulty.id, 'medium', 'players get the fixed version');
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/reset`, { auth: owner(), body: {} })).status, 409, 'unpublish before going back to the original');

  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/retire`, { auth: owner(), body: {} })).body.status, 'retired');
  const tuning = await call('/v1/learn/tuning');
  assert.ok(tuning.body.retiredStories.includes(puzzle.story.id), 'no game builds the deleted story again');
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/save`, { auth: owner(), body: { title: 'Again' } })).status, 409);
  assert.equal((await call('/admin/v1/quality-puzzles?status=retired', { auth: owner() })).body.puzzles.length, 1);
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/restore`, { auth: owner(), body: {} })).body.status, 'published', 'Undo puts it back as it was');
  assert.equal((await call(`/admin/v1/quality-puzzles/${id}/unpublish`, { auth: owner(), body: {} })).body.status, 'fixed');
  assert.equal((await call('/v1/learn/fixed')).body.puzzles.length, 0);
  const audit = await db.prepare("SELECT action FROM admin_audit WHERE action LIKE 'quality.%' ORDER BY at").all();
  assert.ok(audit.results.some((a) => a.action === 'quality.retire'), 'every change is in the audit log');
});

test('the statistics hold up on small and noisy samples', async () => {
  const { wilson, bayesAverage, meanInterval, median, robustZ, winsorize } = await import('../src/stats.js');
  const small = wilson(2, 5), big = wilson(40, 100);
  assert.ok(small.low < 0.15 && big.low > 0.3, '2 of 5 is far less certain than 40 of 100');
  assert.equal(wilson(0, 0).p, null);
  assert.ok(Math.abs(bayesAverage(5, 1, 3.8, 5) - 4) < 1e-9, 'one 5-star rating moves a 3.8 average only to 4');
  const ci = meanInterval([1, 2, 2, 1, 2]);
  assert.ok(ci.high < 3, 'five low ratings are confidently under 3');
  assert.equal(median(winsorize([1, 1.2, 1.1, 50], 0.1, 6)), 1.15, 'one long pause does not move the typical time');
  assert.ok(robustZ(6, [1, 1.1, 0.9, 1.2, 1]) > 3.5 && Math.abs(robustZ(1.1, [1, 1.1, 0.9, 1.2, 1])) < 3.5, 'only a real outlier stands out');
});

test('only the first rating and feel of a game count, in every game', async () => {
  // The Logic Grid.
  const pid = 'firstOnlyPid0001';
  await call('/v1/learn/plays', { body: { plays: [play({ pid, outcome: 'solved', rating: 5, feel: 'right' })] } });
  await call('/v1/learn/plays', { body: { plays: [play({ pid, outcome: 'solved', rating: 1, feel: 'hard' })] } });
  const lg = await db.prepare('SELECT rating, feel FROM plays WHERE pid = ?1').bind(pid).first();
  assert.deepEqual({ ...lg }, { rating: 5, feel: 'right' }, 'a changed Logic Grid rating is ignored');
  const late = 'firstOnlyPid0002';
  await call('/v1/learn/plays', { body: { plays: [play({ pid: late, outcome: 'solved' })] } });
  await call('/v1/learn/plays', { body: { plays: [play({ pid: late, outcome: 'solved', rating: 4 })] } });
  assert.equal((await db.prepare('SELECT rating FROM plays WHERE pid = ?1').bind(late).first()).rating, 4, 'a first rating sent later still counts');
  // NINETIMESNINE and a grid-kit game.
  await db.prepare("UPDATE settings SET value = 'true' WHERE key IN ('np_learning_enabled', 'cm_learning_enabled')").run();
  const np = (o) => ({ level: 'easy', size: 9, outcome: 'solved', minutes: 5, pid: 'npfirstonly1', ...o });
  await call('/v1/learn/np/plays', { body: { plays: [np({ rating: 4, feel: 'easy' })] } });
  await call('/v1/learn/np/plays', { body: { plays: [np({ rating: 2, feel: 'hard' })] } });
  const n = await db.prepare("SELECT rating, feel FROM np_plays WHERE pid = 'npfirstonly1'").first();
  assert.deepEqual({ ...n }, { rating: 4, feel: 'easy' }, 'NINETIMESNINE keeps the first rating');
  const kit = (o) => ({ level: 'easy', size: 6, outcome: 'solved', minutes: 3, pid: 'kitfirstonly1', ...o });
  await call('/v1/learn/cm/plays', { body: { plays: [kit({ rating: 3 })] } });
  await call('/v1/learn/cm/plays', { body: { plays: [kit({ rating: 5, feel: 'right' })] } });
  const k = await db.prepare("SELECT rating, feel FROM kit_plays WHERE pid = 'kitfirstonly1'").first();
  assert.deepEqual({ ...k }, { rating: 3, feel: 'right' }, 'a grid-kit game keeps its first rating; a first feel sent later counts');
});
