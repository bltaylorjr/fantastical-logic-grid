// Admin dashboard tests: sign-in and roles, audit log, rate limits, settings
// that change the game, announcements, players and moderation. Run with
// `npm test` in server/.
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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 40, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks),
      // A trailing line break, as a secret pasted into the Cloudflare dashboard can have: it must still match.
      ADMIN_TOKEN: `${TOKEN}\n`,
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
const player = (uid) => signer.token({ sub: uid });

test('the dashboard is served with strict security headers', async () => {
  const r = await call('/admin/', { origin: null });
  assert.equal(r.status, 200);
  assert.match(r.text, /Logic Grid Admin/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const js = await call('/admin/admin.js', { origin: null });
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await call('/admin/README.md', { origin: null })).status, 404);
  const cfg = await call('/admin/v1/client-config');
  assert.equal(cfg.body.firebaseApiKey, 'test-web-key');
});

test('only confirmed admins and the break-glass key get in, and refusals are logged', async () => {
  assert.equal((await call('/admin/v1/me')).status, 401);
  assert.equal((await call('/admin/v1/me', { auth: 'wrong-token' })).status, 401);
  const stranger = await call('/admin/v1/me', { auth: idToken('u-x', 'someone@example.com') });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.error, 'not_admin');
  const unverified = await call('/admin/v1/me', { auth: idToken('owner-uid', OWNER, false) });
  assert.equal(unverified.body.error, 'verify_email');
  const me = await call('/admin/v1/me', { auth: owner() });
  assert.deepEqual([me.status, me.body.role], [200, 'owner']);
  const glass = await call('/admin/v1/me', { auth: TOKEN });
  assert.deepEqual([glass.body.email, glass.body.role], ['break-glass token', 'owner']);
  // No CORS: the game's site cannot read admin replies.
  assert.equal(me.headers.get('access-control-allow-origin'), null);
  const { results } = await db.prepare('SELECT actor, action, status FROM admin_audit ORDER BY id').all();
  assert.ok(results.some((r) => r.actor === 'unknown' && r.status === 401));
  assert.ok(results.some((r) => r.actor === OWNER && r.action === 'me' && r.status === 200));
  assert.ok(results.some((r) => r.actor === 'break-glass token'));
});

test('roles: the owner adds admins; each role only reaches its own tools', async () => {
  assert.equal((await call('/admin/v1/admins', { auth: owner(), body: { email: 'Mod@Example.com', role: 'moderator' } })).status, 200);
  assert.equal((await call('/admin/v1/admins', { auth: owner(), body: { email: 'view@example.com', role: 'viewer' } })).status, 200);
  assert.equal((await call('/admin/v1/admins', { auth: owner(), body: { email: 'x@example.com', role: 'owner' } })).status, 400);
  const mod = idToken('mod-uid', 'mod@example.com');
  const viewer = idToken('view-uid', 'view@example.com');
  assert.equal((await call('/admin/v1/me', { auth: mod })).body.role, 'moderator');
  assert.equal((await call('/admin/v1/analytics', { auth: viewer })).status, 200);
  // Viewers see the player list, but only names, dates and counts.
  const seen = await call('/admin/v1/players', { auth: viewer });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.ids, false);
  assert.ok(seen.body.players.every((p) => !('uid' in p)));
  assert.equal((await call('/admin/v1/players/someone', { auth: viewer })).status, 403);
  assert.equal((await call('/admin/v1/players', { auth: mod })).status, 200);
  assert.equal((await call('/admin/v1/settings', { auth: mod, body: { key: 'races_enabled', value: false } })).status, 403);
  assert.equal((await call('/admin/v1/admins', { auth: mod })).status, 403);
  const list = await call('/admin/v1/admins', { auth: owner() });
  assert.equal(list.body.owner, OWNER);
  assert.deepEqual(list.body.admins.map((a) => a.email).sort(), ['mod@example.com', 'view@example.com']);
  assert.equal((await call('/admin/v1/admins/remove', { auth: owner(), body: { email: 'view@example.com' } })).status, 200);
  assert.equal((await call('/admin/v1/me', { auth: viewer })).status, 403);
});

test('settings switch game features off and back on', async () => {
  const off = await call('/admin/v1/settings', { auth: owner(), body: { key: 'races_enabled', value: false } });
  assert.equal(off.status, 200);
  assert.equal((await call('/v1/profile', { auth: player('p-race'), method: 'PUT', body: { screenName: 'Racer One' } })).status, 200);
  const race = await call('/v1/races/find', { auth: player('p-race'), body: {} });
  assert.deepEqual([race.status, race.body.error], [503, 'switched_off']);
  assert.equal((await call('/v1/config')).body.features.races, false);
  await call('/admin/v1/settings', { auth: owner(), body: { key: 'races_enabled', value: true } });
  assert.equal((await call('/v1/races/find', { auth: player('p-race'), body: {} })).body.error, 'no_open_races');

  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'daily_tts_cap', value: 5000 } })).status, 400);
  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'daily_tts_cap', value: 120 } })).status, 200);
  assert.equal((await call('/v1/health?deep=1')).body.voiceCap, 120);

  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'disabled_themes', value: ['no-such-theme'] } })).status, 400);
  const themes = (await call('/admin/v1/settings', { auth: owner() })).body.themes;
  assert.equal((await call('/admin/v1/settings', { auth: owner(), body: { key: 'disabled_themes', value: [themes[0].id] } })).status, 200);
  assert.deepEqual((await call('/v1/config')).body.disabledThemes, [themes[0].id]);

  await call('/admin/v1/settings', { auth: owner(), body: { key: 'blocked_words', value: ['grumble'] } });
  const name = await call('/v1/profile', { auth: player('p-word'), method: 'PUT', body: { screenName: 'Big Grumble' } });
  assert.equal(name.body.error, 'name_blocked');

  const audit = await call('/admin/v1/audit', { auth: owner() });
  const change = audit.body.entries.find((e) => e.action === 'settings.change' && e.target === 'daily_tts_cap' && e.status === 200);
  assert.deepEqual(change.detail, { from: 300, to: 120 });
});

