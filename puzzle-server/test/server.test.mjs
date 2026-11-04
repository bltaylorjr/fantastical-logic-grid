// Starts the puzzle server on a spare port and checks the key, puzzles,
// hints, size limits and bad requests, then its upkeep: the start-up check,
// the per-operation numbers, thread replacement, and a broken release being
// reported as not healthy.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const KEY = 'test-key-'.padEnd(40, 'x');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
const serve = (port, env = {}) => spawn(process.execPath, [join(here, '..', 'server.mjs')], { env: { ...process.env, FLG_PUZZLE_KEY: KEY, PORT: String(port), THREADS: '2', RELEASE: 'test', ...env }, stdio: ['ignore', 'inherit', 'inherit'] });
const proc = serve(PORT);
const call = (path, { key = KEY, body, method = body ? 'POST' : 'GET', at = base } = {}) =>
  fetch(at + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-FLG-Key': key } : {}) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); } };

try {
  for (let i = 0; i < 50; i++) { try { const r = await call('/v1/health'); if ((await r.json()).ok) break; } catch (e) { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
  await check('refuses a request with no key', async () => assert.equal((await call('/v1/health', { key: '' })).status, 401));
  await check('refuses a wrong key', async () => assert.equal((await call('/v1/health', { key: KEY.slice(0, -1) + 'y' })).status, 401));
  await check('health reports the release', async () => { const h = await (await call('/v1/health')).json(); assert.equal(h.ok, true); assert.equal(h.release, 'test'); });
  await check('the start-up check passed every game', async () => { const h = await (await call('/v1/health')).json(); assert.equal(h.canary.state, 'passed'); assert.deepEqual(h.canary.failed, []); });
  let puzzle;
  await check('builds a puzzle', async () => {
    const r = await call('/v1/run/flg/generate', { body: { args: { difficulty: 'easy', seed: 'server-test' } } });
    assert.equal(r.status, 200);
    puzzle = (await r.json()).result;
    assert.ok(puzzle.clues.length > 0 && puzzle.solution.length > 0);
  });
  await check('the same seed gives the same puzzle', async () => {
    const again = (await (await call('/v1/run/flg/generate', { body: { args: { difficulty: 'easy', seed: 'server-test' } } })).json()).result;
    assert.deepEqual(again.clues.map((c) => c.text), puzzle.clues.map((c) => c.text));
  });
  await check('gives a hint', async () => {
    const r = await call('/v1/run/flg/hint', { body: { args: { puzzle, marks: [] } } });
    assert.equal(r.status, 200);
    assert.ok(['step', 'done'].includes((await r.json()).result.kind));
  });
  await check('rejects bad JSON', async () => assert.equal((await call('/v1/run/flg/generate', { body: '{oops' })).status, 400));
  await check('rejects missing args', async () => assert.equal((await call('/v1/run/flg/generate', { body: {} })).status, 400));
  await check('rejects an unknown operation or game', async () => {
    for (const path of ['/v1/run/flg/constructor', '/v1/run/flg/ping', '/v1/run/nope/generate', '/v1/run/np/__proto__']) assert.equal((await call(path, { body: { args: {} } })).status, 404, path);
  });
  await check('every game in games.js has every operation it lists', async () => {
    const { ENGINE_GAMES, OP_KINDS } = await import(join(here, '..', '..', 'engine', 'src', 'games.js'));
    for (const [id, game] of Object.entries(ENGINE_GAMES)) {
      const { OPS } = await import(join(here, '..', '..', 'engine', 'src', game.ops));
      assert.deepEqual(Object.keys(OPS).sort(), Object.keys(game.kinds).sort(), `${id}: ${game.ops} and games.js list the same operations`);
      for (const kind of Object.values(game.kinds)) assert.ok(OP_KINDS[kind], `${id}: kind ${kind} exists`);
    }
  });
  let np;
  await check('builds a NINETIMESNINE puzzle', async () => {
    const r = await call('/v1/run/np/generate', { body: { args: { difficulty: 'easy', size: 6, seed: 'np-test', story: false } } });
    assert.equal(r.status, 200);
    np = (await r.json()).result;
    assert.equal(np.size, 6);
    assert.equal(np.givens.length, 36);
  });
  await check('gives a NINETIMESNINE hint', async () => {
    const r = await call('/v1/run/np/hint', { body: { args: { puzzle: np, entries: np.givens } } });
    assert.equal(r.status, 200);
    assert.ok((await r.json()).result);
  });
  await check('plays the rival\'s next move', async () => {
    const r = await call('/v1/run/np/move', { body: { args: { puzzle: np, grid: np.givens, options: { maxLevel: 5 } } } });
    assert.equal(r.status, 200);
  });
  await check('plans and runs the Tidewater tide', async () => {
    const t = await call('/v1/run/np/tide', { body: { args: { puzzle: np, options: { depth: 0.5 } } } });
    assert.equal(t.status, 200);
    const { water } = (await t.json()).result;
    const e = await call('/v1/run/np/ebb', { body: { args: { puzzle: np, grid: np.givens.map((d, i) => (water.includes(i) ? 0 : d)), water } } });
    assert.equal(e.status, 200);
  });
  await check('checks a wizard grid: one answer, reasoned out', async () => {
    const r = await call('/v1/run/np/check', { body: { args: { size: 6, givens: np.givens } } });
    const a = (await r.json()).result;
    assert.equal(a.count, 1);
    assert.equal(a.solved, true);
    assert.deepEqual(a.solution, np.solution);
  });
  await check('checks a wizard grid: an empty grid has many answers', async () => {
    const a = (await (await call('/v1/run/np/check', { body: { args: { size: 4, givens: [] } } })).json()).result;
    assert.equal(a.count, 2);
    assert.ok(a.suggestion);
  });
  await check('rejects an oversized request', async () => assert.equal((await call('/v1/run/flg/hint', { body: { args: { puzzle: { x: 'a'.repeat(600 * 1024) }, marks: [] } } }).catch(() => ({ status: 413 }))).status, 413));
  await check('unknown paths are not found', async () => assert.equal((await call('/v1/nope', { body: {} })).status, 404));
  await check('health counts each operation and times it', async () => {
    const { ops } = await (await call('/v1/health')).json();
    assert.ok(ops['flg/generate'].runs >= 2);
    assert.equal(ops['flg/generate'].timedOut, 0);
    assert.ok(ops['flg/generate'].p50Ms >= 0 && ops['flg/generate'].p95Ms >= ops['flg/generate'].p50Ms);
  });
} finally {
  proc.kill('SIGTERM');
}

const waitUp = async (at, want = (h) => h.ok) => {
  for (let i = 0; i < 100; i++) { try { const h = await (await call('/v1/health', { at })).json(); if (want(h)) return h; } catch (e) { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
  return (await call('/v1/health', { at })).json();
};

// Threads are replaced after RECYCLE_JOBS requests, and the server keeps answering.
{
  const port = PORT + 1;
  const p2 = serve(port, { RECYCLE_JOBS: '1', CANARY: '0' });
  const at = `http://127.0.0.1:${port}`;
  try {
    await waitUp(at);
    await check('keeps answering while it replaces threads', async () => {
      for (let i = 0; i < 4; i++) {
        const r = await call('/v1/run/sk/generate', { at, body: { args: { difficulty: 'easy', seed: `recycle-${i}` } } });
        assert.equal(r.status, 200);
      }
      const h = await waitUp(at);
      assert.ok(h.upkeep.recycled >= 4, `recycled ${h.upkeep.recycled}`);
      assert.equal(h.upkeep.crashed, 0);
      assert.equal(h.canary.state, 'off');
    });
  } finally {
    p2.kill('SIGTERM');
  }
}

// A broken release fails the start-up check and is reported as not healthy.
{
  const port = PORT + 2;
  const dir = mkdtempSync(join(tmpdir(), 'flg-broken-'));
  cpSync(join(here, '..', '..', 'engine', 'src'), join(dir, 'engine', 'src'), { recursive: true });
  cpSync(join(here, '..', '..', 'engine', 'doctor.js'), join(dir, 'engine', 'doctor.js'));
  writeFileSync(join(dir, 'engine', 'src', 'sk-ops.js'), "import { generateSkyline } from './skyline.js';\nexport const OPS = { generate: (a) => generateSkyline(a), hint: () => { throw new Error('broken'); } };\n");
  const p3 = serve(port, { ENGINE_DIR: join(dir, 'engine', 'src') });
  const at = `http://127.0.0.1:${port}`;
  try {
    await check('a broken release says it is not healthy', async () => {
      const h = await waitUp(at, (x) => x.canary && x.canary.state !== 'checking');
      assert.equal(h.canary.state, 'failed');
      assert.equal(h.ok, false);
      assert.ok(h.canary.failed.some((f) => f.startsWith('sk/')), h.canary.failed.join(' | '));
    });
  } finally {
    p3.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('Puzzle server tests passed.');
