// Challenge a friend: after solving, a player can share a short link that
// opens the very same puzzle for anyone, no account needed, with their time
// to beat. When the friend finishes, both times show.
//
//   POST /v1/challenges               { puzzle, elapsedMs, hints }  -> { code }
//   GET  /v1/challenges/:code         { puzzle, title, tier, elapsedMs, hints, plays, beat }
//   POST /v1/challenges/:code/result  { elapsedMs, hints }  -> { plays, beat, faster }
//
// Nothing about the player is kept: a challenge holds the puzzle, one time and
// two counts. Puzzle text is checked for blocked words, as for races, because
// other people will read it. Links last CHALLENGE_KEEP_MS.
import { json, readText, TooLarge } from './http.js';
import { checkPuzzle, newCode } from './compete.js';
import { getSettings } from './settings.js';

const MAX_PUZZLE_CHARS = 400_000;
const MIN_MS = 5_000;
const MAX_MS = 7 * 24 * 3600_000;
export const CHALLENGE_KEEP_MS = 60 * 24 * 3600_000;
const ROUTE = /^\/v1\/challenges(?:\/([A-Z0-9]{6})(?:\/(result))?)?$/;
const ms = (v) => (Number.isInteger(v) && v >= MIN_MS && v <= MAX_MS ? v : null);
const hintsOf = (v) => (Number.isInteger(v) && v >= 0 && v <= 999 ? v : 0);

export async function handleChallenges(req, env, url) {
  const m = url.pathname.match(ROUTE);
  if (!m) return null;
  const [, code, action] = m;
  const fail = (error, status = 400, extra = {}) => json(req, env, { error, ...extra }, status);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return fail('slow_down', 429);
  const db = env.DB;
  const now = Date.now();

  if (!code && req.method === 'POST') {
    const s = await getSettings(env);
    if (!s.challenges_enabled) return fail('off', 403, { message: 'Challenge links are switched off for now.' });
    let b;
    try { b = JSON.parse(await readText(req, MAX_PUZZLE_CHARS + 1000)); } catch (e) { return fail(e instanceof TooLarge ? 'too_large' : 'bad_request', e instanceof TooLarge ? 413 : 400); }
    const t = ms(b?.elapsedMs);
    if (!t) return fail('bad_time');
    const bad = checkPuzzle(b.puzzle);
    if (bad) return fail(bad);
    const made = await db.prepare('SELECT COUNT(*) AS n FROM challenges WHERE created_at >= ?1').bind(now - 24 * 3600_000).first();
    if (made.n >= s.challenges_daily_cap) return fail('daily_limit', 429, { message: 'Lots of challenges today. Please try again tomorrow.' });
    // Tidy up old links while we are here.
    await db.prepare('DELETE FROM challenges WHERE created_at < ?1').bind(now - CHALLENGE_KEEP_MS).run();
    const p = b.puzzle;
    for (let i = 0; i < 5; i++) {
      const c = newCode();
      const r = await db.prepare(`INSERT OR IGNORE INTO challenges (code, puzzle, story_id, tier, title, elapsed_ms, hints, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(c, JSON.stringify(p), p.story.id, p.difficulty.id, p.title, t, hintsOf(b.hints), now).run();
      if (r.meta.changes) return json(req, env, { code: c });
    }
    return fail('busy', 503);
  }
  if (!code) return fail('not_found', 404);

  const row = await db.prepare('SELECT * FROM challenges WHERE code = ?1 AND created_at >= ?2').bind(code, now - CHALLENGE_KEEP_MS).first();
  if (!row) return fail('not_found', 404, { message: 'This challenge link has expired or does not exist.' });

  if (!action && req.method === 'GET') {
    return json(req, env, { code, puzzle: JSON.parse(row.puzzle), title: row.title, tier: row.tier, elapsedMs: row.elapsed_ms, hints: row.hints, plays: row.plays, beat: row.beat });
  }
  if (action === 'result' && req.method === 'POST') {
    let b;
    try { b = JSON.parse(await readText(req, 2_000)); } catch (e) { return fail('bad_request'); }
    const t = ms(b?.elapsedMs);
    if (!t) return fail('bad_time');
    const faster = t < row.elapsed_ms;
    const r = await db.prepare('UPDATE challenges SET plays = plays + 1, beat = beat + ?2 WHERE code = ?1 RETURNING plays, beat').bind(code, faster ? 1 : 0).first();
    return json(req, env, { plays: r.plays, beat: r.beat, faster });
  }
  return fail('not_found', 404);
}

