// CORS and JSON helpers shared by every route. Only the game's own pages and
// apps (ALLOWED_ORIGINS in wrangler.toml) may call the Worker from a browser.
// Requests carry a bearer token, never cookies, so no credentials mode is needed.

export function allowedOrigin(req, env) {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

export function corsHeaders(req, env) {
  const origin = allowedOrigin(req, env);
  const h = { Vary: 'Origin' };
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

export function json(req, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req, env), ...extra },
  });
}

// Reads a request body as text, stopping as soon as it passes maxBytes, so a
// huge or endless upload never fills the Worker's memory. Throws TooLarge.
export class TooLarge extends Error {}

export async function readText(req, maxBytes) {
  if (Number(req.headers.get('Content-Length') || 0) > maxBytes) throw new TooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new TooLarge(); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

// Headers every Worker response carries. API answers are JSON and never meant
// to be shown as a page, framed or sniffed as another type; HSTS keeps every
// visit on HTTPS. The admin app's own pages set a fuller policy (admin.js).
const BASE_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function secured(res) {
  const out = new Response(res.body, res); // headers of redirects and asset responses are read-only
  for (const [k, v] of Object.entries(BASE_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  if (!out.headers.has('Content-Security-Policy') && !/^text\/html/i.test(out.headers.get('Content-Type') || '')) out.headers.set('Content-Security-Policy', API_CSP);
  return out;
}
