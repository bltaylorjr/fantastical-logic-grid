// Storyline gifts (story-gifts.js): run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { partKey } from '../../engine/src/story.js';
import { nameKey } from '../src/names.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://thelogicgrid.com';
const OWNER = 'owner@example.com';
const TOKEN = 'break-glass-token-for-gift-tests';
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
    outboundService: async () => new Response('{}', { status: 201 }),
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: { FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), OWNER_EMAIL: OWNER, ADMIN_TOKEN: TOKEN },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  const player = db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 1)');
  await player.bind('monkey-uid', 'ColbaltSockMonkey18', nameKey('ColbaltSockMonkey18')).run();
  await player.bind('writer-uid', 'StoryWriter', nameKey('StoryWriter')).run();
});
after(() => mf.dispose());

const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const call = async (path, { body, auth } = {}) => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const parts = {
  openings: '{N} {many} met by the old lighthouse on a stormy night.',
  incidents: { name: 'Lantern', text: 'Someone switched off the great lantern just as a ship came near.', prize: 'the lighthouse lantern' },
  mishaps: 'The wind blew everyone\'s notes into the sea, so nobody agrees on what they saw.',
  endings: '{Fact}, so {winner} owns up and lights {prize} again.',
};
let askedId;

test('a signed-in player can ask for a puzzle from their storyline', async () => {
  const player = signer.token({ sub: 'writer-uid', email: 'writer@example.com', email_verified: true });
  const r = await call('/v1/feedback', { auth: player, body: { kind: 'idea', topic: 'story', theme: 'mystery', text: 'A lighthouse keeper finds the lantern switched off on a stormy night.', puzzle: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.gift, 'queued');
  const g = await db.prepare("SELECT feedback_id, user_id, email, credit, status FROM story_gifts WHERE user_id = 'writer-uid'").first();
  assert.deepEqual({ ...g, feedback_id: undefined }, { feedback_id: undefined, user_id: 'writer-uid', email: 'writer@example.com', credit: 'StoryWriter', status: 'asked' });
  askedId = g.feedback_id;
  // Not signed in, or another kind of idea: no gift.
  assert.equal((await call('/v1/feedback', { body: { kind: 'idea', topic: 'story', text: 'Pirates on a foggy night lose a map.', puzzle: true } })).body.gift, 'signed_out');
  assert.equal((await call('/v1/feedback', { auth: player, body: { kind: 'idea', topic: 'feature', text: 'Please add a dark grid.', puzzle: true } })).body.gift, 'none');
});

test('the dashboard shows who wants a puzzle', async () => {
  const r = await call('/admin/v1/inbox?type=idea&status=new', { auth: owner() });
  const item = r.body.items.find((i) => i.id === askedId);
  assert.equal(item.meta.gift.status, 'asked');
  assert.equal(item.meta.gift.credit, 'StoryWriter');
});

test('approving checks the parts, adds them for everyone, and queues the gift', async () => {
  const bad = await call(`/admin/v1/feedback/${askedId}/storyline/approve`, { auth: owner(), body: { theme: 'mystery', parts: { ...parts, endings: 'Everyone went home.' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /Ending/);
  const r = await call(`/admin/v1/feedback/${askedId}/storyline/approve`, { auth: owner(), body: { theme: 'mystery', parts, difficulty: 'easy' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.gift, { email: true, credit: 'StoryWriter' });
  const added = (await db.prepare("SELECT kind, value FROM parts WHERE theme = 'mystery' AND status = 'approved'").all()).results;
  assert.equal(added.length, 4);
  assert.equal(JSON.parse(added.find((p) => p.kind === 'incidents').value).by, 'StoryWriter');
  const fb = await db.prepare('SELECT status, note FROM feedback WHERE id = ?1').bind(askedId).first();
  assert.equal(fb.status, 'addressed');
});

test('the team can credit a storyline to a player by screen name', async () => {
  await call('/v1/feedback', { body: { kind: 'idea', topic: 'story', text: 'A sock monkey hides the museum key in a sock drawer.' } });
  const f = await db.prepare("SELECT id FROM feedback WHERE text LIKE 'A sock monkey%'").first();
  const none = await call(`/admin/v1/feedback/${f.id}/storyline/approve`, { auth: owner(), body: { theme: 'mystery', parts, credit: 'NobodyByThatName' } });
  assert.equal(none.status, 404);
  const p2 = { ...parts, incidents: { ...parts.incidents, text: 'The museum key vanished into the sock drawer.' } };
  const r = await call(`/admin/v1/feedback/${f.id}/storyline/approve`, { auth: owner(), body: { theme: 'mystery', parts: p2, credit: 'colbaltsockmonkey18', email: 'monkey@example.com' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.gift, { email: true, credit: 'ColbaltSockMonkey18' });
});

test('the Action builds the gifts and the puzzle lands in the saved puzzles', async () => {
  const claim = await call('/admin/v1/gifts/claim', { auth: TOKEN, body: {} });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.gifts.length, 2);
  const g = claim.body.gifts.find((x) => x.credit === 'ColbaltSockMonkey18');
  assert.equal(g.email, 'monkey@example.com');
  assert.equal(g.force.o, partKey('openings', parts.openings));
  assert.equal(g.hasPlayer, true);
  const save = JSON.stringify({ id: 'gift-save-1', name: 'The Silent Lantern', puzzle: { title: 'The Silent Lantern', story: { credit: 'ColbaltSockMonkey18' } }, marks: {} });
  const other = claim.body.gifts.find((x) => x.credit === 'StoryWriter');
  const done = await call('/admin/v1/gifts/done', { auth: TOKEN, body: { gifts: [{ id: g.id, ok: true, save }, { id: other.id, ok: false, error: 'test' }] } });
  assert.deepEqual(done.body, { sent: 1, failed: 1 });
  const rec = await db.prepare("SELECT kind, key, data, rev FROM sync_records WHERE user_id = 'monkey-uid'").first();
  assert.equal(rec.kind, 'save');
  assert.equal(rec.key, 'gift-save-1');
  assert.equal(JSON.parse(rec.data).puzzle.story.credit, 'ColbaltSockMonkey18');
  const row = await db.prepare('SELECT status, email FROM story_gifts WHERE id = ?1').bind(g.id).first();
  assert.deepEqual({ ...row }, { status: 'sent', email: null });
  // The failed one goes back in line.
  assert.equal((await db.prepare('SELECT status FROM story_gifts WHERE id = ?1').bind(other.id).first()).status, 'approved');
  // Only the owner (or the Action's key) can claim.
  const mod = signer.token({ sub: 'x', email: 'someone@example.com', email_verified: true });
  assert.equal((await call('/admin/v1/gifts/claim', { auth: mod, body: {} })).status, 403);
});
