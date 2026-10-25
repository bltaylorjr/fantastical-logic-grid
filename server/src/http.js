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
