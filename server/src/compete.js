// Screen names, races and the scoreboard. A player takes part only after
// choosing a screen name; the screen name is the only thing other players see.
//
//   GET    /v1/profile               the player's screen name (or null)
//   PUT    /v1/profile               { screenName }  choose or change it
//   DELETE /v1/profile               leave: removes the name, scores and race entries
//   POST   /v1/scores                { storyId, tier, categories, items, elapsedMs, hints, checks }
//   GET    /v1/scoreboard?period=week|all   top players (no sign-in needed)
//   POST   /v1/races                 { puzzle, public }  start a race on this puzzle
//   POST   /v1/races/find            { tier?, skip? }  an open race by someone else
//   POST   /v1/races/:code/join      returns the race puzzle and starts the clock
//   POST   /v1/races/:code/finish    { elapsedMs, hints, checks, revealed, pairs }
//   GET    /v1/races/:code           the standings
//   POST   /v1/races/:code/invite    { screenName }  challenge a player to this race
//   GET    /v1/invites               challenges waiting for this player
//   POST   /v1/invites/:id/decline   say no to a challenge (accepting = joining)
//
// Times come from the player's device, but a race time can never be shorter
// than the server's own clock since joining, and a race only counts as solved
// when the submitted answers match the puzzle's solution.

import { json, readText, TooLarge } from './http.js';
import { checkName, cleanName, nameKey, hasBlockedWords, isSuggestedName } from './names.js';
import { isDeleted } from './sync.js';
import { AuthError } from './auth.js';
import { getSettings } from './settings.js';
import { supporterTiers } from './supporters.js';
import { contributorTiers } from './contributors.js';

export const TIERS = { basic: 10, easy: 20, medium: 35, hard: 55, expert: 80, mensa: 110 };
// Minutes a typical player needs per grid cell (the same as the app's estimate).
const PAR_MIN_PER_CELL = { basic: 0.12, easy: 0.16, medium: 0.22, hard: 0.3, expert: 0.36, mensa: 0.42 };
const HINT_PENALTY_MS = 60_000;
const CHECK_PENALTY_MS = 15_000;
const MIN_SOLVE_MS = 5_000;
const MAX_SOLVE_MS = 7 * 24 * 3600_000;
const SOLO_PER_DAY = 40;
const RACES_PER_DAY = 20;
const INVITES_PER_DAY = 30;
const RACE_PLAYERS = 20;
const RACE_OPEN_MS = 7 * 24 * 3600_000; // others can join for a week
const RACE_FINISH_MS = 14 * 24 * 3600_000; // and finish within two
const RACE_KEEP_MS = 45 * 24 * 3600_000;
const MAX_PUZZLE_CHARS = 400_000;
const BOARD_ROWS = 50;
const BOARD_CACHE_MS = 30_000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L to misread

export const cellsOf = (k, n) => (k * (k - 1) / 2) * n * n;

// Points for one solve: harder and bigger puzzles are worth more, beating the
// usual time earns up to 50% more, and each hint or check costs a little.
export function pointsFor({ tier, cells, elapsedMs, hints, checks }) {
  const par = cells * PAR_MIN_PER_CELL[tier] * 60_000;
  const size = Math.sqrt(cells / 48); // 48 cells = 3 categories of 4 items
  const speed = Math.min(1.5, Math.max(0.6, Math.sqrt(par / Math.max(elapsedMs, 1))));
  const help = Math.max(0.25, 1 - 0.15 * hints - 0.05 * checks);
  return Math.max(1, Math.round(TIERS[tier] * size * speed * help));
}

const weekStart = (now) => {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
};
const dayStart = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// Statements that remove a player's part in all of this, for account deletion.
export function deleteCompeteStatements(env, uid) {
  return [
    env.DB.prepare('DELETE FROM players WHERE user_id = ?1').bind(uid),
    env.DB.prepare('DELETE FROM scores WHERE user_id = ?1').bind(uid),
    env.DB.prepare('DELETE FROM race_entries WHERE user_id = ?1').bind(uid),
    env.DB.prepare('DELETE FROM race_invites WHERE from_id = ?1 OR to_id = ?1').bind(uid),
    env.DB.prepare('UPDATE races SET host_id = NULL WHERE host_id = ?1').bind(uid),
  ];
}

