// Google Search Console and Bing Webmaster numbers for thelogicgrid.com, for
// the admin dashboard. Fetched every night at 2 am Eastern (nightly.js) (and on
// demand from the dashboard), then kept in D1 (`search_snapshots`) so viewing
// the dashboard never calls Google or Bing. Both APIs are free.
//
// Credentials live only in Worker secrets:
//   GSC_SERVICE_ACCOUNT  the JSON key of a Google Cloud service account that
//                        was added as a user on the Search Console property
//   BING_WEBMASTER_KEY   the API key from Bing Webmaster Tools > Settings > API access
// SEARCH_SITE_URL (wrangler.toml) is the property, e.g. https://thelogicgrid.com/

const DAY = 24 * 3600_000;
const RANGE_DAYS = 28;
const TOP = 25;
export const REFRESH_GAP_MS = 10 * 60_000;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const siteOf = (env) => env.SEARCH_SITE_URL || 'https://thelogicgrid.com/';
// A Google domain property (sc-domain:thelogicgrid.com) has no address; Bing and
// the home-page check use the plain https address of the same domain.
const homeOf = (site) => (site.startsWith('sc-domain:') ? `https://${site.slice(10)}/` : site);
const round = (v, p = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** p) / 10 ** p : null);

async function getJson(res, what) {
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* below */ }
  if (!res.ok) {
    const msg = body?.error?.message || body?.Message || body?.message || text.slice(0, 200);
    throw new Error(`${what}: ${res.status} ${msg}`.trim());
  }
  if (body === null) throw new Error(`${what}: not JSON`);
  return body;
}

// ------------------------------------------------------------- Google
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

// An OAuth access token for the service account (JWT bearer grant, RS256).
async function googleToken(sa) {
  const pem = String(sa.private_key || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(sig)}`,
  });
  return (await getJson(res, 'Google sign-in')).access_token;
}

export async function fetchGoogle(env, now = Date.now()) {
  let sa;
  try { sa = JSON.parse(env.GSC_SERVICE_ACCOUNT); } catch (e) { throw new Error('GSC_SERVICE_ACCOUNT is not the JSON key file.'); }
  if (!sa.client_email || !sa.private_key) throw new Error('GSC_SERVICE_ACCOUNT is missing client_email or private_key.');
  const token = await googleToken(sa);
  const site = siteOf(env);
  const auth = { Authorization: `Bearer ${token}` };
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}`;
  // Search data arrives two or three days late; end the range yesterday.
  const end = isoDay(now - DAY);
  const start = isoDay(now - RANGE_DAYS * DAY);
  const query = (dimensions, rowLimit) => fetch(`${base}/searchAnalytics/query`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit, dataState: 'all' }),
  }).then((r) => getJson(r, 'Google search data'));
  const errors = [];
  const soft = (p, fallback) => p.catch((e) => { errors.push(e.message); return fallback; });
  const [byDate, byQuery, byPage, totals, maps, home] = await Promise.all([
    query(['date'], 100),
    query(['query'], TOP),
    query(['page'], TOP),
    query([], 1),
    soft(fetch(`${base}/sitemaps`, { headers: auth }).then((r) => getJson(r, 'Google sitemaps')), {}),
    soft(fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: homeOf(site), siteUrl: site }),
    }).then((r) => getJson(r, 'Google page check')), {}),
  ]);
  const row = (r) => ({ clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: round((r.ctr || 0) * 100, 1), position: round(r.position, 1) });
  const t = (totals.rows || [])[0] || {};
  const idx = home.inspectionResult?.indexStatusResult;
  return {
    site, start, end,
    totals: row(t),
    byDay: (byDate.rows || []).map((r) => ({ date: r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0 })),
    queries: (byQuery.rows || []).map((r) => ({ key: r.keys[0], ...row(r) })),
    pages: (byPage.rows || []).map((r) => ({ key: r.keys[0], ...row(r) })),
    sitemaps: (maps.sitemap || []).map((m) => ({
      path: m.path, lastSubmitted: m.lastSubmitted || null, lastDownloaded: m.lastDownloaded || null, pending: !!m.isPending,
      errors: Number(m.errors || 0), warnings: Number(m.warnings || 0),
      submitted: (m.contents || []).reduce((s, c) => s + Number(c.submitted || 0), 0),
      indexed: (m.contents || []).reduce((s, c) => s + Number(c.indexed || 0), 0),
    })),
    home: idx ? { url: site, verdict: idx.verdict || null, coverage: idx.coverageState || null, lastCrawl: idx.lastCrawlTime || null, fetch: idx.pageFetchState || null, robots: idx.robotsTxtState || null } : null,
    errors,
  };
}

