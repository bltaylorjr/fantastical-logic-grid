// Fetches the Bing Webmaster reports for the admin dashboard from GitHub's own
// internet addresses and posts them to the Worker (POST /admin/v1/search/bing).
// Bing often refuses the Worker ("ThrottleIP") because Cloudflare Workers share
// their outgoing addresses with many other sites; GitHub's runners are not on
// that list. Run by .github/workflows/bing-search.yml every 6 hours.
//
// Needs: BING_WEBMASTER_KEY (the same key as the Worker secret), FLG_ADMIN_TOKEN
// (the Worker's ADMIN_TOKEN), API (the Worker address), SITE (the Bing property).
// The key is never printed; Bing's error text is scrubbed of it.

const { BING_WEBMASTER_KEY: KEY, FLG_ADMIN_TOKEN: TOKEN } = process.env;
const API = (process.env.API || 'https://flg-api.btay74.workers.dev').replace(/\/+$/, '');
const SITE = `${(process.env.SITE || 'https://thelogicgrid.com').replace(/\/+$/, '')}/`;
const METHODS = { traffic: 'GetRankAndTrafficStats', queries: 'GetQueryStats', pages: 'GetPageStats', feeds: 'GetFeeds', crawl: 'GetCrawlStats' };
const GAP_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s) => String(s).split(KEY).join('…').slice(0, 300);

if (!KEY || !TOKEN) {
  console.log(`::notice::Skipped: add the repository secret${!KEY ? ' BING_WEBMASTER_KEY' : ''}${!KEY && !TOKEN ? ' and' : ''}${!TOKEN ? ' FLG_ADMIN_TOKEN' : ''} to fetch the Bing numbers from GitHub.`);
  process.exit(0);
}

async function bing(method) {
  const url = `https://ssl.bing.com/webmaster/api.svc/json/${method}?siteUrl=${encodeURIComponent(SITE)}&apikey=${encodeURIComponent(KEY)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* below */ }
  if (!res.ok) throw new Error(scrub(`Bing ${method}: ${res.status} ${body?.Message || body?.message || text.slice(0, 200)}`));
  if (!body) throw new Error(`Bing ${method}: not JSON`);
  return Array.isArray(body.d) ? body.d : [];
}

const report = { errors: [] };
const throttled = (m) => /throttl|\b429\b/i.test(m);
try {
  const names = Object.keys(METHODS);
  // The first report is required; the rest are kept if they fail.
  report[names[0]] = await bing(METHODS[names[0]]);
  for (const k of names.slice(1)) {
    await sleep(GAP_MS);
    try { report[k] = await bing(METHODS[k]); } catch (e) {
      report.errors.push(scrub(e.message));
      report[k] = [];
      if (throttled(e.message)) break;
    }
  }
} catch (e) {
  report.error = scrub(e.message);
}

const res = await fetch(`${API}/admin/v1/search/bing`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(report),
  signal: AbortSignal.timeout(30_000),
});
const answer = await res.json().catch(() => ({}));
if (!res.ok) {
  console.log(`::error::The Worker did not accept the Bing numbers: ${res.status} ${answer.message || answer.error || ''}`);
  process.exit(1);
}
if (report.error) {
  // Bing refused GitHub too. Not a failure of this job: the Worker keeps the
  // last good numbers and its hourly check tries again.
  console.log(`::warning::Bing did not answer: ${report.error}`);
} else {
  console.log(`Bing numbers sent to the dashboard (${report.traffic.length} days of traffic${report.errors.length ? `; ${report.errors.length} report(s) missing: ${report.errors.join(' | ')}` : ''}).`);
}