// ------------------------------------------------------------- puzzles
// The puzzle a host shares: checked for shape and size, and its text for
// blocked words, because other players will read it.
export function checkPuzzle(p) {
  if (!p || typeof p !== 'object') return 'bad_puzzle';
  const cats = p.categories;
  if (!Array.isArray(cats) || cats.length < 3 || cats.length > 6) return 'bad_puzzle';
  const n = cats[0].items && cats[0].items.length;
  if (!(n >= 3 && n <= 8)) return 'bad_puzzle';
  for (const c of cats) {
    if (typeof c.id !== 'string' || !Array.isArray(c.items) || c.items.length !== n) return 'bad_puzzle';
    if (c.items.some((it) => !it || typeof it.id !== 'string' || typeof it.label !== 'string')) return 'bad_puzzle';
  }
  if (!Array.isArray(p.solution) || p.solution.length !== n) return 'bad_puzzle';
  for (const row of p.solution) {
    if (!row || typeof row !== 'object') return 'bad_puzzle';
    for (const c of cats) if (!c.items.some((it) => it.id === row[c.id])) return 'bad_puzzle';
  }
  if (!p.difficulty || !TIERS[p.difficulty.id]) return 'bad_puzzle';
  if (!p.story || typeof p.story.id !== 'string' || !p.story.id || p.story.id.length > 200) return 'bad_puzzle';
  if (typeof p.title !== 'string' || !p.title || p.title.length > 120) return 'bad_puzzle';
  if (!Array.isArray(p.clues) || !Array.isArray(p.story.paragraphs)) return 'bad_puzzle';
  const text = [
    p.title, p.story.ending, ...p.story.paragraphs,
    ...p.clues.map((c) => c && c.text), ...(p.questions || []).map((q) => q && q.text),
    ...cats.flatMap((c) => [c.name, ...c.items.map((it) => it.label)]),
    ...(Array.isArray(p.cast) ? p.cast.map((c) => (typeof c === 'string' ? c : c && c.name)) : []),
  ].filter((t) => typeof t === 'string').join(' \n ');
  if (hasBlockedWords(text, { strict: false })) return 'puzzle_words';
  return null;
}

function solutionPairs(p) {
  const out = new Set();
  const ids = p.categories.map((c) => c.id);
  for (const row of p.solution) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.add([row[ids[i]], row[ids[j]]].sort().join('|'));
  }
  return out;
}

function matchesSolution(puzzle, pairs) {
  if (!Array.isArray(pairs) || pairs.length > 2000) return false;
  const want = solutionPairs(puzzle);
  const got = new Set();
  for (const pr of pairs) {
    if (!Array.isArray(pr) || pr.length !== 2 || typeof pr[0] !== 'string' || typeof pr[1] !== 'string') return false;
    got.add([pr[0], pr[1]].sort().join('|'));
  }
  if (got.size !== want.size) return false;
  for (const k of want) if (!got.has(k)) return false;
  return true;
}

// ------------------------------------------------------------- scoreboard
let boardCache = new Map(); // period -> { at, body }
export const clearBoardCache = () => boardCache.clear();

// A ban from the admin dashboard keeps a player out of races, scores and
// screen names, and off the scoreboard. until NULL means no end.
export async function banOf(env, uid, now = Date.now()) {
  return env.DB.prepare('SELECT reason, until FROM bans WHERE user_id = ?1 AND (until IS NULL OR until > ?2)').bind(uid, now).first();
}

