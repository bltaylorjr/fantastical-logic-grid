// The Storyline Submission Database (src/story-submissions.js) and its emails.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { buildStorylinePuzzle } from '../../scripts/storyline-puzzle.mjs';

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


const FORM = {
  kind: 'storyline', theme: 'mystery', title: 'The Midnight Gala', pitch: 'Who stole the tiara?', setting: "A seaside mansion, New Year's Eve, 1925",
  characters: [{ name: 'Lady Ashford', trait: 'Nervous', role: 'Main' }, { name: 'Mr. Pike', role: 'Supporting' }, { name: 'Nora' }, { name: 'Felix' }],
  goal: 'find out which guest took the tiara', clues: 'Rooms: Library, Kitchen, Garden, Ballroom. Drinks: Tea, Punch, Cider, Lemonade. the butler wasnt in the library.',
  beat: 'Beginning: the lights go out at midnight.', tone: 'Mysterious', difficulty: 'medium', reward: { animation: 'Fireworks' }, credit: 'B. Taylor', consent: true,
};

test('the form checks required fields, the same way as the page', async () => {
  const r = await call('/v1/story-submissions', { body: { kind: 'storyline', title: 'Only a title' } });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.body.errors).sort(), ['characters', 'clues', 'consent', 'pitch']);
  const long = await call('/v1/story-submissions', { body: { ...FORM, title: 'x'.repeat(60) } });
  assert.equal(long.status, 200);
  const row = await db.prepare('SELECT title FROM story_submissions WHERE id = ?1').bind(long.body.id).first();
  assert.equal(row.title.length, 40, 'titles are cut to 40 characters');
  const cat = await call('/v1/story-submissions', { body: { kind: 'category', theme: 'not-a-theme', idea: 'Secret Passage' } });
  assert.deepEqual(Object.keys(cat.body.errors), ['theme']);
});

