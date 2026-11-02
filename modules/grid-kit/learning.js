// Learning from play for the kit games, the same way NINETIMESNINE's does.
// Every solved, revealed or abandoned puzzle leaves a small record on this
// device: level, size, time, hints, mistakes, the techniques the player asked
// for help with, and how it felt. From those records the next puzzle is tuned:
// how tough it is inside the chosen level, which level to suggest, and which
// technique to practice. Tuning only chooses between puzzles the engine has
// already proven, so every puzzle still has one answer and needs no guessing.
//
// The device also remembers every puzzle fingerprint and story (or picture) it
// has shown, so free play never repeats one. Daily puzzles are shared on purpose.
export const ORDER = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];
const MAX_PLAYS = 400, MAX_SEEN = 5000, MAX_STORIES = 600, MAX_GALLERY = 300;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// par: typical solve time per level (ms). simple: techniques too basic to practice.
export function createLearning({ load, keep, key, par, simple = [], config = () => ({}) }) {
  let data = { v: 1, plays: [], seen: [], stories: [], gallery: [], ...(load(key, {}) || {}) };
  let shared = null;
  const persist = () => keep(key, data);

  function started(p) {
    if (p.fingerprint && !data.seen.includes(p.fingerprint)) data.seen.push(p.fingerprint);
    const sid = p.picture?.id || p.story?.id;
    if (sid && !data.stories.includes(sid)) data.stories.push(sid);
    data.seen = data.seen.slice(-MAX_SEEN);
    data.stories = data.stories.slice(-MAX_STORIES);
    persist();
  }

  function finished(game, outcome) {
    const p = game.p;
    const rec = {
      pid: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      fp: p.fingerprint, d: p.difficulty.id, size: p.size, mode: game.mode || 'free',
      outcome, ms: Math.round(game.ms), hints: game.hints, mistakes: game.mistakes, checks: game.checks || 0,
      toughness: p.toughness ?? null, tuned: game.tuned ?? null, stuck: game.stuck || [], feel: null, at: Date.now(), daily: game.daily || null,
    };
    data.plays.push(rec);
    data.plays = data.plays.slice(-MAX_PLAYS);
    // A picture uncovered by the player joins their gallery.
    if (p.picture && outcome === 'solved' && !data.gallery.some((g) => g.fp === p.fingerprint)) {
      data.gallery.push({ fp: p.fingerprint, name: p.picture.name, size: p.size, cols: p.cols, cells: p.solution.map((v) => (v === 1 ? 1 : 0)).join(''), at: Date.now() });
      data.gallery = data.gallery.slice(-MAX_GALLERY);
    }
    persist();
    return rec;
  }

  function rate(fp, feel) {
    const rec = [...data.plays].reverse().find((r) => r.fp === fp);
    if (!rec) return null;
    rec.feel = feel;
    persist();
    return rec;
  }

  function verdict(r) {
    let v = 0;
    const parMs = par[r.d] || 600e3;
    if (r.outcome !== 'solved') v -= 1.5;
    else {
      if (r.hints === 0 && r.ms < parMs) v += 1;
      if (r.hints >= 2) v -= 1;
      if (r.ms > parMs * 2) v -= 0.5;
    }
    if (r.feel === 'easy') v += 1;
    if (r.feel === 'hard') v -= 1;
    return clamp(v, -2, 2);
  }

  function toughness(level) {
    const recent = data.plays.filter((r) => r.d === level && r.mode === 'free').slice(-8);
    const c = config();
    const strength = c.adaptStrength ?? 1;
    let local = 0.5;
    if (recent.length) {
      let w = 0, sum = 0;
      recent.forEach((r, i) => { const wt = i + 1; w += wt; sum += verdict(r) * wt; });
      local = clamp(0.5 + (sum / w) * 0.25 * strength, 0.05, 0.95);
    }
    const s = shared?.toughness?.[level];
    if (typeof s !== 'number') return local;
    const sw = c.sharedWeight ?? 0.25;
    return recent.length ? local * (1 - sw) + s * sw : 0.5 + (s - 0.5) * strength;
  }

  function suggestLevel() {
    const free = data.plays.filter((r) => r.mode === 'free' || r.mode === 'daily');
    if (!free.length) return 'easy';
    const last = free[free.length - 1].d;
    const lastThree = free.filter((r) => r.d === last).slice(-3);
    const i = ORDER.indexOf(last);
    if (lastThree.length === 3 && lastThree.every((r) => r.outcome === 'solved' && r.hints <= 1 && r.feel !== 'hard' && r.ms < (par[r.d] || 600e3) * 1.2)) return ORDER[Math.min(i + 1, ORDER.length - 1)];
    if (lastThree.filter((r) => r.outcome !== 'solved' || r.feel === 'hard').length >= 2) return ORDER[Math.max(i - 1, 0)];
    return last;
  }

  function weakTechnique() {
    const counts = {};
    for (const r of data.plays.slice(-30)) for (const t of r.stuck || []) counts[t] = (counts[t] || 0) + 1;
    const top = Object.entries(counts).filter(([t, n]) => n >= 2 && !simple.includes(t)).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  }

  function optionsFor(level) {
    const weak = weakTechnique();
    return {
      avoid: data.seen.slice(),
      usedStories: data.stories.slice(),
      usedPictures: data.stories.slice(),
      toughness: toughness(level),
      practice: weak && Math.random() < (config().practiceChance ?? 0.35) ? weak : null,
    };
  }

  return {
    started, finished, rate, toughness, suggestLevel, weakTechnique, optionsFor,
    plays: () => data.plays,
    gallery: () => data.gallery || [],
    setShared: (s) => { shared = s; },
  };
}

