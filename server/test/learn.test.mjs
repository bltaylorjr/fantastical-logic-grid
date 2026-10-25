// Learning and voice tests: run with `npm test` in server/. They start the
// whole Worker in Miniflare with a local D1 database and a stand-in for the
// Gemini voice service, so nothing leaves this computer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { computeTuning } from '../src/learn.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const ADMIN = 'test-admin-token-1234567890';
let mf;
let geminiCalls = 0;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRoot: join(root, '..'), // learn.js uses the engine's story-part rules
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    ratelimits: Object.fromEntries(['LIMIT_PLAYS', 'LIMIT_PARTS', 'LIMIT_TTS'].map((n, i) => [n, { namespace_id: String(41001 + i), simple: { limit: 100, period: 60 } }])),
    bindings: { ALLOWED_ORIGINS: `${ORIGIN},http://tauri.localhost`, ADMIN_TOKEN: ADMIN, GEMINI_API_KEY: 'test-key', DAILY_TTS_CAP: '2', FIREBASE_PROJECT_ID: 'flg-test' },
    // Stand-in for Google: one second of silent 24 kHz audio.
    outboundService: async (req) => {
      if (!req.url.startsWith('https://generativelanguage.googleapis.com/')) return new Response('blocked', { status: 500 });
      geminiCalls++;
      const pcm = Buffer.alloc(48000).toString('base64');
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm } }] } }] });
    },
  });
  const db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = (path, { method = 'POST', body, origin = ORIGIN, token } = {}) => mf.dispatchFetch(`https://api.test${path}`, {
  method,
  headers: { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const many = (n, p) => Array.from({ length: n }, () => ({ clue_types: '{"not":3,"either":1}', ...p }));

test('tuning: players who found a level too easy or too hard move it, gently', () => {
  const t = computeTuning([...many(12, { tier: 'easy', theme: 'pets', effort: 0, signal: 1, rating: 5 }), ...many(12, { tier: 'hard', theme: 'mystery', effort: 0, signal: -1, rating: 2 })], []);
  assert.ok(t.effort.easy > 0.2, JSON.stringify(t.effort));
  assert.ok(t.effort.hard < -0.2);
  assert.ok(Math.abs(t.effort.easy) <= 0.6 && Object.values(t.clueWeights).every((w) => w >= 0.75 && w <= 1.4));
  assert.ok(t.themeWeights.pets > t.themeWeights.mystery, JSON.stringify(t.themeWeights));
  assert.equal(computeTuning(many(3, { tier: 'basic', theme: 'pets', effort: 0, signal: 1 }), []).effort.basic, undefined, 'a level with few games is left alone');
});

test('plays: saved without anything personal; bad rows dropped; CORS only for the game', async () => {
  const play = { tier: 'medium', theme: 'cooking', outcome: 'solved', effort: 0.2, signal: 0.6, rating: 4, feel: 'right', clueTypes: { not: 4, less: 2 }, parts: { o: '1', i: 'x3k' }, platform: 'android', minutes: 7.5, hints: 1, mistakes: 0 };
  const r = await call('/v1/learn/plays', { body: { plays: [play, { tier: 'nope', theme: 'cooking', outcome: 'solved' }, { ...play, email: 'a@b.c', name: 'Sam' }] } });
  assert.equal((await r.json()).saved, 2);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const bad = await call('/v1/learn/plays', { body: { plays: [] }, origin: 'https://evil.example' });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const rows = (await (await mf.getD1Database('DB')).prepare('SELECT * FROM plays').all()).results;
  assert.equal(rows.length, 2);
  assert.ok(!/a@b\.c|Sam/.test(JSON.stringify(rows)) && rows[0].platform === 'android');
});

test('shared story parts wait for review; approved ones reach every player', async () => {
  assert.equal((await call('/v1/learn/parts', { body: { theme: 'pets', kind: 'openings', value: 'Five dogs met.' } })).status, 400);
  const part = { theme: 'pets', kind: 'openings', value: 'The dog park was muddy, but {n} {many} came anyway.' };
  assert.equal((await (await call('/v1/learn/parts', { body: part })).json()).status, 'pending');
  let tun = await (await call('/v1/learn/tuning', { method: 'GET' })).json();
  assert.equal(tun.parts.pets, undefined, 'not shared before review');
  assert.equal(tun.games, 2);

  assert.equal((await call('/admin/learn/parts', { method: 'GET' })).status, 401);
  assert.equal((await call('/admin/learn/parts', { method: 'GET', token: 'wrong-token-wrong-token' })).status, 401);
  const list = await (await call('/admin/learn/parts', { method: 'GET', token: ADMIN })).json();
  assert.equal(list.parts.length, 1);
  await call('/admin/learn/review', { token: ADMIN, body: { key: list.parts[0].key, status: 'approved' } });
  tun = await (await call('/v1/learn/tuning', { method: 'GET' })).json();
  assert.deepEqual(tun.parts.pets.openings, [part.value]);
  assert.match(await (await call('/admin/learn', { method: 'GET' })).text(), /Story review/);
  // Parts can belong to one topic (its story key), but not to a made-up one.
  const topicPart = { theme: 'pets/hotel', kind: 'mishaps', value: 'The night clerk dozed off, so the check-in cards are a jumble.' };
  assert.equal((await (await call('/v1/learn/parts', { body: topicPart })).json()).status, 'pending');
  assert.equal((await call('/v1/learn/parts', { body: { ...topicPart, theme: 'pets/moon-base' } })).status, 400);
});

test('voices: cached, capped per day, and fall back to Kokoro', async () => {
  const say = (text) => call('/v1/tts', { body: { text, voice: 'Kore' } });
  const a = await say('Hello there.');
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('Content-Type'), 'audio/wav');
  assert.equal(new TextDecoder().decode((await a.arrayBuffer()).slice(0, 4)), 'RIFF');
  const again = await say('Hello there.');
  assert.equal(again.headers.get('X-Cache'), 'hit', 'the same clip comes from the cache');
  await again.arrayBuffer();
  assert.equal((await say('Second clip.')).status, 200);
  const capped = await say('Third clip.');
  assert.equal(capped.status, 429);
  assert.equal((await capped.json()).fallback, 'kokoro');
  assert.equal(geminiCalls, 2, 'cached and capped clips never reach Google');
  assert.equal((await say('x'.repeat(500))).status, 400);
});
