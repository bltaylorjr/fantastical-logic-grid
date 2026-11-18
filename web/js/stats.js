// My stats and badges. Every finished puzzle adds one entry to the solve log
// (meta `solves`, synced with an account and merged entry by entry), and the
// stats page, the daily streak and the badges are all worked out from it.
// Badges keep the time they were first earned (meta `badges`).
import * as store from './store.js';
import { streak } from './daily.js';

const LOG_LIMIT = 2000;
const TIER_ORDER = ['basic', 'easy', 'medium', 'hard', 'expert', 'mensa', 'theorist'];

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
export function facts(log) {
  const solved = log.filter((x) => !x.revealed);
  const themes = new Set(solved.map((x) => x.theme).filter(Boolean));
  const themeCount = {};
  for (const x of solved) if (x.theme) themeCount[x.theme] = (themeCount[x.theme] || 0) + 1;
  // Longest run of finished puzzles in a row with no hints (a revealed
  // answer or a hint ends the run).
  let run = 0, bestNoHintRun = 0;
  for (const x of [...log].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    run = !x.revealed && !x.hints ? run + 1 : 0;
    bestNoHintRun = Math.max(bestNoHintRun, run);
  }
  const perDay = {};
  for (const x of solved) if (x.at) { const d = new Date(x.at).toDateString(); perDay[d] = (perDay[d] || 0) + 1; }
  return {
    log, solved, themes, streak: streak(log),
    noHintStreak: streak(log.filter((x) => !x.hints)),
    topTheme: Math.max(0, ...Object.values(themeCount)),
    bestNoHintRun,
    bestDay: Math.max(0, ...Object.values(perDay)),
    hours: solved.reduce((s, x) => s + (x.ms || 0), 0) / 3600000,
  };
}