test('sound, voice and picture choices reach the game', async () => {
  // Uses the break-glass token: the owner's per-minute limit is spent above.
  let cfg = (await call('/v1/config')).body;
  assert.deepEqual(cfg.game, { voiceSource: 'server', readAloud: true, portraitStyle: 'notionists', confetti: true, aiPictures: 'scene', celebrations: ['confetti'], celebrateRandom: false, supportUrl: '' });
  assert.deepEqual(cfg.defaults, { sound: true, volume: 60, music: true, musicVolume: 40 });
  assert.equal(cfg.features.errorReports, true);
  assert.equal(cfg.features.feedback, true);
  assert.equal(cfg.features.pictures, true);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'voice_source', value: 'openai' } })).status, 400);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'voice_source', value: 'device' } })).status, 200);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'portrait_style', value: 'lorelei' } })).status, 200);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'default_music', value: false } })).status, 200);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'default_volume', value: 101 } })).status, 400);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'picture_model', value: 'bad model!' } })).status, 400);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'picture_model', value: '@cf/black-forest-labs/flux-2' } })).status, 200);
  assert.equal((await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'gemini_voice_model', value: '' } })).status, 400);
  cfg = (await call('/v1/config')).body;
  assert.equal(cfg.game.voiceSource, 'device');
  assert.equal(cfg.game.portraitStyle, 'lorelei');
  assert.equal(cfg.defaults.music, false);
  const listed = await call('/admin/v1/settings', { auth: TOKEN });
  assert.deepEqual(listed.body.settings.find((x) => x.key === 'ai_pictures').options.map((o) => o.value), ['none', 'scene', 'all']);
  assert.deepEqual(listed.body.services, { gemini: false, pictures: false });
  // No Workers AI binding here: the game is told to use its built-in art.
  assert.equal((await call('/v1/picture', { body: { prompt: 'A lighthouse at dusk', kind: 'scene' } })).body.error, 'not_set_up');
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'ai_pictures', value: 'none' } });
  assert.equal((await call('/v1/picture', { body: { prompt: 'A lighthouse at dusk', kind: 'scene' } })).body.error, 'switched_off');
  assert.equal((await call('/v1/config')).body.features.pictures, false);
});

test('ideas and problems arrive in separate boxes', async () => {
  assert.equal((await call('/v1/feedback', { body: { kind: 'idea', topic: 'story', text: 'A pirate ship lost in the fog! Write me at a@b.co', platform: 'web', version: '1.6.0' } })).status, 200);
  assert.equal((await call('/v1/feedback', { body: { kind: 'problem', topic: 'sound', text: 'The music stops after a while.' } })).status, 200);
  assert.equal((await call('/v1/feedback', { body: { kind: 'problem', text: 'hi' } })).status, 400);
  assert.equal((await call('/v1/feedback', { body: { kind: 'spam', text: 'Buy things now' } })).status, 400);
  const ideas = await call('/admin/v1/feedback?kind=idea', { auth: TOKEN });
  assert.equal(ideas.body.items.length, 1);
  assert.equal(ideas.body.items[0].topic, 'story');
  assert.match(ideas.body.items[0].text, /<email>/);
  assert.deepEqual(ideas.body.waiting, { idea: 1, problem: 1 });
  const problems = await call('/admin/v1/feedback?kind=problem', { auth: TOKEN });
  assert.equal(problems.body.items[0].topic, 'sound');
  const id = problems.body.items[0].id;
  assert.equal((await call(`/admin/v1/feedback/${id}`, { auth: TOKEN, body: { status: 'done' } })).status, 200);
  assert.equal((await call('/admin/v1/feedback?kind=problem', { auth: TOKEN })).body.items.length, 0);
  assert.equal((await call('/admin/v1/feedback?kind=problem&status=done', { auth: TOKEN })).body.items.length, 1);
  assert.equal((await call(`/admin/v1/feedback/${id}`, { auth: idToken('owner-addr-uid', OWNER), body: { status: 'addressed' } })).status, 400, 'addressed needs a note');
  assert.equal((await call(`/admin/v1/feedback/${id}`, { auth: idToken('owner-addr-uid', OWNER), body: { status: 'addressed', note: '  Fixed the music   loop in 1.7.1. ' } })).status, 200);
  const addressed = (await call('/admin/v1/feedback?kind=problem&status=addressed', { auth: idToken('owner-addr-uid', OWNER) })).body;
  assert.deepEqual(addressed.items.map((x) => [x.status, x.note]), [['addressed', 'Fixed the music loop in 1.7.1.']]);
  assert.equal(addressed.waiting.problem, undefined, 'addressed is not waiting');
  assert.equal((await call(`/admin/v1/feedback/${id}`, { auth: TOKEN, body: { status: 'delete' } })).status, 200);
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'feedback_enabled', value: false } });
  assert.equal((await call('/v1/feedback', { body: { kind: 'idea', text: 'More dragons please' } })).status, 503);
  assert.equal((await call('/v1/config')).body.features.feedback, false);
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'feedback_enabled', value: true } });
});