async function scoreboard(env, period, now) {
  const since = period === 'all' ? 0 : weekStart(now);
  const hit = boardCache.get(period);
  if (hit && now - hit.at < BOARD_CACHE_MS && hit.since === since) return hit.body;
  const { results } = await env.DB.prepare(`
    WITH pts AS (
      SELECT user_id, SUM(points) AS points, COUNT(*) AS solved, MIN(created_at) AS first FROM scores
      WHERE created_at >= ?1 GROUP BY user_id
    ), fin AS (
      SELECT user_id, finished_at,
        RANK() OVER (PARTITION BY code ORDER BY adjusted_ms) AS place,
        COUNT(*) OVER (PARTITION BY code) AS finishers
      FROM race_entries WHERE solved = 1
    ), wins AS (
      SELECT user_id, COUNT(*) AS wins FROM fin WHERE place = 1 AND finishers >= 2 AND finished_at >= ?1 GROUP BY user_id
    )
    SELECT p.screen_name AS name, p.user_id AS uid, pts.points, pts.solved, COALESCE(wins.wins, 0) AS wins, ${APPROVED('p')} AS approved
    FROM pts JOIN players p ON p.user_id = pts.user_id LEFT JOIN wins ON wins.user_id = pts.user_id
    WHERE NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = pts.user_id AND (b.until IS NULL OR b.until > ?3))
    ORDER BY pts.points DESC, wins DESC, pts.first ASC LIMIT ?2`).bind(since, BOARD_ROWS, now).all();
  let rank = 0;
  let prev = null;
  // Supporter badges show only once the owner switches them on (Settings > Support and premium).
  const supporters = (await getSettings(env, now)).supporter_badges_enabled ? await supporterTiers(env, results.map((r) => r.uid), now) : new Map();
  // Contributor badges (Settings > Contributors).
  const contributors = await contributorTiers(env, results.map((r) => r.uid), now);
  const rows = results.map((r, i) => {
    if (r.points !== prev) { rank = i + 1; prev = r.points; }
    return { rank, name: r.name, points: r.points, solved: r.solved, wins: r.wins, uid: r.uid, approved: !!r.approved, ...(supporters.has(r.uid) ? { supporter: supporters.get(r.uid) } : {}), ...(contributors.has(r.uid) ? { contributor: contributors.get(r.uid) } : {}) };
  });
  const body = { period, since, rows };
  boardCache.set(period, { at: now, since, body });
  return body;
}

