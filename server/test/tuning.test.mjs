// Self-tuning with approval (src/tuning.js): suggestions from the numbers,
// nothing applied until approved, pre-approval, undo, and the check after the
// change has run. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { applyNudges } from '../src/learn.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-tuning-test';
const ORIGIN = 'https://thelogicgrid.com';
const TOKEN = 'break-glass-token-for-tuning-tests';
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

async function call(path, { auth = TOKEN, body, method } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const day = (i = 0) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
async function plays(n, { tier = 'hard', theme = 'mystery', outcome = (i) => (i % 2 ? 'abandoned' : 'solved'), feel = null, rating = null, at = (i) => day(1 + (i % 10)) } = {}) {
  for (let i = 0; i < n; i++) {
    await db.prepare('INSERT INTO plays (day, platform, tier, theme, outcome, rating, feel, minutes, hints) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 8, 1)')
      .bind(at(i), 'web', tier, theme, typeof outcome === 'function' ? outcome(i) : outcome, typeof rating === 'function' ? rating(i) : rating, typeof feel === 'function' ? feel(i) : feel).run();
  }
}
const tuning = async () => (await mf.dispatchFetch('https://api.test/v1/learn/tuning', { headers: { Origin: ORIGIN } })).json();

test('nudges sit on top of what everyone taught, within limits, and are listed', () => {
  const t = applyNudges({ games: 40, effort: { hard: 0.1 }, themeWeights: { pets: 1.2 } }, { 'effort:hard': -0.4, 'effort:nope': 1, 'theme:pets': 0.5, 'theme:mystery': 1.15 });
  assert.equal(t.effort.hard, -0.3);
  assert.equal(t.effort.nope, undefined, 'unknown levels are ignored');
  assert.equal(t.themeWeights.pets, 0.6);
  assert.equal(t.themeWeights.mystery, 1.15);
  assert.deepEqual(t.house, { effort: { hard: -0.4 }, themes: { pets: 0.5, mystery: 1.15 } });
  assert.equal(applyNudges({ effort: {} }, {}).house, undefined, 'nothing listed when nothing is nudged');
});

test('too few games: nothing is suggested', async () => {
  await plays(10, { outcome: 'abandoned' });
  const r = await call('/admin/v1/tuning/check', { body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 0);
  assert.equal((await call('/admin/v1/tuning')).body.waiting.length, 0);
});

test('a hard level players give up on gets a gentler suggestion that waits for approval', async () => {
  await plays(20, { outcome: (i) => (i % 3 ? 'abandoned' : 'solved'), feel: 'hard' });
  const r = await call('/admin/v1/tuning/check', { body: {} });
  assert.equal(r.body.added, 2, 'the level, and the Mystery theme those games were in');
  const v = (await call('/admin/v1/tuning')).body;
  const p = v.waiting.find((x) => x.kind === 'level');
  assert.ok(v.waiting.some((x) => x.target === 'nudge:theme:mystery'));
  assert.equal(p.target, 'nudge:effort:hard');
  assert.equal(p.from, 0);
  assert.equal(p.to, -0.2);
  assert.match(p.reason, /Hard games ended without a solve/);
  assert.ok(p.baseline.games >= 20);
  // Nothing changed yet: the players' tuning has no house nudge.
  assert.equal((await tuning()).house, undefined);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM house_nudges').first()).n, 0);
  // Asking again does not repeat it.
  assert.equal((await call('/admin/v1/tuning/check', { body: {} })).body.added, 0);
  // Viewers can read but not approve.
  assert.equal((await call('/admin/v1/admins', { body: { email: 'look@example.com', role: 'viewer' } })).status, 200);
  const viewer = signer.token({ sub: 'look-uid', email: 'look@example.com', email_verified: true });
  assert.equal((await call('/admin/v1/tuning', { auth: viewer })).status, 200);
  assert.equal((await call(`/admin/v1/tuning/${p.id}/approve`, { auth: viewer, body: {} })).status, 403);
  // Approve: it applies, reaches the players' tuning and is measured later.
  assert.equal((await call(`/admin/v1/tuning/${p.id}/approve`, { body: {} })).status, 200);
  const t = await tuning();
  assert.equal(t.house.effort.hard, -0.2);
  const after = (await call('/admin/v1/tuning')).body;
  assert.ok(!after.waiting.some((x) => x.id === p.id));
  assert.equal(after.applied[0].id, p.id);
  assert.ok(after.applied[0].checkAt > Date.now() + 13 * 86400000, 'measured after 14 days');
  assert.equal((await call(`/admin/v1/tuning/${p.id}/approve`, { body: {} })).status, 409, 'cannot apply twice');
  // While it is being measured, no new suggestion stacks on the same level.
  assert.equal((await call('/admin/v1/tuning/check', { body: {} })).body.added, 0);
});

test('after 14 days a change that made things worse is offered back as an undo; undo restores it', async () => {
  const p = (await call('/admin/v1/tuning')).body.applied[0];
  // Pretend 14 days passed, with even more players giving up since.
  await db.prepare('UPDATE tuning_proposals SET check_at = ?1, decided_at = ?2 WHERE id = ?3').bind(Date.now() - 1000, Date.now() - 15 * 86400000, p.id).run();
  await plays(15, { outcome: 'abandoned', at: () => day(0) });
  const r = await call('/admin/v1/tuning/check', { body: {} });
  assert.equal(r.body.undos, 1);
  const v = (await call('/admin/v1/tuning')).body;
  assert.equal(v.applied[0].result.verdict, 'worse');
  const undo = v.waiting.find((x) => x.kind === 'undo');
  assert.ok(undo && undo.undoOf === p.id);
  assert.equal(undo.to, 0);
  // Approving the undo puts the value back and closes the change.
  assert.equal((await call(`/admin/v1/tuning/${undo.id}/approve`, { body: {} })).status, 200);
  assert.equal((await tuning()).house, undefined);
  const h = (await call('/admin/v1/tuning')).body;
  assert.ok(h.history.some((x) => x.id === p.id && x.status === 'undone'));
});

test('decline keeps it quiet for 30 days; a value changed by hand is never overwritten', async () => {
  await plays(25, { tier: 'easy', theme: 'pets', outcome: (i) => (i % 2 ? 'abandoned' : 'solved'), rating: 2 });
  await call('/admin/v1/tuning/check', { body: {} });
  const v = (await call('/admin/v1/tuning')).body;
  const level = v.waiting.find((x) => x.target === 'nudge:effort:easy');
  const theme = v.waiting.find((x) => x.target === 'nudge:theme:pets');
  assert.ok(level && theme);
  assert.equal(theme.to, 0.85);
  assert.equal((await call(`/admin/v1/tuning/${level.id}/decline`, { body: { note: 'Easy should stay easy-ish' } })).status, 200);
  assert.equal((await call('/admin/v1/tuning/check', { body: {} })).body.added, 0, 'not suggested again right away');
  // Someone sets the theme nudge by hand first: approving the old suggestion refuses.
  await db.prepare("INSERT INTO house_nudges (target, value, updated_at, updated_by) VALUES ('theme:pets', 0.9, 1, 'hand')").run();
  const r = await call(`/admin/v1/tuning/${theme.id}/approve`, { body: {} });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'moved');
  assert.equal((await db.prepare("SELECT value FROM house_nudges WHERE target = 'theme:pets'").first()).value, 0.9);
  const h = (await call('/admin/v1/tuning')).body.history;
  assert.ok(h.some((x) => x.id === level.id && x.status === 'declined' && x.note === 'Easy should stay easy-ish'));
  assert.ok(h.some((x) => x.id === theme.id && x.status === 'replaced'));
});

test('pre-approval: only the owner sets it, and pre-approved changes apply by themselves', async () => {
  const admin = signer.token({ sub: 'adm-uid', email: 'adm@example.com', email_verified: true });
  assert.equal((await call('/admin/v1/admins', { body: { email: 'adm@example.com', role: 'admin' } })).status, 200);
  assert.equal((await call('/admin/v1/tuning/rules', { auth: admin, body: { kind: 'max_level', mode: 'auto' } })).status, 403);
  assert.equal((await call('/admin/v1/tuning/rules', { body: { kind: 'nope', mode: 'auto' } })).status, 400);
  assert.equal((await call('/admin/v1/tuning/rules', { body: { kind: 'max_level', mode: 'auto' } })).body.rules.max_level, 'auto');
  // NINETIMESNINE: almost nobody solves Master.
  for (let i = 0; i < 12; i++) await db.prepare("INSERT INTO np_plays (day, level, size, outcome) VALUES (?1, 'master', 9, ?2)").bind(day(1), i ? 'abandoned' : 'solved').run();
  const r = await call('/admin/v1/tuning/check', { body: {} });
  assert.equal(r.body.applied, 1);
  const s = (await call('/admin/v1/settings')).body;
  const np = JSON.stringify(s);
  assert.match(np, /"np_max_level"/);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key = 'np_max_level'").first()).value, '"expert"');
  const v = (await call('/admin/v1/tuning')).body;
  const p = v.applied.find((x) => x.target === 'setting:np_max_level');
  assert.ok(p.auto);
  assert.equal(p.decidedBy, 'pre-approved');
  // Undo works the same way.
  assert.equal((await call(`/admin/v1/tuning/${p.id}/undo`, { auth: admin, body: {} })).status, 200);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key = 'np_max_level'").first()).value, '"master"');
  // An alert told the admins.
  const a = await db.prepare("SELECT title FROM alert_queue WHERE category = 'approvals' AND title LIKE '%tuning%' ORDER BY id").all();
  assert.ok(a.results.some((x) => /waiting for your OK/.test(x.title)));
  assert.ok(a.results.some((x) => /pre-approved/.test(x.title)));
});

test('marketing: a post that brought players is offered again; a channel with no players is paused; both undo', async () => {
  const now = Date.now();
  const { id: camp } = await db.prepare("INSERT INTO campaigns (code, name, status, created_by, created_at, updated_at) VALUES ('spring', 'Spring', 'active', 't', ?1, ?1) RETURNING id").bind(now).first();
  const { id: ad } = await db.prepare(`INSERT INTO campaign_ads (campaign_id, channel, medium, content, title, body, media, landing, status, post_on, posted_at, created_by, created_at, updated_at)
    VALUES (?1, 'facebook', 'social', 'tip-one', 'Facebook: tip one', 'Try it {link}', '[]', '/?play=now', 'posted', ?2, ?3, 't', ?3, ?3) RETURNING id`).bind(camp, day(3), now).first();
  const ups = [];
  for (const d of [5, 9]) {
    ups.push((await db.prepare(`INSERT INTO campaign_ads (campaign_id, channel, medium, content, title, body, media, landing, status, post_on, created_by, created_at, updated_at)
      VALUES (?1, 'x', 'social', ?2, 'X post', 'Hi {link}', '[]', '/?play=now', 'approved', ?3, 't', ?4, ?4) RETURNING id`).bind(camp, `x-${d}`, day(-d), now).first()).id);
  }
  const stat = (source, content, event, n) => db.prepare("INSERT INTO campaign_stats (day, campaign, source, medium, content, event, platform, n) VALUES (?1, 'spring', ?2, 'social', ?3, ?4, 'web', ?5)").bind(day(1), source, content, event, n).run();
  await stat('facebook', 'tip-one', 'visit', 12);
  await stat('facebook', 'tip-one', 'play', 6);
  await stat('x', 'x-old', 'visit', 31);

  const r = await call('/admin/v1/tuning/check', { body: {} });
  assert.ok(r.body.added >= 2);
  const v = (await call('/admin/v1/tuning')).body;
  const repeat = v.waiting.find((x) => x.kind === 'ad_repeat');
  const pause = v.waiting.find((x) => x.kind === 'ad_pause');
  assert.equal(repeat.target, `repeat:${ad}`);
  assert.match(repeat.reason, /12 visitors .* 50% of them started a puzzle/);
  assert.equal(pause.target, 'approved:x');
  assert.deepEqual(pause.from, ups);
  // Nothing changed before approval.
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM campaign_ads WHERE content = 'tip-one-again'").first()).n, 0);

  assert.equal((await call(`/admin/v1/tuning/${repeat.id}/approve`, { body: {} })).status, 200);
  const copy = await db.prepare("SELECT status, post_on, landing, channel FROM campaign_ads WHERE content = 'tip-one-again'").first();
  assert.deepEqual([copy.status, copy.channel, copy.landing, copy.post_on], ['approved', 'facebook', '/?play=now', repeat.to.on]);
  assert.equal((await call(`/admin/v1/tuning/${pause.id}/approve`, { body: {} })).status, 200);
  const st = (await db.prepare(`SELECT status FROM campaign_ads WHERE id IN (${ups.join(',')})`).all()).results.map((x) => x.status);
  assert.deepEqual(st, ['draft', 'draft'], 'the paused posts went back to draft');

  // A copy is never repeated again, and undo takes both back.
  assert.equal((await call('/admin/v1/tuning/check', { body: {} })).body.added, 0);
  assert.equal((await call(`/admin/v1/tuning/${repeat.id}/undo`, { body: {} })).status, 200);
  assert.equal((await db.prepare("SELECT status FROM campaign_ads WHERE content = 'tip-one-again'").first()).status, 'removed');
  assert.equal((await call(`/admin/v1/tuning/${pause.id}/undo`, { body: {} })).status, 200);
  const back = (await db.prepare(`SELECT status FROM campaign_ads WHERE id IN (${ups.join(',')})`).all()).results.map((x) => x.status);
  assert.deepEqual(back, ['approved', 'approved'], 'undo approves them again');
});

test('marketing: a post is repeated once; after the repeat is measured it is not suggested again', async () => {
  const now = Date.now();
  const { id: camp } = await db.prepare("INSERT INTO campaigns (code, name, status, created_by, created_at, updated_at) VALUES ('summer', 'Summer', 'active', 't', ?1, ?1) RETURNING id").bind(now).first();
  const { id: ad } = await db.prepare(`INSERT INTO campaign_ads (campaign_id, channel, medium, content, title, body, media, landing, status, post_on, posted_at, created_by, created_at, updated_at)
    VALUES (?1, 'bluesky', 'social', 'tip-two', 'Bluesky: tip two', 'Try it {link}', '[]', '/?play=now', 'posted', ?2, ?3, 't', ?3, ?3) RETURNING id`).bind(camp, day(3), now).first();
  const stat = (event, n) => db.prepare("INSERT INTO campaign_stats (day, campaign, source, medium, content, event, platform, n) VALUES (?1, 'summer', 'bluesky', 'social', 'tip-two', ?2, 'web', ?3)").bind(day(1), event, n).run();
  await stat('visit', 12);
  await stat('play', 6);
  const repeats = async () => (await call('/admin/v1/tuning')).body.waiting.filter((x) => x.target === `repeat:${ad}`);

  await call('/admin/v1/tuning/check', { body: {} });
  const [repeat] = await repeats();
  assert.ok(repeat, 'the post is offered again');
  assert.equal((await call(`/admin/v1/tuning/${repeat.id}/approve`, { body: {} })).status, 200);
  // The copy goes out, and 14 days later the change has been measured.
  await db.prepare("UPDATE campaign_ads SET status = 'posted', posted_at = ?1 WHERE content = 'tip-two-again'").bind(now).run();
  await db.prepare(`UPDATE tuning_proposals SET check_at = ?1, result = '{"verdict":"helped"}' WHERE id = ?2`).bind(now - 1000, repeat.id).run();

  await call('/admin/v1/tuning/check', { body: {} });
  assert.deepEqual(await repeats(), [], 'no second suggestion to repeat the same post');
});