test('signed-in players with a confirmed email can get a thank-you email', async () => {
  const send = (kind, auth, reply = true) => call('/v1/feedback', { auth, body: { kind, topic: 'other', text: 'More dragons, please!', reply } });
  // Anonymous, unconfirmed, or not asked for: saved, but no email.
  assert.equal((await send('idea', undefined)).body.reply, 'signed_out');
  assert.equal((await send('idea', idToken('p-new', 'new@example.com', false))).body.reply, 'unverified');
  assert.equal((await send('idea', idToken('p1', 'p1@example.com'), false)).body.reply, 'none');
  assert.equal((await send('idea', 'not.a.token')).body.reply, 'signed_out');
  // One note per player per kind a day.
  assert.equal((await send('idea', idToken('p1', 'P1@Example.com'))).body.reply, 'queued');
  assert.equal((await send('idea', idToken('p1', 'p1@example.com'))).body.reply, 'limit');
  assert.equal((await send('problem', idToken('p1', 'p1@example.com'))).body.reply, 'queued');
  const row = await db.prepare("SELECT * FROM feedback_replies WHERE kind = 'idea'").first();
  assert.equal(row.email, 'p1@example.com');
  assert.ok(!JSON.stringify(row).includes('p1"'), 'the account id is not stored');
  // Only the owner (the GitHub Action's break-glass key) can claim them.
  assert.equal((await call('/admin/v1/replies/claim', { auth: idToken('p1', 'p1@example.com'), body: {} })).status, 403);
  const claim = (await call('/admin/v1/replies/claim', { auth: TOKEN, body: { limit: 10 } })).body;
  assert.equal(claim.off, false);
  assert.deepEqual(claim.replies.map((r) => r.kind).sort(), ['idea', 'problem'], 'update emails wait for the team');
  assert.ok(claim.replies.every((r) => r.text === 'More dragons, please!'), 'the note quotes what the player wrote');
  assert.equal((await call('/admin/v1/replies/claim', { auth: TOKEN, body: {} })).body.replies.length, 0, 'claimed notes are not handed out twice');
  const [a, b] = claim.replies;
  assert.deepEqual((await call('/admin/v1/replies/done', { auth: TOKEN, body: { sent: [a.id], failed: [b.id] } })).body, { sent: 1, failed: 1 });
  const sentRow = await db.prepare('SELECT email, text FROM feedback_replies WHERE id = ?1').bind(a.id).first();
  assert.equal(sentRow.email, null, 'address removed once sent');
  assert.equal(sentRow.text, null, 'the player\'s words removed once sent');
  assert.equal((await db.prepare('SELECT status FROM feedback_replies WHERE id = ?1').bind(b.id).first()).status, 'waiting', 'a failed note is tried again');
  const counts = (await call('/admin/v1/feedback?kind=idea', { auth: TOKEN })).body.replies;
  assert.equal(counts.sentToday, 1);
  assert.equal(counts.waiting, 1);
  // The daily cap for everyone.
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'feedback_reply_daily_cap', value: 2 } });
  assert.equal((await send('idea', idToken('p2', 'p2@example.com'))).body.reply, 'limit');
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'feedback_reply_daily_cap', value: 100 } });
  // The switch: off drops waiting notes and their addresses.
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'feedback_replies_enabled', value: false } });
  assert.equal((await call('/v1/config')).body.features.feedbackReplies, false);
  assert.equal((await send('idea', idToken('p3', 'p3@example.com'))).body.reply, 'off');
  const off = (await call('/admin/v1/replies/claim', { auth: TOKEN, body: {} })).body;
  assert.equal(off.off, true);
  assert.equal(off.dropped, 5, 'the waiting note and the four held updates');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM feedback_replies WHERE email IS NOT NULL').first()).n, 0);
  await call('/admin/v1/settings', { auth: TOKEN, body: { key: 'feedback_replies_enabled', value: true } });
  // An empty claim is not written to the audit log (it runs every 15 minutes).
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'replies.claim'").first()).n;
  await call('/admin/v1/replies/claim', { auth: TOKEN, body: {} });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'replies.claim'").first()).n, before);
  await db.prepare('DELETE FROM feedback_replies').run();
});

test('"Email me an update": the team marking it addressed emails the player their words and the note', async () => {
  const boss = idToken('up-owner', OWNER); // its own rate-limit bucket
  const send = (kind, uid, text) => call('/v1/feedback', { auth: idToken(uid, `${uid}@example.com`), body: { kind, topic: 'other', text, reply: true } });
  const sent = await send('problem', 'up1', 'The grid scrolls twice on my tablet.');
  assert.equal(sent.body.reply, 'queued');
  assert.equal(sent.body.update, true);
  assert.equal((await send('idea', 'up2', 'A pirate ship lost in the fog.')).body.update, true);
  assert.equal((await call('/v1/feedback', { body: { kind: 'idea', topic: 'other', text: 'No account here.', reply: true } })).body.update, false);
  const fb = async (text) => (await db.prepare('SELECT id FROM feedback WHERE text = ?1').bind(text).first()).id;
  const problemId = await fb('The grid scrolls twice on my tablet.');
  const ideaId = await fb('A pirate ship lost in the fog.');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE id = ?1 AND conversation_id IS NULL').bind(problemId).first()).n, 1, 'the feedback row itself stays unlinked');
  // The thank-you notes go now; the updates wait.
  const first = (await call('/admin/v1/replies/claim', { auth: boss, body: {} })).body.replies;
  assert.deepEqual(first.map((r) => r.kind).sort(), ['idea', 'problem']);
  await call('/admin/v1/replies/done', { auth: boss, body: { sent: first.map((r) => r.id) } });
  // Marked addressed: the update is queued with the note.
  const marked = await call(`/admin/v1/feedback/${problemId}`, { auth: boss, body: { status: 'addressed', note: 'Fixed the grid height in version 1.7.1.' } });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.emailed, 1);
  // Closed without a fix: no update, and its address and words go.
  assert.equal((await call(`/admin/v1/feedback/${ideaId}`, { auth: boss, body: { status: 'done' } })).body.emailed, 0);
  const dropped = await db.prepare("SELECT status, email, text FROM feedback_replies WHERE feedback_id = ?1").bind(ideaId).first();
  assert.deepEqual({ ...dropped }, { status: 'dropped', email: null, text: null });
  const update = (await call('/admin/v1/replies/claim', { auth: boss, body: {} })).body.replies;
  assert.equal(update.length, 1);
  assert.equal(update[0].kind, 'problem_update');
  assert.equal(update[0].email, 'up1@example.com');
  assert.equal(update[0].text, 'The grid scrolls twice on my tablet.');
  assert.equal(update[0].note, 'Fixed the grid height in version 1.7.1.');
  await call('/admin/v1/replies/done', { auth: boss, body: { sent: [update[0].id] } });
  // Marking it again does not send a second email.
  assert.equal((await call(`/admin/v1/feedback/${problemId}`, { auth: boss, body: { status: 'addressed', note: 'Again.' } })).body.emailed, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM feedback_replies WHERE email IS NOT NULL OR text IS NOT NULL OR note IS NOT NULL').first()).n, 0, 'nothing about the player is kept once sent');
  await db.prepare('DELETE FROM feedback_replies').run();
});

