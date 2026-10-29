// Report a problem with a puzzle: the report keeps the puzzle under a tracking
// id; the puzzle doctor's repair marks it addressed, queues the apology email
// with its link for a player who asked, and the link returns the repaired puzzle.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { generatePuzzle } from '../../engine/src/index.js';

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

import { examine, probe } from '../../scripts/puzzle-doctor.mjs';

test('reports are filed by category, checked, repaired, cross-referenced and learned from', async () => {
  const owner = token('owner-uid', OWNER);
  const fay = token('fay-uid', 'fay@example.com');
  const good = generatePuzzle({ difficulty: 'easy', categories: 3, items: 4, seed: 'report-test' });
  const broken = JSON.parse(JSON.stringify(good));
  broken.answerKey.rows[0][1] = broken.answerKey.rows[1][1];

  assert.equal((await call('/v1/puzzle-report', { body: { text: 'x', puzzle: broken } })).status, 400, 'too short');
  assert.equal((await call('/v1/puzzle-report', { body: { text: 'Something is wrong', puzzle: { nope: 1 } } })).status, 400, 'a puzzle that cannot be read');
  assert.equal((await call('/v1/puzzle-report', { body: { kind: 'page', text: 'Something is wrong' } })).status, 400, 'a page issue says where');
  const sent = await call('/v1/puzzle-report', { auth: fay, body: { kind: 'puzzle', text: 'The answer key says the wrong thing', puzzle: broken, image: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', page: 'Puzzle screen: Test', version: '2.0.0', reply: true } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.match(sent.body.tracking, /^PZ-[A-Z2-9]{8}$/);
  assert.equal(sent.body.category, 'puzzle');
  assert.equal(sent.body.reply, 'queued');
  // A Web Page Issue on the same screen and version, then a sound puzzle reported there.
  const page = await call('/v1/puzzle-report', { body: { kind: 'page', text: 'The grid is cut off on my tablet', page: 'Puzzle screen: Another', version: '2.0.0', screen: '800x1280' } });
  assert.equal(page.status, 200);
  assert.match(page.body.tracking, /^WS-[A-Z2-9]{8}$/, 'a web page issue is filed as web structure');
  const anon = await call('/v1/puzzle-report', { body: { kind: 'puzzle', text: 'The last row will not fill in', puzzle: good, page: 'Puzzle screen: Fine', version: '2.0.0' } });
  assert.equal(anon.status, 200);

  const inbox = (await call('/admin/v1/inbox?type=problem&status=new', { auth: owner })).body;
  const item = inbox.items.find((i) => i.report && i.report.tracking === sent.body.tracking);
  assert.equal(item.report.status, 'new');
  assert.match(item.text, new RegExp(sent.body.tracking));

  // The doctor's round: only puzzle reports.
  const claim = (await call('/admin/v1/puzzle-reports/claim', { auth: owner, body: { limit: 5 } })).body;
  assert.equal(claim.reports.length, 2);
  const results = claim.reports.map((r) => ({ id: r.id, ...examine(r.puzzle, claim.playbook) }));
  const done = (await call('/admin/v1/puzzle-reports/done', { auth: owner, body: { results } })).body;
  assert.deepEqual([done.repaired, done.noFault, done.display, done.emailed], [1, 1, 1, 1]);

  // Both categories used together: the sound puzzle is explained by the page issue.
  const list = (await call('/admin/v1/error-tracking', { auth: owner })).body.reports;
  const fine = list.find((r) => r.text.startsWith('The last row'));
  assert.equal(fine.status, 'no_fault');
  assert.equal(fine.findings[0].code, 'display');
  assert.ok(fine.related.includes(page.body.tracking), 'linked to the web page issue');
  const ws = list.find((r) => r.tracking === page.body.tracking);
  assert.equal(ws.category, 'webstructure');
  assert.ok(ws.related.length >= 1, 'the web page issue links back to the puzzle reports');
  const mine = list.find((r) => r.tracking === sent.body.tracking);
  assert.equal(mine.status, 'repaired');
  const detail = (await call(`/admin/v1/error-tracking/${mine.id}`, { auth: owner })).body;
  assert.ok(detail.story.paragraphs.length, 'the storyline as reported');
  assert.ok(detail.repairedStory, 'and as repaired');
  assert.match(detail.image, /^<svg/, 'the picture');
  assert.match(detail.findings[0].text, /answer key/, 'the reason for failure');
  assert.match(detail.note, /rebuilt your puzzle/, 'the correction made');

  // The apology email, with what was found, what was done and the link.
  const mail = await db.prepare("SELECT explain, note, link FROM feedback_replies WHERE email = 'fay@example.com' AND kind = 'problem_repaired'").first();
  assert.ok(mail, 'apology queued');
  assert.match(mail.explain, /answer key/);
  const tokenId = mail.link.split('repaired=')[1];
  assert.match(tokenId, /^[A-Za-z0-9_-]{32}$/);
  const got = await call(`/v1/repaired/${tokenId}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.tracking, sent.body.tracking);
  assert.deepEqual(got.body.puzzle.answerKey, good.answerKey, 'the repaired puzzle has the right answer key');
  assert.equal((await call('/v1/repaired/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status, 404);

  // Learning: the repair is counted for its fault, and the playbook prefers it.
  const learned = (await call('/admin/v1/fault-patterns', { auth: owner })).body;
  const key = learned.patterns.find((p) => p.code === 'answer_key');
  assert.equal(key.repaired, 1);
  assert.ok(learned.playbook.answer_key.length, 'a playbook for that fault');
  assert.ok(learned.patterns.some((p) => p.category === 'webstructure'), 'web page issues are learned too');

  // Self-diagnosis: a fault today's engine no longer makes sends its waiting reports back.
  await db.prepare(`UPDATE puzzle_reports SET status = 'needs_fix', findings = '[{"code":"answer_key","text":"x"}]' WHERE tracking = ?1`).bind(sent.body.tracking).run();
  await db.prepare('UPDATE fault_patterns SET probe_at = NULL, resolved_at = NULL').run();
  const again = (await call('/admin/v1/puzzle-reports/claim', { auth: owner, body: { limit: 5 } })).body;
  assert.ok(again.probes.some((p) => p.code === 'answer_key'), 'the known fault is probed');
  const probes = again.probes.map((p) => ({ key: p.key, ...probe(p, 3, 'test') }));
  const after = (await call('/admin/v1/puzzle-reports/done', { auth: owner, body: { results: [], probes } })).body;
  assert.equal(after.requeued, 1, 'the waiting report goes back for repair');
  assert.equal((await db.prepare('SELECT status FROM puzzle_reports WHERE tracking = ?1').bind(sent.body.tracking).first()).status, 'new');

  // The team closes a web page issue with a note.
  assert.equal((await call(`/admin/v1/error-tracking/${ws.id}/done`, { auth: owner, body: { note: 'The grid now fits small tablets.' } })).status, 200);
});
