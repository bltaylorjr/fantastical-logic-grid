// Number Place's part of the shared learning service. The only data Number
// Place shares with the rest of the game: anonymous summaries of finished
// puzzles, and the tuning worked out from everyone's games.
//
//   POST /v1/learn/np/plays    summaries of finished Number Place puzzles
//   GET  /v1/learn/np/tuning   toughness per level from everyone's games
//
// The admin dashboard's Number Place section reads npSummary() and changes the
// settings in the "Number Place" group (settings.js).
import { getSettings } from './settings.js';
import { loadCrowd, priorFor, shrink } from './shared-learning.js';

export const NP_LEVELS = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];
export const NP_TECHNIQUES = ['nakedSingle', 'hiddenSingle', 'intersection', 'nakedPair', 'hiddenPair', 'nakedTriple', 'hiddenTriple', 'xWing', 'swordfish', 'xyWing'];
export const NP_TUNING_CACHE_KEY = 'https://flg-cloud.internal/v1/learn/np/tuning';
// Typical solve times, the same as the game's (modules/number-place/learning.js).
const PAR_MIN = { basic: 1.5, easy: 4, medium: 8, hard: 14, expert: 22, master: 35 };
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
const MODES = new Set(['free', 'daily', 'race', 'file']);
const OUTCOMES = new Set(['solved', 'revealed', 'abandoned']);
const FEELS = new Set(['easy', 'right', 'hard']);
const VARIANTS = new Set(['', 'diagonal', 'parity', 'diagonal+parity']);
const TUNING_DAYS = 90;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, lo, hi) : d);
const today = () => new Date().toISOString().slice(0, 10);

export function cleanNpPlay(p) {
  if (!p || !NP_LEVELS.includes(p.level) || !OUTCOMES.has(p.outcome) || ![4, 6, 9].includes(p.size)) return null;
  const variants = Array.isArray(p.variants) ? [...p.variants].sort().join('+') : '';
  return {
    platform: PLATFORMS.has(p.platform) ? p.platform : 'web',
    level: p.level, size: p.size, variants: VARIANTS.has(variants) ? variants : '',
    mode: MODES.has(p.mode) ? p.mode : 'free', outcome: p.outcome, feel: FEELS.has(p.feel) ? p.feel : null,
    minutes: num(p.minutes, 0, 600, null), hints: Math.round(num(p.hints, 0, 999)), mistakes: Math.round(num(p.mistakes, 0, 999)), checks: Math.round(num(p.checks, 0, 999)),
    tuned: num(p.tuned, 0, 1, null), score: p.score == null ? null : Math.round(num(p.score, 0, 1000)),
    stuck: JSON.stringify([...new Set((Array.isArray(p.stuck) ? p.stuck : []).filter((t) => NP_TECHNIQUES.includes(t)))].slice(0, 10)),
    pid: /^[a-z0-9]{8,32}$/.test(p.pid || '') ? p.pid : null,
    version: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p.version || '') ? p.version : null,
  };
}

export async function postNpPlays(req, env, body, json) {
  const s = await getSettings(env);
  // Switched off in the admin dashboard: accept and drop, so apps do not retry.
  if (!s.learning_enabled || !s.np_learning_enabled) return json({ saved: 0 });
  const rows = (Array.isArray(body.plays) ? body.plays : []).slice(0, 50).map(cleanNpPlay).filter(Boolean);
  if (!rows.length) return json({ saved: 0 });
  const day = today();
  const stmt = env.DB.prepare(`INSERT INTO np_plays (day, platform, level, size, variants, mode, outcome, feel, minutes, hints, mistakes, checks, tuned, score, stuck, pid, version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (pid) WHERE pid IS NOT NULL DO UPDATE SET feel = COALESCE(excluded.feel, np_plays.feel)`);
  await env.DB.batch(rows.map((r) => stmt.bind(day, r.platform, r.level, r.size, r.variants, r.mode, r.outcome, r.feel, r.minutes, r.hints, r.mistakes, r.checks, r.tuned, r.score, r.stuck, r.pid, r.version)));
  return json({ saved: rows.length });
}

// How a play went, from -2 (much too hard) to +2 (much too easy): the same
// reading as the game's own, so the shared tuning agrees with each device.
export function npVerdict(r) {
  let v = 0;
  if (r.outcome !== 'solved') v -= 1.5;
  else {
    if (!r.hints && r.minutes != null && r.minutes < PAR_MIN[r.level]) v += 1;
    if (r.hints >= 2) v -= 1;
    if (r.minutes != null && r.minutes > PAR_MIN[r.level] * 2) v -= 0.5;
  }
  if (r.feel === 'easy') v += 1;
  if (r.feel === 'hard') v -= 1;
  return clamp(v, -2, 2);
}

