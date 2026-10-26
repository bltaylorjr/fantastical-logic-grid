// The game's own characters (src/characters.js): the creator, the story rule
// checks, publishing, the public list, portraits and player suggestions.
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } }, LIMIT_FEEDBACK: { namespace_id: '3', simple: { limit: 3, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN,
      OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'test-web-key', DAILY_TTS_CAP: '300', TEST_CHARACTERS: '1',
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

const setting = (key, value) => call('/admin/v1/settings', { auth: owner(), body: { key, value } });
const save = (c, auth = owner()) => call('/admin/v1/characters/save', { auth, body: c });
const MO = { name: 'captain mo', gender: 'm', personality: 'a cheerful old sea captain who loves riddles', role: 'both', themes: ['adventure', 'fantasy'], style: 'notionists',
  voice: { gemini: 'Fenrir', kokoro: 'am_puck', speed: 1.1 }, lines: { clue: ['Mark my words, friend:'], hint: ['Let me nudge you along.'], solve: ['Splendid work!'] } };

test('the creator saves a draft that players do not see yet', async () => {
  const r = await save(MO);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.character.name, 'Captain Mo');
  assert.equal(r.body.character.id, 'captain-mo');
  assert.equal(r.body.character.status, 'draft');
  assert.deepEqual(r.body.problems, []);
  const pub = await call('/v1/characters');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.body.characters, []);
  const list = await call('/admin/v1/characters', { auth: owner() });
  assert.equal(list.body.characters.length, 1);
  assert.ok(list.body.options.voices.gemini.m.includes('Fenrir'));
});

test('names and lines that break the story rules or the word filter are refused', async () => {
  // "Library" is a Mystery room; a line naming a grid item would read like a clue.
  const room = await save({ ...MO, name: 'Library', themes: ['mystery'] });
  assert.equal(room.status, 200);
  assert.match(room.body.problems.join(' '), /grid item "Library"/);
  const pub = await call(`/admin/v1/characters/${room.body.character.id}/publish`, { auth: owner(), body: {} });
  assert.equal(pub.status, 400);
  assert.equal(pub.body.error, 'story_rules');
  const line = await save({ ...MO, name: 'Wren', themes: ['mystery'], lines: { clue: ['I saw them in the Kitchen:'] } });
  assert.match(line.body.problems.join(' '), /names "Kitchen"/);
  // Clara is one of the game's women, so a man called Clara would get the wrong voice somewhere.
  const clash = await save({ ...MO, name: 'Clara' });
  assert.match(clash.body.problems.join(' '), /already one of the game's women/);
  const rude = await save({ ...MO, name: 'Shithead' });
  assert.equal(rude.status, 400);
  assert.equal((await save({ ...MO, name: 'X' })).status, 400);
  assert.equal((await save({ ...MO, lines: { clue: ['Room 4 is where:'] } })).status, 400);
  for (const n of ['Library', 'Wren', 'Clara']) await call(`/admin/v1/characters/${n.toLowerCase()}/delete`, { auth: owner(), body: {} });
});

test('publishing needs an admin, and players then get the character', async () => {
  const mod = idToken('mod-uid', 'mod@example.com');
  await call('/admin/v1/admins', { auth: owner(), body: { email: 'mod@example.com', role: 'moderator' } });
  assert.equal((await call('/admin/v1/characters/captain-mo/publish', { auth: mod, body: {} })).status, 403);
  const r = await call('/admin/v1/characters/captain-mo/publish', { auth: owner(), body: {} });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.character.status, 'published');
  const pub = await call('/v1/characters');
  const mo = pub.body.characters.find((c) => c.id === 'captain-mo');
  assert.ok(mo);
  assert.equal(mo.gender, 'm');
  assert.deepEqual(mo.voice, { gemini: 'Fenrir', kokoro: 'am_puck', speed: 1.1 });
  assert.equal(mo.personality, undefined, 'the personality text stays in the dashboard');
  assert.equal(pub.body.enabled, true);
  assert.equal(pub.body.suggestions, true);
});

