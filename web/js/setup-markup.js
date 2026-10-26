// The setup screen's choice lists as HTML. app.js draws them, and the build
// (scripts/build.mjs) draws the same lists into index.html ahead of time, so
// the first screen is complete before any script runs and nothing jumps when
// the game starts.
import { esc } from './grid.js';
import { icon } from './icons.js';

export const SURPRISE_THEME = { id: 'random', name: 'Surprise me', description: 'Any theme' };

export function sizesFor(tier) {
  const out = [];
  for (let k = tier.categories[0]; k <= tier.categories[1]; k++) for (let n = tier.items[0]; n <= tier.items[1]; n++) out.push(`${k}x${n}`);
  return out;
}

export const tierChoicesHtml = (difficulties, selected) => difficulties.map((d, i) => `
    <label class="choice"><input type="radio" name="tier" value="${d.id}"${d.id === selected ? ' checked' : ''}>
    <span><span class="pips" aria-hidden="true">${'<i class="on"></i>'.repeat(i + 1)}${'<i></i>'.repeat(difficulties.length - i - 1)}</span><b>${esc(d.name)}</b><small>${esc(d.summary)}</small></span></label>`).join('');

export const themeChoicesHtml = (themes, selected) => themes.map((t) => `
    <label class="choice" title="${esc(t.description || '')}"><input type="radio" name="theme" value="${t.id}"${t.id === selected ? ' checked' : ''} aria-describedby="theme-d-${t.id}">
    <span class="tile" data-world="${t.id}">${icon(t.id, 'glyph')}<b>${esc(t.name)}</b></span><span class="sr-only" id="theme-d-${t.id}">${esc(t.description || '')}</span></label>`).join('');

export const sizeChoicesHtml = (sizes, selected) => [...sizes, 'custom'].map((s) => {
  const [k, n] = s.split('x');
  const text = s === 'custom' ? '<b>Custom</b><small>Any size</small>' : `<b>${k} × ${n}</b><small>${k} categories, ${n} items</small>`;
  return `<label class="choice"><input type="radio" name="size" value="${s}"${s === selected ? ' checked' : ''}><span>${text}</span></label>`;
}).join('');

export const clueTypesHtml = (clueTypes, checked) => clueTypes.map((c) => `
    <label class="check"><input type="checkbox" value="${c.id}"${checked.includes(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('');
