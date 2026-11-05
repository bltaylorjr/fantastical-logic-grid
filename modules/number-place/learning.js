// Learning from play, the same way the logic grid's learn.js does. Every
// solved, revealed or abandoned puzzle leaves a small record on this device:
// level, time, hints, mistakes, the techniques the player asked for help
// with, and how it felt. From those records the next puzzle is tuned:
// how tough it is inside the chosen level, which level to suggest, and which
// technique to practice. Tuning only chooses between puzzles the engine has
// already proven, so every puzzle still has one answer and needs no guessing.
//
// The device also remembers every puzzle fingerprint and story it has shown,
// so free play never repeats one. Daily and race puzzles are shared on purpose.
//
// A host can blend in what every player's games taught (setShared) and send
// each record on (onPlay), like the logic grid's /v1/learn service.

export const PAR_MS = { basic: 90e3, easy: 240e3, medium: 480e3, hard: 840e3, expert: 1320e3, master: 2100e3 };
const ORDER = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];
const MAX_PLAYS = 400, MAX_SEEN = 5000, MAX_STORIES = 600;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Toughness and level suggestions learn from classic games; each other style tunes itself (styles.js).
const classic = (r) => (r.style || 'classic') === 'classic';

// config() gives the admin's NINETIMESNINE choices: adaptStrength, practiceChance
// and sharedWeight, each 0 to 1.
export function createLearning({ load, keep, key, config = () => ({}) }) {
  let data = { v: 1, plays: [], seen: [], stories: [], ...(load(key, {}) || {}) };
  let shared = null;
  const persist = () => keep(key, data);

  // A puzzle starts: remember it so it never comes back in free play.
  function started(p) {
    if (p.fingerprint && !data.seen.includes(p.fingerprint)) data.seen.push(p.fingerprint);
    if (p.story?.id && !data.stories.includes(p.story.id)) data.stories.push(p.story.id);
    data.seen = data.seen.slice(-MAX_SEEN);
    data.stories = data.stories.slice(-MAX_STORIES);
    persist();
  }

  // outcome: 'solved' | 'revealed' | 'abandoned'
  function finished(game, outcome) {
    const p = game.p;
    const rec = {
      // A random key for this one game, so a rating sent later updates it.
      pid: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      fp: p.fingerprint, d: p.difficulty.id, size: p.size, variants: p.variants, mode: game.mode || 'free',
      // The game style (styles.js) and how its game went: rival score, best chain and so on.
      style: game.style || 'classic', sr: game.styleResult || null,
      outcome, ms: Math.round(game.ms), hints: game.hints, mistakes: game.mistakes, checks: game.checks || 0,
      toughness: p.toughness ?? null, tuned: game.tuned ?? null, stuck: game.stuck || [], feel: null, at: Date.now(), daily: game.daily || null,
    };
    data.plays.push(rec);
    data.plays = data.plays.slice(-MAX_PLAYS);
    persist();
    return rec;
  }

  // The player's "how did that feel?" answer for their latest record of this puzzle.
  function rate(fp, feel) {
    const rec = [...data.plays].reverse().find((r) => r.fp === fp);
    if (!rec) return null;
    rec.feel = feel;
    persist();
    return rec;
  }

  // How a play went, from -2 (much too hard) to +2 (much too easy).
  function verdict(r) {
    let v = 0;
    if (r.outcome !== 'solved') v -= 1.5;
    else {
      if (r.hints === 0 && r.ms < PAR_MS[r.d]) v += 1;
      if (r.hints >= 2) v -= 1;
      if (r.ms > PAR_MS[r.d] * 2) v -= 0.5;
    }
    if (r.feel === 'easy') v += 1;
    if (r.feel === 'hard') v -= 1;
    return clamp(v, -2, 2);
  }

  // 0 (gentlest) to 1 (toughest) inside a level; 0.5 for a new player.
  function toughness(level) {
    const recent = data.plays.filter((r) => r.d === level && r.mode === 'free' && classic(r)).slice(-8);
    const c = config();
    const strength = c.adaptStrength ?? 1;
    let local = 0.5;
    if (recent.length) {
      // Newer plays count more.
      let w = 0, sum = 0;
      recent.forEach((r, i) => { const wt = i + 1; w += wt; sum += verdict(r) * wt; });
      local = clamp(0.5 + (sum / w) * 0.25 * strength, 0.05, 0.95);
    }
    const s = shared?.toughness?.[level];
    if (typeof s !== 'number') return local;
    const sw = c.sharedWeight ?? 0.25;
    return recent.length ? local * (1 - sw) + s * sw : 0.5 + (s - 0.5) * strength;
  }

  // The level to suggest next: up after three clean solves, down after struggles.
  function suggestLevel() {
    const free = data.plays.filter((r) => (r.mode === 'free' || r.mode === 'daily') && classic(r));
    if (!free.length) return 'easy';
    const last = free[free.length - 1].d;
    const lastThree = free.filter((r) => r.d === last).slice(-3);
    const i = ORDER.indexOf(last);
    if (lastThree.length === 3 && lastThree.every((r) => r.outcome === 'solved' && r.hints <= 1 && r.feel !== 'hard' && r.ms < PAR_MS[r.d] * 1.2)) return ORDER[Math.min(i + 1, ORDER.length - 1)];
    if (lastThree.filter((r) => r.outcome !== 'solved' || r.feel === 'hard').length >= 2) return ORDER[Math.max(i - 1, 0)];
    return last;
  }

  // The technique the player most often needs help with, if any.
  function weakTechnique() {
    const counts = {};
    for (const r of data.plays.slice(-30)) for (const t of r.stuck || []) counts[t] = (counts[t] || 0) + 1;
    const top = Object.entries(counts).filter(([t, n]) => n >= 2 && !['nakedSingle', 'hiddenSingle'].includes(t)).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  }

  // Everything the engine needs to build this player's next free-play puzzle.
  function optionsFor(level) {
    const weak = weakTechnique();
    return {
      avoid: data.seen.slice(),
      usedStories: data.stories.slice(),
      toughness: toughness(level),
      // Practice a weak spot in about one puzzle in three (the admin can change it).
      practice: weak && Math.random() < (config().practiceChance ?? 0.35) ? weak : null,
    };
  }

  return {
    started, finished, rate, toughness, suggestLevel, weakTechnique, optionsFor,
    plays: () => data.plays,
    hasSeen: (fp) => data.seen.includes(fp),
    setShared: (s) => { shared = s; },
  };
}

