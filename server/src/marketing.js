// Marketing: every campaign and ad, the media they use, tracked links, and
// what each link brought in.
//
//   POST /v1/m                          one anonymous event from the game: a visit
//                                       from a campaign link or another site, and
//                                       later plays, solves, installs and Windows
//                                       downloads from that visit (web/js/campaign.js)
//   GET  /admin/v1/marketing?days=      campaigns, ads, media and their numbers (viewer)
//   POST /admin/v1/marketing/campaigns  add or change a campaign (admin)
//   POST /admin/v1/marketing/campaigns/:id/delete   with its ads (admin)
//   POST /admin/v1/marketing/ads        add or change an ad (admin)
//   POST /admin/v1/marketing/ads/:id/delete
//   POST /admin/v1/marketing/media      add or change a media entry (admin)
//   POST /admin/v1/marketing/media/:id/delete
//   GET  /admin/v1/export/marketing.csv  the numbers as a spreadsheet (admin)
//
// Privacy: an event is a count in campaign_stats for one day, campaign,
// source, medium, ad, event and platform. Nothing about the player, device or
// address is kept, so numbers can never be tied to a person. Codes the
// dashboard does not know are counted as '(other)' or 'other', so nobody can
// fill the table with made-up names.
import { json, readText, TooLarge } from './http.js';
import { SEEDS } from './marketing-seed.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const EVENTS = ['visit', 'play', 'solve', 'install', 'download'];
export const MEDIUMS = ['social', 'video', 'forum', 'community', 'directory', 'store', 'email', 'referral', 'search', 'print', 'qr', 'other'];
export const CAMPAIGN_STATUS = ['draft', 'active', 'paused', 'ended'];
export const AD_STATUS = ['draft', 'approved', 'posted', 'removed'];
export const MEDIA_KINDS = ['video', 'image', 'text', 'other'];
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
// Sources the game names from the page a visitor came from (campaign.js),
// always accepted. Ads add their own channels.
export const KNOWN_SOURCES = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave', 'reddit', 'facebook', 'instagram', 'x', 'threads', 'bluesky', 'mastodon',
  'youtube', 'tiktok', 'pinterest', 'linkedin', 'discord', 'itch', 'producthunt', 'hackernews', 'indiehackers', 'alternativeto', 'microsoftstore', 'github', 'quora', 'email', 'other'];
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CODES_CACHE_MS = 300_000;
let codes = null; // { at, campaigns: Map(code -> Set(content)), sources: Set }

const slug = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

async function knownCodes(env, now = Date.now()) {
  if (codes && now - codes.at < CODES_CACHE_MS) return codes;
  const { results } = await env.DB.prepare('SELECT c.code, a.channel, a.content FROM campaigns c LEFT JOIN campaign_ads a ON a.campaign_id = c.id').all();
  const campaigns = new Map();
  const sources = new Set(KNOWN_SOURCES);
  for (const r of results) {
    if (!campaigns.has(r.code)) campaigns.set(r.code, new Set());
    if (r.content) campaigns.get(r.code).add(r.content);
    if (r.channel) sources.add(r.channel);
  }
  codes = { at: now, campaigns, sources };
  return codes;
}
const forgetCodes = () => { codes = null; };

