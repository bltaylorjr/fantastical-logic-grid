// Starts the puzzle server on a spare port and checks the key, puzzles,
// hints, size limits and bad requests.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const KEY = 'test-key-'.padEnd(40, 'x');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
const proc = spawn(process.execPath, [join(here, '..', 'server.mjs')], { env: { ...process.env, FLG_PUZZLE_KEY: KEY, PORT: String(PORT), THREADS: '2', RELEASE: 'test' }, stdio: ['ignore', 'inherit', 'inherit'] });
const call = (path, { key = KEY, body, method = body ? 'POST' : 'GET' } = {}) =>
  fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-FLG-Key': key } : {}) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); } };

try {
  for (let i = 0; i < 50; i++) { try { const r = await call('/v1/health'); if ((await r.json()).ok) break; } catch (e) { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
  await check('refuses a request with no key', async () => assert.equal((await call('/v1/health', { key: '' })).status, 401));
  await check('refuses a wrong key', async () => assert.equal((await call('/v1/health', { key: KEY.slice(0, -1) + 'y' })).status, 401));
  await check('health reports the release', async () => { const h = await (await call('/v1/health')).json(); assert.equal(h.ok, true); assert.equal(h.release, 'test'); });
  let puzzle;
  await check('builds a puzzle', async () => {
    const r = await call('/v1/generate', { body: { options: { difficulty: 'easy', seed: 'server-test' } } });
    assert.equal(r.status, 200);
    puzzle = (await r.json()).result;
    assert.ok(puzzle.clues.length > 0 && puzzle.solution.length > 0);
  });
  await check('the same seed gives the same puzzle', async () => {
    const again = (await (await call('/v1/generate', { body: { options: { difficulty: 'easy', seed: 'server-test' } } })).json()).result;
    assert.deepEqual(again.clues.map((c) => c.text), puzzle.clues.map((c) => c.text));
  });
  await check('gives a hint', async () => {
    const r = await call('/v1/hint', { body: { puzzle, marks: [] } });
    assert.equal(r.status, 200);
    assert.ok(['step', 'done'].includes((await r.json()).result.kind));
  });
  await check('rejects bad JSON', async () => assert.equal((await call('/v1/generate', { body: '{oops' })).status, 400));
  await check('rejects missing options', async () => assert.equal((await call('/v1/generate', { body: {} })).status, 400));
  await check('rejects an oversized request', async () => assert.equal((await call('/v1/hint', { body: { puzzle: { x: 'a'.repeat(600 * 1024) }, marks: [] } }).catch(() => ({ status: 413 }))).status, 413));
  await check('unknown paths are not found', async () => assert.equal((await call('/v1/nope', { body: {} })).status, 404));
} finally {
  proc.kill('SIGTERM');
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('Puzzle server tests passed.');
