// Numbers that show the puzzles are good, for the website build and the game:
//
//   GET /v1/quality   { rating, daily, handPicked }
//     rating      the average star rating over the last 90 days and how many
//                 ratings it is from, or null below MIN_SHOWN ratings
//     daily       the best-rated daily puzzles of the last year, by story id
//                 (the website build turns story ids back into dates):
//                 at least MIN_DAILY ratings and an average of 4 or more
//     handPicked  the dates an admin picked in Settings (hand_picked_days)
//
// Only totals over the anonymous play summaries; cached for an hour.
import { json } from './http.js';
import { getSettings } from './settings.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round1 = (v) => Math.round(v * 10) / 10;
const MIN_SHOWN = 10;
const MIN_DAILY = 3;
const TOP = 30;

export async function qualityNumbers(env, now = Date.now()) {
  const db = env.DB;
  const [all, daily] = await db.batch([
    db.prepare('SELECT AVG(rating) AS avg, COUNT(rating) AS rated FROM plays WHERE day >= ?1').bind(isoDay(now - 89 * DAY)),
    db.prepare(`SELECT story, AVG(rating) AS avg, COUNT(rating) AS rated FROM plays
      WHERE mode = 'daily' AND story IS NOT NULL AND rating IS NOT NULL AND day >= ?1
      GROUP BY story HAVING COUNT(rating) >= ?2 AND AVG(rating) >= 4 ORDER BY AVG(rating) DESC, COUNT(rating) DESC LIMIT ?3`).bind(isoDay(now - 365 * DAY), MIN_DAILY, TOP),
  ]);
  const a = all.results[0] || {};
  const s = await getSettings(env, now);
  return {
    rating: a.rated >= MIN_SHOWN ? { average: round1(a.avg), rated: a.rated, days: 90 } : null,
    daily: daily.results.map((r) => ({ story: r.story, average: round1(r.avg), rated: r.rated })),
    handPicked: s.hand_picked_days || [],
  };
}

export async function handleQuality(req, env, url) {
  if (url.pathname !== '/v1/quality' || req.method !== 'GET') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  return json(req, env, await qualityNumbers(env), 200, { 'Cache-Control': 'public, max-age=3600' });
}