// Everyone's games, with gentler limits than one device so no single group of
// players can pull a level too far. On its own a level needs 10 games before
// it moves. crowd (shared-learning.js) is what all games' players found at
// each band of difficulty: a level is drawn toward it, strongly while it has
// few games of its own, and moves as soon as its band has enough.
export function computeNpTuning(plays, crowd = null) {
  const by = {};
  for (const r of plays) if (r.mode !== 'race') (by[r.level] ||= []).push(npVerdict(r) / 2);
  const toughness = {};
  for (const level of NP_LEVELS) {
    const list = by[level] || [];
    const prior = priorFor(crowd, level);
    if (prior == null && list.length < 10) continue;
    const lean = prior == null ? list.reduce((a, b) => a + b, 0) / list.length : shrink(list, prior);
    toughness[level] = Math.round(clamp(0.5 + lean * 0.4, 0.2, 0.8) * 100) / 100;
  }
  return { games: plays.length, toughness, ...(crowd ? { crowd: { games: crowd.games, lean: crowd.lean } } : {}), updated: new Date().toISOString() };
}

export async function getNpTuning(req, env, ctx, json) {
  const cache = caches.default;
  const key = new Request(NP_TUNING_CACHE_KEY);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, hit);
  const s = await getSettings(env);
  const since = new Date(Date.now() - TUNING_DAYS * 86400000).toISOString().slice(0, 10);
  const plays = s.np_learning_enabled
    ? (await env.DB.prepare('SELECT level, mode, outcome, feel, minutes, hints FROM np_plays WHERE day >= ? ORDER BY rowid DESC LIMIT 50000').bind(since).all()).results
    : [];
  // Every game's players count too (shared-learning.js).
  const crowd = s.np_learning_enabled ? await loadCrowd(env, s, npVerdict) : null;
  const res = json(computeNpTuning(plays, crowd), 200, { 'Cache-Control': 'public, max-age=900' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// The admin's Number Place section: how each level is going.
export async function npSummary(env, days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT day, level, size, variants, mode, outcome, feel, minutes, hints, mistakes, tuned, stuck FROM np_plays WHERE day >= ?1 ORDER BY rowid DESC LIMIT 50000').bind(since).all();
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const levels = NP_LEVELS.map((level) => {
    const xs = results.filter((r) => r.level === level);
    const solved = xs.filter((r) => r.outcome === 'solved');
    const feels = { easy: 0, right: 0, hard: 0 };
    for (const r of xs) if (r.feel) feels[r.feel]++;
    return {
      level, games: xs.length, solved: solved.length,
      revealed: xs.filter((r) => r.outcome === 'revealed').length, abandoned: xs.filter((r) => r.outcome === 'abandoned').length,
      medianMinutes: median(solved.map((r) => r.minutes).filter((m) => m != null)),
      avgHints: xs.length ? Math.round((xs.reduce((n, r) => n + r.hints, 0) / xs.length) * 10) / 10 : null,
      avgTuned: xs.some((r) => r.tuned != null) ? Math.round((xs.filter((r) => r.tuned != null).reduce((n, r) => n + r.tuned, 0) / xs.filter((r) => r.tuned != null).length) * 100) / 100 : null,
      feels,
    };
  });
  const stuck = {};
  for (const r of results) { try { for (const t of JSON.parse(r.stuck || '[]')) stuck[t] = (stuck[t] || 0) + 1; } catch (e) { /* skip */ } }
  const byDay = {};
  for (const r of results) { const d = (byDay[r.day] ||= { day: r.day, games: 0, solved: 0 }); d.games++; if (r.outcome === 'solved') d.solved++; }
  const modes = {};
  for (const r of results) modes[r.mode] = (modes[r.mode] || 0) + 1;
  const s = await getSettings(env);
  const crowd = s.np_learning_enabled ? await loadCrowd(env, s, npVerdict) : null;
  return {
    since, games: results.length, levels, modes, feedback: await npFeedback(env),
    stuck: Object.entries(stuck).sort((a, b) => b[1] - a[1]).map(([technique, count]) => ({ technique, count })),
    byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    tuning: computeNpTuning(results.filter((r) => r.day >= new Date(Date.now() - TUNING_DAYS * 86400000).toISOString().slice(0, 10)), crowd),
    sharedLearning: s.shared_learning_enabled !== false,
  };
}

// How many ideas and problem reports came from Number Place, by state. Counts
// only, so a viewer can see them; the words are in Communication (moderators).
export async function npFeedback(env, game = 'number-place') {
  const out = { idea: { new: 0, approved: 0, addressed: 0, done: 0 }, problem: { new: 0, approved: 0, addressed: 0, done: 0 }, reports: { puzzle: 0, webstructure: 0 } };
  try {
    const [fb, pr] = await env.DB.batch([
      env.DB.prepare('SELECT kind, status, COUNT(*) AS n FROM feedback WHERE game = ?1 GROUP BY kind, status').bind(game),
      env.DB.prepare('SELECT category, COUNT(*) AS n FROM puzzle_reports WHERE game = ?1 GROUP BY category').bind(game),
    ]);
    for (const r of fb.results) if (out[r.kind]) out[r.kind][r.status] = (out[r.kind][r.status] || 0) + r.n;
    for (const r of pr.results) out.reports[r.category] = r.n;
  } catch (e) { /* the game column is not set up yet */ }
  return out;
}
