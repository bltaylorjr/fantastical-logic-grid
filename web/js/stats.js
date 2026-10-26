// My stats and badges. Every finished puzzle adds one entry to the solve log
// (meta `solves`, synced with an account and merged entry by entry), and the
// stats page, the daily streak and the badges are all worked out from it.
// Badges keep the time they were first earned (meta `badges`).
import * as store from './store.js';
import { streak } from './daily.js';

const LOG_LIMIT = 2000;
const TIER_ORDER = ['basic', 'easy', 'medium', 'hard', 'expert', 'mensa'];

// One entry per finished puzzle: { at, storyId, tier, theme, ms, expectedMs,
// hints, checks, mistakes, revealed, cells, categories, daily, race }.
export function entryFor(save) {
  const p = save.puzzle;
  const K = p.categories.length, N = p.categories[0].items.length;
  return {
    at: save.completedAt || Date.now(), storyId: save.storyId || (p.story && p.story.id) || '',
    tier: p.difficulty.id, theme: p.theme.id, ms: Math.round(save.elapsedMs || 0), expectedMs: Math.round(save.expectedMs || 0),
    hints: save.hintsUsed || 0, checks: save.checksUsed || 0, mistakes: save.mistakes || 0, revealed: !!save.revealed,
    cells: (K * (K - 1) / 2) * N * N, categories: K, daily: save.daily || null, race: !!save.race,
  };
}

// Players who solved puzzles before the log existed start from their recent history.
export async function solveLog() {
  const log = await store.getMeta('solves', null);
  if (Array.isArray(log)) return log;
  const hist = await store.getMeta('history', []).catch(() => []);
  return hist.map((h) => ({ at: h.at, tier: h.tier, theme: '', ms: h.ms, hints: h.hints, revealed: h.revealed, cells: h.cells, checks: 0, mistakes: 0 }));
}

// Adds a finished puzzle and returns the badges it newly earned.
export async function record(save) {
  const log = await solveLog();
  const e = entryFor(save);
  if (log.some((x) => x.at === e.at && x.storyId === e.storyId)) return [];
  log.push(e);
  await store.setMeta('solves', log.slice(-LOG_LIMIT));
  return awardBadges(log);
}

async function awardBadges(log) {
  const have = await store.getMeta('badges', {});
  const fresh = BADGES.filter((b) => !have[b.id] && b.test(facts(log)));
  if (!fresh.length) return [];
  const now = Date.now();
  await store.setMeta('badges', { ...have, ...Object.fromEntries(fresh.map((b) => [b.id, now])) });
  return fresh;
}

// What badges and the stats page look at.
function facts(log) {
  const solved = log.filter((x) => !x.revealed);
  const themes = new Set(solved.map((x) => x.theme).filter(Boolean));
  return { log, solved, themes, streak: streak(log) };
}

const has = (f, tier) => f.solved.some((x) => x.tier === tier);
export const BADGES = [
  { id: 'first', name: 'First case closed', text: 'Solve your first puzzle.', test: (f) => f.solved.length >= 1 },
  { id: 'nohints', name: 'On my own', text: 'Solve a puzzle without any hints.', test: (f) => f.solved.some((x) => !x.hints) },
  { id: 'perfect', name: 'Flawless', text: 'Solve a puzzle with no hints, no checks and no mistakes.', test: (f) => f.solved.some((x) => !x.hints && !x.checks && !x.mistakes) },
  { id: 'quick', name: 'Quick thinker', text: 'Solve a puzzle in under half the expected time.', test: (f) => f.solved.some((x) => x.expectedMs && x.ms && x.ms < x.expectedMs / 2) },
  { id: 'medium', name: 'Getting serious', text: 'Solve a Medium puzzle.', test: (f) => has(f, 'medium') },
  { id: 'hard', name: 'Hard case', text: 'Solve a Hard puzzle.', test: (f) => has(f, 'hard') },
  { id: 'expert', name: 'Expert detective', text: 'Solve an Expert puzzle.', test: (f) => has(f, 'expert') },
  { id: 'mensa', name: 'Mastermind', text: 'Solve a MENSA puzzle.', test: (f) => has(f, 'mensa') },
  { id: 'big', name: 'Big picture', text: 'Solve a puzzle with 5 or more categories.', test: (f) => f.solved.some((x) => x.categories >= 5) },
  { id: 'ten', name: 'Ten cases', text: 'Solve 10 puzzles.', test: (f) => f.solved.length >= 10 },
  { id: 'fifty', name: 'Fifty cases', text: 'Solve 50 puzzles.', test: (f) => f.solved.length >= 50 },
  { id: 'hundred', name: 'Hundred cases', text: 'Solve 100 puzzles.', test: (f) => f.solved.length >= 100 },
  { id: 'explorer', name: 'Explorer', text: 'Solve puzzles in 5 different themes.', test: (f) => f.themes.size >= 5 },
  { id: 'globetrotter', name: 'Globetrotter', text: 'Solve puzzles in 10 different themes.', test: (f) => f.themes.size >= 10 },
  { id: 'daily', name: 'Daily detective', text: 'Solve a daily puzzle.', test: (f) => f.solved.some((x) => x.daily) },
  { id: 'streak3', name: 'On a roll', text: 'Solve the daily puzzle 3 days in a row.', test: (f) => f.streak.best >= 3 },
  { id: 'streak7', name: 'Week of wonders', text: 'Solve the daily puzzle 7 days in a row.', test: (f) => f.streak.best >= 7 },
  { id: 'streak30', name: 'Month of mysteries', text: 'Solve the daily puzzle 30 days in a row.', test: (f) => f.streak.best >= 30 },
  { id: 'racer', name: 'Racer', text: 'Finish a race against other players.', test: (f) => f.solved.some((x) => x.race) },
];

// Numbers for the stats page.
export async function summary(today) {
  const log = await solveLog();
  const badges = await store.getMeta('badges', {});
  const f = facts(log);
  const byTier = TIER_ORDER.map((tier) => {
    const xs = f.solved.filter((x) => x.tier === tier && x.ms > 0);
    if (!xs.length) return null;
    const avg = (k) => xs.reduce((s, x) => s + (x[k] || 0), 0) / xs.length;
    return { tier, solved: xs.length, bestMs: Math.min(...xs.map((x) => x.ms)), avgMs: avg('ms'), avgHints: avg('hints') };
  }).filter(Boolean);
  const themeCount = {};
  for (const x of f.solved) if (x.theme) themeCount[x.theme] = (themeCount[x.theme] || 0) + 1;
  const monthAgo = Date.now() - 30 * 86400000;
  return {
    total: log.length,
    solved: f.solved.length,
    revealed: log.length - f.solved.length,
    noHints: f.solved.filter((x) => !x.hints).length,
    last30: f.solved.filter((x) => x.at >= monthAgo).length,
    totalMs: f.solved.reduce((s, x) => s + (x.ms || 0), 0),
    byTier,
    themes: Object.entries(themeCount).sort((a, b) => b[1] - a[1]),
    streak: streak(log, today),
    badges: BADGES.map((b) => ({ ...b, at: badges[b.id] || null })),
  };
}
