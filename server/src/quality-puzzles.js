// Problem puzzles (admin > Puzzle quality, admin/quality.js).
//
// A Logic Grid puzzle is built on the player's device and never stored. When
// a finished game is a problem (given up on or answer revealed, rated 1 or 2,
// called too hard or too easy, or played far outside its level's normal
// limits) the game also sends the puzzle itself, with nothing about the
// player. The team sees it with its numbers and suggested fixes, and can:
//   Edit       change its title and story words, or rebuild it with other
//              settings (the dashboard builds it with the website's own engine)
//   Delete     retire its story: no game builds that story again (Undo puts it back)
//   Republish  give players the fixed version: it is listed in the game's
//              Hand-picked puzzles as "fixed by the team"
//
// Public:
//   POST /v1/learn/problem            { pid, puzzle } one problem puzzle (learn.js routes it here)
//   GET  /v1/learn/fixed              republished puzzles, for the game
// Admin (qualityPuzzleRoutes, under /admin/v1/):
//   GET  quality-puzzles?status=&theme=&tier=&days=   the list, with numbers, reasons and suggestions
//   GET  quality-puzzles/:id          one puzzle, as players got it and as fixed
//   POST quality-puzzles/:id/save     { title?, paragraphs?, ending?, puzzle?, note? } -> status fixed
//   POST quality-puzzles/:id/(publish|unpublish|retire|restore|reset)
import { checkPuzzle } from './compete.js';
import { readablePuzzle } from './puzzle-reports.js';
import { THEMES } from '../../engine/src/themes.js';
import { TIER_ORDER, TIERS } from '../../engine/src/tiers.js';
import { wilson, bayesAverage, median, winsorize } from './stats.js';

const DAY = 24 * 3600_000;
const THEME_IDS = new Set(THEMES.map((t) => t.id));
const TIER_SET = new Set(TIER_ORDER);
export const ID_RE = /^[a-z0-9-]{1,40}-[a-z0-9-]{1,60}-[a-z]{1,20}-\d+x\d+-[\w.:-]{1,60}$/;
const STATUSES = ['open', 'fixed', 'published', 'retired'];
// At most this many new problem puzzles a day, so the free database stays small.
export const MAX_NEW_PER_DAY = 100;
// Untouched problem puzzles go after this; fixed, published and retired ones stay.
export const KEEP_OPEN_DAYS = 90;
const MAX_FIXED_LISTED = 30;
// learn.js caches the shared tuning (with the retired stories) under this key.
const TUNING_CACHE_KEY = 'https://flg-cloud.internal/v1/learn/tuning';
const FIXED_CACHE_KEY = 'https://flg-cloud.internal/v1/learn/fixed';
const clearCache = async (key) => { try { await caches.default.delete(new Request(key)); } catch (e) { /* tests: no cache */ } };
const clearTuning = () => clearCache(TUNING_CACHE_KEY);
const clearFixed = () => clearCache(FIXED_CACHE_KEY);

// ---------- normal limits ----------
// A play is outside its level's normal limits when it took far longer than
// the game expected, or needed many hints or made many mistakes. The game
// uses the same numbers (web/js/learn.js isProblem) to decide what to send.
export const LIMITS = { slowTimes: 2, fastTimes: 0.35, hints: 3, mistakes: 6, lowRating: 2 };

export function playReasons(p) {
  const out = [];
  if (p.outcome === 'revealed') out.push('revealed');
  if (p.outcome === 'abandoned') out.push('quit');
  if (p.rating != null && p.rating <= LIMITS.lowRating) out.push('low_rating');
  if (p.feel === 'hard') out.push('too_hard');
  if (p.feel === 'easy') out.push('too_easy');
  if (p.outcome === 'solved' && p.expected > 0 && p.minutes != null) {
    if (p.minutes > p.expected * LIMITS.slowTimes) out.push('slow');
    else if (p.minutes < p.expected * LIMITS.fastTimes) out.push('fast');
  }
  if (p.hints >= LIMITS.hints) out.push('hints');
  if (p.mistakes >= LIMITS.mistakes) out.push('mistakes');
  return out;
}

