// Educator puzzle packages (educators.js): the request form, the school email
// code, the admin's approve and decline, and the GitHub Action's claim and
// done calls. Run with `npm test` in server/.
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
const TOKEN = 'break-glass-token-for-educator-tests';
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN, OWNER_EMAIL: 'owner@example.com' },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

async function call(path, { auth, method, body } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null), cors: r.headers.get('Access-Control-Allow-Origin') };
}
const admin = (path, body) => call(`/admin/v1/${path}`, { auth: TOKEN, body });
const form = ({ educator = {}, ...over } = {}) => ({
  educator: { name: 'Ms Rivera', email: 'rivera@lincoln.k12.ca.us', school: 'Lincoln Elementary', role: 'Classroom teacher', ...educator },
  grade: '4', count: 3, difficulty: 'progressive', themes: ['pets/any', 'sports'], agree: true, ...over,
});
const codeFor = async (ref) => (await admin('educators/claim', {})).body.mails.find((m) => m.ref === ref);

test('the form is open and says how many puzzles it allows', async () => {
  const r = await call('/v1/educators/options');
  assert.equal(r.status, 200);
  assert.equal(r.cors, ORIGIN);
  assert.deepEqual(r.body, { enabled: true, maxPuzzles: 30, personalEmail: false });
});

test('requests are checked: agreement, puzzle count, school email', async () => {
  assert.equal((await call('/v1/educators/request', { body: form({ agree: false }) })).status, 400);
  assert.equal((await call('/v1/educators/request', { body: form({ count: 40 }) })).status, 400);
  const personal = await call('/v1/educators/request', { body: form({ educator: { email: 'teacher@gmail.com' } }) });
  assert.equal(personal.status, 400);
  assert.equal(personal.body.error, 'school_email');
  const custom = await call('/v1/educators/request', { body: form({ source: 'custom', custom: { theme: 'Space', categories: [{ name: 'Planet', items: ['Mars'] }] } }) });
  assert.equal(custom.status, 400);
  assert.match(custom.body.message, /at least 3/);
});