// ------------------------------------------------------------- Bing
// "/Date(1729814400000-0700)/" -> 1729814400000
export const bingDate = (v) => { const m = /Date\((-?\d+)/.exec(String(v || '')); return m ? Number(m[1]) : null; };

export async function fetchBing(env, now = Date.now()) {
  const site = homeOf(siteOf(env));
  const call = (method) => fetch(`https://ssl.bing.com/webmaster/api.svc/json/${method}?siteUrl=${encodeURIComponent(site)}&apikey=${encodeURIComponent(env.BING_WEBMASTER_KEY)}`)
    .then((r) => getJson(r, `Bing ${method}`)).then((j) => (Array.isArray(j.d) ? j.d : []))
    // Bing can echo the key in its error text; never store it.
    .catch((e) => { throw new Error(String(e.message).split(env.BING_WEBMASTER_KEY).join('…')); });
  const errors = [];
  const soft = (p) => p.catch((e) => { errors.push(e.message); return []; });
  const [traffic, queries, pages, feeds, crawl] = await Promise.all([
    call('GetRankAndTrafficStats'), soft(call('GetQueryStats')), soft(call('GetPageStats')), soft(call('GetFeeds')), soft(call('GetCrawlStats')),
  ]);
  const since = now - RANGE_DAYS * DAY;
  const byDay = traffic.map((x) => ({ date: isoDay(bingDate(x.Date) || 0), clicks: x.Clicks || 0, impressions: x.Impressions || 0, ms: bingDate(x.Date) || 0 }))
    .filter((x) => x.ms >= since).sort((a, b) => a.ms - b.ms).map(({ ms, ...x }) => x);
  // Query and page stats come as weekly rows; add up the last four weeks.
  const top = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if ((bingDate(r.Date) || now) < since) continue;
      const k = r.Query;
      const e = m.get(k) || { key: k, clicks: 0, impressions: 0, posSum: 0, posN: 0 };
      e.clicks += r.Clicks || 0;
      e.impressions += r.Impressions || 0;
      if (r.AvgImpressionPosition > 0) { e.posSum += r.AvgImpressionPosition * (r.Impressions || 1); e.posN += r.Impressions || 1; }
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, TOP)
      .map(({ posSum, posN, ...e }) => ({ ...e, ctr: e.impressions ? round((100 * e.clicks) / e.impressions, 1) : 0, position: posN ? round(posSum / posN, 1) : null }));
  };
  const clicks = byDay.reduce((s, x) => s + x.clicks, 0);
  const impressions = byDay.reduce((s, x) => s + x.impressions, 0);
  const lastCrawl = crawl.map((c) => ({ ...c, ms: bingDate(c.Date) || 0 })).sort((a, b) => b.ms - a.ms)[0];
  return {
    site, start: isoDay(since), end: isoDay(now),
    totals: { clicks, impressions, ctr: impressions ? round((100 * clicks) / impressions, 1) : 0, position: null },
    byDay,
    queries: top(queries),
    pages: top(pages),
    sitemaps: feeds.map((f) => ({
      path: f.Url, lastSubmitted: bingDate(f.Submitted) ? new Date(bingDate(f.Submitted)).toISOString() : null,
      lastDownloaded: bingDate(f.LastCrawled) ? new Date(bingDate(f.LastCrawled)).toISOString() : null,
      status: f.Status || null, submitted: f.UrlCount || 0, indexed: null,
    })),
    crawl: lastCrawl ? { date: isoDay(lastCrawl.ms), inIndex: lastCrawl.InIndex ?? null, crawled: lastCrawl.CrawledPages ?? null, errors: lastCrawl.CrawlErrors ?? null } : null,
    errors,
  };
}

// ------------------------------------------------------------- store
const SOURCES = {
  google: { configured: (env) => !!env.GSC_SERVICE_ACCOUNT, fetch: fetchGoogle },
  bing: { configured: (env) => !!env.BING_WEBMASTER_KEY, fetch: fetchBing },
};

// Fetches each connected source and saves it. A failed fetch keeps the last
// good numbers and records the error next to them.
export async function refreshSearch(env, now = Date.now()) {
  const out = {};
  for (const [name, src] of Object.entries(SOURCES)) {
    if (!src.configured(env)) { out[name] = 'not_connected'; continue; }
    try {
      const data = await src.fetch(env, now);
      await env.DB.prepare(`INSERT INTO search_snapshots (source, fetched_at, data, error, tried_at) VALUES (?1, ?2, ?3, NULL, ?2)
        ON CONFLICT (source) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data, error = NULL, tried_at = excluded.tried_at`)
        .bind(name, now, JSON.stringify(data)).run();
      out[name] = 'ok';
    } catch (e) {
      const msg = String(e.message || e).slice(0, 500);
      await env.DB.prepare(`INSERT INTO search_snapshots (source, fetched_at, data, error, tried_at) VALUES (?1, NULL, NULL, ?2, ?3)
        ON CONFLICT (source) DO UPDATE SET error = excluded.error, tried_at = excluded.tried_at`).bind(name, msg, now).run();
      out[name] = 'error';
    }
  }
  return out;
}

export async function searchSnapshots(env) {
  const { results } = await env.DB.prepare('SELECT source, fetched_at, data, error, tried_at FROM search_snapshots').all();
  const rows = new Map(results.map((r) => [r.source, r]));
  return Object.fromEntries(Object.entries(SOURCES).map(([name, src]) => {
    const r = rows.get(name);
    return [name, {
      connected: src.configured(env),
      fetchedAt: r?.fetched_at || null,
      triedAt: r?.tried_at || null,
      error: r?.error || null,
      data: r?.data ? JSON.parse(r.data) : null,
    }];
  }));
}

export async function lastTry(env) {
  const r = await env.DB.prepare('SELECT MAX(tried_at) AS t FROM search_snapshots').first();
  return r?.t || 0;
}
