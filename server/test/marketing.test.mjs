// Marketing: the starter campaign is added once, campaign visits are counted
// anonymously (unknown codes fold into "other"), the dashboard shows numbers
// per channel, campaign and ad, and only admins may change anything.
// Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';
import { cleanEvent, trackedLink } from '../src/marketing.js';

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
    ratelimits: { LIMIT_ADMIN: { namespace_id: '1', simple: { limit: 400, period: 60 } } },
    bindings: {
      FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, TEST_JWKS: JSON.stringify(signer.jwks), ADMIN_TOKEN: TOKEN,
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

const owner = () => signer.token({ sub: 'owner-uid', email: OWNER, email_verified: true });
const admin = () => signer.token({ sub: 'a-uid', email: 'admin@example.com', email_verified: true });
const viewer = () => signer.token({ sub: 'v-uid', email: 'viewer@example.com', email_verified: true });

async function call(path, { auth, method, body, origin = ORIGIN } = {}) {
  const r = await mf.dispatchFetch(`https://api.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, body: json };
}

const send = (b, origin = ORIGIN) => mf.dispatchFetch('https://api.test/v1/m', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify(b) });

test('the starter campaign arrives once with its ads, media and tracked links', async () => {
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at) VALUES ('viewer@example.com', 'viewer', 'test', 0), ('admin@example.com', 'admin', 'test', 0)").run();
  assert.equal((await call('/admin/v1/marketing')).status, 401, 'signed in only');
  const r = await call('/admin/v1/marketing', { auth: viewer() });
  assert.equal(r.status, 200);
  const c = r.body.campaigns.find((x) => x.code === 'launch-2026');
  assert.ok(c, 'launch campaign seeded');
  assert.equal(c.status, 'active');
  const ads = r.body.ads.filter((a) => a.campaignId === c.id);
  assert.ok(ads.length >= 20, `${ads.length} ads`);
  assert.ok(ads.every((a) => a.status === 'approved'), 'Bobby approved every starter ad');
  const contents = ads.map((a) => `${a.channel}|${a.content}`);
  assert.equal(new Set(contents).size, contents.length, 'each ad has its own link');
  const reddit = ads.find((a) => a.content === 'webgames-launch');
  assert.equal(reddit.link, 'https://thelogicgrid.com/?play=now&utm_source=reddit&utm_medium=forum&utm_campaign=launch-2026&utm_content=webgames-launch', 'ads open a quick puzzle');
  assert.match(reddit.body, /\{link\}/);
  assert.ok(reddit.media.length && reddit.media.every((id) => r.body.media.some((m) => m.id === id)), 'ads point at listed media');
  assert.ok(r.body.media.some((m) => /promo-9x16-captioned\.mp4$/.test(m.url)), 'promo video listed');
  // Opening again never adds it twice, and a deleted campaign stays deleted.
  await call('/admin/v1/marketing', { auth: viewer() });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE code = 'launch-2026'").first()).n, 1);
  const before = (await db.prepare('SELECT COUNT(*) AS n FROM marketing_media').first()).n;
  await call('/admin/v1/marketing', { auth: viewer() });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM marketing_media').first()).n, before);
});

test('the game counts campaign visits anonymously, and made-up codes fold into other', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await send({ e: 'visit', c: 'launch-2026', s: 'reddit', m: 'forum', k: 'webgames-launch', p: 'web' })).status, 200);
  await send({ e: 'solve', c: 'launch-2026', s: 'reddit', m: 'forum', k: 'webgames-launch', p: 'web' });
  await send({ e: 'play', c: 'launch-2026', s: 'reddit', m: 'forum', k: 'webgames-launch', p: 'web' });
  await send({ e: 'visit', c: 'made-up-campaign', s: 'my-spam-site', m: 'banner', k: 'zzz', p: 'toaster' });
  await send({ e: 'visit', c: '', s: 'pinterest', m: 'social', p: 'web' });
  assert.equal((await send({ e: 'hack' })).status, 400, 'unknown events refused');
  assert.equal((await mf.dispatchFetch('https://api.test/v1/m', { method: 'POST', body: 'not json' })).status, 400, 'junk refused');
  const rows = (await db.prepare('SELECT campaign, source, medium, content, event, platform, n FROM campaign_stats ORDER BY campaign, event').all()).results;
  assert.deepEqual(rows.find((x) => x.event === 'visit' && x.campaign === 'launch-2026'), { campaign: 'launch-2026', source: 'reddit', medium: 'forum', content: 'webgames-launch', event: 'visit', platform: 'web', n: 3 });
  assert.deepEqual(rows.find((x) => x.campaign === '(other)'), { campaign: '(other)', source: 'other', medium: 'other', content: '', event: 'visit', platform: 'web', n: 1 });
  assert.deepEqual(rows.find((x) => x.campaign === '(none)'), { campaign: '(none)', source: 'pinterest', medium: 'social', content: '', event: 'visit', platform: 'web', n: 1 });
  assert.equal(rows.length, 5);

  const r = await call('/admin/v1/marketing?days=7', { auth: viewer() });
  assert.deepEqual(r.body.totals, { visit: 5, play: 1, solve: 1, return: 0, install: 0, download: 0, support: 0 });
  assert.equal(r.body.trend.length, 7);
  assert.equal(r.body.trend.at(-1).visit, 5);
  assert.equal(r.body.bySource[0].source, 'reddit');
  const ad = r.body.ads.find((a) => a.content === 'webgames-launch');
  assert.deepEqual(ad.stats, { visit: 3, play: 1, solve: 1, return: 0, install: 0, download: 0, support: 0 });
  assert.equal(r.body.byCampaign.find((x) => x.campaign === '(none)').name, 'No campaign (links from other sites)');
});

test('admins add and change campaigns, ads and media; viewers only look', async () => {
  assert.equal((await call('/admin/v1/marketing/campaigns', { auth: viewer(), body: { name: 'Nope' } })).status, 403);
  const c = await call('/admin/v1/marketing/campaigns', { auth: admin(), body: { name: 'Spring Puzzle Week', status: 'active', starts: '2027-03-01', ends: '2027-03-07' } });
  assert.equal(c.status, 200);
  assert.equal(c.body.code, 'spring-puzzle-week');
  assert.equal((await call('/admin/v1/marketing/campaigns', { auth: admin(), body: { name: 'Again', code: 'spring-puzzle-week' } })).status, 409, 'codes are unique');
  assert.equal((await call('/admin/v1/marketing/campaigns', { auth: admin(), body: { name: 'Backwards', starts: '2027-03-07', ends: '2027-03-01' } })).status, 400);

  const m = await call('/admin/v1/marketing/media', { auth: admin(), body: { title: 'Flyer', kind: 'image', url: 'https://example.com/flyer.png' } });
  assert.equal(m.status, 200);
  assert.equal((await call('/admin/v1/marketing/media', { auth: admin(), body: { title: 'Bad', url: 'javascript:alert(1)' } })).status, 400, 'only https links');

  const a = await call('/admin/v1/marketing/ads', { auth: admin(), body: { campaignId: c.body.id, title: 'Library flyer', channel: 'Print Shop', medium: 'print', body: 'Scan me: {link}', media: [m.body.id, 'x'] } });
  assert.equal(a.status, 200);
  let r = await call('/admin/v1/marketing', { auth: admin() });
  let ad = r.body.ads.find((x) => x.id === a.body.id);
  assert.equal(ad.channel, 'print-shop');
  assert.equal(ad.content, 'library-flyer');
  assert.deepEqual(ad.media, [m.body.id]);
  assert.equal(ad.link, 'https://thelogicgrid.com/?play=now&utm_source=print-shop&utm_medium=print&utm_campaign=spring-puzzle-week&utm_content=library-flyer');

  // Its channel now counts, so a visit from it is kept as itself.
  await send({ e: 'visit', c: 'spring-puzzle-week', s: 'print-shop', m: 'print', k: 'library-flyer', p: 'web' });
  assert.equal((await db.prepare("SELECT n FROM campaign_stats WHERE campaign = 'spring-puzzle-week' AND source = 'print-shop' AND content = 'library-flyer'").first()).n, 1);

  // Posting it records when, and keeps the first time.
  const posted = await call('/admin/v1/marketing/ads', { auth: admin(), body: { ...ad, status: 'posted', postUrl: 'https://example.com/post/1' } });
  assert.equal(posted.status, 200);
  assert.equal((await call('/admin/v1/marketing/ads', { auth: admin(), body: { ...ad, landing: 'https://evil.example/' } })).status, 400, 'landing pages stay on the site');
  r = await call('/admin/v1/marketing', { auth: admin() });
  ad = r.body.ads.find((x) => x.id === a.body.id);
  assert.equal(ad.status, 'posted');
  assert.ok(ad.postedAt > 0);
  assert.equal((await call('/admin/v1/marketing/ads', { auth: admin(), body: { ...ad, postUrl: 'http://insecure.example' } })).status, 400);

  const csv = await mf.dispatchFetch('https://api.test/admin/v1/export/marketing.csv', { headers: { Authorization: `Bearer ${admin()}` } });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /^day,campaign,source,medium,ad,event,platform,count/);
  assert.match(text, /"spring-puzzle-week","print-shop","print","library-flyer","visit","web","1"/);

  assert.equal((await call(`/admin/v1/marketing/campaigns/${c.body.id}/delete`, { auth: admin(), body: { confirm: 'wrong' } })).status, 400);
  assert.equal((await call(`/admin/v1/marketing/campaigns/${c.body.id}/delete`, { auth: admin(), body: { confirm: 'spring-puzzle-week' } })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM campaign_ads WHERE campaign_id = ?1').bind(c.body.id).first()).n, 0, 'its ads go too');
  assert.equal((await call(`/admin/v1/marketing/media/${m.body.id}/delete`, { auth: admin(), body: {} })).status, 200);
  const audit = (await db.prepare("SELECT action FROM admin_audit WHERE action LIKE 'marketing.%' AND status = 200").all()).results.map((x) => x.action);
  assert.ok(audit.includes('marketing.campaign_delete') && audit.includes('marketing.ad'), 'changes are in the audit log');
});

test('event cleaning and links', () => {
  const known = { campaigns: new Map([['launch-2026', new Set(['a1'])]]), sources: new Set(['reddit', 'other']) };
  assert.deepEqual(cleanEvent({ e: 'visit', c: 'Launch-2026', s: 'Reddit', m: 'forum', k: 'nope', p: 'ios' }, known), { campaign: 'launch-2026', source: 'reddit', medium: 'forum', content: 'other', event: 'visit', platform: 'ios' });
  assert.equal(cleanEvent({ e: 'drop table' }, known), null);
  assert.equal(trackedLink('https://thelogicgrid.com/', { channel: 'x', medium: 'social', content: '', landing: 'javascript:' }, 'c1'), 'https://thelogicgrid.com/?utm_source=x&utm_medium=social&utm_campaign=c1');
  assert.equal(trackedLink('https://thelogicgrid.com', { channel: 'x', medium: 'social', content: 'a', landing: '/daily/?play=now' }, 'c1'), 'https://thelogicgrid.com/daily/?play=now&utm_source=x&utm_medium=social&utm_campaign=c1&utm_content=a');
});