test('a signed-in player: saved with the account and a confirmation with the form copy from noreply', async () => {
  const owner = token('owner-uid', OWNER);
  const ann = token('ann-uid', 'ann@example.com');
  const r = await call('/v1/story-submissions', { auth: ann, body: FORM });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.copy, 'emailed');
  assert.equal(r.body.key, undefined);
  const row = await db.prepare('SELECT user_id, email, consent, consent_text, form FROM story_submissions WHERE id = ?1').bind(r.body.id).first();
  assert.equal(row.user_id, 'ann-uid');
  assert.equal(row.email, 'ann@example.com');
  assert.equal(row.consent, 1);
  assert.match(row.consent_text, /permission/);
  assert.equal(JSON.parse(row.form).clues, FORM.clues, 'the original words are kept as sent');

  const claim = (await call('/admin/v1/replies/claim', { auth: owner, body: { limit: 50 } })).body;
  const mail = claim.replies.find((m) => m.email === 'ann@example.com');
  assert.equal(mail.kind, 'story_received');
  assert.ok(mail.submission.copy.some(([k, v]) => k === 'Title' && v === 'The Midnight Gala'));
  assert.ok(mail.submission.copy.some(([k]) => k === 'Consent'));
  await call('/admin/v1/replies/done', { auth: owner, body: { sent: claim.replies.map((m) => m.id), failed: [] } });

  // Approve: the corrected words go with the puzzle; the original stays.
  const list = (await call('/admin/v1/story-submissions?q=Midnight', { auth: owner })).body;
  assert.ok(list.items.some((i) => i.id === r.body.id));
  const fixed = { ...FORM, clues: 'Rooms: Library, Kitchen, Garden, Ballroom. Drinks: Tea, Punch, Cider, Lemonade. The butler was not in the library.' };
  const ok = await call(`/admin/v1/story-submissions/${r.body.id}/approve`, { auth: owner, body: { polished: { clues: fixed.clues, goal: 'Find out which guest took the tiara.' } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.emailed, 1);
  const claim2 = (await call('/admin/v1/replies/claim', { auth: owner, body: { limit: 50 } })).body;
  const approved = claim2.replies.find((m) => m.email === 'ann@example.com');
  assert.equal(approved.kind, 'story_approved');
  assert.deepEqual(approved.build, { submission: true, theme: 'Mystery' });
  assert.equal(approved.submission.polished.clues, fixed.clues);
  const puzzle = buildStorylinePuzzle({ submission: { form: approved.submission.form, polished: approved.submission.polished }, seed: 'sub-test' });
  assert.equal(puzzle.error, undefined, puzzle.error);
  assert.equal(puzzle.title, 'The Midnight Gala');
  const stored = await call('/admin/v1/replies/puzzle', { auth: owner, body: { id: approved.id, puzzle } });
  assert.equal(stored.body.stored, true, 'in the player\'s Saved puzzles');
  const entry = (await call(`/admin/v1/story-submissions/${r.body.id}`, { auth: owner })).body;
  assert.equal(entry.puzzle.title, 'The Midnight Gala', 'the first puzzle is saved with the entry');
  assert.equal(entry.status, 'approved');
  assert.equal(entry.form.clues, FORM.clues);
  await call('/admin/v1/replies/done', { auth: owner, body: { sent: [approved.id], failed: [] } });

  // Email a copy from the dashboard.
  const copy = await call(`/admin/v1/story-submissions/${r.body.id}/email`, { auth: owner, body: { to: 'editor@example.com' } });
  assert.equal(copy.status, 200);
  const claim3 = (await call('/admin/v1/replies/claim', { auth: owner, body: { limit: 50 } })).body;
  const team = claim3.replies.find((m) => m.email === 'editor@example.com');
  assert.equal(team.kind, 'submission_copy');
  assert.equal(team.puzzle.title, 'The Midnight Gala', 'the copy carries the saved puzzle');
  await call('/admin/v1/replies/done', { auth: owner, body: { sent: claim3.replies.map((m) => m.id), failed: [] } });
});

test('a guest: thank-you, then a copy only to the address they type, once', async () => {
  const owner = token('owner-uid', OWNER);
  const r = await call('/v1/story-submissions', { body: { kind: 'theme', idea: 'Haunted Lighthouse' } });
  assert.equal(r.body.copy, 'offer');
  assert.ok(r.body.key.length >= 20);
  assert.equal((await call('/v1/story-submissions/copy', { body: { id: r.body.id, key: 'wrong'.repeat(5), email: 'g@example.com' } })).status, 410);
  const ok = await call('/v1/story-submissions/copy', { body: { id: r.body.id, key: r.body.key, email: 'G@Example.com' } });
  assert.equal(ok.body.copy, 'emailed');
  assert.equal((await call('/v1/story-submissions/copy', { body: { id: r.body.id, key: r.body.key, email: 'other@example.com' } })).status, 410, 'only once');
  const row = await db.prepare('SELECT email, copy_key FROM story_submissions WHERE id = ?1').bind(r.body.id).first();
  assert.deepEqual(row, { email: 'g@example.com', copy_key: null });
  const claim = (await call('/admin/v1/replies/claim', { auth: owner, body: { limit: 50 } })).body;
  const m = claim.replies.find((x) => x.email === 'g@example.com');
  assert.equal(m.kind, 'story_received');
  assert.equal(m.submission.kind, 'theme');
  await call('/admin/v1/replies/done', { auth: owner, body: { sent: claim.replies.map((x) => x.id), failed: [] } });
});

test('Share an idea storylines are in the database too, and decisions stay in step', async () => {
  const owner = token('owner-uid', OWNER);
  await call('/v1/feedback', { body: { kind: 'idea', topic: 'story', text: 'A pirate ship lost in the fog', theme: 'nautical' } });
  const list = (await call('/admin/v1/story-submissions?q=pirate', { auth: owner })).body;
  assert.equal(list.items.length, 1);
  const s = list.items[0];
  assert.equal(s.source, 'idea box');
  assert.equal(s.themeName, 'Nautical');
  const byTheme = (await call('/admin/v1/story-submissions?q=nautical', { auth: owner })).body;
  assert.ok(byTheme.items.some((i) => i.id === s.id), 'theme names are searchable');
  const no = await call(`/admin/v1/story-submissions/${s.id}/decline`, { auth: owner, body: {} });
  assert.equal(no.status, 200);
  const f = await db.prepare("SELECT status, declined FROM feedback WHERE text = 'A pirate ship lost in the fog'").first();
  assert.deepEqual(f, { status: 'done', declined: 1 });
});

test('deleting an account keeps the entry but drops the link and address', async () => {
  const bo = token('bo-uid', 'bo@example.com');
  const r = await call('/v1/story-submissions', { auth: bo, body: { ...FORM, title: 'Bo story' } });
  const del = await mf.dispatchFetch('https://api.test/v1/account', { method: 'DELETE', headers: { Authorization: `Bearer ${await bo}`, Origin: ORIGIN } });
  assert.ok(del.status < 300, `delete answered ${del.status}`);
  const row = await db.prepare('SELECT user_id, email, title FROM story_submissions WHERE id = ?1').bind(r.body.id).first();
  assert.deepEqual(row, { user_id: null, email: null, title: 'Bo story' });
});