// ---------- badges ----------

export const BADGES = [
  { id: 'first', name: 'First grid', note: 'Solve your first puzzle', test: (s) => s.solved.length >= 1 },
  { id: 'basic', name: 'Warmed up', note: 'Solve a Basic puzzle', test: (s) => s.has('basic') },
  { id: 'easy', name: 'Easy does it', note: 'Solve an Easy puzzle', test: (s) => s.has('easy') },
  { id: 'medium', name: 'Middle ground', note: 'Solve a Medium puzzle', test: (s) => s.has('medium') },
  { id: 'hard', name: 'Hard as nails', note: 'Solve a Hard puzzle', test: (s) => s.has('hard') },
  { id: 'expert', name: 'Expert eye', note: 'Solve an Expert puzzle', test: (s) => s.has('expert') },
  { id: 'master', name: 'Grand master', note: 'Solve a Master puzzle', test: (s) => s.has('master') },
  { id: 'clean', name: 'Clean sheet', note: 'Solve a Hard or harder puzzle with no hints, checks or mistakes', test: (s) => s.solved.some((r) => ORDER.indexOf(r.d) >= 3 && !r.hints && !r.checks && !r.mistakes) },
  { id: 'quick', name: 'Quick study', note: 'Solve a 9×9 Medium in under 5 minutes', test: (s) => s.solved.some((r) => r.d === 'medium' && r.size === 9 && r.ms < 300e3) },
  { id: 'diagonal', name: 'Cross-eyed', note: 'Solve a puzzle with diagonals', test: (s) => s.solved.some((r) => r.variants?.includes('diagonal')) },
  { id: 'parity', name: 'Odds and evens', note: 'Solve an odd and even puzzle', test: (s) => s.solved.some((r) => r.variants?.includes('parity')) },
  { id: 'streak3', name: 'Three in a row', note: 'Solve the daily puzzle 3 days running', test: (s) => s.streak >= 3 },
  { id: 'streak7', name: 'A week of grids', note: 'Solve the daily puzzle 7 days running', test: (s) => s.streak >= 7 },
  { id: 'streak30', name: 'Habit formed', note: 'Solve the daily puzzle 30 days running', test: (s) => s.bestStreak >= 30 },
  { id: 'ten', name: 'Ten down', note: 'Solve 10 puzzles', test: (s) => s.solved.length >= 10 },
  { id: 'fifty', name: 'Fifty down', note: 'Solve 50 puzzles', test: (s) => s.solved.length >= 50 },
  { id: 'hundred', name: 'Centurion', note: 'Solve 100 puzzles', test: (s) => s.solved.length >= 100 },
  { id: 'rival', name: 'Grid duelist', note: 'Beat the rival in NINETIMESNINE-Rival Grid', test: (s) => s.solved.some((r) => r.style === 'rival' && r.sr?.won) },
  { id: 'rival-sharp', name: 'Sharper still', note: 'Beat a Sharp or Relentless rival', test: (s) => s.solved.some((r) => r.style === 'rival' && r.sr?.won && r.sr.skill >= 0.6) },
  { id: 'chain', name: 'Chain reactor', note: 'Reach your chain goal in NINETIMESNINE-Chain Reaction', test: (s) => s.solved.some((r) => r.style === 'chain' && r.sr?.best >= r.sr.goal) },
  { id: 'tide', name: 'Low tide', note: 'Solve a NINETIMESNINE-Tidewater puzzle', test: (s) => s.solved.some((r) => r.style === 'tide') },
  { id: 'tide-deep', name: 'Deep diver', note: 'Solve a NINETIMESNINE-Tidewater puzzle with no ebbs and no hints', test: (s) => s.solved.some((r) => r.style === 'tide' && !r.hints && r.sr && !r.sr.ebbs) },
  { id: 'glyph', name: 'Realm walker', note: 'Clear every realm on the NINETIMESNINE-Glyph Quest map', test: (s) => s.solved.filter((r) => r.style === 'glyph').length >= 6 },
  { id: 'student', name: 'Student of logic', note: 'Use a hint, then solve the next puzzle at that level with none', test: (s) => s.solved.some((r, i) => r.hints > 0 && s.solved.slice(i + 1).some((x) => x.d === r.d && !x.hints)) },
];