test('communication: players and the team write to each other, with one inbox for everything', async () => {
  const boss = idToken('comm-owner', OWNER); // its own rate-limit bucket
  const mod = idToken('comm-mod', 'comm-mod@example.com');
  const view = idToken('comm-view', 'comm-view@example.com');
  await call('/admin/v1/admins', { auth: boss, body: { email: 'comm-mod@example.com', role: 'moderator' } });
  await call('/admin/v1/admins', { auth: boss, body: { email: 'comm-view@example.com', role: 'viewer' } });
  const ann = idToken('ann-uid', 'ann@example.com');
  await db.prepare("INSERT OR REPLACE INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES ('ann-uid', 'Puzzle Ann', 'puzzleann', 1, 1)").run();

  // Messages need a sign-in.
  assert.equal((await call('/v1/messages')).status, 401);
  assert.deepEqual((await call('/v1/messages', { auth: ann })).body.conversations, []);
  // A player writes to the team; email addresses and links are blanked.
  const sent = await call('/v1/messages', { auth: ann, body: { topic: 'question', text: 'How do I print a puzzle? Mail me at ann@example.com' } });
  assert.equal(sent.status, 200);
  const convId = sent.body.id;
  assert.equal((await call('/v1/messages', { auth: ann, body: { text: 'x' } })).status, 400, 'too short');
  // An idea with "let the team reply" starts a conversation linked to that idea only.
  const idea = await call('/v1/feedback', { auth: ann, body: { kind: 'idea', topic: 'story', text: 'A lighthouse keeper mystery', talk: true } });
  assert.equal(idea.body.talk, 'linked');
  const anon = await call('/v1/feedback', { body: { kind: 'problem', topic: 'sound', text: 'The music skips a beat', talk: true } });
  assert.equal(anon.body.talk, 'signed_out');
  assert.equal((await db.prepare("SELECT conversation_id FROM feedback WHERE text LIKE 'The music%'").first()).conversation_id, null, 'other feedback stays anonymous');
  await db.prepare("INSERT INTO app_errors (day, fingerprint, platform, version, kind, message, place) VALUES (?1, 'fp-comm', 'web', '1.0', 'error', 'grid is undefined', 'app.js:1')").bind(new Date().toISOString().slice(0, 10)).run();

  // One inbox. Viewers see error reports and the email log, not what players wrote.
  const all = (await call('/admin/v1/inbox?type=all&status=new', { auth: mod })).body;
  const types = new Set(all.items.map((i) => i.type));
  for (const t of ['message', 'idea', 'problem', 'error']) assert.ok(types.has(t), `the inbox lists ${t}`);
  assert.equal(all.counts.unread, 2);
  const msg = all.items.find((i) => i.type === 'message' && i.id === convId);
  assert.equal(msg.meta.name, 'Puzzle Ann');
  assert.match(msg.text, /<email>/);
  const seen = (await call('/admin/v1/inbox?type=all', { auth: view })).body;
  assert.deepEqual([...new Set(seen.items.map((i) => i.type))].sort(), ['error']);
  assert.equal((await call(`/admin/v1/conversations/${convId}`, { auth: view })).status, 403);
  assert.equal((await call(`/admin/v1/conversations/${convId}/reply`, { auth: view, body: { text: 'Hi' } })).status, 403, 'viewers cannot send');
  // Filters and search.
  assert.ok((await call('/admin/v1/inbox?type=idea', { auth: mod })).body.items.every((i) => i.type === 'idea'));
  const found = (await call('/admin/v1/inbox?type=all&q=lighthouse', { auth: mod })).body.items;
  assert.deepEqual([...new Set(found.map((i) => i.type))].sort(), ['idea', 'message']);
  assert.equal((await call('/admin/v1/inbox?type=all&q=100%25', { auth: mod })).body.items.length, 0, 'a % in the search is not a wildcard');
  // Addressed: a problem with a note, and an error fixed in a version, leave "new" and show under "addressed".
  const prob = all.items.find((i) => i.type === 'problem' && /music skips/.test(i.text));
  assert.equal((await call(`/admin/v1/feedback/${prob.id}`, { auth: mod, body: { status: 'addressed', note: 'The music no longer skips.' } })).status, 200);
  assert.equal((await call('/admin/v1/errors/fix', { auth: boss, body: { message: 'grid is undefined', place: 'app.js:1', fixedIn: '1.1', note: 'Grid loads first now.' } })).status, 200);
  const fresh = (await call('/admin/v1/inbox?type=all&status=new', { auth: mod })).body.items;
  assert.ok(!fresh.some((i) => i.id === prob.id && i.type === 'problem') && !fresh.some((i) => i.type === 'error' && i.id === 'fp-comm'), 'addressed items leave the new list');
  const done = (await call('/admin/v1/inbox?type=all&status=addressed', { auth: mod })).body.items;
  assert.equal(done.find((i) => i.type === 'problem' && i.id === prob.id).meta.note, 'The music no longer skips.');
  assert.equal(done.find((i) => i.type === 'error' && i.id === 'fp-comm').meta.fix.fixedIn, '1.1');
  assert.ok(done.every((i) => ['idea', 'problem', 'error'].includes(i.type)), 'only ideas, problems and errors can be addressed');
  await call(`/admin/v1/feedback/${prob.id}`, { auth: mod, body: { status: 'new' } });
  await db.prepare("DELETE FROM error_fixes WHERE message = 'grid is undefined'").run();

  // The player turns on email notices; the team replies; the player sees "The team".
  assert.equal((await call('/v1/messages/email', { auth: idToken('ann-uid', 'ann@example.com', false), body: { on: true } })).status, 403, 'needs a confirmed email');
  assert.equal((await call('/v1/messages/email', { auth: ann, body: { on: true } })).body.email, true);
  const thread = (await call(`/admin/v1/conversations/${convId}`, { auth: mod })).body;
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.emailOn, true);
  const reply = await call(`/admin/v1/conversations/${convId}/reply`, { auth: mod, body: { text: 'Open the puzzle and press Print. See https://thelogicgrid.com/help' } });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.email, 'queued');
  assert.equal((await call(`/admin/v1/conversations/${convId}/reply`, { auth: mod, body: { text: 'One more thing.' } })).body.email, 'limit', 'one email notice a day');
  const notice = await db.prepare("SELECT email, kind FROM feedback_replies WHERE kind = 'message'").first();
  assert.equal(notice.email, 'ann@example.com');
  const mine = (await call('/v1/messages', { auth: ann })).body;
  const c = mine.conversations.find((x) => x.id === convId);
  assert.equal(c.unread, true);
  assert.equal(mine.unread, 1);
  assert.deepEqual(c.messages.map((m) => m.from), ['player', 'team', 'team']);
  assert.match(c.messages[1].text, /https:\/\/thelogicgrid\.com\/help/, 'team links are kept');
  assert.ok(!JSON.stringify(mine).includes('mod@example.com'), 'players never see which admin wrote');
  await call(`/v1/messages/${convId}/read`, { auth: ann, body: {} });
  assert.equal((await call('/v1/messages', { auth: ann })).body.unread, 0);
  // Done, then the player's reply opens it again. Another player cannot reply in it.
  await call(`/admin/v1/conversations/${convId}/status`, { auth: mod, body: { status: 'done' } });
  assert.equal((await call(`/v1/messages/${convId}`, { auth: idToken('bob-uid', 'bob@example.com'), body: { text: 'Hello there' } })).status, 404);
  await call(`/v1/messages/${convId}`, { auth: ann, body: { text: 'Thanks, that worked!' } });
  assert.equal((await db.prepare('SELECT status, admin_unread FROM conversations WHERE id = ?1').bind(convId).first()).status, 'open');
  assert.equal((await call(`/admin/v1/conversations/${convId}/status`, { auth: mod, body: { status: 'delete' } })).status, 403, 'deleting needs an admin');

  // Admins write first, by screen name; moderators cannot.
  assert.equal((await call('/admin/v1/conversations', { auth: mod, body: { to: 'Puzzle Ann', text: 'Hello' } })).status, 403);
  const first = await call('/admin/v1/conversations', { auth: boss, body: { to: 'puzzle ann', subject: 'Your race', text: 'Congratulations on your win!' } });
  assert.equal(first.status, 200);
  assert.equal(first.body.uid, 'ann-uid');
  assert.equal((await call('/admin/v1/conversations', { auth: boss, body: { to: 'Nobody Here', text: 'Hi' } })).status, 404);

  // News reaches every copy of the game through /v1/config.
  assert.equal((await call('/admin/v1/news', { auth: mod, body: { title: 'New themes', text: 'Three new worlds.' } })).status, 403);
  const news = await call('/admin/v1/news', { auth: boss, body: { title: 'New themes', text: 'Three new worlds to explore.' } });
  assert.equal(news.status, 200);
  assert.equal((await call('/v1/config')).body.news[0].title, 'New themes');
  assert.equal((await call('/v1/config')).body.features.messages, true);
  await call(`/admin/v1/news/${news.body.id}/end`, { auth: boss, body: {} });
  assert.equal((await call('/v1/config')).body.news.length, 0);

  // Banned players can read but not send; the switch closes Messages.
  await db.prepare("INSERT INTO bans (user_id, banned_by, banned_at) VALUES ('ann-uid', 'test', 1)").run();
  assert.equal((await call('/v1/messages', { auth: ann, body: { text: 'Let me back in' } })).status, 403);
  await db.prepare("DELETE FROM bans WHERE user_id = 'ann-uid'").run();
  await call('/admin/v1/settings', { auth: boss, body: { key: 'messages_enabled', value: false } });
  assert.equal((await call('/v1/messages', { auth: ann })).body.off, true);
  assert.equal((await call('/v1/messages', { auth: ann, body: { text: 'Hello again' } })).status, 503);
  await call('/admin/v1/settings', { auth: boss, body: { key: 'messages_enabled', value: true } });
  // Everything is in the audit log.
  const acts = (await db.prepare("SELECT action FROM admin_audit WHERE action LIKE 'conversations.%' OR action LIKE 'news.%' OR action = 'inbox.view'").all()).results.map((r) => r.action);
  for (const a of ['inbox.view', 'conversations.view', 'conversations.reply', 'conversations.status', 'conversations.start', 'news.create']) assert.ok(acts.includes(a), `${a} is audited`);

  // Deleting the account removes the conversations and the email address.
  await call('/admin/v1/players/ann-uid/delete', { auth: boss, body: { confirm: 'ann-uid' } });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE user_id = 'ann-uid'").first()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM message_contacts").first()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE conversation_id IS NOT NULL").first()).n, 0);
  await db.batch(['feedback_replies', 'feedback', 'conversation_messages', 'news', 'sync_deleted_users'].map((t) => db.prepare(`DELETE FROM ${t}`)));
  await db.prepare("DELETE FROM app_errors WHERE fingerprint = 'fp-comm'").run();
  await call('/admin/v1/admins/remove', { auth: boss, body: { email: 'comm-mod@example.com' } });
  await call('/admin/v1/admins/remove', { auth: boss, body: { email: 'comm-view@example.com' } });
});

