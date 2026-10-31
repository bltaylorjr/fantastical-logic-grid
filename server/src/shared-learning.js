// Learning across all games: the Logic Grid's and Number Place's anonymous
// play summaries pooled into one reading of how players are finding each band
// of difficulty, so every game learns from every game's players.
//
// Each game still tunes from its own plays first. The pooled reading is a
// starting point (a prior) that each level is drawn toward in proportion to
// how few games of its own it has: a level with a handful of games follows
// what all players found at that band, and one with hundreds follows its own.
// A level that had to wait for 10 of its own games before it moved now moves
// as soon as its band has enough games across all the games.
//
// Both games' readings are put on one scale, the lean: -1 (much too hard) to
// +1 (much too easy). The Logic Grid's is its play signal (learn.js), Number
// Place's its verdict halved (number-place.js npVerdict). Race games are left
// out, as they are in Number Place's own tuning.
//
// Levels are matched by where they sit in each game's ladder (BANDS), never by
// name, so a new game only has to say which band each of its levels is in.
// The admin setting "Learn across all games" (shared_learning_enabled) turns
// the pooling off; each game then tunes from its own plays as before.

// gentle, middle and tough levels of each game.
export const BANDS = {
  basic: 'gentle', easy: 'gentle',
  medium: 'middle', hard: 'middle',
  expert: 'tough', mensa: 'tough', theorist: 'tough', master: 'tough',
};
// A band needs this many games, all games together, before it is used.
export const CROWD_MIN = 20;
// How many games of a level's own the pooled reading counts as.
export const PRIOR_GAMES = 10;
// Plays read from each game, and how far back.
export const CROWD_DAYS = 90;
const CROWD_LIMIT = 50000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

// lgPlays: { tier, signal, mode } from the plays table. npPlays: { level, lean, mode },
// lean already on the -1..1 scale. Returns the pooled lean per band.
export function computeCrowd(lgPlays = [], npPlays = []) {
  const sum = {}, n = {};
  const add = (band, lean) => {
    if (!band || !Number.isFinite(lean)) return;
    sum[band] = (sum[band] || 0) + clamp(lean, -1, 1);
    n[band] = (n[band] || 0) + 1;
  };
  let lg = 0, np = 0;
  for (const p of lgPlays) if (p.mode !== 'race' && BANDS[p.tier]) { add(BANDS[p.tier], +p.signal || 0); lg++; }
  for (const p of npPlays) if (p.mode !== 'race' && BANDS[p.level]) { add(BANDS[p.level], p.lean); np++; }
  const lean = {};
  for (const band of Object.keys(n)) if (n[band] >= CROWD_MIN) lean[band] = round2(sum[band] / n[band]);
  return { games: { logicGrid: lg, numberPlace: np }, lean, counts: n };
}

// The pooled lean for one level, or null when its band has too few games.
export const priorFor = (crowd, level) => (crowd && typeof crowd.lean?.[BANDS[level]] === 'number' ? crowd.lean[BANDS[level]] : null);

// A level's own values drawn toward the prior: (own total + K * prior) / (own games + K).
export function shrink(values, prior, k = PRIOR_GAMES) {
  const total = values.reduce((a, b) => a + b, 0);
  return (total + k * prior) / (values.length + k);
}

// Both games' recent plays, for the tuning endpoints and the admin dashboard.
// A table that is not set up yet (Number Place's before its migration) counts
// as no games. npVerdict comes from number-place.js, passed in so the two
// modules do not import each other.
export async function loadCrowd(env, settings, npVerdict, now = Date.now()) {
  if (settings.shared_learning_enabled === false) return null;
  const since = new Date(now - CROWD_DAYS * 86400000).toISOString().slice(0, 10);
  const read = async (sql) => {
    try { return (await env.DB.prepare(sql).bind(since, CROWD_LIMIT).all()).results; } catch (e) { return []; }
  };
  const lg = await read('SELECT tier, signal, mode FROM plays WHERE day >= ?1 ORDER BY rowid DESC LIMIT ?2');
  const np = settings.np_learning_enabled === false ? [] : (await read('SELECT level, mode, outcome, feel, minutes, hints FROM np_plays WHERE day >= ?1 ORDER BY rowid DESC LIMIT ?2'))
    .map((r) => ({ level: r.level, mode: r.mode, lean: npVerdict(r) / 2 }));
  return computeCrowd(lg, np);
}
