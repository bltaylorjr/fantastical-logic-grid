// Storylines get one email per submission: when the team approves a story
// idea, the player who asked for an email gets "Congratulations" with the
// first puzzle built from it (built by the sender, stored in their game, sent
// as a PDF). Disapproved, the one email thanks them for their input.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { buildStorylinePuzzle } from '../../scripts/storyline-puzzle.mjs';
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

const STORY = 'A beach rental day. Umbrella Companies: Shady Summers, In the Shade, Beach Bums, Sunbeams, Gotcha Covered. '
  + 'Price: $60, $69, $75, $85, $93. Accessories: Cooling fans, Auto Mister, Bluetooth, Wifi Hotspot, Mini cooler';

test('an approved storyline: one congratulations email, its puzzle built by the sender and stored for the player', async () => {
  const owner = token('owner-uid', OWNER);
  const dee = token('dee-uid', 'dee@example.com');
  const sent = await call('/v1/feedback', { auth: dee, body: { kind: 'idea', topic: 'story', text: STORY, reply: true } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.reply, 'story', 'no thank-you yet: one email per storyline');
  const rows0 = (await db.prepare("SELECT kind, status FROM feedback_replies WHERE email = 'dee@example.com'").all()).results;
  assert.deepEqual(rows0, [{ kind: 'idea_update', status: 'held' }]);

  const item = (await call('/admin/v1/inbox?type=idea&status=new', { auth: owner })).body.items.find((i) => i.text.startsWith('A beach'));
  assert.equal(item.meta.storyEmail, true);

  // Approve is one button: no note, no file.
  const ok = await call(`/admin/v1/feedback/${item.id}/approve`, { auth: owner, body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.emailed, 1);
  assert.equal((await call(`/admin/v1/feedback/${item.id}/approve`, { auth: owner, body: {} })).status, 409, 'only once');
  assert.equal((await call(`/admin/v1/feedback/${item.id}/decline`, { auth: owner, body: {} })).status, 409, 'decided already');

  // The sender is asked to build the puzzle from the player's words.
  const claim = (await call('/admin/v1/replies/claim', { auth: owner, body: { limit: 50 } })).body;
  const emails = claim.replies.filter((r) => r.email === 'dee@example.com');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].kind, 'story_approved');
  assert.ok(emails[0].build, 'the puzzle is to be built');
  assert.equal(emails[0].puzzle, undefined);
  assert.equal(emails[0].uid, undefined, 'the account id never leaves the Worker');

  const puzzle = buildStorylinePuzzle({ text: emails[0].text, theme: emails[0].build.theme, seed: 'storyline-test' });
  assert.equal(puzzle.error, undefined, puzzle.error);
  assert.deepEqual(puzzle.categories[0].items.map((x) => x.label).every((n) => STORY.includes(n)), true, 'the cast comes from the storyline');
  const stored = await call('/admin/v1/replies/puzzle', { auth: owner, body: { id: emails[0].id, puzzle } });
  assert.equal(stored.status, 200, JSON.stringify(stored.body));
  assert.equal(stored.body.stored, true);

  // In the player's game, outside any conversation (the game keeps it in Saved puzzles).
  const mine = (await call('/v1/messages', { auth: dee })).body.puzzles;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, puzzle.title);
  assert.equal(mine[0].conversationId, null);

  await call('/admin/v1/replies/done', { auth: owner, body: { sent: [emails[0].id], failed: [] } });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM feedback_replies WHERE user_id IS NOT NULL').first()).n, 0, 'the account id is not kept once sent');
});

test('a disapproved storyline gets one thank-you for the player\'s input', async () => {
  const owner = token('owner-uid', OWNER);
  const eve = token('eve-uid', 'eve@example.com');
  await call('/v1/feedback', { auth: eve, body: { kind: 'idea', topic: 'story', text: 'A dragon who runs a bakery', reply: true } });
  const item = (await call('/admin/v1/inbox?type=idea&status=new', { auth: owner })).body.items.find((i) => i.text.startsWith('A dragon'));
  const no = await call(`/admin/v1/feedback/${item.id}/decline`, { auth: owner, body: {} });
  assert.equal(no.status, 200, JSON.stringify(no.body));
  assert.equal(no.body.emailed, 1);
  const rows = (await db.prepare("SELECT kind, status, user_id FROM feedback_replies WHERE email = 'eve@example.com'").all()).results;
  assert.deepEqual(rows, [{ kind: 'story_declined', status: 'waiting', user_id: null }]);
  const f = await db.prepare('SELECT status FROM feedback WHERE id = ?1').bind(item.id).first();
  assert.equal(f.status, 'done');
});
