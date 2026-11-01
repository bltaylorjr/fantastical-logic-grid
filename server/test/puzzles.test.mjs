// Puzzle server route (src/puzzles.js): run with `npm test` in server/.
// The Workers VPC binding is replaced by a stand-in that records what it was sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePuzzles } from '../src/puzzles.js';

const ORIGIN = 'https://thelogicgrid.com';
const KEY = 'k'.repeat(40);
function envWith({ answer = { status: 200, body: { result: { id: 'p1' } } }, limited = false, key = KEY, binding = true } = {}) {
  const sent = [];
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    PUZZLE_KEY: key,
    LIMIT_PUZZLES: { limit: async () => ({ success: !limited }) },
    LIMIT_HINTS: { limit: async () => ({ success: !limited }) },
  };
  if (binding) env.PUZZLES = { fetch: async (url, init = {}) => { sent.push({ url, init }); if (answer === 'throw') throw new Error('down'); return new Response(JSON.stringify(answer.body), { status: answer.status }); } };
  return { env, sent };
}
const req = (path, { body, origin = ORIGIN, method = 'POST' } = {}) => new Request(`https://api.example${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});
const call = (r, env) => handlePuzzles(r, env, new URL(r.url));

test('other paths are not handled', async () => {
  assert.equal(await call(req('/v1/challenges'), envWith().env), null);
});

test('off until the binding and the key are both set', async () => {
  for (const opts of [{ binding: false }, { key: 'short' }]) {
    const res = await call(req('/v1/puzzles/generate', { body: { options: {} } }), envWith(opts).env);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'puzzles_off');
  }
});

test('passes a puzzle request on with the key, and the answer back', async () => {
  const { env, sent } = envWith();
  const res = await call(req('/v1/puzzles/generate', { body: { options: { difficulty: 'easy' }, extra: 'dropped' } }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { result: { id: 'p1' } });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/v1\/generate$/);
  assert.equal(sent[0].init.headers['X-FLG-Key'], KEY);
  assert.deepEqual(JSON.parse(sent[0].init.body), { options: { difficulty: 'easy' } });
});

test('hints go to the hint path', async () => {
  const { env, sent } = envWith();
  const res = await call(req('/v1/puzzles/hint', { body: { puzzle: { id: 'p1' }, marks: [] } }), env);
  assert.equal(res.status, 200);
  assert.match(sent[0].url, /\/v1\/hint$/);
});

test('turns away requests from other sites and from scripts', async () => {
  for (const origin of ['https://copycat.example', null]) {
    const { env, sent } = envWith();
    const res = await call(req('/v1/puzzles/generate', { body: { options: {} }, origin }), env);
    assert.equal(res.status, 403);
    assert.equal(sent.length, 0);
  }
});

test('rate limited visitors wait', async () => {
  const { env, sent } = envWith({ limited: true });
  const res = await call(req('/v1/puzzles/generate', { body: { options: {} } }), env);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  assert.equal(sent.length, 0);
});

test('bad and oversized requests stop here', async () => {
  const { env, sent } = envWith();
  assert.equal((await call(req('/v1/puzzles/generate', { body: '{bad' }), env)).status, 400);
  assert.equal((await call(req('/v1/puzzles/generate', { body: { options: [] } }), env)).status, 400);
  assert.equal((await call(req('/v1/puzzles/hint', { body: { puzzle: {}, marks: 'x' } }), env)).status, 400);
  assert.equal((await call(req('/v1/puzzles/generate', { body: { options: { t: 'a'.repeat(70_000) } } }), env)).status, 413);
  assert.equal(sent.length, 0);
});

test('a wrong key on our side is reported as a server problem', async () => {
  const res = await call(req('/v1/puzzles/generate', { body: { options: {} } }), envWith({ answer: { status: 401, body: { error: 'unauthorized' } } }).env);
  assert.equal(res.status, 502);
});

test('an unreachable puzzle server answers 502', async () => {
  const res = await call(req('/v1/puzzles/generate', { body: { options: {} } }), envWith({ answer: 'throw' }).env);
  assert.equal(res.status, 502);
});

test('health needs no origin and shows no secrets', async () => {
  const res = await call(req('/v1/puzzles/health', { method: 'GET', origin: null }), envWith({ answer: { status: 200, body: { ok: true, release: 'abc', busy: 0, queued: 0, threads: 2 } } }).env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, release: 'abc', busy: 0, queued: 0 });
});