test('a teacher confirms the school email with the code, and the team approves', async () => {
  // The teacher came by the educator campaign's Facebook group post.
  const tags = { c: 'educators-2026', s: 'facebook', m: 'community', k: 'teacher-groups' };
  const sent = await call('/v1/educators/request', { body: { ...form(), campaign: tags } });
  assert.equal(sent.status, 200);
  const { ref } = sent.body;
  assert.match(ref, /^[A-Z2-9]{10}$/);
  assert.equal((await call(`/v1/educators/status?ref=${ref}`)).body.status, 'unverified');
  // The code email is waiting for the Action, with the code; the database only keeps a hash.
  const mail = await codeFor(ref);
  assert.equal(mail.kind, 'verify');
  assert.equal(mail.email, 'rivera@lincoln.k12.ca.us');
  assert.match(mail.code, /^\d{6}$/);
  const row = await db.prepare('SELECT code_hash FROM educator_requests WHERE ref = ?1').bind(ref).first();
  assert.notEqual(row.code_hash, mail.code);
  assert.equal((await admin('educators/done', { mails: { sent: [mail.id] } })).status, 200);
  assert.equal((await admin('educators/claim', {})).body.mails.length, 0);

  // Not confirmed yet: the team cannot approve.
  assert.equal((await admin(`educators/${mail.id}/approve`, {})).status, 409);
  const wrong = await call('/v1/educators/verify', { body: { ref, code: mail.code === '000000' ? '111111' : '000000' } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /5 tries left/);
  assert.deepEqual((await call('/v1/educators/verify', { body: { ref, code: mail.code } })).body, { status: 'pending' });

  const list = (await admin('educators?status=pending')).body;
  assert.equal(list.counts.pending, 1);
  const req = list.requests.find((r) => r.ref === ref);
  assert.equal(req.domainKind, 'school');
  assert.equal(req.request.grade, '4');
  assert.deepEqual(req.request.themes, ['pets/any', 'sports/any']);
  assert.equal((await admin('analytics?days=7')).body.review.educators, 1);

  assert.equal((await admin(`educators/${req.id}/approve`, { note: 'Lovely school' })).body.status, 'approved');
  const work = (await admin('educators/claim', {})).body;
  const build = work.builds.find((b) => b.ref === ref);
  assert.equal(build.email, 'rivera@lincoln.k12.ca.us');
  assert.equal(build.request.count, 3);
  assert.deepEqual(work.usedStories, []);
  assert.equal((await call(`/v1/educators/status?ref=${ref}`)).body.status, 'building');
  // A second claim does not hand out the same build again.
  assert.equal((await admin('educators/claim', {})).body.builds.length, 0);
  await admin('educators/done', { builds: [{ id: build.id, ok: true, puzzles: 3, storyIds: ['pets|a', 'sports|b', 'pets|c'] }] });
  assert.equal((await call(`/v1/educators/status?ref=${ref}`)).body.status, 'sent');
  // Each step is counted for the ad the teacher came from, and only for that ad.
  const counts = (await db.prepare("SELECT campaign, source, medium, content, event, SUM(n) AS n FROM campaign_stats WHERE event LIKE 'edu_%' GROUP BY campaign, source, medium, content, event ORDER BY event").all()).results;
  assert.deepEqual(counts, ['edu_confirm', 'edu_request', 'edu_sent'].map((event) => ({ campaign: 'educators-2026', source: 'facebook', medium: 'community', content: 'teacher-groups', event, n: 1 })));
  assert.equal(JSON.parse((await db.prepare('SELECT campaign FROM educator_requests WHERE ref = ?1').bind(ref).first()).campaign).k, 'teacher-groups');

  // The next package is told which stories were used.
  const next = await call('/v1/educators/request', { body: form({ educator: { email: 'kim@lincoln.k12.ca.us' } }) });
  const m2 = await codeFor(next.body.ref);
  await call('/v1/educators/verify', { body: { ref: next.body.ref, code: m2.code } });
  await admin(`educators/${m2.id}/approve`, {});
  const w2 = (await admin('educators/claim', {})).body;
  assert.deepEqual(w2.usedStories.sort(), ['pets|a', 'pets|c', 'sports|b']);
  // A failed build is tried again, then marked failed for the team.
  const id2 = w2.builds[0].id;
  await admin('educators/done', { builds: [{ id: id2, ok: false, error: 'timeout' }] });
  assert.equal((await call(`/v1/educators/status?ref=${next.body.ref}`)).body.status, 'approved');
  // A request without campaign tags is not counted; made-up tags fold into (other).
  assert.equal((await db.prepare("SELECT SUM(n) AS n FROM campaign_stats WHERE event = 'edu_request'").first()).n, 1);
  const odd = await call('/v1/educators/request', { body: { ...form({ educator: { email: 'pat@lincoln.k12.ca.us' } }), campaign: { c: 'my-own-thing', s: 'spam', m: 'x', k: 'y' } } });
  assert.equal(odd.status, 200);
  assert.equal((await db.prepare("SELECT campaign FROM campaign_stats WHERE event = 'edu_request' AND campaign != 'educators-2026'").first()).campaign, '(other)');
});

test('the feedback section opens with the package email link: survey, ideas and the team\'s answer', async () => {
  const sent = await call('/v1/educators/request', { body: form({ educator: { email: 'park@maple.k12.or.us', name: 'Mr Park', school: 'Maple Middle' } }) });
  const { ref } = sent.body;
  const m = await codeFor(ref);
  await admin('educators/done', { mails: { sent: [m.id] } });
  await call('/v1/educators/verify', { body: { ref, code: m.code } });
  await admin(`educators/${m.id}/approve`, {});
  const build = (await admin('educators/claim', {})).body.builds.find((b) => b.ref === ref);
  const key = build.feedbackKey;
  assert.match(key, /^[A-Z2-9]{24}$/);
  // Locked until the package has been emailed.
  assert.equal((await call('/v1/educators/feedback/open', { body: { ref, key } })).status, 403);
  // A build that runs again keeps the same key.
  await admin('educators/done', { builds: [{ id: build.id, ok: false, error: 'email' }] });
  const again = (await admin('educators/claim', {})).body.builds.find((b) => b.ref === ref);
  assert.equal(again.feedbackKey, key);
  await admin('educators/done', { builds: [{ id: build.id, ok: true, puzzles: 3, storyIds: ['x|1'] }] });
  const row = await db.prepare('SELECT feedback_key, feedback_hash FROM educator_requests WHERE ref = ?1').bind(ref).first();
  assert.equal(row.feedback_key, null);
  assert.ok(row.feedback_hash && row.feedback_hash !== key);

  assert.equal((await call('/v1/educators/feedback/open', { body: { ref, key: key.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) } })).status, 403);
  const open = (await call('/v1/educators/feedback/open', { body: { ref, key } })).body;
  assert.equal(open.unlocked, true);
  assert.equal(open.name, 'Mr Park');
  assert.equal(open.survey, null);
  assert.equal((await call('/v1/educators/feedback/survey', { body: { ref, key, answers: { fit: 2 } } })).status, 400);
  const sv = (await call('/v1/educators/feedback/survey', { body: { ref, key, answers: { fit: 2, engage: 3, again: 3, use: [0, 3], wants: [1], comment: 'My class loved it.' } } })).body;
  assert.deepEqual(sv.survey.answers.use, [0, 3]);
  // Answering again replaces the earlier answers.
  await call('/v1/educators/feedback/survey', { body: { ref, key, answers: { fit: 1, engage: 4, again: 3, comment: 'My class loved it.' } } });
  assert.equal((await call('/v1/educators/feedback/send', { body: { ref, key, kind: 'wish', text: 'More space puzzles' } })).status, 400);
  const fb = (await call('/v1/educators/feedback/send', { body: { ref, key, kind: 'idea', text: 'More space puzzles, please!' } })).body;
  assert.equal(fb.items.length, 1);
  assert.equal(fb.items[0].status, 'new');

  const list = (await admin('educators/feedback?status=new')).body;
  const item = list.items.find((x) => x.ref === ref);
  assert.equal(item.kind, 'idea');
  assert.equal(item.school, 'Maple Middle');
  assert.equal(list.surveys, 1);
  assert.equal((await admin(`educators/feedback/${item.id}/address`, { note: '' })).status, 400);
  assert.equal((await admin(`educators/feedback/${item.id}/address`, { note: 'We added a space theme in version 1.12.' })).status, 200);
  const work = (await admin('educators/claim', {})).body;
  const reply = work.replies.find((r) => r.ref === ref);
  assert.equal(reply.email, 'park@maple.k12.or.us');
  assert.equal(reply.note, 'We added a space theme in version 1.12.');
  await admin('educators/done', { replies: { sent: [reply.id] } });
  assert.equal((await admin('educators/claim', {})).body.replies.length, 0);
  const after = (await call('/v1/educators/feedback/open', { body: { ref, key } })).body;
  assert.equal(after.items[0].reply, 'We added a space theme in version 1.12.');
  assert.equal(after.survey.answers.fit, 1);

  const results = (await admin('educators/survey')).body;
  assert.equal(results.responses, 1);
  const fit = results.questions.find((q) => q.id === 'fit');
  assert.equal(fit.counts[1], 1);
  assert.equal(results.comments[0].text, 'My class loved it.');
});

