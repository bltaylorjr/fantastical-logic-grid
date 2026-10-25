// Learning from play. Every finished, revealed or abandoned puzzle leaves a
// small record on this device (level, theme, clue types, story parts, time,
// hints, mistakes, and the player's rating). From those records the game
// tunes the next puzzle: how tough it is inside the chosen level, the mix of
// clue types, which themes "Surprise me" leans toward, and which story parts
// come up. Tuning only chooses between puzzles the engine has already checked,
// so every puzzle still has exactly one solution, needs no guessing, and never
// repeats a story.
//
// Players can also add story parts of their own (or approve ones the AI story
// writer drafts). Shared learning (other players' results and approved story
// parts) arrives through setShared() and is blended in.
import * as store from './store.js';
import { checkStoryPart, partKey } from '../engine/index.js';

const KEY = 'learning';
const MAX_PLAYS = 400;
const EMPTY = () => ({ v: 1, plays: [], parts: {}, shared: null });
let cache = null;

async function load() {
  if (!cache) {
    try { cache = { ...EMPTY(), ...(await store.getMeta(KEY, null) || {}) }; } catch (e) { cache = EMPTY(); }
  }
  return cache;
}
async function persist() {
  try { await store.setMeta(KEY, cache); } catch (e) { /* learning is optional */ }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// One record per story (a story is never played twice). Later events (a
// rating after a solve) update the same record.
function playOf(save) {
  const p = save.puzzle;
  return {
    storyId: save.storyId, at: Date.now(), tier: p.difficulty.id, theme: p.theme.id, chosenTheme: save.chosenTheme || null,
    K: p.categories.length, N: p.categories[0].items.length, clueCount: p.clues.length, clueTypes: p.stats.clueTypes,
    score: p.stats.difficultyScore, effort: p.stats.effort || 0, parts: p.story.parts || null,
    ms: 0, expectedMs: save.expectedMs || 0, hints: 0, checks: 0, mistakes: 0, percent: 0, outcome: 'playing', rating: null, feel: null,
  };
}

export async function record(save, outcome) {
  const L = await load();
  let play = L.plays.find((x) => x.storyId === save.storyId);
  if (!play) { play = playOf(save); L.plays.push(play); }
  Object.assign(play, {
    at: Date.now(), ms: save.elapsedMs || 0, hints: save.hintsUsed || 0, checks: save.checksUsed || 0,
    mistakes: save.mistakes || 0, percent: outcome === 'solved' ? 100 : save.percent || 0,
  });
  // A solve never turns back into a quit if the player deletes the save later.
  if (!(outcome === 'abandoned' && (play.outcome === 'solved' || play.outcome === 'revealed'))) play.outcome = outcome;
  L.plays = L.plays.slice(-MAX_PLAYS);
  await persist();
  return play;
}

export async function rate(save, { rating, feel }) {
  const L = await load();
  let play = L.plays.find((x) => x.storyId === save.storyId);
  if (!play) play = await record(save, save.solved ? (save.revealed ? 'revealed' : 'solved') : 'playing');
  if (rating !== undefined) play.rating = rating;
  if (feel !== undefined) play.feel = feel;
  await persist();
}

export async function ratingOf(storyId) {
  const L = await load();
  const play = L.plays.find((x) => x.storyId === storyId);
  return play ? { rating: play.rating, feel: play.feel } : {};
}

// How a finished play felt, from -1 (far too hard) to 1 (far too easy).
function signal(p) {
  if (p.feel === 'easy') return 1;
  if (p.feel === 'hard') return -1;
  if (p.feel === 'right') return 0;
  if (p.outcome === 'revealed') return -0.8;
  if (p.outcome === 'abandoned') return p.percent < 30 ? -0.6 : -0.4;
  if (p.outcome !== 'solved') return 0;
  if (p.hints >= 4 || p.mistakes >= 8) return -0.6;
  if (p.hints >= 2 || p.mistakes >= 4) return -0.2;
  if (p.hints === 0 && p.mistakes <= 1 && (!p.expectedMs || p.ms <= p.expectedMs)) return 0.6;
  return 0;
}

const done = (p) => p.outcome !== 'playing';
const delta = (p) => (p.rating ? (p.rating - 3) / 2 : 0);

function localEffort(plays, tier) {
  let e = null;
  for (const p of plays) {
    if (p.tier !== tier || !done(p)) continue;
    // Move from the toughness of the puzzle just played toward what the player needed.
    e = clamp((e ?? p.effort ?? 0) * 0.5 + (p.effort || 0) * 0.5 + 0.35 * signal(p), -1, 1);
  }
  return e;
}

function localClueWeights(plays) {
  const sum = {}, n = {};
  for (const p of plays) {
    if (!p.rating || !p.clueTypes) continue;
    const total = Object.values(p.clueTypes).reduce((s, x) => s + x, 0) || 1;
    for (const [t, c] of Object.entries(p.clueTypes)) {
      sum[t] = (sum[t] || 0) + delta(p) * (c / total);
      n[t] = (n[t] || 0) + c / total;
    }
  }
  const out = {};
  for (const t in sum) if (n[t] >= 0.5) out[t] = clamp(1 + 0.6 * (sum[t] / n[t]), 0.6, 1.6);
  return out;
}

function localThemeWeights(plays) {
  const picks = {}, rsum = {}, rn = {};
  for (const p of plays) {
    if (p.chosenTheme && p.chosenTheme !== 'random') picks[p.theme] = (picks[p.theme] || 0) + 1;
    if (p.rating) { rsum[p.theme] = (rsum[p.theme] || 0) + delta(p); rn[p.theme] = (rn[p.theme] || 0) + 1; }
    if (p.outcome === 'abandoned') { rsum[p.theme] = (rsum[p.theme] || 0) - 0.25; rn[p.theme] = (rn[p.theme] || 0) + 1; }
  }
  const out = {};
  for (const t of new Set([...Object.keys(picks), ...Object.keys(rn)])) {
    out[t] = clamp(1 + 0.08 * Math.min(picks[t] || 0, 10) + 0.6 * (rn[t] ? rsum[t] / rn[t] : 0), 0.5, 2.5);
  }
  return out;
}

function localStoryPrefs(plays, parts) {
  const sum = {}, n = {};
  for (const p of plays) {
    if (!p.rating || !p.parts) continue;
    for (const [k, key] of Object.entries(p.parts)) {
      const id = `${p.theme}|${k}|${key}`;
      sum[id] = (sum[id] || 0) + delta(p);
      n[id] = (n[id] || 0) + 1;
    }
  }
  const out = {};
  const put = (theme, k, key, v) => { ((out[theme] ||= {})[k] ||= {})[key] = clamp(v, -1, 1); };
  for (const id in sum) { const [theme, k, key] = id.split('|'); put(theme, k, key, sum[id] / n[id]); }
  // The player's own parts get a head start so they show up soon.
  for (const [theme, kinds] of Object.entries(parts)) {
    for (const [kind, list] of Object.entries(kinds)) {
      const k = { openings: 'o', incidents: 'i', mishaps: 'm', endings: 'e' }[kind];
      for (const part of list) { const key = partKey(kind, part.value); if (out[theme]?.[k]?.[key] === undefined) put(theme, k, key, 0.6); }
    }
  }
  return out;
}

function mergeParts(...sources) {
  const out = {};
  for (const src of sources) {
    for (const [theme, kinds] of Object.entries(src || {})) {
      for (const [kind, list] of Object.entries(kinds)) {
        const arr = ((out[theme] ||= {})[kind] ||= []);
        for (const it of list) arr.push(it && it.value !== undefined ? it.value : it);
      }
    }
  }
  return out;
}

// Options to add to generatePuzzle(). Shared learning fills in where this
// device has little history of its own; the player's own play counts more.
export async function tuning(tier, { useShared = true } = {}) {
  const L = await load();
  const plays = L.plays;
  const shared = useShared && L.shared ? L.shared : null;
  const mine = plays.filter((p) => p.tier === tier && done(p)).length;
  const blend = (a, b, w) => (a == null ? b : b == null ? a : a * w + b * (1 - w));
  const wMine = clamp(mine / 5, 0, 1);

  const effort = blend(localEffort(plays, tier), shared?.effort?.[tier] ?? null, wMine);
  const mixWeights = (a, b, w) => {
    const out = {};
    for (const t of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) out[t] = blend(a?.[t] ?? null, b?.[t] ?? null, w);
    return out;
  };
  const rated = plays.filter((p) => p.rating).length;
  const clueWeights = mixWeights(localClueWeights(plays), shared?.clueWeights, clamp(rated / 6, 0, 1));
  const themeWeights = mixWeights(localThemeWeights(plays), shared?.themeWeights, clamp(plays.length / 8, 0, 1));
  const learning = {};
  if (effort != null && Math.abs(effort) >= 0.15) learning.effort = Math.round(effort * 100) / 100;
  if (Object.keys(clueWeights).length) learning.clueWeights = clueWeights;
  if (Object.keys(themeWeights).length) learning.themeWeights = themeWeights;
  const storyParts = mergeParts(L.parts, shared?.parts);
  const prefs = localStoryPrefs(plays, L.parts);
  return {
    ...(Object.keys(learning).length ? { learning } : {}),
    ...(Object.keys(storyParts).length ? { storyParts } : {}),
    ...(Object.keys(prefs).length ? { storyPrefs: prefs } : {}),
  };
}

// Plain-language summary for Settings.
export async function summary(tierNames, themeNames, clueNames) {
  const L = await load();
  const plays = L.plays.filter(done);
  const lines = [];
  if (!plays.length) lines.push('No puzzles yet. Finish or rate a puzzle and the game starts learning.');
  else lines.push(`${plays.length} puzzle${plays.length > 1 ? 's' : ''} played, ${plays.filter((p) => p.rating).length} rated.`);
  for (const tier of Object.keys(tierNames)) {
    const e = localEffort(L.plays, tier);
    if (e == null) continue;
    const word = e >= 0.5 ? 'noticeably tougher' : e >= 0.15 ? 'a little tougher' : e <= -0.5 ? 'noticeably gentler' : e <= -0.15 ? 'a little gentler' : 'standard';
    lines.push(`${tierNames[tier]}: ${word} puzzles within the level.`);
  }
  const tw = Object.entries(localThemeWeights(L.plays)).sort((a, b) => b[1] - a[1]);
  if (tw.length && tw[0][1] > 1.15) lines.push(`"Surprise me" leans toward ${themeNames[tw[0][0]] || tw[0][0]}.`);
  const cw = Object.entries(localClueWeights(L.plays)).sort((a, b) => b[1] - a[1]);
  if (cw.length && cw[0][1] > 1.1) lines.push(`More ${clueNames[cw[0][0]] || cw[0][0]} clues, which you rate highly.`);
  if (cw.length && cw.at(-1)[1] < 0.9) lines.push(`Fewer ${clueNames[cw.at(-1)[0]] || cw.at(-1)[0]} clues.`);
  const mineParts = Object.values(L.parts).reduce((s, k) => s + Object.values(k).reduce((a, l) => a + l.length, 0), 0);
  if (mineParts) lines.push(`${mineParts} story part${mineParts > 1 ? 's' : ''} of your own in the mix.`);
  if (L.shared && L.shared.players) lines.push(`Also learning from ${L.shared.players.toLocaleString()} players everywhere.`);
  return lines;
}

// ---------- the player's own story parts ----------
export async function listParts() {
  const L = await load();
  const out = [];
  for (const [theme, kinds] of Object.entries(L.parts)) {
    for (const [kind, list] of Object.entries(kinds)) for (const it of list) out.push({ theme, kind, ...it, key: partKey(kind, it.value) });
  }
  return out.sort((a, b) => b.at - a.at);
}

export async function addPart(theme, kind, value, source = 'mine') {
  const res = checkStoryPart(kind, value);
  if (!res.ok) return res;
  const L = await load();
  const list = ((L.parts[theme] ||= {})[kind] ||= []);
  const key = partKey(kind, value);
  if (list.some((it) => partKey(kind, it.value) === key)) return { ok: false, errors: ['That story part is already in the mix.'] };
  list.push({ value, source, at: Date.now(), shared: false });
  await persist();
  return { ok: true, key };
}

export async function removePart(theme, kind, key) {
  const L = await load();
  const list = L.parts[theme]?.[kind];
  if (!list) return;
  L.parts[theme][kind] = list.filter((it) => partKey(kind, it.value) !== key);
  await persist();
}

// ---------- shared learning ----------
export async function setShared(data) {
  const L = await load();
  L.shared = data ? { ...data, fetchedAt: Date.now() } : null;
  await persist();
}
export async function getState() { return load(); }
export async function markSent(storyIds, partKeys = []) {
  const L = await load();
  for (const p of L.plays) if (storyIds.includes(p.storyId)) p.sent = p.rating ? 2 : 1;
  for (const kinds of Object.values(L.parts)) for (const [kind, list] of Object.entries(kinds)) for (const it of list) if (partKeys.includes(partKey(kind, it.value))) it.shared = true;
  await persist();
}

export async function reset() {
  cache = EMPTY();
  await persist();
}