async function myStanding(env, uid, period, now) {
  const since = period === 'all' ? 0 : weekStart(now);
  const mine = await env.DB.prepare('SELECT COALESCE(SUM(points), 0) AS points, COUNT(*) AS solved FROM scores WHERE user_id = ?1 AND created_at >= ?2').bind(uid, since).first();
  if (!mine.solved) return { rank: null, points: 0, solved: 0 };
  const above = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (
      SELECT s.user_id, SUM(s.points) AS p FROM scores s JOIN players pl ON pl.user_id = s.user_id
      WHERE s.created_at >= ?1 GROUP BY s.user_id HAVING p > ?2)`).bind(since, mine.points).first();
  return { rank: above.n + 1, points: mine.points, solved: mine.solved };
}

// ------------------------------------------------------------- name approval
// With the names_need_approval switch on, other players see a new or changed
// screen name only after an admin approves it (a name_reviews row for the
// current name_key); until then it shows as NEW_PLAYER. A player always sees
// their own name.
export const NEW_PLAYER = 'New player';
const APPROVED = (p) => `EXISTS (SELECT 1 FROM name_reviews nr WHERE nr.user_id = ${p}.user_id AND nr.name_key = ${p}.name_key)`;
async function nameShown(env, uid, now) {
  const { names_need_approval: on } = await getSettings(env, now);
  return (id, name, approved) => (!on || approved || (uid && id === uid) ? name : NEW_PLAYER);
}
async function isApproved(env, uid, settings) {
  if (!settings.names_need_approval) return true;
  return !!(await env.DB.prepare(`SELECT ${APPROVED('p')} AS a FROM players p WHERE p.user_id = ?1`).bind(uid).first('a'));
}

// ------------------------------------------------------------- races
async function standings(env, race, uid, now) {
  const shown = await nameShown(env, uid, now);
  const { results } = await env.DB.prepare(`SELECT e.user_id, e.joined_at, e.finished_at, e.solved, e.elapsed_ms, e.hints, e.checks, e.adjusted_ms, p.screen_name, ${APPROVED('p')} AS approved
    FROM race_entries e LEFT JOIN players p ON p.user_id = e.user_id WHERE e.code = ?1`).bind(race.code).all();
  const done = results.filter((r) => r.solved).sort((a, b) => a.adjusted_ms - b.adjusted_ms || a.finished_at - b.finished_at);
  const rest = results.filter((r) => !r.solved).sort((a, b) => (a.finished_at ? 1 : 0) - (b.finished_at ? 1 : 0) || a.joined_at - b.joined_at);
  let place = 0;
  let prev = null;
  const players = [...done, ...rest].map((r, i) => {
    if (r.solved && r.adjusted_ms !== prev) { place = i + 1; prev = r.adjusted_ms; }
    return {
      name: r.screen_name ? shown(r.user_id, r.screen_name, r.approved) : 'A former player',
      me: r.user_id === uid,
      host: r.user_id === race.host_id,
      status: r.solved ? 'solved' : r.finished_at ? 'gave_up' : 'solving',
      place: r.solved ? place : null,
      elapsedMs: r.solved ? r.elapsed_ms : null,
      hints: r.finished_at ? r.hints : null,
      checks: r.finished_at ? r.checks : null,
      raceMs: r.solved ? r.adjusted_ms : null,
    };
  });
  // Players challenged to this race who have not joined yet.
  const { results: asked } = await env.DB.prepare(`SELECT i.to_id, i.status, p.screen_name, ${APPROVED('p')} AS approved FROM race_invites i JOIN players p ON p.user_id = i.to_id
    WHERE i.code = ?1 AND i.status != 'accepted' AND NOT EXISTS (SELECT 1 FROM race_entries e WHERE e.code = i.code AND e.user_id = i.to_id)
    ORDER BY i.created_at`).bind(race.code).all();
  for (const a of asked) {
    players.push({ name: shown(a.to_id, a.screen_name, a.approved), me: a.to_id === uid, host: false, status: a.status === 'declined' ? 'declined' : 'invited', place: null, elapsedMs: null, hints: null, checks: null, raceMs: null });
  }
  return {
    code: race.code, title: race.title, tier: race.tier, cells: race.cells,
    createdAt: race.created_at, closesAt: race.closes_at, open: now < race.closes_at && results.length < RACE_PLAYERS,
    penalties: { hintMs: HINT_PENALTY_MS, checkMs: CHECK_PENALTY_MS },
    players,
  };
}

const getRace = (env, code) => env.DB.prepare('SELECT code, host_id, tier, cells, story_id, title, public, created_at, closes_at FROM races WHERE code = ?1').bind(code).first();

// ------------------------------------------------------------- routing
const ROUTES = /^\/v1\/(profile|scores|scoreboard|races|invites)(?:\/(find|[A-Z0-9]{6}|\d{1,12})(?:\/(join|finish|invite|decline))?)?$/;

export async function handleCompete(req, env, ctx, url, signedIn) {
  const m = url.pathname.match(ROUTES);
  if (!m) return null;
  const [, area, sub, action] = m;
  const method = req.method;
  const now = Date.now();
  const db = env.DB;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });

  const who = async () => {
    const user = await signedIn(req, env);
    if (await isDeleted(env, user.uid)) throw new AuthError('Account deleted');
    return user;
  };
  // A body over max bytes, or one that is not JSON, reads as null (race starts
  // check the size first and answer too_large).
  const body = async (max = 64_000) => { try { return JSON.parse(await readText(req, max)); } catch (e) { return null; } };
  const fail = (error, status = 400, extra = {}) => json(req, env, { error, ...extra }, status);

  try {
    // The scoreboard is public; a signed-in player also gets their own place.
    if (area === 'scoreboard' && !sub && method === 'GET') {
      const period = url.searchParams.get('period') === 'all' ? 'all' : 'week';
      const board = await scoreboard(env, period, now);
      let me = null;
      let uid = null;
      if (req.headers.get('Authorization')) {
        try { uid = (await who()).uid; } catch (e) { if (!(e instanceof AuthError)) throw e; }
      }
      if (uid) {
        const profile = await db.prepare('SELECT screen_name FROM players WHERE user_id = ?1').bind(uid).first();
        if (profile) me = { name: profile.screen_name, ...(await myStanding(env, uid, period, now)) };
      }
      const shown = await nameShown(env, uid, now);
      return json(req, env, { period: board.period, since: board.since, rows: board.rows.map(({ uid: id, approved, ...r }) => ({ ...r, name: shown(id, r.name, approved), me: !!uid && id === uid })), me });
    }

    const user = await who();
    const uid = user.uid;
    const isWrite = method !== 'GET';
    if (isWrite && env.LIMIT_COMPETE && !(await env.LIMIT_COMPETE.limit({ key: uid })).success) return fail('slow_down', 429);
    const profile = await db.prepare('SELECT screen_name, accept_invites FROM players WHERE user_id = ?1').bind(uid).first();
    const settings = await getSettings(env, now);
    // A banned player can still look at their name and remove it.
    if (!(area === 'profile' && !sub && method !== 'PUT')) {
      const ban = await banOf(env, uid, now);
      if (ban) return fail('banned', 403, { message: 'Your account cannot take part in races or the scoreboard right now.', until: ban.until });
    }
    const off = (what) => fail('switched_off', 503, { message: `${what} are switched off for now. Please try again later.` });

    if (area === 'profile' && !sub) {
      if (method === 'GET') return json(req, env, { screenName: profile ? profile.screen_name : null, acceptInvites: profile ? !!profile.accept_invites : true, nameApproved: profile ? await isApproved(env, uid, settings) : null });
      if (method === 'DELETE') {
        await db.batch(deleteCompeteStatements(env, uid));
        boardCache.clear();
        return json(req, env, { screenName: null });
      }
      if (method === 'PUT') {
        const b = await body();
        // Only the "let others challenge me" switch, keeping the name.
        if (b && profile && b.screenName === undefined && typeof b.acceptInvites === 'boolean') {
          await db.prepare('UPDATE players SET accept_invites = ?2 WHERE user_id = ?1').bind(uid, b.acceptInvites ? 1 : 0).run();
          return json(req, env, { screenName: profile.screen_name, acceptInvites: b.acceptInvites });
        }
        if (!settings.names_enabled) return off('New screen names');
        const problem = checkName(b && b.screenName, { extra: settings.blocked_words });
        if (problem) return fail(problem.code, 422, { message: problem.message });
        const name = cleanName(b.screenName);
        const key = nameKey(name);
        const taken = await db.prepare('SELECT user_id FROM players WHERE name_key = ?1').bind(key).first();
        if (taken && taken.user_id !== uid) return fail('name_taken', 409, { message: 'Someone already has that screen name. Try adding a number or another word.' });
        const accept = typeof b.acceptInvites === 'boolean' ? (b.acceptInvites ? 1 : 0) : (profile ? profile.accept_invites : 1);
        await db.prepare(`INSERT INTO players (user_id, screen_name, name_key, created_at, updated_at, accept_invites) VALUES (?1, ?2, ?3, ?4, ?4, ?5)
          ON CONFLICT (user_id) DO UPDATE SET screen_name = excluded.screen_name, name_key = excluded.name_key, updated_at = excluded.updated_at,
            accept_invites = excluded.accept_invites`).bind(uid, name, key, now, accept).run();
        // Names from Suggest a name are approved straight away; typed names wait for an admin.
        if (isSuggestedName(name)) {
          await db.prepare("INSERT OR REPLACE INTO name_reviews (user_id, name_key, reviewed_by, reviewed_at) VALUES (?1, ?2, 'automatic (suggested name)', ?3)").bind(uid, key, now).run();
        }
        boardCache.clear();
        return json(req, env, { screenName: name, acceptInvites: !!accept, nameApproved: await isApproved(env, uid, settings) });
      }
      return fail('not_found', 404);
    }

    if (!profile) return fail('no_screen_name', 403, { message: 'Choose a screen name first.' });

    if (area === 'scores' && !sub && method === 'POST') {
      if (!settings.scores_enabled) return off('Solo scores');
      const b = (await body()) || {};
      const k = int(b.categories, 3, 6);
      const n = int(b.items, 3, 8);
      const reported = int(b.elapsedMs, 0, MAX_SOLVE_MS);
      const elapsedMs = reported === null ? null : Math.max(MIN_SOLVE_MS, reported);
      const hints = int(b.hints, 0, 1000);
      const checks = int(b.checks, 0, 1000);
      if (!TIERS[b.tier] || !k || !n || elapsedMs === null || hints === null || checks === null || typeof b.storyId !== 'string' || !b.storyId || b.storyId.length > 200) return fail('bad_score');
      const today = await db.prepare("SELECT COUNT(*) AS n FROM scores WHERE user_id = ?1 AND kind = 'solo' AND created_at >= ?2").bind(uid, dayStart(now)).first();
      if (today.n >= SOLO_PER_DAY) return fail('daily_limit', 429, { message: `Only ${SOLO_PER_DAY} solo puzzles a day count for the scoreboard. Races still count.` });
      const cells = cellsOf(k, n);
      const points = pointsFor({ tier: b.tier, cells, elapsedMs, hints, checks });
      const r = await db.prepare(`INSERT OR IGNORE INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at)
        VALUES (?1, ?2, 'solo', ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(uid, b.storyId, b.tier, cells, elapsedMs, hints, checks, points, now).run();
      boardCache.clear();
      return json(req, env, { points, counted: r.meta.changes > 0 });
    }

    if (area === 'invites') {
      if (!sub && method === 'GET') {
        const { results } = await db.prepare(`SELECT i.id, i.code, i.created_at, r.title, r.tier, r.cells, p.screen_name AS from_name, ${APPROVED('p')} AS approved
          FROM race_invites i JOIN races r ON r.code = i.code LEFT JOIN players p ON p.user_id = i.from_id
          WHERE i.to_id = ?1 AND i.status = 'pending' AND r.closes_at > ?2
            AND NOT EXISTS (SELECT 1 FROM race_entries e WHERE e.code = i.code AND e.user_id = ?1)
          ORDER BY i.created_at DESC LIMIT 20`).bind(uid, now).all();
        return json(req, env, {
          invites: results.map((r) => ({ id: r.id, code: r.code, title: r.title, tier: r.tier, cells: r.cells, from: r.from_name ? (r.approved || !settings.names_need_approval ? r.from_name : NEW_PLAYER) : 'A former player', at: r.created_at })),
        });
      }
      if (sub && /^\d+$/.test(sub) && action === 'decline' && method === 'POST') {
        await db.prepare("UPDATE race_invites SET status = 'declined' WHERE id = ?1 AND to_id = ?2 AND status = 'pending'").bind(Number(sub), uid).run();
        return json(req, env, { declined: true });
      }
      return fail('not_found', 404);
    }

    if (area !== 'races') return fail('not_found', 404);
    // Players already in a race can always finish it and see the standings.
    if (!settings.races_enabled && method === 'POST' && action !== 'finish') return off('Races');

    if (!sub && method === 'POST') {
      let b;
      try { b = JSON.parse(await readText(req, MAX_PUZZLE_CHARS + 1000)); } catch (e) {
        if (e instanceof TooLarge) return fail('too_large', 413);
        b = null;
      }
      const puzzle = b && b.puzzle;
      const problem = checkPuzzle(puzzle);
      if (problem === 'puzzle_words') return fail(problem, 422, { message: 'This puzzle has words that cannot be shared with other players. Remove the custom title or names and try again.' });
      if (problem) return fail(problem);
      const text = JSON.stringify(puzzle);
      if (text.length > MAX_PUZZLE_CHARS) return fail('too_large', 413);
      const hosted = await db.prepare('SELECT COUNT(*) AS n FROM races WHERE host_id = ?1 AND created_at >= ?2').bind(uid, now - 24 * 3600_000).first();
      if (hosted.n >= RACES_PER_DAY) return fail('daily_limit', 429, { message: `You can start up to ${RACES_PER_DAY} races a day.` });
      const cells = cellsOf(puzzle.categories.length, puzzle.categories[0].items.length);
      // Tidy up long-finished races while we are here.
      ctx.waitUntil(db.batch([
        db.prepare('DELETE FROM race_entries WHERE code IN (SELECT code FROM races WHERE created_at < ?1)').bind(now - RACE_KEEP_MS),
        db.prepare('DELETE FROM races WHERE created_at < ?1').bind(now - RACE_KEEP_MS),
      ]).catch(() => {}));
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const r = await db.prepare(`INSERT OR IGNORE INTO races (code, host_id, tier, cells, story_id, title, puzzle, public, created_at, closes_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(code, uid, puzzle.difficulty.id, cells, puzzle.story.id, puzzle.title, text, b.public === false ? 0 : 1, now, now + RACE_OPEN_MS).run();
        if (r.meta.changes) {
          await db.prepare('INSERT INTO race_entries (code, user_id, joined_at) VALUES (?1, ?2, ?3)').bind(code, uid, now).run();
          return json(req, env, await standings(env, await getRace(env, code), uid, now));
        }
      }
      return fail('server', 500);
    }

    if (sub === 'find' && method === 'POST') {
      const b = (await body()) || {};
      const tier = TIERS[b.tier] ? b.tier : null;
      const skip = Array.isArray(b.skip) ? b.skip.filter((c) => typeof c === 'string').slice(0, 20) : [];
      const { results } = await db.prepare(`SELECT r.code, r.story_id, r.tier, r.title FROM races r
        WHERE r.public = 1 AND r.closes_at > ?1 AND (r.host_id IS NULL OR r.host_id != ?2) AND (?3 IS NULL OR r.tier = ?3)
          AND NOT EXISTS (SELECT 1 FROM race_entries e WHERE e.code = r.code AND e.user_id = ?2)
          AND (SELECT COUNT(*) FROM race_entries e WHERE e.code = r.code) < ?4
          AND r.code NOT IN (SELECT value FROM json_each(?5))
        ORDER BY random() LIMIT 1`).bind(now, uid, tier, RACE_PLAYERS, JSON.stringify(skip)).all();
      if (!results.length) return fail('no_open_races', 404, { message: 'No open races right now. Start one and others can join it.' });
      const r = results[0];
      return json(req, env, { code: r.code, storyId: r.story_id, tier: r.tier, title: r.title });
    }

    const race = await db.prepare('SELECT * FROM races WHERE code = ?1').bind(sub).first();
    if (!race) return fail('no_race', 404, { message: 'There is no race with that code. Check it and try again.' });
    const entry = await db.prepare('SELECT * FROM race_entries WHERE code = ?1 AND user_id = ?2').bind(sub, uid).first();

    if (!action && method === 'GET') return json(req, env, await standings(env, race, uid, now));

    if (action === 'join' && method === 'POST') {
      if (!entry) {
        if (now >= race.closes_at) return fail('race_closed', 410, { message: 'This race has closed to new players.' });
        const { n } = await db.prepare('SELECT COUNT(*) AS n FROM race_entries WHERE code = ?1').bind(sub).first();
        if (n >= RACE_PLAYERS) return fail('race_full', 409, { message: 'This race is full.' });
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO race_entries (code, user_id, joined_at) VALUES (?1, ?2, ?3)').bind(sub, uid, now),
          db.prepare("UPDATE race_invites SET status = 'accepted' WHERE code = ?1 AND to_id = ?2").bind(sub, uid),
        ]);
      }
      return json(req, env, { race: await standings(env, race, uid, now), puzzle: JSON.parse(race.puzzle) });
    }

    if (action === 'invite' && method === 'POST') {
      if (!entry) return fail('not_in_race', 403, { message: 'Join this race first.' });
      if (now >= race.closes_at) return fail('race_closed', 410, { message: 'This race has closed to new players.' });
      const b = (await body()) || {};
      const key = nameKey(cleanName(b.screenName));
      const nobody = () => fail('no_player', 404, { message: 'No player has that screen name. Check the spelling and try again.' });
      if (!key) return nobody();
      const target = await db.prepare('SELECT user_id, screen_name, accept_invites FROM players WHERE name_key = ?1').bind(key).first();
      if (!target || (await banOf(env, target.user_id, now))) return nobody();
      if (target.user_id === uid) return fail('self', 400, { message: 'That is your own screen name. Enter the name of the player you want to challenge.' });
      if (!target.accept_invites) return fail('no_invites', 403, { message: `${target.screen_name} is not taking challenges right now.` });
      if (await db.prepare('SELECT 1 FROM race_entries WHERE code = ?1 AND user_id = ?2').bind(sub, target.user_id).first()) {
        return fail('already_in', 409, { message: `${target.screen_name} is already in this race.` });
      }
      const { n: sent } = await db.prepare('SELECT COUNT(*) AS n FROM race_invites WHERE from_id = ?1 AND created_at >= ?2').bind(uid, now - 24 * 3600_000).first();
      if (sent >= INVITES_PER_DAY) return fail('daily_limit', 429, { message: `You can send up to ${INVITES_PER_DAY} challenges a day.` });
      // One challenge per player per race: a "no" stays a no.
      const r = await db.prepare('INSERT OR IGNORE INTO race_invites (code, from_id, to_id, created_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(sub, uid, target.user_id, now).run();
      return json(req, env, { invited: target.screen_name, already: r.meta.changes === 0 });
    }

    if (action === 'finish' && method === 'POST') {
      if (!entry) return fail('not_in_race', 403, { message: 'Join this race first.' });
      if (entry.finished_at) return json(req, env, { race: await standings(env, race, uid, now), points: null });
      if (now > race.created_at + RACE_FINISH_MS) return fail('race_closed', 410, { message: 'This race has finished.' });
      const b = (await body()) || {};
      const hints = int(b.hints, 0, 1000);
      const checks = int(b.checks, 0, 1000);
      const reported = int(b.elapsedMs, 0, MAX_SOLVE_MS);
      if (hints === null || checks === null || reported === null) return fail('bad_result');
      const puzzle = JSON.parse(race.puzzle);
      const solved = !b.revealed && matchesSolution(puzzle, b.pairs);
      if (!b.revealed && !solved) return fail('not_solved', 422, { message: 'Those answers do not solve the puzzle yet.' });
      // Never shorter than the real time since joining allows.
      const elapsedMs = Math.max(MIN_SOLVE_MS, Math.min(reported, now - entry.joined_at + 5_000));
      const raceMs = elapsedMs + hints * HINT_PENALTY_MS + checks * CHECK_PENALTY_MS;
      const stmts = [db.prepare(`UPDATE race_entries SET finished_at = ?3, solved = ?4, elapsed_ms = ?5, hints = ?6, checks = ?7, adjusted_ms = ?8
        WHERE code = ?1 AND user_id = ?2 AND finished_at IS NULL`).bind(sub, uid, now, solved ? 1 : 0, elapsedMs, hints, checks, raceMs)];
      let points = null;
      if (solved) {
        points = pointsFor({ tier: race.tier, cells: race.cells, elapsedMs, hints, checks });
        stmts.push(db.prepare(`INSERT OR IGNORE INTO scores (user_id, story_id, kind, tier, cells, elapsed_ms, hints, checks, points, created_at)
          VALUES (?1, ?2, 'race', ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(uid, race.story_id, race.tier, race.cells, elapsedMs, hints, checks, points, now));
      }
      await db.batch(stmts);
      boardCache.clear();
      return json(req, env, { race: await standings(env, race, uid, now), points });
    }
    return fail('not_found', 404);
  } catch (e) {
    if (e instanceof AuthError) return fail('sign_in', 401, { detail: e.message });
    throw e;
  }
}
