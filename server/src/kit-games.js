// Cage Math, Sum Cross and Picture Grid's part of the shared learning service
// (the kit games, modules/grid-kit). The only data these games share with the
// rest of the app: anonymous summaries of finished puzzles, and the tuning
// worked out from everyone's games. One table (kit_plays) with a game column.
//
//   POST /v1/learn/(cm|sc|pg)/plays    summaries of finished puzzles
//   GET  /v1/learn/(cm|sc|pg)/tuning   toughness per level from everyone's games
//   GET  /admin/v1/kit-game/(cm|sc|pg) the admin section: how each level is going
//
// Each game's settings are in its own group (settings.js): cm_*, sc_*, pg_*.
import { getSettings } from './settings.js';

export const KIT_GAMES = {
  cm: { name: 'Cage Math', sizes: [4, 5, 6, 7, 8, 9], techniques: ['nakedSingle', 'hiddenSingle', 'cageCombo', 'cageLine', 'nakedPair', 'hiddenPair', 'nakedTriple', 'cageTotal'] },
  sc: { name: 'Sum Cross', sizes: [5, 6, 7, 8, 9, 10, 12], techniques: ['nakedSingle', 'hiddenSingle', 'combo', 'comboFit', 'nakedPair', 'nakedTriple'] },
  pg: { name: 'Picture Grid', sizes: [5, 10, 15, 20, 25], techniques: ['overlap', 'finish', 'edge', 'reach', 'cross'] },
};
export const KIT_LEVELS = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];
export const kitTuningKey = (game) => `https://flg-cloud.internal/v1/learn/${game}/tuning`;
// Typical solve times, the same as each game's (modules/<game>/game.js), in minutes.
const PAR_MIN = {
  cm: { basic: 1.5, easy: 3, medium: 6, hard: 12, expert: 20, master: 30 },
  sc: { basic: 1.5, easy: 4, medium: 8, hard: 14, expert: 22, master: 35 },
  pg: { basic: 1, easy: 4, medium: 6, hard: 15, expert: 25, master: 40 },
};
const PLATFORMS = new Set(['web', 'desktop', 'android', 'ios']);
const MODES = new Set(['free', 'daily', 'file']);
const OUTCOMES = new Set(['solved', 'revealed', 'abandoned']);
const FEELS = new Set(['easy', 'right', 'hard']);
const TUNING_DAYS = 90;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, lo, hi) : d);
const today = () => new Date().toISOString().slice(0, 10);
export const isKitGame = (g) => Object.hasOwn(KIT_GAMES, g);

export function cleanKitPlay(game, p) {
  const g = KIT_GAMES[game];
  if (!g || !p || !KIT_LEVELS.includes(p.level) || !OUTCOMES.has(p.outcome) || !g.sizes.includes(p.size)) return null;
  return {
    platform: PLATFORMS.has(p.platform) ? p.platform : 'web',
    level: p.level, size: p.size, mode: MODES.has(p.mode) ? p.mode : 'free', outcome: p.outcome, feel: FEELS.has(p.feel) ? p.feel : null,
    minutes: num(p.minutes, 0, 600, null), hints: Math.round(num(p.hints, 0, 999)), mistakes: Math.round(num(p.mistakes, 0, 9999)), checks: Math.round(num(p.checks, 0, 999)),
    tuned: num(p.tuned, 0, 1, null), score: p.score == null ? null : Math.round(num(p.score, 0, 5000)),
    stuck: JSON.stringify([...new Set((Array.isArray(p.stuck) ? p.stuck : []).filter((t) => g.techniques.includes(t)))].slice(0, 10)),
    pid: /^[a-z0-9]{8,32}$/.test(p.pid || '') ? p.pid : null,
    version: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p.version || '') ? p.version : null,
  };
}

const learningOn = (s, game) => s.learning_enabled && s[`${game}_learning_enabled`];

export async function postKitPlays(game, env, body, json) {
  const s = await getSettings(env);
  if (!learningOn(s, game)) return json({ saved: 0 });
  const rows = (Array.isArray(body.plays) ? body.plays : []).slice(0, 50).map((p) => cleanKitPlay(game, p)).filter(Boolean);
  if (!rows.length) return json({ saved: 0 });
  const day = today();
  const stmt = env.DB.prepare(`INSERT INTO kit_plays (game, day, platform, level, size, mode, outcome, feel, minutes, hints, mistakes, checks, tuned, score, stuck, pid, version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (game, pid) WHERE pid IS NOT NULL DO UPDATE SET feel = COALESCE(excluded.feel, kit_plays.feel)`);
  await env.DB.batch(rows.map((r) => stmt.bind(game, day, r.platform, r.level, r.size, r.mode, r.outcome, r.feel, r.minutes, r.hints, r.mistakes, r.checks, r.tuned, r.score, r.stuck, r.pid, r.version)));
  return json({ saved: rows.length });
}