function streaks(plays, today) {
  const days = new Set(plays.filter((r) => r.daily && r.outcome === 'solved').map((r) => r.daily));
  let streak = 0;
  const d = new Date(`${today}T00:00:00Z`);
  if (!days.has(today)) d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const day of [...days].sort()) {
    const t = Date.parse(`${day}T00:00:00Z`);
    run = prev !== null && t - prev === 864e5 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return { streak, bestStreak: best };
}

export function summary(plays, today = new Date().toISOString().slice(0, 10)) {
  const solved = plays.filter((r) => r.outcome === 'solved');
  const s = { solved, ...streaks(plays, today), has: (d) => solved.some((r) => r.d === d) };
  const byLevel = ORDER.map((id) => {
    const xs = solved.filter((r) => r.d === id);
    // Times leave out Rival Grid, where the rival fills in part of the grid.
    const timed = xs.filter((r) => r.style !== 'rival');
    const clean = timed.filter((r) => !r.hints);
    return { id, solved: xs.length, best: clean.length ? Math.min(...clean.map((r) => r.ms)) : null, average: timed.length ? timed.reduce((n, r) => n + r.ms, 0) / timed.length : null };
  });
  return { ...s, byLevel, badges: BADGES.map((b) => ({ id: b.id, name: b.name, note: b.note, earned: b.test(s) })) };
}