export const REASON_TEXT = {
  revealed: 'answer revealed', quit: 'given up', low_rating: 'rated low', too_hard: 'called too hard', too_easy: 'called too easy',
  slow: `took over ${LIMITS.slowTimes}× the expected time`, fast: 'solved far quicker than expected', hints: `${LIMITS.hints}+ hints`, mistakes: `${LIMITS.mistakes}+ mistakes`,
};

// ---------- storage ----------
async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(data) {
  if (!data) return null;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(Array.isArray(data) ? data : data);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

// The puzzle as the game sent it: its own shape, an engine id, the options it
// was built with, not a player's own story, and nothing a player wrote.
export function checkProblemPuzzle(p) {
  if (!p || typeof p !== 'object' || p.mode || !p.options || p.options.custom) return null;
  if (!ID_RE.test(String(p.id || '')) || !TIER_SET.has(p.difficulty?.id) || !THEME_IDS.has(p.theme?.id)) return null;
  if (!p.story || !Array.isArray(p.story.paragraphs)) return null;
  if (checkPuzzle(p)) return null;
  return readablePuzzle(p);
}

// One problem puzzle from the game. Returns { saved: true|false }.
export async function saveProblemPuzzle(env, body, now = Date.now()) {
  const text = checkProblemPuzzle(body?.puzzle);
  if (!text) return { saved: false, error: 'bad_puzzle' };
  const p = body.puzzle;
  const known = await env.DB.prepare('SELECT status FROM quality_puzzles WHERE id = ?1').bind(p.id).first();
  if (known) {
    await env.DB.prepare('UPDATE quality_puzzles SET last_seen = ?2 WHERE id = ?1').bind(p.id, now).run();
    return { saved: true };
  }
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM quality_puzzles WHERE first_seen > ?1').bind(now - DAY).first();
  if (n >= MAX_NEW_PER_DAY) return { saved: false, error: 'full' };
  const size = `${p.categories.length}x${p.categories[0].items.length}`;
  await env.DB.prepare(`INSERT INTO quality_puzzles (id, tier, theme, topic, story, size, seed, title, puzzle, first_seen, last_seen)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) ON CONFLICT (id) DO NOTHING`)
    .bind(p.id, p.difficulty.id, p.theme.id, String(p.topic?.id || '').slice(0, 60) || null, String(p.story.id || '').slice(0, 160) || null,
      size, String(p.seed || '').slice(0, 60) || null, String(p.title || '').slice(0, 160), await gzip(text), now).run();
  return { saved: true };
}

// Stories retired with Delete: the game never builds them again.
export async function retiredStories(env) {
  try {
    const { results } = await env.DB.prepare("SELECT DISTINCT story FROM quality_puzzles WHERE status = 'retired' AND story IS NOT NULL LIMIT 2000").all();
    return results.map((r) => r.story);
  } catch (e) { return []; } // not migrated yet
}

// Republished puzzles for the game's Hand-picked list.
export async function fixedPuzzles(env) {
  const { results } = await env.DB.prepare(`SELECT id, title, tier, theme, fixed, published_at FROM quality_puzzles
    WHERE status = 'published' AND fixed IS NOT NULL ORDER BY published_at DESC LIMIT ?1`).bind(MAX_FIXED_LISTED).all();
  const out = [];
  for (const r of results) {
    try { out.push({ id: r.id, title: r.title, difficulty: r.tier, theme: r.theme, publishedAt: r.published_at, puzzle: await gunzip(r.fixed) }); } catch (e) { /* skip a damaged row */ }
  }
  return out;
}

// ---------- suggestions ----------
// Plain fixes for what went wrong, from the puzzle's numbers. Each:
// { text, action } where action is a ready-made rebuild for Edit (or null).
export function suggestionsFor(stats, info) {
  const out = [];
  const tier = TIERS[info.tier];
  const i = TIER_ORDER.indexOf(info.tier);
  const easier = i > 0 ? TIER_ORDER[i - 1] : null;
  const harder = i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
  const [K, N] = String(info.size || '').split('x').map(Number);
  const has = (r) => stats.reasons[r] > 0;
  const hardSide = has('quit') || has('revealed') || has('too_hard') || has('slow') || has('hints') || has('mistakes');
  if (hardSide && !has('too_easy')) {
    if (tier && K && N && (K > tier.categories[0] || N > tier.items[0])) {
      const smaller = K > tier.categories[0] ? { categories: K - 1, items: N } : { categories: K, items: N - 1 };
      out.push({ text: `Make it smaller: ${smaller.categories} × ${smaller.items} instead of ${K} × ${N} keeps the ${tier.name} clues but less to track.`, action: { difficulty: info.tier, ...smaller } });
    }
    if (info.whatif > (tier?.maxWhatIf ?? 99)) out.push({ text: `It needs ${info.whatif} what-if steps, more than ${tier.name} allows (${tier.maxWhatIf}). Rebuild it so it can be solved straight through.`, action: { difficulty: info.tier, categories: K, items: N, newSeed: true } });
    if (easier && (has('too_hard') || stats.quitRate >= 0.5)) out.push({ text: `Most players found it beyond ${tier?.name || info.tier}. Rebuild it one level easier (${TIERS[easier].name}).`, action: { difficulty: easier, newSeed: false } });
    if (has('hints') || has('mistakes')) out.push({ text: 'Players needed many hints or made many mistakes: read the clues for wording that could be taken two ways, and reword the story if it hints at the wrong answer.', action: null });
  }
  if (has('too_easy') || has('fast')) {
    if (harder) out.push({ text: `Players found it too easy for ${tier?.name || info.tier}. Rebuild it one level harder (${TIERS[harder].name}), or a size bigger.`, action: { difficulty: harder, newSeed: false } });
  }
  if (has('low_rating') && !hardSide) out.push({ text: 'Rated low but not too hard: the story is the likely cause. Edit the title and story words, or retire the story (Delete) and rebuild with a new one.', action: { difficulty: info.tier, categories: K, items: N, newSeed: true } });
  if (stats.versions.length > 1) out.push({ text: `Played on app versions ${stats.versions.join(', ')}: if only one version had problems, it may be a game fault, not the puzzle (check Error tracking).`, action: null });
  if (!out.length) out.push({ text: 'Look at it in Edit: check the story and clues read clearly, then rebuild it with a new story if needed.', action: null });
  return out;
}

// ---------- the list ----------
const num = (v) => (v == null ? null : Math.round(v * 10) / 10);

// One puzzle's games. Times are each solve over the expected time, clipped
// to 0.1-6x, and the median taken; the rating is a Bayesian average pulled
// toward the overall average (weight 5); the give-up share has its 95%
// Wilson interval, and `problemLow` (the cautious share of games with a
// problem) orders the list.
function summarize(plays, prior) {
  const reasons = {};
  let quits = 0, problems = 0, hints = 0, mistakes = 0, expected = 0;
  const ratings = [], minutes = [], ratios = [];
  const versions = new Set(), modes = new Set(), days = new Set();
  for (const p of plays) {
    const why = playReasons(p);
    for (const r of why) reasons[r] = (reasons[r] || 0) + 1;
    if (why.length) problems++;
    if (p.outcome !== 'solved') quits++;
    if (p.rating >= 1 && p.rating <= 5) ratings.push(p.rating);
    if (p.minutes > 0 && p.outcome === 'solved') { minutes.push(p.minutes); if (p.expected > 0) ratios.push(p.minutes / p.expected); }
    if (p.expected) expected = p.expected;
    hints += p.hints || 0;
    mistakes += p.mistakes || 0;
    if (p.version) versions.add(p.version);
    if (p.mode) modes.add(p.mode);
    days.add(p.day);
  }
  const games = plays.length || 0;
  const quit = wilson(quits, games);
  const rating = ratings.length ? bayesAverage(ratings.reduce((a, b) => a + b, 0), ratings.length, prior, 5) : null;
  return {
    games, reasons, quitRate: games ? Math.round(quit.p * 100) / 100 : 0, quitRange: games ? [num(quit.low * 100) / 100, num(quit.high * 100) / 100] : null,
    problemLow: Math.round(wilson(problems, games).low * 1000) / 1000,
    rating: num(rating), rated: ratings.length, ratingRaw: ratings.length ? num(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
    minutes: num(median(minutes)), expected: num(expected) || null, timeRatio: ratios.length ? num(median(winsorize(ratios, 0.1, 6))) : null,
    hints: games ? num(hints / games) : null, mistakes: games ? num(mistakes / games) : null,
    versions: [...versions].sort(), modes: [...modes], days: [...days].sort(),
  };
}

export async function listProblemPuzzles(env, { status = 'open', theme = null, tier = null } = {}) {
  const where = [];
  const args = [];
  if (STATUSES.includes(status)) { args.push(status); where.push(`status = ?${args.length}`); }
  else if (status === 'active') where.push("status != 'retired'");
  if (theme && THEME_IDS.has(theme)) { args.push(theme); where.push(`theme = ?${args.length}`); }
  if (tier && TIER_SET.has(tier)) { args.push(tier); where.push(`tier = ?${args.length}`); }
  const { results } = await env.DB.prepare(`SELECT id, tier, theme, topic, story, size, seed, title, status, note, first_seen, last_seen, updated_by, updated_at, published_at, (fixed IS NOT NULL) AS hasFixed
    FROM quality_puzzles ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last_seen DESC LIMIT 200`).bind(...args).all();
  const counts = Object.fromEntries((await env.DB.prepare('SELECT status, COUNT(*) AS n FROM quality_puzzles GROUP BY status').all()).results.map((r) => [r.status, r.n]));
  if (!results.length) return { puzzles: [], counts, limits: LIMITS };
  const ids = results.map((r) => r.id);
  const plays = [];
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const r = await env.DB.prepare(`SELECT puzzle_id, day, outcome, rating, feel, minutes, expected, hints, mistakes, version, mode, whatif, clues, score
      FROM plays WHERE puzzle_id IN (${part.map((_, j) => `?${j + 1}`).join(',')})`).bind(...part).all();
    plays.push(...r.results);
  }
  // The overall average rating, the prior for each puzzle's own average.
  let prior = null;
  try { prior = (await env.DB.prepare("SELECT AVG(rating) AS a FROM plays WHERE rating IS NOT NULL AND day >= date('now', '-90 days')").first())?.a ?? null; } catch (e) { /* none */ }
  const byId = new Map();
  for (const p of plays) (byId.get(p.puzzle_id) || byId.set(p.puzzle_id, []).get(p.puzzle_id)).push(p);
  const puzzles = results.map((r) => {
    const mine = byId.get(r.id) || [];
    const stats = summarize(mine, prior);
    const last = mine[mine.length - 1] || {};
    const info = { tier: r.tier, size: r.size, whatif: last.whatif ?? null, clues: last.clues ?? null, score: last.score ?? null };
    // Worst first: the cautious share of games with a problem, by how many games.
    const weight = Math.round(stats.problemLow * Math.log2(1 + stats.games) * 1000) / 1000;
    return {
      id: r.id, title: r.title, tier: r.tier, theme: r.theme, topic: r.topic, story: r.story, size: r.size, seed: r.seed,
      status: r.status, note: r.note, hasFixed: !!r.hasFixed, firstSeen: r.first_seen, lastSeen: r.last_seen,
      updatedBy: r.updated_by, updatedAt: r.updated_at, publishedAt: r.published_at,
      ...info, stats, weight, suggestions: suggestionsFor(stats, info),
    };
  });
  puzzles.sort((a, b) => b.weight - a.weight || b.lastSeen - a.lastSeen);
  return { puzzles, counts, limits: LIMITS };
}

// ---------- editing ----------
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

// Applies the team's word changes to a puzzle; returns { puzzle } or { error }.
export function applyEdits(base, body) {
  let p = base;
  if (body.puzzle) {
    // A rebuild from the dashboard: the same checks as a puzzle from the game.
    if (!checkProblemPuzzle(body.puzzle)) return { error: 'The rebuilt puzzle could not be read. Rebuild it again.' };
    p = body.puzzle;
  }
  p = JSON.parse(JSON.stringify(p));
  if (body.title != null) {
    const title = clean(body.title, 120);
    if (title.length < 2) return { error: 'Give the puzzle a title.' };
    p.title = title;
    if (p.story) p.story.title = title;
  }
  if (Array.isArray(body.paragraphs)) {
    const paragraphs = body.paragraphs.map((x) => clean(x, 1200)).filter(Boolean).slice(0, 12);
    if (!paragraphs.length) return { error: 'The story needs at least one paragraph.' };
    p.story.paragraphs = paragraphs;
    p.story.text = paragraphs.join('\n\n');
    p.story.wordCount = p.story.text.split(/\s+/).filter(Boolean).length;
  }
  if (body.ending != null && p.story) p.story.ending = clean(body.ending, 600);
  const bad = checkPuzzle(p);
  if (bad === 'puzzle_words') return { error: 'Some of the words are on the blocked list. Change them and save again.' };
  if (bad) return { error: 'The puzzle no longer reads correctly. Undo the change or rebuild it.' };
  if (!readablePuzzle(p)) return { error: 'The puzzle is too big to save.' };
  return { puzzle: p };
}

export function qualityPuzzleRoutes(Refusal) {
  const ID = '([a-z0-9][\\w.:-]{5,200})';
  const getRow = async (env, id) => {
    const r = await env.DB.prepare('SELECT * FROM quality_puzzles WHERE id = ?1').bind(id).first();
    if (!r) throw new Refusal(404, 'gone', 'That puzzle is gone. Reload the page.');
    return r;
  };
  const setStatus = (env, id, status, who, now, extra = '') => env.DB.prepare(`UPDATE quality_puzzles SET status = ?2, updated_by = ?3, updated_at = ?4${extra} WHERE id = ?1`).bind(id, status, who, now).run();
  return [
    ['GET', /^quality-puzzles$/, 'viewer', 'quality.puzzles', async ({ env, url }) => ({
      body: {
        ...await listProblemPuzzles(env, { status: url.searchParams.get('status') || 'active', theme: url.searchParams.get('theme'), tier: url.searchParams.get('tier') }),
        // Edit > Rebuild builds puzzles with the website's own engine (its Book maker page).
        siteUrl: String(env.SITE_URL || 'https://thelogicgrid.com').replace(/\/+$/, ''),
        levels: TIER_ORDER.map((id) => ({ id, name: TIERS[id].name, categories: TIERS[id].categories, items: TIERS[id].items })),
      },
      quiet: true,
    })],
    ['GET', new RegExp(`^quality-puzzles/${ID}$`), 'viewer', 'quality.puzzle', async ({ env, params: [id] }) => {
      const r = await getRow(env, id);
      return { body: { id: r.id, status: r.status, note: r.note, puzzle: await gunzip(r.puzzle), fixed: await gunzip(r.fixed) }, quiet: true };
    }],
    ['POST', new RegExp(`^quality-puzzles/${ID}/save$`), 'admin', 'quality.edit', async ({ env, params: [id], body, who, now }) => {
      const r = await getRow(env, id);
      if (r.status === 'retired') throw new Refusal(409, 'retired', 'This puzzle is deleted. Undo first to edit it.');
      const base = (await gunzip(r.fixed)) || (await gunzip(r.puzzle));
      const e = applyEdits(base, body || {});
      if (e.error) throw new Refusal(400, 'bad_edit', e.error);
      const status = r.status === 'published' ? 'published' : 'fixed';
      await env.DB.prepare('UPDATE quality_puzzles SET fixed = ?2, status = ?3, note = ?4, updated_by = ?5, updated_at = ?6 WHERE id = ?1')
        .bind(id, await gzip(JSON.stringify(e.puzzle)), status, clean(body?.note ?? r.note ?? '', 500) || null, who.actor, now).run();
      if (status === 'published') await clearFixed();
      return { body: { ok: true, status, fixed: e.puzzle }, target: id, detail: { rebuilt: !!body?.puzzle } };
    }, { maxBody: 200_000 }],
    ['POST', new RegExp(`^quality-puzzles/${ID}/reset$`), 'admin', 'quality.reset', async ({ env, params: [id], who, now }) => {
      const r = await getRow(env, id);
      if (r.status === 'published') throw new Refusal(409, 'published', 'Take it off the Hand-picked list first (Unpublish).');
      await env.DB.prepare("UPDATE quality_puzzles SET fixed = NULL, status = 'open', updated_by = ?2, updated_at = ?3 WHERE id = ?1").bind(id, who.actor, now).run();
      return { body: { ok: true, status: 'open' }, target: id };
    }],
    ['POST', new RegExp(`^quality-puzzles/${ID}/publish$`), 'admin', 'quality.publish', async ({ env, params: [id], who, now }) => {
      const r = await getRow(env, id);
      if (!r.fixed) throw new Refusal(409, 'not_fixed', 'Fix it first (Edit), then republish the fixed version.');
      if (r.status === 'retired') throw new Refusal(409, 'retired', 'This puzzle is deleted. Undo first.');
      await setStatus(env, id, 'published', who.actor, now, ', published_at = ?4');
      await clearFixed();
      return { body: { ok: true, status: 'published' }, target: id };
    }],
    ['POST', new RegExp(`^quality-puzzles/${ID}/unpublish$`), 'admin', 'quality.unpublish', async ({ env, params: [id], who, now }) => {
      await getRow(env, id);
      await setStatus(env, id, 'fixed', who.actor, now);
      await clearFixed();
      return { body: { ok: true, status: 'fixed' }, target: id };
    }],
    ['POST', new RegExp(`^quality-puzzles/${ID}/retire$`), 'admin', 'quality.retire', async ({ env, params: [id], who, now }) => {
      const r = await getRow(env, id);
      if (r.status === 'retired') return { body: { ok: true, status: 'retired' }, target: id };
      await env.DB.prepare("UPDATE quality_puzzles SET before_retire = status, status = 'retired', updated_by = ?2, updated_at = ?3 WHERE id = ?1").bind(id, who.actor, now).run();
      await clearTuning();
      return { body: { ok: true, status: 'retired' }, target: id };
    }],
    ['POST', new RegExp(`^quality-puzzles/${ID}/restore$`), 'admin', 'quality.restore', async ({ env, params: [id], who, now }) => {
      const r = await getRow(env, id);
      const back = STATUSES.includes(r.before_retire) && r.before_retire !== 'retired' ? r.before_retire : (r.fixed ? 'fixed' : 'open');
      await setStatus(env, id, back, who.actor, now);
      await clearTuning();
      return { body: { ok: true, status: back }, target: id };
    }],
  ];
}

export function upkeepStatements(env, now) {
  return {
    quality_puzzles: env.DB.prepare("DELETE FROM quality_puzzles WHERE status = 'open' AND last_seen < ?1").bind(now - KEEP_OPEN_DAYS * DAY),
  };
}

export { gzip, gunzip };
