// Player profiles for the admin dashboard: what a signed-in player plays,
// when, from roughly where, for about how long, and how it goes.
//
//   GET /admin/v1/players/:uid/profile?days=   (moderator, admin.js)
//
// Where the numbers come from:
// - The puzzles and stats come from what the player's own game already syncs
//   to their account: the solve log (meta `solves`, one entry per finished
//   puzzle) and the saved puzzles still in progress. They are read with
//   SQLite's JSON functions, so the Worker never parses the big records.
// - When, where and how long come from account_places
//   (migrations/2350_account_places.sql): one row per day, rough place and
//   kind of device, written by recordPlace() each time the signed-in game
//   checks in with the server (it does every 5 minutes while open).
//
// Privacy: the place is Cloudflare's own lookup of the connection (country,
// region, nearest city); the address itself is never stored. Star ratings stay
// anonymous (plays table, learn.js) and are never joined to an account, so a
// profile cannot show them. Guests have no profile.

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const MIN_GAP = 4 * 60_000; // write a place at most this often
const SESSION_GAP = 12 * 60_000; // longer than this between visits = a new session
export const PLACE_KEEP_DAYS = 180;
const TEXT = /^[\p{L}\p{M}\p{N} .,'()&/-]{1,60}$/u;

const clean = (v) => {
  const s = String(v || '').trim();
  return TEXT.test(s) ? s : '';
};

// Broad kind of system and device from the browser's own description of itself.
export function deviceOf(ua = '') {
  const u = String(ua);
  const os = /Android/i.test(u) ? 'android'
    : /iPhone|iPad|iPod/i.test(u) ? 'ios'
      : /CrOS/.test(u) ? 'chromeos'
        : /Windows/i.test(u) ? 'windows'
          : /Macintosh|Mac OS X/i.test(u) ? 'mac'
            : /Linux/i.test(u) ? 'linux' : 'other';
  const device = /iPad|Tablet/i.test(u) || (os === 'android' && !/Mobile/i.test(u)) ? 'tablet'
    : /Mobi|iPhone|iPod/i.test(u) ? 'mobile' : 'desktop';
  return { os, device };
}

// Cloudflare's lookup of the connection, cut down to a rough place.
export function placeOf(cf = {}) {
  const country = /^[A-Z]{2}$/.test(String(cf.country || '')) && cf.country !== 'T1' ? cf.country : 'XX';
  return { country, region: country === 'XX' ? '' : clean(cf.region), city: country === 'XX' ? '' : clean(cf.city) };
}

// One statement that notes this visit from a signed-in game. Put it in the
// same batch as the sign-in note (sync.js recordSignIn).
export function placeStatement(env, uid, req, now = Date.now()) {
  if (!req) return null;
  const { country, region, city } = placeOf(req.cf || {});
  const { os, device } = deviceOf(req.headers.get('User-Agent') || '');
  return env.DB.prepare(`INSERT INTO account_places (user_id, day, country, region, city, os, device, first_at, last_at, minutes, sessions)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 0, 1 WHERE NOT EXISTS (SELECT 1 FROM sync_deleted_users WHERE user_id = ?1)
    ON CONFLICT (user_id, day, country, region, city, os, device) DO UPDATE SET
      minutes = minutes + CASE WHEN excluded.last_at - last_at <= ?10 THEN (excluded.last_at - last_at) / 60000 ELSE 0 END,
      sessions = sessions + CASE WHEN excluded.last_at - last_at > ?10 THEN 1 ELSE 0 END,
      last_at = excluded.last_at
    WHERE account_places.last_at < excluded.last_at - ?9`)
    .bind(uid, isoDay(now), country, region, city, os, device, now, MIN_GAP, SESSION_GAP);
}

export const deletePlaceStatements = (env, uid) => [env.DB.prepare('DELETE FROM account_places WHERE user_id = ?1').bind(uid)];

// ------------------------------------------------------------- streaks
// The same rule as the game (web/js/daily.js): a daily puzzle counts if it was
// solved, not revealed, between midnight UTC of its date and 48 hours after
// midnight US Eastern. Days run on US Eastern time.
const EASTERN = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const puzzleDay = (t) => EASTERN.format(new Date(t));
const dayStart = (d) => { const est = Date.parse(`${d}T05:00:00Z`); return puzzleDay(est - 3600_000) === d ? est - 3600_000 : est; };
const addDays = (d, n) => isoDay(Date.parse(`${d}T12:00:00Z`) + n * DAY);
export function streakOf(dailies, now = Date.now()) {
  const days = new Set();
  for (const { daily, at } of dailies) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(daily || ''))) continue;
    if (at >= Date.parse(`${daily}T00:00:00Z`) && at - dayStart(daily) <= 48 * 3600_000) days.add(daily);
  }
  let best = 0, run = 0, prev = null;
  for (const d of [...days].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const today = puzzleDay(now);
  let current = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;
  return { current, best, days: days.size };
}

