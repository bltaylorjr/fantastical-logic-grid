// Lab modes (modes.js): their grid sizes, and how a Lab mode adapts to the
// player. No imports, so the setup screen (web/js/lab.js) can load it without
// the story library.
//
// Adapting works like the main game's free play (web/js/learn.js), but from
// the mode's own small record on this device, kept apart from the live
// learning data, ratings, scoreboard and stats:
//   - toughness inside the chosen difficulty ("effort", -1 gentler to 1
//     tougher) moves after each finished puzzle, from its hints, time and
//     whether the player gave up. The engine uses effort only to choose
//     between puzzles it has already fully checked (generator.js), so every
//     puzzle still has exactly one answer.
//   - the solved panel suggests the next difficulty: a step up after quick
//     solves with no hints, a step down after giving up or many hints.

// [categories, items] for each difficulty. The size picker is hidden while a
// Lab mode is chosen, so these are the sizes players get.
export const LAB_SIZES = {
  timeline: { basic: [4, 4], easy: [4, 4], medium: [4, 5], hard: [4, 5], expert: [5, 5], mensa: [5, 6], theorist: [5, 7] },
  seating: { basic: [3, 5], easy: [3, 6], medium: [4, 6], hard: [4, 6], expert: [4, 6], mensa: [5, 7], theorist: [5, 8] },
};
export const LAB_LIMITS = { timeline: { categories: [4, 5], items: [4, 8] }, seating: { categories: [3, 5], items: [5, 8] } };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const LAB_RECORD_MAX = 60;

// How a finished Lab puzzle felt, from -1 (far too hard) to 1 (far too easy).
// play: { outcome: 'solved' | 'revealed' | 'abandoned', hints, mistakes, ms, expectedMs, percent }
export function labSignal(p) {
  if (p.outcome === 'revealed') return -0.8;
  if (p.outcome === 'abandoned') return (p.percent || 0) < 30 ? -0.6 : -0.4;
  if (p.outcome !== 'solved') return 0;
  if (p.hints >= 4 || p.mistakes >= 8) return -0.6;
  if (p.hints >= 2 || p.mistakes >= 4) return -0.2;
  if (p.hints === 0 && (p.mistakes || 0) <= 1 && (!p.expectedMs || p.ms <= p.expectedMs)) return 0.6;
  return 0;
}

const finished = (p) => ['solved', 'revealed', 'abandoned'].includes(p.outcome);

// Effort for the next puzzle at this difficulty, or null with no history.
export function labEffort(plays, tier) {
  let e = null;
  for (const p of plays || []) {
    if (p.tier !== tier || !finished(p)) continue;
    e = clamp((e ?? p.effort ?? 0) * 0.5 + (p.effort || 0) * 0.5 + 0.35 * labSignal(p), -1, 1);
  }
  return e;
}

// Options to add to generatePuzzle() for a Lab puzzle: only effort, and only
// when it is far enough from the middle to matter (as in learn.js).
export function labTuning(plays, tier) {
  const e = labEffort(plays, tier);
  return e != null && Math.abs(e) >= 0.15 ? { learning: { effort: Math.round(e * 100) / 100 } } : {};
}

// The record with one play added or updated (one entry per story).
export function labAddPlay(plays, play, max = LAB_RECORD_MAX) {
  const list = (plays || []).filter((p) => p.storyId !== play.storyId);
  list.push(play);
  return list.slice(-max);
}

// The difficulty to suggest after the latest play: { tier, why, step }.
// step is -1, 0 or 1.
export function labSuggest(plays, tierOrder) {
  const done = (plays || []).filter(finished);
  const last = done.at(-1);
  if (!last) return null;
  const i = Math.max(0, tierOrder.indexOf(last.tier));
  const down = { tier: tierOrder[Math.max(0, i - 1)], step: i > 0 ? -1 : 0 };
  const up = { tier: tierOrder[Math.min(tierOrder.length - 1, i + 1)], step: i < tierOrder.length - 1 ? 1 : 0 };
  const stay = { tier: last.tier, step: 0 };
  if (last.outcome !== 'solved') return { ...down, why: 'gaveUp' };
  if (last.hints >= 4) return { ...down, why: 'manyHints' };
  const quick = (p) => p.outcome === 'solved' && p.hints === 0 && (!p.expectedMs || p.ms <= p.expectedMs);
  if (quick(last)) return { ...up, why: 'quick' };
  const recent = done.slice(-2);
  if (recent.length === 2 && recent.every((p) => p.tier === last.tier && p.outcome === 'solved' && p.hints <= 1)) return { ...up, why: 'steady' };
  return { ...stay, why: 'fits' };
}
