// Puzzle styles on the setup screen (engine/src/modes.js): Classic (the
// default, every puzzle exactly as before), Timeline Case and Seating Plan.
// The choice is the setup screen's "Puzzle style" (web/index.html, #mode-field).
// Old ?lab=1 links and FLG_LAB=1 builds need nothing: the choice is always shown.
//
// A Timeline Case or Seating Plan is set in the theme picked on the setup
// screen ("Surprise me" picks one). The style chooses the grid size for each
// difficulty, so the Size and Topic choices hide while one is picked.
//
// These puzzles count toward the player's own stats, streaks and badges like
// any other, but stay out of races, the scoreboard, ratings and the shared
// learning data. Each style keeps its own small record on this device
// instead (store meta "labLearning"), used the way free play tunes itself
// (engine/lab-play.js): toughness inside the chosen difficulty, and a
// suggested next difficulty on the solved panel.
import * as store from './store.js';
import { LAB_SIZES, labTuning, labAddPlay, labSuggest } from '../engine/lab-play.js';

// The setup screen's choices; 'classic' sends no mode to the engine.
export const MODE_CHOICES = [
  { id: 'classic', name: 'Classic' },
  { id: 'timeline', name: 'Timeline Case' },
  { id: 'seating', name: 'Seating Plan' },
];
export const knownMode = (v) => (MODE_CHOICES.some((m) => m.id === v) ? v : 'classic');
export const modeName = (id) => (MODE_CHOICES.find((m) => m.id === id) || {}).name || '';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A simple round table for a solved Seating Plan: seats numbered clockwise
// from the top, each with its guest's name.
export function tableSvg(puzzle) {
  if (!puzzle || puzzle.mode !== 'seating' || !puzzle.table) return '';
  const seatCat = puzzle.categories.find((c) => c.id === puzzle.table.category);
  const nameCat = puzzle.categories[0];
  if (!seatCat) return '';
  const N = seatCat.items.length;
  const who = {};
  for (const row of puzzle.solution) who[row[seatCat.id]] = nameCat.items.find((it) => it.id === row[nameCat.id])?.label || '';
  const W = 320, cx = W / 2, cy = W / 2, R = 78, r = 122;
  const seats = seatCat.items.map((it, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / N; // clockwise from the top
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const sx = cx + Math.cos(a) * (R + 14), sy = cy + Math.sin(a) * (R + 14);
    return `<g><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="${sx.toFixed(1)}" y="${(sy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="currentColor">${i + 1}</text>`
      + `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">${esc(who[it.id] || '')}</text></g>`;
  }).join('');
  const label = `Round table: ${seatCat.items.map((it) => `${it.label}, ${who[it.id]}`).join('; ')}.`;
  return `<figure class="mode-table" style="margin:12px auto;max-width:340px;text-align:center"><svg viewBox="0 0 ${W} ${W}" role="img" aria-label="${esc(label)}"><circle cx="${cx}" cy="${cy}" r="${R}" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="2"/>${seats}</svg>`
    + `<figcaption class="help">${esc(seatCat.name)}s numbered clockwise. Each guest's left is the next ${esc(seatCat.name.toLowerCase())} clockwise.</figcaption></figure>`;
}

// The grid size a puzzle style uses at a difficulty: [categories, items].
export const labSize = (mode, tier) => (LAB_SIZES[mode] && LAB_SIZES[mode][tier]) || null;

// ---------------------------------------------------------------------------
// Each style's own record (never the shared learning data).
const RECORD_KEY = 'labLearning';
async function loadRecord() {
  try { const r = await store.getMeta(RECORD_KEY, null); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; }
}

// A finished, revealed or abandoned Timeline Case or Seating Plan. outcome: solved | revealed | abandoned.
export async function labRecord(save, outcome) {
  const p = save && save.puzzle;
  if (!p || !LAB_SIZES[p.mode]) return;
  const r = await loadRecord();
  r[p.mode] = labAddPlay(Array.isArray(r[p.mode]) ? r[p.mode] : [], {
    storyId: save.storyId, at: Date.now(), tier: p.difficulty.id, effort: (p.stats && p.stats.effort) || 0, outcome,
    hints: Number(save.hintsUsed) || 0, mistakes: Number(save.mistakes) || 0, ms: Number(save.elapsedMs) || 0,
    expectedMs: Number(save.expectedMs) || 0, percent: Number(save.percent) || 0,
  });
  try { await store.setMeta(RECORD_KEY, r); } catch (e) { /* the record is optional */ }
}

// generatePuzzle() options from the style's own record (only toughness).
export async function labTuningFor(mode, tier) {
  const r = await loadRecord();
  return labTuning(Array.isArray(r[mode]) ? r[mode] : [], tier);
}

// The solved panel's suggestion: { tier, text } from the style's record.
export async function labNext(mode, tierOrder, tierName) {
  const r = await loadRecord();
  const s = labSuggest(Array.isArray(r[mode]) ? r[mode] : [], tierOrder);
  if (!s) return null;
  const name = modeName(mode) || 'puzzle';
  const was = tierName(r[mode].filter((p) => p.outcome !== 'playing').at(-1).tier);
  const next = tierName(s.tier);
  const a = /^[AEIOU]/.test(next) ? 'an' : 'a';
  const text = s.step < 0 ? `That was a tough one. Try ${a} ${next} ${name} next for a gentler case.`
    : s.step > 0 ? (s.why === 'quick' ? `Quick, with no hints! Ready for ${a} ${next} ${name}?` : `Steady solving. Ready for ${a} ${next} ${name}?`)
    : s.why === 'gaveUp' || s.why === 'manyHints' ? `Try another ${was} ${name}. The next one will be a little gentler.`
    : `Try another ${was} ${name}. Each one adapts to how you played.`;
  return { tier: s.tier, text };
}
