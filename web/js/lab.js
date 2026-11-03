// Lab modes on the setup screen (engine/src/modes.js): Timeline Case and
// Seating Plan, for the owner's review only. Nothing here shows unless the
// page address has ?lab=1 or the build was made with FLG_LAB=1 (which adds
// <meta name="flg-lab" content="1">, for the claude.ai preview where the
// address cannot be changed). With the lab off the setup screen is exactly as
// before and no puzzle gets a mode.
//
// A Lab puzzle is set in the theme picked on the setup screen ("Surprise me"
// picks one). The mode chooses the grid size for each difficulty, so the
// Size and Topic choices hide while a Lab mode is picked.
//
// Lab puzzles stay out of the live learning data, ratings, scoreboard, stats
// and badges. Each mode keeps its own small record on this device instead
// (store meta "labLearning"), used the way free play tunes itself
// (engine/lab-play.js): toughness inside the chosen difficulty, and a
// suggested next difficulty on the solved panel.
import * as store from './store.js';
import { LAB_SIZES, labTuning, labAddPlay, labSuggest } from '../engine/lab-play.js';

export const LAB_ON = (() => {
  try {
    if (new URLSearchParams(location.search).get('lab') === '1') return true;
  } catch (e) { /* no address (tests) */ }
  return !!document.querySelector('meta[name="flg-lab"][content="1"]');
})();

export const LAB_CHOICES = [
  { id: 'standard', name: 'Standard', summary: 'The usual story puzzle with your theme.' },
  { id: 'timeline', name: 'Timeline Case', summary: 'A whodunit told by the clock: before, right after, between, first and last.' },
  { id: 'seating', name: 'Seating Plan', summary: 'Guests round one table: next to, across from, two seats to the left.' },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The Lab field, placed first in the setup form. onChange(modeId) runs on a pick.
export function mountLabField(form, current, onChange) {
  let field = form.querySelector('#lab-field');
  if (!field) {
    field = document.createElement('fieldset');
    field.id = 'lab-field';
    field.className = 'lab-field';
    form.prepend(field);
  }
  field.innerHTML = `<legend>Lab mode <span class="optional">(review only)</span></legend>
    <div class="choices tiers" id="lab-choices">${LAB_CHOICES.map((m) => `
      <label class="choice"><input type="radio" name="labmode" value="${esc(m.id)}"${m.id === current ? ' checked' : ''}>
      <span><b>${esc(m.name)}</b><small>${esc(m.summary)}</small></span></label>`).join('')}
    </div>
    <p class="help" id="lab-help">${current === 'standard' ? '' : 'The story is set in the theme you pick below ("Surprise me" picks one). The mode sets the grid size for each difficulty, so Size and Topic are hidden.'}</p>`;
  field.onchange = (e) => {
    const v = e.target.closest('input[name=labmode]')?.value;
    if (LAB_CHOICES.some((m) => m.id === v)) onChange(v);
  };
  return field;
}

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
  return `<figure class="lab-table" style="margin:12px auto;max-width:340px;text-align:center"><svg viewBox="0 0 ${W} ${W}" role="img" aria-label="${esc(label)}"><circle cx="${cx}" cy="${cy}" r="${R}" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="2"/>${seats}</svg>`
    + `<figcaption class="help">${esc(seatCat.name)}s numbered clockwise. Each guest's left is the next ${esc(seatCat.name.toLowerCase())} clockwise.</figcaption></figure>`;
}

// The grid size a Lab mode uses at a difficulty: [categories, items].
export const labSize = (mode, tier) => (LAB_SIZES[mode] && LAB_SIZES[mode][tier]) || null;

// ---------------------------------------------------------------------------
// Each Lab mode's own record (never the live learning data).
const RECORD_KEY = 'labLearning';
async function loadRecord() {
  try { const r = await store.getMeta(RECORD_KEY, null); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; }
}

// A finished, revealed or abandoned Lab puzzle. outcome: solved | revealed | abandoned.
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

// generatePuzzle() options from the mode's own record (only toughness).
export async function labTuningFor(mode, tier) {
  const r = await loadRecord();
  return labTuning(Array.isArray(r[mode]) ? r[mode] : [], tier);
}

// The solved panel's suggestion: { tier, text } from the mode's record.
export async function labNext(mode, tierOrder, tierName) {
  const r = await loadRecord();
  const s = labSuggest(Array.isArray(r[mode]) ? r[mode] : [], tierOrder);
  if (!s) return null;
  const name = (LAB_CHOICES.find((m) => m.id === mode) || {}).name || 'Lab puzzle';
  const was = tierName(r[mode].filter((p) => p.outcome !== 'playing').at(-1).tier);
  const next = tierName(s.tier);
  const a = /^[AEIOU]/.test(next) ? 'an' : 'a';
  const text = s.step < 0 ? `That was a tough one. Try ${a} ${next} ${name} next for a gentler case.`
    : s.step > 0 ? (s.why === 'quick' ? `Quick, with no hints! Ready for ${a} ${next} ${name}?` : `Steady solving. Ready for ${a} ${next} ${name}?`)
    : s.why === 'gaveUp' || s.why === 'manyHints' ? `Try another ${was} ${name}. The next one will be a little gentler.`
    : `Try another ${was} ${name}. Each one adapts to how you played.`;
  return { tier: s.tier, text };
}