// How a play went, from -2 (much too hard) to +2 (much too easy): the same
// reading as the game's own, so the shared tuning agrees with each device.
export function kitVerdict(game, r) {
  const par = PAR_MIN[game][r.level];
  let v = 0;
  if (r.outcome !== 'solved') v -= 1.5;
  else {
    if (!r.hints && r.minutes != null && r.minutes < par) v += 1;
    if (r.hints >= 2) v -= 1;
    if (r.minutes != null && r.minutes > par * 2) v -= 0.5;
  }
  if (r.feel === 'easy') v += 1;
  if (r.feel === 'hard') v -= 1;
  return clamp(v, -2, 2);
}

// Everyone's games, with gentler limits than one device. A level needs 10 games before it moves.
export function computeKitTuning(game, plays) {
  const by = {};
  for (const r of plays) if (r.mode !== 'file') (by[r.level] ||= []).push(kitVerdict(game, r));
  const toughness = {};
  for (const [level, list] of Object.entries(by)) {
    if (list.length < 10) continue;
    toughness[level] = Math.round(clamp(0.5 + (list.reduce((a, b) => a + b, 0) / list.length) * 0.2, 0.2, 0.8) * 100) / 100;
  }
  return { games: plays.length, toughness, updated: new Date().toISOString() };
}

export async function getKitTuning(game, env, ctx, json) {
  const cache = caches.default;
  const key = new Request(kitTuningKey(game));
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, hit);
  const s = await getSettings(env);
  const since = new Date(Date.now() - TUNING_DAYS * 86400000).toISOString().slice(0, 10);
  const plays = s[`${game}_learning_enabled`]
    ? (await env.DB.prepare('SELECT level, mode, outcome, feel, minutes, hints FROM kit_plays WHERE game = ? AND day >= ? ORDER BY rowid DESC LIMIT 50000').bind(game, since).all()).results
    : [];
  const res = json(computeKitTuning(game, plays), 200, { 'Cache-Control': 'public, max-age=900' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// The admin section for one game: how each level is going.
export async function kitSummary(env, game, days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT day, level, size, mode, outcome, feel, minutes, hints, mistakes, tuned, stuck FROM kit_plays WHERE game = ?1 AND day >= ?2 ORDER BY rowid DESC LIMIT 50000').bind(game, since).all();
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const levels = KIT_LEVELS.map((level) => {
    const xs = results.filter((r) => r.level === level);
    const solved = xs.filter((r) => r.outcome === 'solved');
    const feels = { easy: 0, right: 0, hard: 0 };
    for (const r of xs) if (r.feel) feels[r.feel]++;
    const tuned = xs.filter((r) => r.tuned != null);
    return {
      level, games: xs.length, solved: solved.length,
      revealed: xs.filter((r) => r.outcome === 'revealed').length, abandoned: xs.filter((r) => r.outcome === 'abandoned').length,
      medianMinutes: median(solved.map((r) => r.minutes).filter((m) => m != null)),
      avgHints: xs.length ? Math.round((xs.reduce((n, r) => n + r.hints, 0) / xs.length) * 10) / 10 : null,
      avgTuned: tuned.length ? Math.round((tuned.reduce((n, r) => n + r.tuned, 0) / tuned.length) * 100) / 100 : null,
      feels,
    };
  });
  const stuck = {};
  for (const r of results) { try { for (const t of JSON.parse(r.stuck || '[]')) stuck[t] = (stuck[t] || 0) + 1; } catch (e) { /* skip */ } }
  const sizes = {};
  for (const r of results) sizes[r.size] = (sizes[r.size] || 0) + 1;
  const modes = {};
  for (const r of results) modes[r.mode] = (modes[r.mode] || 0) + 1;
  const cutoff = new Date(Date.now() - TUNING_DAYS * 86400000).toISOString().slice(0, 10);
  return {
    game, name: KIT_GAMES[game].name, since, games: results.length, levels, modes, sizes,
    stuck: Object.entries(stuck).sort((a, b) => b[1] - a[1]).map(([technique, count]) => ({ technique, count })),
    tuning: computeKitTuning(game, results.filter((r) => r.day >= cutoff)),
  };
}
