// Site visitors: how many people open the game each day, and on what.
//
//   POST /v1/v                  one visit from the game (web/js/visit.js), at most
//                               once a day per device: guest or player, which app,
//                               operating system and kind of device
//   GET  /admin/v1/visitors?days=   the numbers for the admin Visitors page (viewer)
//
// Privacy: a visit only adds 1 to a count in visit_stats for its day and its
// broad groups. The country (and, in the US, Canada and Australia, the state or
// province) comes from Cloudflare's own lookup of the connection; the address
// itself is never stored. Values the dashboard does not know are counted as
// 'other', so nobody can fill the table with made-up names.
import { json, readText, TooLarge } from './http.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const WHO = ['guest', 'player'];
export const APPS = ['web', 'desktop', 'android', 'ios'];
export const OSES = ['windows', 'mac', 'android', 'ios', 'linux', 'chromeos', 'other'];
export const DEVICES = ['mobile', 'tablet', 'desktop'];
const REGION_COUNTRIES = new Set(['US', 'CA', 'AU']);
export const KEEP_DAYS = 400;

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

// Turns what the game sent and Cloudflare's lookup into one stats row.
export function cleanVisit(body, cf = {}) {
  if (!body || typeof body !== 'object') return null;
  const country = /^[A-Z]{2}$/.test(String(cf.country || '')) && cf.country !== 'T1' ? cf.country : 'XX';
  const region = REGION_COUNTRIES.has(country) && /^[A-Z0-9]{1,3}$/.test(String(cf.regionCode || '')) ? cf.regionCode : '';
  return {
    who: pick(body.g, WHO, 'guest'),
    app: pick(body.a, APPS, 'web'),
    os: pick(body.o, OSES, 'other'),
    device: pick(body.d, DEVICES, 'desktop'),
    country,
    region,
  };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Returns a Response for POST /v1/v, or null for anything else.
export async function handleVisits(req, env, url) {
  if (url.pathname !== '/v1/v' || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: (await sha256(`flg-v|${ip}`)).slice(0, 32) })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  let body;
  try { body = JSON.parse(await readText(req, 500)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  const row = cleanVisit(body, req.cf || {});
  if (!row) return json(req, env, { error: 'bad_request' }, 400);
  await env.DB.prepare(`INSERT INTO visit_stats (day, who, app, os, device, country, region, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
    ON CONFLICT (day, who, app, os, device, country, region) DO UPDATE SET n = n + 1`)
    .bind(isoDay(Date.now()), row.who, row.app, row.os, row.device, row.country, row.region).run();
  return json(req, env, { ok: true });
}

// ------------------------------------------------------------- numbers
const group = (rows, key, order) => {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + r.n);
  const out = [...m].map(([id, n]) => ({ id, n }));
  return order ? out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : out.sort((a, b) => b.n - a.n);
};

export async function visitorNumbers(env, days, now = Date.now()) {
  const dayList = Array.from({ length: days }, (_, i) => isoDay(now - (days - 1 - i) * DAY));
  const { results } = await env.DB.prepare(`SELECT day, who, app, os, device, country, region, n FROM visit_stats WHERE day >= ?1`).bind(dayList[0]).all();
  const today = isoDay(now);
  const perDay = (filter) => dayList.map((d) => results.filter((r) => r.day === d && filter(r)).reduce((s, r) => s + r.n, 0));
  const total = results.reduce((s, r) => s + r.n, 0);
  const regions = results.filter((r) => r.region).map((r) => ({ ...r, place: `${r.region}, ${r.country}` }));
  return {
    days,
    dayList,
    total,
    today: results.filter((r) => r.day === today).reduce((s, r) => s + r.n, 0),
    byDay: { guest: perDay((r) => r.who === 'guest'), player: perDay((r) => r.who === 'player') },
    who: group(results, 'who', WHO),
    app: group(results, 'app', APPS),
    os: group(results, 'os', OSES),
    device: group(results, 'device', DEVICES),
    country: group(results, 'country').slice(0, 50),
    region: group(regions, 'place').slice(0, 50),
    generatedAt: now,
  };
}

const daysParam = (url) => Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));

export function visitorRoutes() {
  return [
    ['GET', /^visitors$/, 'viewer', 'visitors.view', async ({ env, url }) => ({ body: await visitorNumbers(env, daysParam(url)) })],
  ];
}