test('the story workshop adds checked story parts for everyone', async () => {
  const opts = (await call('/admin/v1/workshop', { auth: TOKEN })).body;
  assert.ok(opts.stories.some((s) => s.key === 'mystery'));
  assert.deepEqual(opts.kinds.map((k) => k.id), ['openings', 'incidents', 'mishaps', 'endings']);
  const bad = await call('/admin/v1/workshop/add', { auth: TOKEN, body: { story: 'mystery', kind: 'openings', value: 'Five people met.' } });
  assert.equal(bad.status, 400);
  const good = await call('/admin/v1/workshop/add', { auth: TOKEN, body: { story: 'mystery', kind: 'mishaps', value: 'The butler mixed up every name on the guest list.' } });
  assert.equal(good.status, 200);
  const row = await db.prepare('SELECT status, source FROM parts WHERE key = ?1').bind(good.body.key).first();
  assert.deepEqual({ ...row }, { status: 'approved', source: 'admin' });
  const draft = await call('/admin/v1/workshop/draft', { auth: TOKEN, body: { story: 'mystery', kind: 'mishaps', idea: 'fog' } });
  assert.equal(draft.status, 400);
  assert.match(draft.body.message, /GEMINI_API_KEY/);
});

test('announcements show in the game between their start and end', async () => {
  const made = await call('/admin/v1/announcements', { auth: owner(), body: { text: 'New themes this weekend!', level: 'info' } });
  assert.equal(made.status, 200);
  await call('/admin/v1/announcements', { auth: owner(), body: { text: 'Later', startsAt: Date.now() + 3600_000 } });
  let cfg = (await call('/v1/config')).body;
  assert.deepEqual(cfg.announcements.map((a) => a.text), ['New themes this weekend!']);
  assert.equal((await call(`/admin/v1/announcements/${made.body.id}/end`, { auth: owner(), body: {} })).status, 200);
  cfg = (await call('/v1/config')).body;
  assert.equal(cfg.announcements.length, 0);
  assert.equal((await call('/admin/v1/announcements', { auth: owner(), body: { text: 'x' } })).status, 400);
});