// Badges are meant to be earned. Each one, once earned, is kept for good
// (meta `badges`), so making a badge harder never takes it from anyone who
// already has it. `goal` gives [have, need] for the stats page progress bar.
const AT_LEAST = (tier) => (x) => TIER_ORDER.indexOf(x.tier) >= TIER_ORDER.indexOf(tier);
const clean = (x) => !x.hints && !x.checks && !x.mistakes;
const count = (f, fn) => f.solved.filter(fn).length;
const tierCount = (f, tier, fn = () => true) => count(f, (x) => x.tier === tier && fn(x));
const counter = (fn, need) => ({ test: (f) => fn(f) >= need, goal: (f) => [Math.min(fn(f), need), need] });
const TOP_TIERS = TIER_ORDER.slice(2); // Medium and up
export const BADGES = [
  // Getting started
  { id: 'first', name: 'First case closed', text: 'Solve your first puzzle.', test: (f) => f.solved.length >= 1 },
  { id: 'nohints', name: 'On my own', text: 'Solve a Hard or harder puzzle without any hints.', test: (f) => f.solved.some((x) => !x.hints && AT_LEAST('hard')(x)) },
  { id: 'daily', name: 'Daily detective', text: 'Solve a daily puzzle without any hints.', test: (f) => f.solved.some((x) => x.daily && !x.hints) },
  // Skill
  { id: 'perfect', name: 'Flawless', text: 'Solve an Expert or harder puzzle with no hints, no checks and no mistakes.', test: (f) => f.solved.some((x) => clean(x) && AT_LEAST('expert')(x)) },
  { id: 'untouchable', name: 'Untouchable', text: 'Solve 10 Hard or harder puzzles with no hints, no checks and no mistakes.', ...counter((f) => count(f, (x) => clean(x) && AT_LEAST('hard')(x)), 10) },
  { id: 'quick', name: 'Quick thinker', text: 'Solve a Hard or harder puzzle without hints in under half the expected time.', test: (f) => f.solved.some((x) => !x.hints && AT_LEAST('hard')(x) && x.expectedMs && x.ms && x.ms < x.expectedMs / 2) },
  { id: 'lightning', name: 'Lightning mind', text: 'Solve an Expert or harder puzzle without hints in under a third of the expected time.', test: (f) => f.solved.some((x) => !x.hints && AT_LEAST('expert')(x) && x.expectedMs && x.ms && x.ms < x.expectedMs / 3) },
  { id: 'hotstreak10', name: 'Hot hand', text: 'Finish 10 puzzles in a row without a hint or a revealed answer.', ...counter((f) => f.bestNoHintRun, 10) },
  { id: 'hotstreak25', name: 'Iron will', text: 'Finish 25 puzzles in a row without a hint or a revealed answer.', ...counter((f) => f.bestNoHintRun, 25) },
  // Difficulty
  { id: 'medium', name: 'Getting serious', text: 'Solve a Medium puzzle without any hints.', test: (f) => tierCount(f, 'medium', (x) => !x.hints) >= 1 },
  { id: 'hard', name: 'Hard case', text: 'Solve a Hard puzzle without any hints.', test: (f) => tierCount(f, 'hard', (x) => !x.hints) >= 1 },
  { id: 'expert', name: 'Expert detective', text: 'Solve an Expert puzzle without any hints.', test: (f) => tierCount(f, 'expert', (x) => !x.hints) >= 1 },
  { id: 'mensa', name: 'Mastermind', text: 'Solve a Quantum Physicist puzzle with 2 hints or fewer.', test: (f) => tierCount(f, 'mensa', (x) => x.hints <= 2) >= 1 },
  { id: 'theorist', name: 'Beyond the quantum', text: 'Solve a Theoretical Physicist puzzle with 2 hints or fewer.', test: (f) => tierCount(f, 'theorist', (x) => x.hints <= 2) >= 1 },
  { id: 'quantum10', name: 'Quantum leap', text: 'Solve 10 Quantum Physicist puzzles without any hints.', ...counter((f) => tierCount(f, 'mensa', (x) => !x.hints), 10) },
  { id: 'theorist10', name: 'Theory of everything', text: 'Solve 10 Theoretical Physicist puzzles without any hints.', ...counter((f) => tierCount(f, 'theorist', (x) => !x.hints), 10) },
  { id: 'grandmaster', name: 'Grand master', text: 'Solve a Theoretical Physicist puzzle with no hints, no checks and no mistakes.', test: (f) => tierCount(f, 'theorist', clean) >= 1 },
  { id: 'ladder', name: 'Top to bottom', text: 'Solve a puzzle at every level from Medium to Theoretical Physicist without any hints.', ...counter((f) => TOP_TIERS.filter((t) => tierCount(f, t, (x) => !x.hints)).length, TOP_TIERS.length) },
  // Grid size
  { id: 'big', name: 'Big picture', text: 'Solve a puzzle with 6 categories.', test: (f) => f.solved.some((x) => x.categories >= 6) },
  { id: 'giant', name: 'Giant grid', text: 'Solve a puzzle with 6 categories of 8 items each without any hints.', test: (f) => f.solved.some((x) => x.categories >= 6 && !x.hints && x.cells >= 15 * 64) },
  // Puzzles solved
  { id: 'ten', name: '25 cases closed', text: 'Solve 25 puzzles.', ...counter((f) => f.solved.length, 25) },
  { id: 'fifty', name: '100 cases closed', text: 'Solve 100 puzzles.', ...counter((f) => f.solved.length, 100) },
  { id: 'hundred', name: '250 cases closed', text: 'Solve 250 puzzles.', ...counter((f) => f.solved.length, 250) },
  { id: 'cases500', name: '500 cases closed', text: 'Solve 500 puzzles.', ...counter((f) => f.solved.length, 500) },
  { id: 'cases1000', name: 'Legend of the grid', text: 'Solve 1,000 puzzles.', ...counter((f) => f.solved.length, 1000) },
  { id: 'marathon', name: 'Marathon', text: 'Solve 10 puzzles in one day.', ...counter((f) => f.bestDay, 10) },
  { id: 'hours50', name: 'Devoted', text: 'Spend 50 hours solving puzzles.', ...counter((f) => Math.floor(f.hours), 50) },
  // Themes
  { id: 'explorer', name: 'Explorer', text: 'Solve puzzles in 10 different themes.', ...counter((f) => f.themes.size, 10) },
  { id: 'globetrotter', name: 'Globetrotter', text: 'Solve puzzles in 20 different themes.', ...counter((f) => f.themes.size, 20) },
  { id: 'specialist', name: 'Specialist', text: 'Solve 25 puzzles in one theme.', ...counter((f) => f.topTheme, 25) },
  // Daily puzzle
  { id: 'streak3', name: 'On a roll', text: 'Solve the daily puzzle 5 days in a row.', ...counter((f) => f.streak.best, 5) },
  { id: 'streak7', name: 'Week of wonders', text: 'Solve the daily puzzle 7 days in a row.', ...counter((f) => f.streak.best, 7) },
  { id: 'streak30', name: 'Month of mysteries', text: 'Solve the daily puzzle 30 days in a row.', ...counter((f) => f.streak.best, 30) },
  { id: 'streak100', name: 'Hundred-day habit', text: 'Solve the daily puzzle 100 days in a row.', ...counter((f) => f.streak.best, 100) },
  { id: 'streak365', name: 'Year of logic', text: 'Solve the daily puzzle 365 days in a row.', ...counter((f) => f.streak.best, 365) },
  { id: 'cleanweek', name: 'Perfect week', text: 'Solve the daily puzzle 7 days in a row without any hints.', ...counter((f) => f.noHintStreak.best, 7) },
  { id: 'daily100', name: 'Daily devotee', text: 'Solve 100 daily puzzles.', ...counter((f) => count(f, (x) => x.daily), 100) },
  // Races
  { id: 'racer', name: 'Racer', text: 'Finish 5 races against other players.', ...counter((f) => count(f, (x) => x.race), 5) },
  { id: 'racer25', name: 'Race veteran', text: 'Finish 25 races against other players.', ...counter((f) => count(f, (x) => x.race), 25) },
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
    badges: BADGES.map((b) => ({ ...b, at: badges[b.id] || null, progress: !badges[b.id] && b.goal ? b.goal(f) : null })),
  };
}
