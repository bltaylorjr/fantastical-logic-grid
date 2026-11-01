// Puzzles from the private puzzle server (docs/PUZZLE-SERVER.md). In server
// mode the website has no puzzle generator of its own: it asks here, and this
// Worker asks the puzzle server on the Oracle build server through a
// Cloudflare Tunnel (the Workers VPC binding PUZZLES). The puzzle server has
// no public address, so this route is the only way in, and it adds the shared
// key PUZZLE_KEY (a Worker secret) to every request.
//
//   POST /v1/puzzles/<game>/<op>  { args }  -> { result }
//     every game and operation in engine/src/games.js (a new game there
//     works here with no changes)
//   GET  /v1/puzzles/health                 -> { ok, release, busy, queued }
//
// Only the game's own pages and apps may call it (ALLOWED_ORIGINS), every
// visitor has a rate limit, and request sizes are capped before anything is
// sent on. Until the binding and the secret are both set it answers 503
// "puzzles_off", and the site keeps its own engine (the build only drops the
// engine when FLG_PUZZLE_SERVER=1).
import { json, readText, TooLarge, allowedOrigin } from './http.js';
import { OP_KINDS, opKind } from '../../engine/src/games.js';

// The VPC Service decides where requests really go; this address only names it.
const ORIGIN = 'http://172.30.0.10:8080';
// Building a puzzle ('build' operations) counts against LIMIT_PUZZLES;
// everything during play ('play': hints, moves, checks) against LIMIT_HINTS.
const LIMITERS = { build: 'LIMIT_PUZZLES', play: 'LIMIT_HINTS' };
const ROUTE = /^\/v1\/puzzles\/(?:health|([a-z0-9-]+)\/([a-z0-9-]+))$/;

export const puzzlesReady = (env) => !!(env.PUZZLES && typeof env.PUZZLES.fetch === 'function' && String(env.PUZZLE_KEY || '').length >= 32);

export async function handlePuzzles(req, env, url) {
  const m = url.pathname.match(ROUTE);
  if (!m) {
    if (url.pathname.startsWith('/v1/puzzles/')) return json(req, env, { error: 'not_found' }, 404);
    return null;
  }
  const [, game, name] = m;
  const op = game ? `${game}/${name}` : 'health';
  const kind = game ? opKind(game, name) : null;
  if (game && !kind) return json(req, env, { error: 'not_found' }, 404);
  const fail = (error, status, extra = {}, headers = {}) => json(req, env, { error, ...extra }, status, headers);
  if (!puzzlesReady(env)) return fail('puzzles_off', 503);

  if (op === 'health') {
    if (req.method !== 'GET') return fail('not_found', 404);
    try {
      const res = await env.PUZZLES.fetch(`${ORIGIN}/v1/health`, { headers: { 'X-FLG-Key': env.PUZZLE_KEY } });
      const h = await res.json().catch(() => ({}));
      return json(req, env, { ok: res.ok && h.ok === true, release: h.release || null, busy: h.busy ?? null, queued: h.queued ?? null }, res.ok ? 200 : 502);
    } catch (e) {
      return fail('unreachable', 502);
    }
  }

  if (req.method !== 'POST') return fail('not_found', 404);
  // Browsers always send Origin; anything else (scripts, scrapers) is turned away.
  if (!allowedOrigin(req, env)) return fail('forbidden', 403);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const limiter = env[LIMITERS[kind]];
  if (limiter && !(await limiter.limit({ key: ip })).success) return fail('slow_down', 429, {}, { 'Retry-After': '60' });

  let body;
  try {
    body = JSON.parse(await readText(req, OP_KINDS[kind].maxBytes));
  } catch (e) {
    return e instanceof TooLarge ? fail('too_large', 413) : fail('bad_request', 400);
  }
  if (!body || typeof body.args !== 'object' || body.args === null || Array.isArray(body.args)) return fail('bad_args', 400);

  let res;
  try {
    res = await env.PUZZLES.fetch(`${ORIGIN}/v1/run/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FLG-Key': env.PUZZLE_KEY },
      body: JSON.stringify({ args: body.args }),
    });
  } catch (e) {
    return fail('unreachable', 502);
  }
  const text = await res.text();
  // Pass the server's answer through; its 401 would mean our key is wrong,
  // which is a setup problem, not the player's.
  const status = res.status === 401 ? 502 : res.status;
  return new Response(text, { status, headers: json(req, env, {}, status).headers });
}