test('players: every player in sections, searchable, sortable, a page at a time', async () => {
  // A moderator from the roles test, so these calls do not use up the owner's rate limit.
  const mod = idToken('mod-uid', 'mod@example.com');
  const now = Date.now();
  const add = async (uid, name, { seen = now, approved = false, banned = false, synced = false } = {}) => {
    if (name) await db.prepare('INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(uid, name, name.toLowerCase().replace(/[^a-z0-9]/g, ''), seen).run();
    if (synced) await db.prepare('INSERT INTO sync_users (user_id, rev, created_at) VALUES (?1, 1, ?2)').bind(uid, seen).run();
    if (approved) await db.prepare('INSERT INTO name_reviews (user_id, name_key, reviewed_by, reviewed_at) VALUES (?1, ?2, ?3, ?4)').bind(uid, name.toLowerCase().replace(/[^a-z0-9]/g, ''), 'test', now).run();
    if (banned) await db.prepare('INSERT INTO bans (user_id, reason, banned_by, banned_at, until) VALUES (?1, ?2, ?3, ?4, NULL)').bind(uid, 'rude', 'test', now).run();
  };
  await add('sec-new', 'Zed Newcomer');
  await add('sec-active', 'Amy Active', { approved: true });
  await add('sec-old', 'Olly Oldtimer', { approved: true, seen: now - 45 * 24 * 3600_000 });
  await add('sec-ban', 'Bart Blocked', { approved: true, banned: true });
  await add('sec-sync-only', null, { synced: true });
  // Recent play keeps an approved name active even when the name is old.
  await add('sec-racer', 'Rita Racer', { approved: true, seen: now - 60 * 24 * 3600_000 });
  await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES ('sec-racer', 's-r', 'solo', 'easy', 48, 60000, 0, 0, 25, ?1)").bind(now).run();

  const all = (await call('/admin/v1/players?per=100', { auth: mod })).body;
  const section = (uid) => all.players.find((p) => p.uid === uid).section;
  assert.equal(section('sec-new'), 'pending');
  assert.equal(section('sec-active'), 'active');
  assert.equal(section('sec-old'), 'inactive');
  assert.equal(section('sec-ban'), 'blocked');
  assert.equal(section('sec-sync-only'), 'account');
  assert.equal(section('sec-racer'), 'active');
  assert.equal(all.players.find((p) => p.uid === 'sec-sync-only').name, null);
  assert.equal(all.sections.all, all.total);
  for (const s of ['pending', 'active', 'inactive', 'blocked', 'account']) assert.ok(all.sections[s] >= 1, s);

  const inactive = (await call('/admin/v1/players?filter=inactive', { auth: mod })).body;
  assert.ok(inactive.players.every((p) => p.section === 'inactive'));
  assert.ok(inactive.players.some((p) => p.uid === 'sec-old'));

  const byName = (await call('/admin/v1/players?filter=named&sort=name&per=100', { auth: mod })).body;
  const names = byName.players.map((p) => p.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, '').localeCompare(b.toLowerCase().replace(/[^a-z0-9]/g, ''))));
  const top = (await call('/admin/v1/players?sort=points&dir=desc', { auth: mod })).body.players[0];
  assert.ok(top.points >= 25);

  const page1 = (await call('/admin/v1/players?per=25&page=1', { auth: mod })).body;
  assert.equal(page1.per, 25);
  assert.equal(page1.pages, Math.ceil(page1.total / 25));
  assert.equal((await call('/admin/v1/players?q=oldtim', { auth: mod })).body.players[0].uid, 'sec-old');
  assert.equal((await call('/admin/v1/players?q=sec-sync', { auth: mod })).body.players[0].uid, 'sec-sync-only');

  const csvText = (await call('/admin/v1/export/players.csv', { auth: owner() })).text;
  assert.match(csvText, /Last seen/);
  assert.match(csvText, /sec-sync-only/);
});