test('the Story workshop will not add a part that names a published character', async () => {
  const r = await call('/admin/v1/workshop/add', { auth: owner(), body: { story: 'adventure', kind: 'mishaps', value: 'Captain Mo mixed up every note in the rain.' } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /Captain Mo/);
});

test('an AI portrait is painted, kept and served only once published', async () => {
  const saved = await save({ ...MO, id: 'captain-mo', style: 'ai', look: 'a blue coat and a white beard' });
  assert.equal(saved.body.character.status, 'draft', 'a change waits for publishing again');
  assert.equal((await call('/admin/v1/characters/captain-mo/publish', { auth: owner(), body: {} })).body.error, 'no_portrait');
  const p = await call('/admin/v1/characters/captain-mo/portrait', { auth: owner(), body: {} });
  assert.equal(p.status, 200, p.text);
  assert.match(p.body.character.portrait, /^data:image\/jpeg;base64,/);
  assert.equal((await call('/v1/characters/captain-mo/portrait')).status, 404);
  assert.equal((await call('/admin/v1/characters/captain-mo/publish', { auth: owner(), body: {} })).status, 200);
  const mo = (await call('/v1/characters')).body.characters.find((c) => c.id === 'captain-mo');
  assert.match(mo.portrait, /^\/v1\/characters\/captain-mo\/portrait\?v=2-/);
  const img = await mf.dispatchFetch(`https://api.test${mo.portrait}`, { headers: { Origin: ORIGIN } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /immutable/);
  await img.arrayBuffer();
});

test('the AI writer drafts lines and counts them toward the daily cap', async () => {
  const r = await call('/admin/v1/characters/captain-mo/lines', { auth: owner(), body: { idea: 'talks like a pirate' } });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.drafts.clue.length >= 1);
  assert.ok(r.body.drafts.clue.every((d) => d.ok));
  await setting('character_draft_cap', 1);
  const again = await call('/admin/v1/characters/captain-mo/lines', { auth: owner(), body: {} });
  assert.equal(again.status, 400);
  assert.match(again.body.message, /used up/);
});

test('players can suggest a character; it waits for review and is rate limited', async () => {
  const ask = (b) => call('/v1/characters/suggest', { body: b });
  const ok = await ask({ name: 'Zara', gender: 'f', look: 'curly red hair and a green scarf', personality: 'brave and curious', voiceStyle: 'lively', themes: ['scifi'] });
  assert.equal(ok.status, 201, ok.text);
  assert.equal((await ask({ name: 'Zara', gender: 'f', personality: 'shit' })).status, 422);
  assert.equal((await ask({ name: '1', gender: 'f', personality: 'kind' })).status, 400);
  assert.equal((await ask({ name: 'Zed', gender: 'm', personality: 'kind' })).status, 429, 'a few a minute per connection');
  const list = (await call('/admin/v1/characters', { auth: owner() })).body.characters;
  const zara = list.find((c) => c.name === 'Zara');
  assert.equal(zara.status, 'suggested');
  assert.equal(zara.source, 'player');
  assert.equal(zara.voice.gemini, 'Zephyr', 'the voice style picks a matching voice');
  assert.ok(!(await call('/v1/characters')).body.characters.some((c) => c.name === 'Zara'));
  assert.equal((await call(`/admin/v1/characters/${zara.id}/publish`, { auth: owner(), body: {} })).body.error, 'review_first');
});

test('switching characters off empties the game\'s list', async () => {
  await setting('characters_enabled', false);
  const pub = await call('/v1/characters');
  assert.equal(pub.body.enabled, false);
  assert.deepEqual(pub.body.characters, []);
  await setting('characters_enabled', true);
});

test('the dashboard\'s copies of the game\'s face files match the game', () => {
  const top = join(root, '..');
  for (const [copy, game] of [['admin/looks.js', 'web/js/looks.js'], ['admin/dicebear.js', 'web/vendor/dicebear/dicebear.js']]) {
    assert.equal(readFileSync(join(top, copy), 'utf8'), readFileSync(join(top, game), 'utf8'), `${copy} must be a copy of ${game}`);
  }
});
