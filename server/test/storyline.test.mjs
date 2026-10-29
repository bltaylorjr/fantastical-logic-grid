// Storylines get one email per submission: when the team approves a story
// idea, the player who asked for an email gets one with the first puzzle made
// from it (as a PDF, built by the sender), and the puzzle waits in their game
// for 30 days. Closed without being used, the one email is a plain thank-you.
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

test('an approved storyline sends one email with its puzzle and stores the puzzle 30 days', async () => {
  const owner = token('owner-uid', OWNER);
  const dee = token('dee-uid', 'dee@example.com');
  const sent = await call('/v1/feedback', { auth: dee, body: { kind: 'idea', topic: 'story', text: 'A lighthouse keeper and a missing ship', reply: true } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.reply, 'story', 'no thank-you yet: one email per storyline');
  const rows0 = (await db.prepare("SELECT kind, status FROM feedback_replies WHERE email = 'dee@example.com'").all()).results;
  assert.deepEqual(rows0, [{ kind: 'idea_update', status: 'held' }]);

  const item = (await call('/admin/v1/inbox?type=idea&status=new', { auth: owner })).body.items.find((i) => i.text.startsWith('A lighthouse'));
  assert.equal(item.meta.storyEmail, true);

  const puzzle = generatePuzzle({ difficulty: 'easy', categories: 3, items: 4, seed: 'storyline-test' });
  const file = { format: 'fantastical-logic-grid', version: 1, save: { name: puzzle.title, puzzle } };
  assert.equal((await call(`/admin/v1/feedback/${item.id}/approve`, { auth: owner, body: { note: '' } })).status, 400, 'a note is needed');
  const ok = await call(`/admin/v1/feedback/${item.id}/approve`, { auth: owner, body: { note: 'We made it a winter mystery.', puzzle: file } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.emailed, ok.body.stored], [1, true]);
  assert.equal((await call(`/admin/v1/feedback/${item.id}/approve`, { auth: owner, body: { note: 'Again' } })).status, 409, 'only once');

  // Stored in the player's game for 30 days.
  const mine = (await call('/v1/messages', { auth: dee })).body.puzzles;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, puzzle.title);

  // The sender gets one email with the puzzle to print; nothing else for this submission.
  const claim = (await call('/admin/v1/replies/claim', { auth: owner, body: { limit: 50 } })).body;
  const emails = claim.replies.filter((r) => r.email === 'dee@example.com');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].kind, 'story_approved');
  assert.equal(emails[0].note, 'We made it a winter mystery.');
  assert.deepEqual(emails[0].puzzle.answerKey, puzzle.answerKey, 'the answer key goes in the PDF');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE user_id IS NOT NULL").first()).n, 0, 'the account id is not kept');
});

test('a storyline closed without being used still gets one plain thank-you', async () => {
  const owner = token('owner-uid', OWNER);
  const eve = token('eve-uid', 'eve@example.com');
  await call('/v1/feedback', { auth: eve, body: { kind: 'idea', topic: 'story', text: 'A dragon who runs a bakery', reply: true } });
  const item = (await call('/admin/v1/inbox?type=idea&status=new', { auth: owner })).body.items.find((i) => i.text.startsWith('A dragon'));
  assert.equal((await call(`/admin/v1/feedback/${item.id}`, { auth: owner, body: { status: 'done' } })).status, 200);
  const rows = (await db.prepare("SELECT kind, status FROM feedback_replies WHERE email = 'eve@example.com'").all()).results;
  assert.deepEqual(rows, [{ kind: 'idea', status: 'waiting' }]);
});
