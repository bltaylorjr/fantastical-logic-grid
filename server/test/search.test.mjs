// Google Search Console and Bing Webmaster numbers for the admin dashboard:
// the service-account sign-in, the daily cron, the stored snapshot, failures
// and the refresh button. Google and Bing are mocked. Run with `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isMaintenanceHour } from '../src/nightly.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { bingDate } from '../src/search.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'break-glass-token-for-search-tests';
const BING_KEY = 'bing-key-123';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { type: 'service_account', client_email: 'reader@logic-grid.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const seen = [];
let bingFails = false;
let mf;
let db;

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const msDate = (ms) => `/Date(${ms}-0700)/`;

async function outbound(req) {
  const url = new URL(req.url);
  seen.push(`${req.method} ${url.host}${url.pathname}`);
  if (url.host === 'oauth2.googleapis.com') {
    const body = new URLSearchParams(await req.text());
    const [h, c, sig] = body.get('assertion').split('.');
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'));
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    if (!ok || claims.iss !== SA.client_email || !claims.scope.includes('webmasters.readonly')) return jsonRes({ error: 'invalid_grant' }, 400);
    return jsonRes({ access_token: 'ya29.test', expires_in: 3600 });
  }
  if (url.host === 'www.googleapis.com' || url.host === 'searchconsole.googleapis.com') {
    if (req.headers.get('Authorization') !== 'Bearer ya29.test') return jsonRes({ error: { message: 'no' } }, 401);
    if (url.pathname.endsWith('/sitemaps')) return jsonRes({ sitemap: [{ path: 'https://thelogicgrid.com/sitemap.xml', lastSubmitted: '2026-10-25T18:00:00Z', isPending: false, errors: '0', warnings: '0', contents: [{ type: 'web', submitted: '12', indexed: '9' }] }] });
    if (url.pathname.includes('urlInspection')) return jsonRes({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-10-24T10:00:00Z' } } });
    const q = await req.json();
    const dim = q.dimensions[0];
    if (!dim) return jsonRes({ rows: [{ clicks: 40, impressions: 900, ctr: 0.0444, position: 7.25 }] });
    if (dim === 'date') return jsonRes({ rows: [{ keys: ['2026-10-23'], clicks: 15, impressions: 400 }, { keys: ['2026-10-24'], clicks: 25, impressions: 500 }] });
    if (dim === 'query') return jsonRes({ rows: [{ keys: ['logic grid puzzles'], clicks: 30, impressions: 600, ctr: 0.05, position: 4.2 }] });
    return jsonRes({ rows: [{ keys: ['https://thelogicgrid.com/'], clicks: 38, impressions: 850, ctr: 0.0447, position: 6 }] });
  }
  if (url.host === 'ssl.bing.com') {
    if (url.searchParams.get('apikey') !== BING_KEY) return jsonRes({ Message: 'bad key' }, 401);
    if (bingFails) return jsonRes({ Message: `InvalidApiKey ${BING_KEY}` }, 400);
    const now = Date.now();
    const m = url.pathname.split('/').pop();
    if (m === 'GetRankAndTrafficStats') return jsonRes({ d: [{ Date: msDate(now - 2 * 864e5), Clicks: 3, Impressions: 70 }, { Date: msDate(now - 864e5), Clicks: 5, Impressions: 90 }, { Date: msDate(now - 90 * 864e5), Clicks: 99, Impressions: 999 }] });
    if (m === 'GetQueryStats') return jsonRes({ d: [{ Query: 'logic puzzle story', Clicks: 4, Impressions: 60, AvgImpressionPosition: 5, Date: msDate(now - 3 * 864e5) }, { Query: 'logic puzzle story', Clicks: 2, Impressions: 40, AvgImpressionPosition: 10, Date: msDate(now - 10 * 864e5) }] });
    if (m === 'GetPageStats') return jsonRes({ d: [{ Query: 'https://thelogicgrid.com/', Clicks: 8, Impressions: 160, AvgImpressionPosition: 6, Date: msDate(now - 3 * 864e5) }] });
    if (m === 'GetFeeds') return jsonRes({ d: [{ Url: 'https://thelogicgrid.com/sitemap.xml', Status: 'Success', UrlCount: 12, Submitted: msDate(now - 864e5), LastCrawled: msDate(now - 3600e3) }] });
    if (m === 'GetCrawlStats') return jsonRes({ d: [{ Date: msDate(now - 864e5), InIndex: 7, CrawledPages: 11, CrawlErrors: 0 }] });
  }
  return new Response('unexpected', { status: 599 });
}

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    outboundService: outbound,
    bindings: {
      FIREBASE_PROJECT_ID: 'flg-test', ALLOWED_ORIGINS: 'https://thelogicgrid.com', ADMIN_TOKEN: TOKEN, SEARCH_SITE_URL: 'https://thelogicgrid.com/',
      GSC_SERVICE_ACCOUNT: JSON.stringify(SA), BING_WEBMASTER_KEY: BING_KEY,
    },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const call = async (path, method = 'GET') => {
  const r = await mf.dispatchFetch(`https://api.test${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: r.status, body: await r.json() };
};

test('Bing dates are read', () => {
  assert.equal(bingDate('/Date(1729814400000-0700)/'), 1729814400000);
  assert.equal(bingDate(null), null);
});

test('before the first fetch the dashboard says so', async () => {
  const r = await call('/admin/v1/search');
  assert.equal(r.status, 200);
  assert.equal(r.body.sources.google.connected, true);
  assert.equal(r.body.sources.google.data, null);
});

test('the nightly 2 am cron fetches Google and Bing and stores the numbers', async () => {
  const worker = await mf.getWorker();
  const onHour = [6, 7].map((h) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return d; }).find((d) => isMaintenanceHour(d.getTime()));
  await worker.scheduled({ cron: `0 ${onHour.getUTCHours()} * * *`, scheduledTime: onHour });
  const { sources } = (await call('/admin/v1/search')).body;
  const g = sources.google.data;
  assert.deepEqual(g.totals, { clicks: 40, impressions: 900, ctr: 4.4, position: 7.3 });
  assert.equal(g.byDay.length, 2);
  assert.equal(g.queries[0].key, 'logic grid puzzles');
  assert.equal(g.pages[0].key, 'https://thelogicgrid.com/');
  assert.deepEqual([g.sitemaps[0].submitted, g.sitemaps[0].indexed], [12, 9]);
  assert.equal(g.home.coverage, 'Submitted and indexed');
  const b = sources.bing.data;
  assert.equal(b.totals.clicks, 8, 'only the last 28 days count');
  assert.deepEqual([b.queries[0].clicks, b.queries[0].impressions], [6, 100]);
  assert.equal(b.crawl.inIndex, 7);
  assert.equal(b.sitemaps[0].status, 'Success');
  // Of the two nightly crons, the one that is not 2 am in New York does nothing.
  const before = seen.length;
  const offHour = [6, 7].map((h) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return d; }).find((d) => !isMaintenanceHour(d.getTime()));
  await worker.scheduled({ cron: `0 ${offHour.getUTCHours()} * * *`, scheduledTime: offHour });
  assert.equal(seen.length, before);
});

test('a failed fetch keeps the last good numbers and hides the key', async () => {
  bingFails = true;
  await db.prepare('UPDATE search_snapshots SET tried_at = 0').run();
  const r = await call('/admin/v1/search/refresh', 'POST');
  assert.equal(r.status, 200);
  assert.equal(r.body.result.bing, 'error');
  const bing = r.body.sources.bing;
  assert.match(bing.error, /Bing GetRankAndTrafficStats: 400/);
  assert.ok(!bing.error.includes(BING_KEY));
  assert.equal(bing.data.totals.clicks, 8);
  bingFails = false;
});

test('refresh waits ten minutes between fetches and is audited', async () => {
  const r = await call('/admin/v1/search/refresh', 'POST');
  assert.deepEqual([r.status, r.body.error], [429, 'too_soon']);
  const row = await db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'search.refresh' AND status = 200").first();
  assert.equal(row.n, 1);
});