test('players: rename, ban, reset scores and delete', async () => {
  const uid = 'p-bad';
  assert.equal((await call('/v1/profile', { auth: player(uid), method: 'PUT', body: { screenName: 'Meanie' } })).status, 200);
  await db.prepare("INSERT INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at) VALUES (?1, 's1', 'solo', 'easy', 48, 60000, 0, 0, 30, ?2)").bind(uid, Date.now()).run();
  await db.prepare('INSERT INTO sync_users (user_id, rev, created_at) VALUES (?1, 1, ?2)').bind(uid, Date.now()).run();
  await db.prepare("INSERT INTO sync_records (user_id, kind, key, data, updated_at, rev) VALUES (?1, 'save', 'a', '{\"secret\":1}', 1, 1)").bind(uid).run();

  const found = await call('/admin/v1/players?q=mean', { auth: owner() });
  assert.equal(found.body.players[0].uid, uid);
  const detail = await call(`/admin/v1/players/${uid}`, { auth: owner() });
  assert.equal(detail.body.account.saves, 1);
  assert.ok(!JSON.stringify(detail.body).includes('secret'), 'saved puzzles are counted, never shown');

  const names = await call('/admin/v1/names?status=pending', { auth: owner() });
  assert.ok(names.body.names.some((n) => n.uid === uid));
  const renamed = await call(`/admin/v1/players/${uid}/rename`, { auth: owner(), body: { reset: true } });
  assert.match(renamed.body.screenName, /^Player [A-Z2-9]{4}$/);
  assert.ok(!(await call('/admin/v1/names?status=pending', { auth: owner() })).body.names.some((n) => n.uid === uid));

  assert.equal((await call('/v1/scoreboard?period=all')).body.rows.length > 0, true);
  assert.equal((await call(`/admin/v1/players/${uid}/ban`, { auth: owner(), body: { days: 7, reason: 'rude' } })).status, 200);
  const blocked = await call('/v1/scores', { auth: player(uid), body: { storyId: 's2', tier: 'easy', categories: 3, items: 4, elapsedMs: 60000, hints: 0, checks: 0 } });
  assert.equal(blocked.body.error, 'banned');
  assert.ok(!(await call('/v1/scoreboard?period=all')).body.rows.some((r) => r.name === renamed.body.screenName));
  assert.equal((await call('/admin/v1/players?filter=banned', { auth: owner() })).body.players.find((p) => p.uid === uid).banned, true);
  await call(`/admin/v1/players/${uid}/unban`, { auth: owner(), body: {} });

  const reset = await call(`/admin/v1/players/${uid}/reset-scores`, { auth: owner(), body: { period: 'all' } });
  assert.equal(reset.body.removed, 1);

  assert.equal((await call(`/admin/v1/players/${uid}/delete`, { auth: owner(), body: { confirm: 'nope' } })).status, 400);
  assert.equal((await call(`/admin/v1/players/${uid}/delete`, { auth: owner(), body: { confirm: uid } })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sync_records WHERE user_id = ?1').bind(uid).first()).n, 0);
  assert.equal((await call('/v1/sync', { auth: player(uid), body: { since: 0 } })).body.error, 'account_deleted');
});

test('analytics, storage and story review', async () => {
  await db.prepare("INSERT INTO plays (day, platform, tier, theme, outcome, rating) VALUES (date('now'), 'web', 'easy', 'mystery', 'solved', 5)").run();
  await db.prepare("INSERT INTO parts (key, theme, kind, value, source, submitted) VALUES ('mystery|places|x', 'mystery', 'places', '\"the old mill\"', 'mine', '2026-10-25')").run();
  const a = await call('/admin/v1/analytics?days=7', { auth: owner() });
  assert.equal(a.status, 200);
  assert.equal(a.body.dayList.length, 7);
  assert.equal(a.body.games.byTheme[0].id, 'mystery');
  assert.equal(a.body.review.parts.pending, 1);
  const s = await call('/admin/v1/storage', { auth: owner() });
  assert.ok(s.body.tables.find((t) => t.table === 'plays').rows >= 1);
  assert.equal((await call('/admin/v1/usage', { auth: owner() })).body.configured, false);
  const parts = await call('/admin/v1/parts', { auth: owner() });
  assert.equal(parts.body.parts[0].value, 'the old mill');
  assert.equal((await call('/admin/v1/parts/review', { auth: owner(), body: { key: 'mystery|places|x', status: 'approved' } })).status, 200);
  assert.equal((await call('/admin/v1/parts/review', { auth: owner(), body: { key: 'gone', status: 'approved' } })).status, 404);
});

test('backups: the archive page, a download, and the viewer page', async () => {
  const status = await call('/admin/v1/archive', { auth: TOKEN });
  assert.equal(status.status, 200);
  assert.equal(status.body.setUp.binding, false, 'no email binding in tests');
  assert.equal(status.body.emailOn, false, 'the weekly email starts off');
  assert.equal(status.body.removeOn, false, 'removal starts off');
  assert.ok(status.body.plan.some((p) => p.table === 'plays'));
  assert.ok(!status.body.plan.some((p) => ['scores', 'players', 'sync_records', 'bans'].includes(p.table)));

  const run = await call('/admin/v1/archive/run', { auth: TOKEN, body: {} });
  assert.equal(run.body.status, 'not_set_up');

  const dl = await mf.dispatchFetch('https://api.test/admin/v1/archive/download', { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/zip');
  const bytes = new Uint8Array(await dl.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  const off = await mf.dispatchFetch('https://api.test/admin/v1/archive/export', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(off.status, 409, 'the GitHub Action gets "off" while the weekly switch is off');
  const exp = await mf.dispatchFetch('https://api.test/admin/v1/archive/export?test=1', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(exp.status, 200);
  assert.equal(exp.headers.get('x-archive-test'), '1');
  await exp.arrayBuffer();
  const confirm = await call('/admin/v1/archive/confirm', { auth: TOKEN, body: { id: Number(exp.headers.get('x-archive-id')) } });
  assert.equal(confirm.body.removed, false, 'a test send removes nothing');

  const page = await call('/admin/archive.html', { origin: null });
  assert.equal(page.status, 200);
  assert.match(page.text, /Archive viewer/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('errors can be marked addressed with the version that fixed them', async () => {
  // The owner on another device (its own rate limit), so the other tests keep theirs. (its own rate limit), so the other tests keep theirs.
  const owner = idToken('owner-fix-uid', OWNER);
  const report = (version) => ({ kind: 'error', message: "Cannot read properties of undefined (reading 'toLowerCase')", stack: 'at h (https://x.test/js/app.js:1882:9)', platform: 'web', version });
  await call('/v1/errors', { body: { errors: [report('1.6.0'), report('1.7.1')] } });
  const before = (await call('/admin/v1/errors', { auth: owner })).body.errors.filter((x) => /toLowerCase/.test(x.message));
  assert.equal(before.length, 2);
  assert.ok(before.every((x) => !x.fix));
  const mark = { message: before[0].message, place: before[0].place, fixedIn: '1.7.1', note: 'Ignore key presses with no key (autofill).' };
  assert.equal((await call('/admin/v1/errors/fix', { auth: owner, body: { ...mark, fixedIn: 'soon' } })).status, 400);
  assert.equal((await call('/admin/v1/errors/fix', { auth: owner, body: mark })).status, 200);
  const after = (await call('/admin/v1/errors', { auth: owner })).body.errors.filter((x) => /toLowerCase/.test(x.message));
  const byVersion = Object.fromEntries(after.map((x) => [x.version, x.fix]));
  assert.equal(byVersion['1.6.0'].missed, false, 'an older version counts as fixed');
  assert.equal(byVersion['1.7.1'].missed, true, 'the fixed version or later shows the fix missed it');
  assert.equal(byVersion['1.6.0'].note, mark.note);
  assert.equal((await call(`/admin/v1/errors/fix/${byVersion['1.6.0'].id}/delete`, { auth: owner, body: {} })).status, 200);
});

test('the older token pages still work and are audited', async () => {
  const r = await call('/admin/errors', { auth: TOKEN });
  assert.equal(r.status, 200);
  assert.equal((await call('/admin/errors', { auth: 'nope' })).status, 401);
  const rows = (await db.prepare("SELECT actor, status FROM admin_audit WHERE action = 'legacy GET /admin/errors'").all()).results;
  assert.deepEqual(rows.map((x) => [x.actor, x.status]), [['break-glass token', 200], ['unknown', 401]]);
});

test('each admin is rate limited', async () => {
  const token = idToken('mod-uid', 'mod@example.com');
  let limited = false;
  // 100 quick calls: even if they straddle a one-minute window, one side passes the limit of 40.
  for (let i = 0; i < 100 && !limited; i++) limited = (await call('/admin/v1/me', { auth: token })).status === 429;
  assert.ok(limited);
});

test('admins sign in again after 12 hours, even with a fresh token', async () => {
  const old = Math.floor(Date.now() / 1000) - 13 * 3600;
  const stale = signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true }, { auth_time: old });
  const r = await call('/admin/v1/me', { auth: stale });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'sign_in');
});

test('admin bodies over the limit are refused while still arriving', async () => {
  // No Content-Length: the body is streamed and cut off once it passes the cap.
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1000))); c.close(); } });
  // The Worker may answer before the upload ends, so a reset also means refused.
  // Its own sign-in, so earlier tests' calls do not count toward the rate limit.
  const auth = idToken('size-check-uid', OWNER);
  let status;
  try {
    const r = await mf.dispatchFetch('https://api.test/admin/v1/settings', { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: big, duplex: 'half' });
    await r.arrayBuffer();
    status = r.status;
  } catch (e) { status = 'reset'; }
  assert.ok([413, 'reset'].includes(status), `gave ${status}`);
  const sized = await call('/admin/v1/settings', { auth, body: { pad: 'x'.repeat(9000) } });
  assert.equal(sized.status, 413);
});

test('the dashboard keeps other sites and powerful features away', async () => {
  const r = await call('/admin/', { origin: null });
  assert.match(r.headers.get('strict-transport-security'), /max-age=\d{8}/);
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
});