test('declining emails the educator the note; wrong codes lock; resend gives a new code', async () => {
  const sent = await call('/v1/educators/request', { body: form({ educator: { email: 'lee@hillside.edu' } }) });
  const { ref } = sent.body;
  const first = await codeFor(ref);
  await admin('educators/done', { mails: { sent: [first.id] } });
  for (let i = 0; i < 6; i++) await call('/v1/educators/verify', { body: { ref, code: first.code === '123456' ? '654321' : '123456' } });
  assert.equal((await call('/v1/educators/verify', { body: { ref, code: first.code } })).body.error, 'locked');
  assert.equal((await call('/v1/educators/resend', { body: { ref } })).body.resent, true);
  const again = await codeFor(ref);
  assert.equal(again.kind, 'verify');
  assert.equal((await call('/v1/educators/verify', { body: { ref, code: again.code } })).body.status, 'pending');
  assert.equal((await admin(`educators/${first.id}/decline`, { note: 'We could not find this school.' })).body.status, 'declined');
  const mail = (await admin('educators/claim', {})).body.mails.find((m) => m.ref === ref);
  assert.equal(mail.kind, 'declined');
  assert.equal(mail.note, 'We could not find this school.');
  assert.equal(mail.code, undefined);
});

test('personal addresses can be allowed, and are marked for the team', async () => {
  assert.equal((await admin('settings', { key: 'educator_personal_email', value: true })).status, 200);
  const sent = await call('/v1/educators/request', { body: form({ educator: { email: 'homeschool@gmail.com', role: 'Homeschool educator' } }) });
  assert.equal(sent.status, 200);
  const row = await db.prepare('SELECT domain_kind FROM educator_requests WHERE ref = ?1').bind(sent.body.ref).first();
  assert.equal(row.domain_kind, 'personal');
  // Three requests a day per address.
  await call('/v1/educators/request', { body: form({ educator: { email: 'homeschool@gmail.com', role: 'Homeschool educator' } }) });
  await call('/v1/educators/request', { body: form({ educator: { email: 'homeschool@gmail.com', role: 'Homeschool educator' } }) });
  assert.equal((await call('/v1/educators/request', { body: form({ educator: { email: 'homeschool@gmail.com', role: 'Homeschool educator' } }) })).status, 429);
  assert.equal((await admin('settings', { key: 'educators_enabled', value: false })).status, 200);
  assert.equal((await call('/v1/educators/request', { body: form({ educator: { email: 'z@acme.org' } }) })).status, 503);
});

test('the claim and done calls need the owner', async () => {
  assert.equal((await call('/admin/v1/educators/claim', { body: {} })).status, 401);
  assert.equal((await call('/admin/v1/educators/done', { body: {} })).status, 401);
});