// ---------- badges ----------

const BASE_BADGES = (name) => [
  { id: 'first', name: 'First solve', note: `Solve your first ${name} puzzle`, test: (s) => s.solved.length >= 1 },
  { id: 'easy', name: 'Easy does it', note: 'Solve an Easy puzzle', test: (s) => s.has('easy') },
  { id: 'medium', name: 'Middle ground', note: 'Solve a Medium puzzle', test: (s) => s.has('medium') },
  { id: 'hard', name: 'Hard as nails', note: 'Solve a Hard puzzle', test: (s) => s.has('hard') },
  { id: 'expert', name: 'Expert eye', note: 'Solve an Expert puzzle', test: (s) => s.has('expert') },
  { id: 'master', name: 'Grand master', note: 'Solve a Master puzzle', test: (s) => s.has('master') },
  { id: 'clean', name: 'Clean sheet', note: 'Solve a Hard or harder puzzle with no hints, checks or mistakes', test: (s) => s.solved.some((r) => ORDER.indexOf(r.d) >= 3 && !r.hints && !r.checks && !r.mistakes) },
  { id: 'streak3', name: 'Three in a row', note: 'Solve the daily puzzle 3 days running', test: (s) => s.streak >= 3 },
  { id: 'streak7', name: 'A week of puzzles', note: 'Solve the daily puzzle 7 days running', test: (s) => s.streak >= 7 },
  { id: 'streak30', name: 'Habit formed', note: 'Solve the daily puzzle 30 days running', test: (s) => s.bestStreak >= 30 },
  { id: 'ten', name: 'Ten down', note: 'Solve 10 puzzles', test: (s) => s.solved.length >= 10 },
  { id: 'fifty', name: 'Fifty down', note: 'Solve 50 puzzles', test: (s) => s.solved.length >= 50 },
  { id: 'hundred', name: 'Centurion', note: 'Solve 100 puzzles', test: (s) => s.solved.length >= 100 },
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

export function summary(plays, { name, extra = [] }, today = new Date().toISOString().slice(0, 10)) {
  const solved = plays.filter((r) => r.outcome === 'solved');
  const s = { solved, ...streaks(plays, today), has: (d) => solved.some((r) => r.d === d) };
  const byLevel = ORDER.map((id) => {
    const xs = solved.filter((r) => r.d === id);
    const clean = xs.filter((r) => !r.hints);
    return { id, solved: xs.length, best: clean.length ? Math.min(...clean.map((r) => r.ms)) : null, average: xs.length ? xs.reduce((n, r) => n + r.ms, 0) / xs.length : null };
  });
  const badges = [...BASE_BADGES(name), ...extra];
  return { ...s, byLevel, badges: badges.map((b) => ({ id: b.id, name: b.name, note: b.note, earned: b.test(s) })) };
}