// ------------------------------------------------------------- profile
const SOLVES = `FROM sync_records r, json_each(r.data) j
  WHERE r.user_id = ?1 AND r.kind = 'meta' AND r.key = 'solves' AND r.deleted = 0 AND json_valid(r.data) AND json_type(r.data) = 'array'
    AND j.type = 'object'`;
const E = (f) => `json_extract(j.value, '$.${f}')`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function playerProfile(env, uid, days = 30, now = Date.now()) {
  const db = env.DB;
  const since = now - days * DAY;
  const sinceDay = isoDay(since);
  const [totals, byTier, byTheme, recent, dailies, inProgress, places, perDay, devices] = (await db.batch([
    db.prepare(`SELECT COUNT(*) AS played, SUM(${E('revealed')} = 0 OR ${E('revealed')} IS NULL) AS solved, SUM(${E('revealed')} = 1) AS revealed,
        SUM(${E('ms')}) AS ms, SUM(${E('hints')}) AS hints, SUM(${E('checks')}) AS checks, SUM(${E('mistakes')}) AS mistakes,
        SUM(${E('daily')} IS NOT NULL) AS daily, SUM(${E('race')} = 1) AS races, SUM((${E('hints')} = 0 OR ${E('hints')} IS NULL) AND (${E('revealed')} = 0 OR ${E('revealed')} IS NULL)) AS noHints,
        MIN(${E('at')}) AS first, MAX(${E('at')}) AS last, SUM(${E('at')} >= ?2) AS recentPlayed ${SOLVES}`).bind(uid, since),
    db.prepare(`SELECT ${E('tier')} AS tier, COUNT(*) AS played, SUM(${E('revealed')} = 0 OR ${E('revealed')} IS NULL) AS solved,
        AVG(CASE WHEN ${E('revealed')} = 0 OR ${E('revealed')} IS NULL THEN ${E('ms')} END) AS avgMs,
        MIN(CASE WHEN ${E('revealed')} = 0 OR ${E('revealed')} IS NULL THEN ${E('ms')} END) AS bestMs, AVG(${E('hints')}) AS avgHints
      ${SOLVES} GROUP BY 1 ORDER BY played DESC`).bind(uid),
    db.prepare(`SELECT ${E('theme')} AS theme, COUNT(*) AS played ${SOLVES} AND ${E('theme')} != '' GROUP BY 1 ORDER BY played DESC LIMIT 10`).bind(uid),
    db.prepare(`SELECT ${E('at')} AS at, ${E('storyId')} AS storyId, ${E('tier')} AS tier, ${E('theme')} AS theme, ${E('ms')} AS ms,
        ${E('hints')} AS hints, ${E('checks')} AS checks, ${E('mistakes')} AS mistakes, ${E('revealed')} AS revealed, ${E('cells')} AS cells,
        ${E('daily')} AS daily, ${E('race')} AS race ${SOLVES} ORDER BY at DESC LIMIT 50`).bind(uid),
    db.prepare(`SELECT ${E('daily')} AS daily, ${E('at')} AS at ${SOLVES} AND ${E('daily')} IS NOT NULL AND (${E('revealed')} = 0 OR ${E('revealed')} IS NULL)`).bind(uid),
    db.prepare(`SELECT json_extract(data, '$.name') AS name, json_extract(data, '$.puzzle.difficulty.id') AS tier, json_extract(data, '$.puzzle.theme.id') AS theme,
        json_extract(data, '$.puzzle.theme.name') AS themeName, json_extract(data, '$.elapsedMs') AS ms, json_extract(data, '$.percent') AS percent,
        json_extract(data, '$.hintsUsed') AS hints, json_extract(data, '$.created') AS started, updated_at AS lastPlayed, json_extract(data, '$.daily') AS daily
      FROM sync_records WHERE user_id = ?1 AND kind = 'save' AND deleted = 0 AND json_valid(data) AND COALESCE(json_extract(data, '$.solved'), 0) = 0
      ORDER BY updated_at DESC LIMIT 25`).bind(uid),
    db.prepare(`SELECT country, region, city, COUNT(DISTINCT day) AS days, SUM(minutes) AS minutes, SUM(sessions) AS sessions, MAX(last_at) AS last
      FROM account_places WHERE user_id = ?1 AND day >= ?2 GROUP BY 1, 2, 3 ORDER BY last DESC LIMIT 20`).bind(uid, sinceDay),
    db.prepare(`SELECT day, SUM(minutes) AS minutes, SUM(sessions) AS sessions, MIN(first_at) AS first, MAX(last_at) AS last
      FROM account_places WHERE user_id = ?1 AND day >= ?2 GROUP BY day ORDER BY day DESC`).bind(uid, sinceDay),
    db.prepare(`SELECT os, device, COUNT(DISTINCT day) AS days, SUM(minutes) AS minutes FROM account_places WHERE user_id = ?1 AND day >= ?2
      GROUP BY 1, 2 ORDER BY minutes DESC, days DESC`).bind(uid, sinceDay),
  ])).map((x) => x.results);
  const t = totals[0] || {};
  const played = num(t.played);
  const solved = num(t.solved);
  const streak = streakOf(dailies);
  const minutes = perDay.reduce((s, d) => s + num(d.minutes), 0);
  return {
    days,
    stats: {
      played, solved, revealed: num(t.revealed), noHints: num(t.noHints), daily: num(t.daily), races: num(t.races),
      recentPlayed: num(t.recentPlayed), solveRate: played ? Math.round((solved / played) * 100) : null,
      totalMs: num(t.ms), avgMs: played ? Math.round(num(t.ms) / played) : null,
      hints: num(t.hints), checks: num(t.checks), mistakes: num(t.mistakes),
      avgHints: played ? Math.round((num(t.hints) / played) * 10) / 10 : null,
      first: t.first || null, last: t.last || null, streak,
    },
    byTier: byTier.map((x) => ({ tier: x.tier || '', played: num(x.played), solved: num(x.solved), avgMs: x.avgMs == null ? null : Math.round(x.avgMs), bestMs: x.bestMs == null ? null : num(x.bestMs), avgHints: Math.round(num(x.avgHints) * 10) / 10 })),
    byTheme: byTheme.map((x) => ({ theme: String(x.theme || ''), played: num(x.played) })),
    recent: recent.map((x) => ({
      at: num(x.at), storyId: String(x.storyId || ''), tier: String(x.tier || ''), theme: String(x.theme || ''), ms: num(x.ms),
      hints: num(x.hints), checks: num(x.checks), mistakes: num(x.mistakes), revealed: !!x.revealed, cells: num(x.cells),
      daily: typeof x.daily === 'string' ? x.daily : null, race: !!x.race,
    })),
    inProgress: inProgress.map((x) => ({
      name: String(x.name || '').slice(0, 120), tier: String(x.tier || ''), theme: String(x.themeName || x.theme || ''), ms: num(x.ms),
      percent: Math.max(0, Math.min(100, Math.round(num(x.percent)))), hints: num(x.hints), started: num(x.started) || null, lastPlayed: num(x.lastPlayed) || null,
      daily: typeof x.daily === 'string' ? x.daily : null,
    })),
    activity: {
      daysActive: perDay.length, minutes, sessions: perDay.reduce((s, d) => s + num(d.sessions), 0),
      perDay: perDay.map((d) => ({ day: d.day, minutes: num(d.minutes), sessions: num(d.sessions), first: num(d.first), last: num(d.last) })),
      places: places.map((p) => ({ country: p.country, region: p.region, city: p.city, days: num(p.days), minutes: num(p.minutes), sessions: num(p.sessions), last: num(p.last) })),
      devices: devices.map((d) => ({ os: d.os, device: d.device, days: num(d.days), minutes: num(d.minutes) })),
    },
  };
}