// Turns what the game sent into one stats row, or null if it is not an event.
export function cleanEvent(body, known) {
  const event = EVENTS.includes(body?.e) ? body.e : null;
  if (!event) return null;
  let campaign = slug(body.c);
  let content = slug(body.k);
  if (!campaign) { campaign = '(none)'; content = ''; } else if (!known.campaigns.has(campaign)) { campaign = '(other)'; content = ''; } else if (content && !known.campaigns.get(campaign).has(content)) content = 'other';
  const s = slug(body.s);
  const source = s && known.sources.has(s) ? s : 'other';
  const medium = MEDIUMS.includes(body.m) ? body.m : (campaign === '(none)' ? 'referral' : 'other');
  const platform = PLATFORMS.has(body.p) ? body.p : 'web';
  return { campaign, source, medium, content, event, platform };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Returns a Response for POST /v1/m, or null for anything else.
export async function handleMarketing(req, env, url) {
  if (url.pathname !== '/v1/m' || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: (await sha256(`flg-m|${ip}`)).slice(0, 32) })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  let body;
  try { body = JSON.parse(await readText(req, 1_000)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  const row = cleanEvent(body, await knownCodes(env));
  if (!row) return json(req, env, { error: 'bad_request' }, 400);
  await env.DB.prepare(`INSERT INTO campaign_stats (day, campaign, source, medium, content, event, platform, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
    ON CONFLICT (day, campaign, source, medium, content, event, platform) DO UPDATE SET n = n + 1`)
    .bind(isoDay(Date.now()), row.campaign, row.source, row.medium, row.content, row.event, row.platform).run();
  return json(req, env, { ok: true });
}

// ------------------------------------------------------------- starter campaigns
// Each seed is added once. Media are matched by their url, so a seed can
// point its ads at media by key.
export async function applySeeds(env, now = Date.now()) {
  const done = new Set((await env.DB.prepare('SELECT id FROM marketing_seeds').all()).results.map((r) => r.id));
  let added = 0;
  for (const seed of SEEDS) {
    if (done.has(seed.id)) continue;
    const mediaIds = {};
    for (const [key, m] of Object.entries(seed.media || {})) {
      const have = await env.DB.prepare('SELECT id FROM marketing_media WHERE url = ?1').bind(m.url).first();
      mediaIds[key] = have ? have.id : (await env.DB.prepare(`INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'starter plan', ?7) RETURNING id`).bind(m.title, m.kind, m.url, m.preview || null, m.size || '', m.notes || '', now).first()).id;
    }
    const c = seed.campaign;
    const exists = await env.DB.prepare('SELECT id FROM campaigns WHERE code = ?1').bind(c.code).first();
    if (!exists) {
      const { id } = await env.DB.prepare(`INSERT INTO campaigns (code, name, goal, notes, status, starts, ends, created_by, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'starter plan', ?8, ?8) RETURNING id`).bind(c.code, c.name, c.goal || '', c.notes || '', c.status || 'draft', c.starts || null, c.ends || null, now).first();
      const stmts = (seed.ads || []).map((a) => env.DB.prepare(`INSERT INTO campaign_ads (campaign_id, channel, medium, content, title, body, media, landing, status, where_to, notes, created_by, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', ?9, ?10, 'starter plan', ?11, ?11)`)
        .bind(id, a.channel, a.medium, a.content, a.title, a.body, JSON.stringify((a.media || []).map((k) => mediaIds[k]).filter(Boolean)), a.landing || '/', a.where || '', a.notes || '', now));
      if (stmts.length) await env.DB.batch(stmts);
    }
    await env.DB.prepare('INSERT OR IGNORE INTO marketing_seeds (id, at) VALUES (?1, ?2)').bind(seed.id, now).run();
    added++;
  }
  if (added) forgetCodes();
  return added;
}

// ------------------------------------------------------------- links
export function trackedLink(site, ad, code) {
  const base = String(site || 'https://thelogicgrid.com').replace(/\/+$/, '');
  const path = /^\/[\w\-./]*$/.test(ad.landing || '') ? ad.landing : '/';
  const q = new URLSearchParams({ utm_source: ad.channel, utm_medium: ad.medium, utm_campaign: code });
  if (ad.content) q.set('utm_content', ad.content);
  return `${base}${path}?${q}`;
}

// ------------------------------------------------------------- numbers
const blank = () => Object.fromEntries(EVENTS.map((e) => [e, 0]));
function add(map, key, extra, event, n) {
  if (!map.has(key)) map.set(key, { ...extra, ...blank() });
  map.get(key)[event] += n;
}

export async function overview(env, days, now = Date.now()) {
  await applySeeds(env, now);
  const since = isoDay(now - (days - 1) * DAY);
  const [campaigns, ads, media, stats] = await Promise.all([
    env.DB.prepare('SELECT id, code, name, goal, notes, status, starts, ends, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt FROM campaigns ORDER BY created_at DESC').all(),
    env.DB.prepare(`SELECT id, campaign_id AS campaignId, channel, medium, content, title, body, media, landing, status, where_to AS "where", post_url AS postUrl, posted_at AS postedAt, notes,
      created_at AS createdAt, updated_at AS updatedAt FROM campaign_ads ORDER BY campaign_id, channel, id`).all(),
    env.DB.prepare('SELECT id, title, kind, url, preview, size, notes, created_at AS createdAt FROM marketing_media ORDER BY id').all(),
    env.DB.prepare('SELECT day, campaign, source, medium, content, event, platform, SUM(n) AS n FROM campaign_stats WHERE day >= ?1 GROUP BY day, campaign, source, medium, content, event, platform').bind(since).all(),
  ]);
  const byCode = new Map(campaigns.results.map((c) => [c.code, c]));
  const byCampaign = new Map(), bySource = new Map(), byAd = new Map(), byDay = new Map(), byPlatform = new Map();
  const totals = blank();
  for (const r of stats.results) {
    totals[r.event] += r.n;
    add(byCampaign, r.campaign, { campaign: r.campaign, name: byCode.get(r.campaign)?.name || (r.campaign === '(none)' ? 'No campaign (links from other sites)' : 'Unknown campaign codes') }, r.event, r.n);
    add(bySource, `${r.source}|${r.medium}`, { source: r.source, medium: r.medium }, r.event, r.n);
    add(byAd, `${r.campaign}|${r.source}|${r.content}`, { campaign: r.campaign, source: r.source, content: r.content }, r.event, r.n);
    add(byDay, r.day, { day: r.day }, r.event, r.n);
    add(byPlatform, r.platform, { platform: r.platform }, r.event, r.n);
  }
  const trend = [];
  for (let t = now - (days - 1) * DAY; isoDay(t) <= isoDay(now); t += DAY) trend.push(byDay.get(isoDay(t)) || { day: isoDay(t), ...blank() });
  const sorted = (m) => [...m.values()].sort((a, b) => b.visit - a.visit || b.solve - a.solve);
  const site = env.SITE_URL || 'https://thelogicgrid.com';
  const codeOf = new Map(campaigns.results.map((c) => [c.id, c.code]));
  const adStats = new Map([...byAd.values()].map((s) => [`${s.campaign}|${s.source}|${s.content}`, s]));
  return {
    since, days, site, events: EVENTS, mediums: MEDIUMS, campaignStatus: CAMPAIGN_STATUS, adStatus: AD_STATUS, mediaKinds: MEDIA_KINDS, sources: KNOWN_SOURCES,
    totals, trend,
    byCampaign: sorted(byCampaign), bySource: sorted(bySource), byPlatform: sorted(byPlatform),
    campaigns: campaigns.results,
    ads: ads.results.map((a) => {
      const code = codeOf.get(a.campaignId);
      const s = adStats.get(`${code}|${a.channel}|${a.content}`);
      return { ...a, media: JSON.parse(a.media || '[]'), link: trackedLink(site, a, code), stats: s ? Object.fromEntries(EVENTS.map((e) => [e, s[e]])) : blank() };
    }),
    media: media.results,
  };
}

export async function statsCsv(env, now = Date.now()) {
  const { results } = await env.DB.prepare('SELECT day, campaign, source, medium, content, event, platform, n FROM campaign_stats ORDER BY day, campaign, source, content, event').all();
  const cell = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
  const q = (v) => `"${cell(v).replace(/"/g, '""')}"`;
  return ['day,campaign,source,medium,ad,event,platform,count', ...results.map((r) => [r.day, r.campaign, r.source, r.medium, r.content, r.event, r.platform, r.n].map(q).join(','))].join('\r\n');
}

// ------------------------------------------------------------- admin routes
function checkUrl(v, Refusal, what) {
  const s = str(v, 500);
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { throw new Refusal(400, 'bad_url', `${what} must be a full web address (https://…).`); }
  if (u.protocol !== 'https:') throw new Refusal(400, 'bad_url', `${what} must start with https://.`);
  return u.toString();
}

export function marketingRoutes(Refusal) {
  const daysParam = (url) => Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
  return [
    ['GET', /^marketing$/, 'viewer', 'marketing.view', async ({ env, url, now }) => ({ body: await overview(env, daysParam(url), now) })],
    ['GET', /^export\/marketing\.csv$/, 'admin', 'marketing.export', async ({ env, now }) => ({ file: await statsCsv(env, now), type: 'text/csv; charset=utf-8', name: `logic-grid-marketing-${isoDay(now)}.csv` })],

    ['POST', /^marketing\/campaigns$/, 'admin', 'marketing.campaign', async ({ env, body, who, now }) => {
      const name = str(body.name, 120);
      if (name.length < 2) throw new Refusal(400, 'bad_name', 'Give the campaign a name.');
      const code = slug(body.code || name);
      if (!SLUG.test(code)) throw new Refusal(400, 'bad_code', 'The link code needs letters or numbers (a-z, 0-9, - and _).');
      const status = CAMPAIGN_STATUS.includes(body.status) ? body.status : 'draft';
      const starts = dateOrNull(body.starts), ends = dateOrNull(body.ends);
      if (starts && ends && ends < starts) throw new Refusal(400, 'bad_dates', 'The end date must be after the start.');
      const id = Number(body.id) || null;
      const clash = await env.DB.prepare('SELECT id FROM campaigns WHERE code = ?1').bind(code).first();
      if (clash && clash.id !== id) throw new Refusal(409, 'code_taken', 'Another campaign already uses that link code.');
      let out;
      if (id) {
        const old = await env.DB.prepare('SELECT code FROM campaigns WHERE id = ?1').bind(id).first();
        if (!old) throw new Refusal(404, 'gone', 'That campaign is gone.');
        await env.DB.prepare('UPDATE campaigns SET code = ?2, name = ?3, goal = ?4, notes = ?5, status = ?6, starts = ?7, ends = ?8, updated_at = ?9 WHERE id = ?1')
          .bind(id, code, name, str(body.goal, 500), str(body.notes, 2000), status, starts, ends, now).run();
        out = { body: { id, code }, target: id, detail: { name, status, ...(old.code !== code ? { code: { from: old.code, to: code } } : {}) } };
      } else {
        const r = await env.DB.prepare(`INSERT INTO campaigns (code, name, goal, notes, status, starts, ends, created_by, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) RETURNING id`).bind(code, name, str(body.goal, 500), str(body.notes, 2000), status, starts, ends, who.actor, now).first();
        out = { body: { id: r.id, code }, target: r.id, detail: { name, code, status } };
      }
      forgetCodes();
      return out;
    }],
    ['POST', /^marketing\/campaigns\/(\d+)\/delete$/, 'admin', 'marketing.campaign_delete', async ({ env, params: [id], body }) => {
      const c = await env.DB.prepare('SELECT code, name FROM campaigns WHERE id = ?1').bind(Number(id)).first();
      if (!c) throw new Refusal(404, 'gone', 'That campaign is gone.');
      if (body.confirm !== c.code) throw new Refusal(400, 'confirm', 'Type the campaign link code to confirm.');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM campaign_ads WHERE campaign_id = ?1').bind(Number(id)),
        env.DB.prepare('DELETE FROM campaigns WHERE id = ?1').bind(Number(id)),
      ]);
      forgetCodes();
      return { body: { ok: true }, target: id, detail: { name: c.name, code: c.code } };
    }],

    ['POST', /^marketing\/ads$/, 'admin', 'marketing.ad', async ({ env, body, who, now }) => {
      const campaignId = Number(body.campaignId);
      if (!(await env.DB.prepare('SELECT id FROM campaigns WHERE id = ?1').bind(campaignId).first())) throw new Refusal(400, 'no_campaign', 'Choose a campaign.');
      const title = str(body.title, 200);
      if (title.length < 2) throw new Refusal(400, 'bad_title', 'Give the ad a short title.');
      const channel = slug(body.channel);
      if (!SLUG.test(channel)) throw new Refusal(400, 'bad_channel', 'Name the channel (for example reddit or facebook).');
      const content = slug(body.content || title);
      const medium = MEDIUMS.includes(body.medium) ? body.medium : 'social';
      const status = AD_STATUS.includes(body.status) ? body.status : 'draft';
      const landing = /^\/[\w\-./]{0,100}$/.test(String(body.landing || '/')) ? String(body.landing || '/') : '/';
      const media = (Array.isArray(body.media) ? body.media : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 20);
      const postUrl = checkUrl(body.postUrl, Refusal, 'The post link') || null;
      const text = str(body.body, 5000), where = str(body.where, 500), notes = str(body.notes, 2000);
      const id = Number(body.id) || null;
      let out;
      if (id) {
        const old = await env.DB.prepare('SELECT status, posted_at FROM campaign_ads WHERE id = ?1').bind(id).first();
        if (!old) throw new Refusal(404, 'gone', 'That ad is gone.');
        const postedAt = status === 'posted' ? (old.posted_at || now) : old.posted_at;
        await env.DB.prepare(`UPDATE campaign_ads SET campaign_id = ?2, channel = ?3, medium = ?4, content = ?5, title = ?6, body = ?7, media = ?8, landing = ?9, status = ?10,
          where_to = ?11, post_url = ?12, posted_at = ?13, notes = ?14, updated_at = ?15 WHERE id = ?1`)
          .bind(id, campaignId, channel, medium, content, title, text, JSON.stringify(media), landing, status, where, postUrl, postedAt, notes, now).run();
        out = { body: { id }, target: id, detail: { title, channel, status, ...(old.status !== status ? { from: old.status } : {}) } };
      } else {
        const r = await env.DB.prepare(`INSERT INTO campaign_ads (campaign_id, channel, medium, content, title, body, media, landing, status, where_to, post_url, posted_at, notes, created_by, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15) RETURNING id`)
          .bind(campaignId, channel, medium, content, title, text, JSON.stringify(media), landing, status, where, postUrl, status === 'posted' ? now : null, notes, who.actor, now).first();
        out = { body: { id: r.id }, target: r.id, detail: { title, channel, status } };
      }
      forgetCodes();
      return out;
    }],
    ['POST', /^marketing\/ads\/(\d+)\/delete$/, 'admin', 'marketing.ad_delete', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('DELETE FROM campaign_ads WHERE id = ?1').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That ad is gone.');
      forgetCodes();
      return { body: { ok: true }, target: id };
    }],

    ['POST', /^marketing\/media$/, 'admin', 'marketing.media', async ({ env, body, who, now }) => {
      const title = str(body.title, 200);
      if (title.length < 2) throw new Refusal(400, 'bad_title', 'Give the file a name.');
      const url = checkUrl(body.url, Refusal, 'The link');
      if (!url) throw new Refusal(400, 'bad_url', 'Add the link where the file can be seen or downloaded.');
      const kind = MEDIA_KINDS.includes(body.kind) ? body.kind : 'other';
      const id = Number(body.id) || null;
      if (id) {
        const r = await env.DB.prepare('UPDATE marketing_media SET title = ?2, kind = ?3, url = ?4, size = ?5, notes = ?6 WHERE id = ?1').bind(id, title, kind, url, str(body.size, 60), str(body.notes, 1000)).run();
        if (!r.meta.changes) throw new Refusal(404, 'gone', 'That file is gone.');
        return { body: { id }, target: id, detail: { title } };
      }
      const r = await env.DB.prepare(`INSERT INTO marketing_media (title, kind, url, size, notes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`)
        .bind(title, kind, url, str(body.size, 60), str(body.notes, 1000), who.actor, now).first();
      return { body: { id: r.id }, target: r.id, detail: { title, url } };
    }],
    ['POST', /^marketing\/media\/(\d+)\/delete$/, 'admin', 'marketing.media_delete', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('DELETE FROM marketing_media WHERE id = ?1').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That file is gone.');
      return { body: { ok: true }, target: id };
    }],
  ];
}
