// Race the computer: a race on a new puzzle against a computer opponent, for
// every player (no account, screen name or connection needed). It runs on this
// device only, so it never touches the race server or the scoreboard's race wins.
//
// The computer works through the same puzzle at a steady pace with short
// thinking pauses, and finishes after its race time. Its time comes from the
// puzzle's expected solve time (its size and level) and the chosen skill;
// "Matched to you" uses the player's own recent solve times on this device, so
// the race stays close and gets tougher as the player gets faster.
// The race rules are the same as a race against players: the player's race
// time is the solve time plus 1 minute for each hint and 15 seconds for each
// check, and revealing the answer counts as giving up.
const RECORD_KEY = 'flg.computerRaces';

export const SKILLS = [
  { id: 'matched', name: 'Matched to you', note: 'Close to your own recent times, a little quicker' },
  { id: 'apprentice', name: 'Apprentice', note: 'Takes its time', factor: 1.5 },
  { id: 'steady', name: 'Steady', note: 'A typical solver for this size and level', factor: 1 },
  { id: 'sharp', name: 'Sharp', note: 'Quick and sure', factor: 0.7 },
  { id: 'relentless', name: 'Relentless', note: 'For when you are on fire', factor: 0.45 },
];
export const skillOf = (id) => SKILLS.find((s) => s.id === id) || SKILLS[0];
export const HINT_MS = 60_000;
export const CHECK_MS = 15_000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// The player's pace: the median of their recent solve times over each puzzle's
// expected time (solved without revealing). 1 = a typical solver; null with too few solves.
export function playerPace(plays) {
  const r = (plays || []).filter((p) => p.outcome === 'solved' && p.ms > 0 && p.expectedMs > 0).slice(-12)
    .map((p) => (p.ms + (p.hints || 0) * HINT_MS + (p.checks || 0) * CHECK_MS) / p.expectedMs).sort((a, b) => a - b);
  if (r.length < 2) return null;
  return r[Math.floor(r.length / 2)];
}

// The computer's race time for this puzzle and skill, in ms.
export function computerMs(expectedMs, skillId, pace = null) {
  const base = Math.max(60_000, expectedMs || 0);
  const s = skillOf(skillId);
  const factor = s.id === 'matched' ? clamp((pace ?? 1) * 0.92, 0.3, 2.2) : s.factor;
  return Math.round(clamp(base * factor, 45_000, 4 * 3600_000));
}

// How far along the computer is (0 to 1) after t ms: steady work broken by
// short thinking pauses, the same for this puzzle every time it is opened.
export function progressAt(t, totalMs, seed) {
  if (t >= totalMs) return 1;
  if (t <= 0) return 0;
  const STEPS = 24, x = t / totalMs;
  const weights = [...Array(STEPS)].map((_, i) => 0.5 + ((hash(`${seed}:${i}`) % 1000) / 1000));
  const sum = weights.reduce((a, b) => a + b, 0);
  let at = 0;
  for (let i = 0; i < STEPS; i++) {
    const w = weights[i] / sum;
    if (x < at + w) {
      // Within a step: a pause first (no progress), then the marks go in.
      const inner = (x - at) / w;
      return (i + Math.max(0, (inner - 0.35) / 0.65)) / STEPS;
    }
    at += w;
  }
  return 1;
}

export const raceMsOf = (save) => (save.elapsedMs || 0) + (save.hintsUsed || 0) * HINT_MS + (save.checksUsed || 0) * CHECK_MS;

// The race, for a new save: { skill, ms, seed, done }.
export function newRace(save, skillId, plays) {
  const pace = playerPace(plays);
  return { skill: skillOf(skillId).id, ms: computerMs(save.expectedMs, skillId, pace), seed: save.id, done: false };
}

// ---------- the player's record against the computer (this device only)
export function record() {
  try { const r = JSON.parse(localStorage.getItem(RECORD_KEY)); if (r && typeof r === 'object') return { wins: r.wins | 0, losses: r.losses | 0 }; } catch (e) { /* none yet */ }
  return { wins: 0, losses: 0 };
}
export function addResult(won) {
  const r = record();
  if (won) r.wins++; else r.losses++;
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(r)); } catch (e) { /* private mode: the result still shows */ }
  return r;
}
export function recordText(r = record()) {
  const n = r.wins + r.losses;
  return n ? `Your record against the computer: ${r.wins} win${r.wins === 1 ? '' : 's'}, ${r.losses} loss${r.losses === 1 ? '' : 'es'}.` : '';
}
