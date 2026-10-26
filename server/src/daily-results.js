// Daily puzzle results everyone can see: how many played today's puzzle, how
// many solved it and the typical time, in the spirit of Wordle's numbers.
//
//   POST /v1/daily/:date/start              a player opened the day's puzzle
//   POST /v1/daily/:date/result             { elapsedMs, revealed }
//   GET  /v1/daily/:date/stats              { started, solved, revealed, solvedPct, medianMs, minutes }
//
// Only counts are kept: one row per day and minute. Nothing about the player.
// The game sends each only once per daily save. Days more than two back or
// one ahead are refused, so old days are not filled in later.
import { json, readText } from './http.js';
import { getSettings } from './settings.js';

const DAY = 24 * 3600_000;
const MAX_MIN = 240;
const ROUTE = /^\/v1\/daily\/(\d{4}-\d{2}-\d{2})\/(start|result|stats)$/;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const okDay = (d, now) => d >= isoDay(now - 2 * DAY) && d <= isoDay(now + DAY);

// The numbers for one day from its rows.
export function summarize(rows) {
  let started = 0, revealed = 0, solved = 0;
  const minutes = [];
  for (const r of rows) {
    if (r.bucket === -1) started += r.n;
    else if (r.bucket === -2) revealed += r.n;
    else if (r.bucket >= 0) { solved += r.n; minutes.push([r.bucket, r.n]); }
  }
  minutes.sort((a, b) => a[0] - b[0]);
  // A player can solve without the start reaching us (offline), so never show
  // more solvers than players.
  started = Math.max(started, solved + revealed);
  let medianMs = null;
  if (solved) {
    let seen = 0;
    for (const [m, n] of minutes) { seen += n; if (seen * 2 >= solved) { medianMs = (m + 0.5) * 60_000; break; } }
  }
  return { started, solved, revealed, solvedPct: started ? Math.round((solved / started) * 100) : null, medianMs, minutes };
}

export async function handleDailyResults(req, env, url) {
  const m = url.pathname.match(ROUTE);
  if (!m) return null;
  const [, day, action] = m;
  const now = Date.now();
  const fail = (error, status = 400) => json(req, env, { error }, status);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return fail('slow_down', 429);
  if (!okDay(day, now)) return fail('bad_day');
  const s = await getSettings(env);
  if (!s.daily_results_enabled) return fail('off', 403);

  if (action === 'stats' && req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT bucket, n FROM daily_results WHERE day = ?1').bind(day).all();
    return json(req, env, { day, ...summarize(results) }, 200, { 'Cache-Control': 'public, max-age=60' });
  }
  if (req.method !== 'POST' || action === 'stats') return fail('not_found', 404);
  let bucket = -1;
  if (action === 'result') {
    let b;
    try { b = JSON.parse(await readText(req, 1_000)); } catch (e) { return fail('bad_request'); }
    const ms = Number(b?.elapsedMs);
    if (b?.revealed) bucket = -2;
    else if (Number.isFinite(ms) && ms >= 5_000 && ms <= 7 * DAY) bucket = Math.min(MAX_MIN, Math.floor(ms / 60_000));
    else return fail('bad_time');
  }
  await env.DB.prepare('INSERT INTO daily_results (day, bucket, n) VALUES (?1, ?2, 1) ON CONFLICT (day, bucket) DO UPDATE SET n = n + 1').bind(day, bucket).run();
  return json(req, env, { ok: true });
}
