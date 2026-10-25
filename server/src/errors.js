// Anonymous error reports from the apps, so problems players hit show up
// without anyone having to write in.
//
//   POST /v1/errors        up to 5 reports { kind, message, stack, platform, version }
//   GET  /admin/errors     the last 7 days of reports, most frequent first (ADMIN_TOKEN)
//
// Reports are cleaned before they are stored: web addresses, email addresses
// and long numbers are blanked, and only file:line of the first stack frames
// is kept. Nothing about the player or device is stored. The same error on
// the same day only raises its count, and a day holds at most
// MAX_DISTINCT_PER_DAY distinct errors, so a flood cannot fill the database.
import { json } from './http.js';

const MAX_DISTINCT_PER_DAY = 300;
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
const KINDS = new Set(['error', 'rejection', 'engine']);

const today = () => new Date().toISOString().slice(0, 10);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cleanMessage(text) {
  return String(text || '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{8,}\b|\d{5,}/gi, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// "at fn (https://site/js/app.js?x=1:12:5)" -> "app.js:12"
export function cleanStack(text) {
  const places = [];
  for (const m of String(text || '').matchAll(/([\w.-]+\.m?js)(?:\?[^:\s)]*)?:(\d+)(?::\d+)?/g)) {
    places.push(`${m[1]}:${m[2]}`);
    if (places.length === 3) break;
  }
  return places.join(' < ');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function postErrors(req, env) {
  const text = await req.text();
  if (text.length > 8_000) return json(req, env, { error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(req, env, { error: 'bad_request' }, 400); }
  const list = Array.isArray(body?.errors) ? body.errors.slice(0, 5) : [];
  const day = today();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_errors WHERE day = ?1').bind(day).first();
  let saved = 0;
  for (const e of list) {
    const message = cleanMessage(e?.message);
    if (!message) continue;
    const kind = KINDS.has(e.kind) ? e.kind : 'error';
    const platform = PLATFORMS.has(e.platform) ? e.platform : 'web';
    const version = /^[\w.-]{1,24}$/.test(String(e.version)) ? String(e.version) : 'unknown';
    const place = cleanStack(e.stack);
    const fingerprint = (await sha256(`${kind}|${platform}|${version}|${message}|${place}`)).slice(0, 32);
    const stmt = n + saved < MAX_DISTINCT_PER_DAY
      ? env.DB.prepare(`INSERT INTO app_errors (day, fingerprint, platform, version, kind, message, place) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          ON CONFLICT (day, fingerprint) DO UPDATE SET count = count + 1`).bind(day, fingerprint, platform, version, kind, message, place)
      : env.DB.prepare('UPDATE app_errors SET count = count + 1 WHERE day = ?1 AND fingerprint = ?2').bind(day, fingerprint);
    const r = await stmt.run();
    if (r.meta?.changes) saved++;
  }
  return json(req, env, { saved });
}

async function listErrors(req, env) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/, '');
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16 || !safeEqual(token, env.ADMIN_TOKEN)) return json(req, env, { error: 'not_allowed' }, 401);
  const days = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 7));
  const since = new Date(Date.now() - (days - 1) * 24 * 3600_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT kind, platform, version, message, place, SUM(count) AS count, MIN(day) AS first, MAX(day) AS last
    FROM app_errors WHERE day >= ?1 GROUP BY fingerprint ORDER BY count DESC LIMIT 100`).bind(since).all();
  return json(req, env, { since, errors: results });
}

// Returns a Response for this module's routes, or null for anything else.
export async function handleErrors(req, env, url) {
  if (url.pathname === '/v1/errors' && req.method === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMIT_ERRORS && !(await env.LIMIT_ERRORS.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) })).success) {
      return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
    }
    return postErrors(req, env);
  }
  if (url.pathname === '/admin/errors' && req.method === 'GET') return listErrors(req, env);
  return null;
}
