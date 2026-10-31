// The game's own characters, made in the admin dashboard's Characters section
// (server/src/characters.js): published ones join new puzzles as one of the
// cast or tell the story, with their own portrait, voice and lines. The list
// comes from the Worker's GET /v1/characters and is kept on this device, so
// it still works offline with the last copy.
//
// Also the Menu's "Suggest a character" questions: the answers go to the
// Worker as a suggestion that waits for the team's review.
import { CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';
import { whileVisible } from './pace.js';
import { setChosenGenders } from './gender.js';

const KEY = 'characters';
const EVERY_MS = 10 * 60_000;
const $ = (s, el = document) => el.querySelector(s);

let data = store.getLocal(KEY) || null;
let onChange = () => {};

const list = () => (data && data.enabled !== false && data.characters) || [];
const fits = (c, themeId) => !c.themes.length || c.themes.includes(themeId);
export const suggestionsOpen = () => !!CLOUD_URL && !!(data ? data.suggestions : true);
export const anyFor = () => list().length > 0;

async function refresh() {
  if (!CLOUD_URL) return;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/characters`);
    if (!res.ok) return;
    const next = await res.json();
    const before = JSON.stringify(data);
    data = { enabled: next.enabled !== false, suggestions: !!next.suggestions, castChance: Number(next.castChance) || 0, narratorChance: Number(next.narratorChance) || 0, characters: Array.isArray(next.characters) ? next.characters : [] };
    store.setLocal(KEY, data);
    if (before !== JSON.stringify(data)) onChange();
  } catch (e) { /* offline: keep the last copy */ }
}

export function init({ onCharactersChanged } = {}) {
  if (onCharactersChanged) onChange = onCharactersChanged;
  if (!CLOUD_URL) return;
  refresh();
  whileVisible(refresh, EVERY_MS);
  addEventListener('online', refresh);
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Who joins a new puzzle in this theme: up to two of the cast (never the
// whole cast, so the theme's own people still appear) and maybe a narrator.
export function pick(themeId, items) {
  const fit = list().filter((c) => fits(c, themeId));
  const chance = (p) => Math.random() * 100 < p;
  const cast = chance(data ? data.castChance : 0) ? shuffle(fit.filter((c) => c.role !== 'narrator')).slice(0, Math.max(0, Math.min(2, items - 1))) : [];
  const tellers = fit.filter((c) => c.role !== 'cast' && !cast.includes(c));
  const narrator = tellers.length && chance(data ? data.narratorChance : 0) ? shuffle(tellers)[0] : null;
  return { cast, narrator };
}

// Keeps a copy of the chosen characters inside the puzzle (see cast.js).
export function attach(puzzle, { cast = [], narrator = null } = {}) {
  const names = new Set(puzzle.categories[0].items.map((i) => i.label));
  const copy = (c, inCast) => ({ id: c.id, name: c.name, gender: c.gender, style: c.style, seed: c.seed, voice: c.voice, lines: c.lines, version: c.version, inCast, ...(c.portrait ? { portrait: c.portrait } : {}) });
  const out = cast.filter((c) => names.has(c.name)).map((c) => copy(c, true));
  if (narrator && !names.has(narrator.name)) out.push(copy(narrator, false));
  if (!out.length) return puzzle;
  puzzle.characters = out;
  if (narrator && !names.has(narrator.name)) puzzle.narrator = narrator.id;
  return puzzle;
}

// Faces and voices follow the open puzzle's characters.
export function useFor(puzzle) { setChosenGenders((puzzle && puzzle.characters) || []); }

// ------------------------------------------------------------- suggestions
async function sendSuggestion(form) {
  const err = $('.error-box', form);
  const done = $('.acct-done', form);
  const btn = $('button[type=submit]', form);
  err.hidden = true;
  done.textContent = '';
  const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
  const body = {
    name: v('name'), gender: (form.querySelector('input[name=gender]:checked') || {}).value || '', look: v('look'), personality: v('personality'),
    voiceStyle: v('voiceStyle'), themes: [...form.querySelectorAll('input[name=themes]:checked')].map((i) => i.value),
  };
  const problem = !body.name ? 'Give your character a name.' : !body.gender ? 'Choose whether they are a woman or a man, so their face and voice match.' : body.personality.length < 3 ? 'Tell us a little about their personality.' : '';
  if (problem) { err.textContent = problem; err.hidden = false; return; }
  btn.disabled = true;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/characters/suggest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.message || 'It could not be sent right now. Please try again later.');
    form.reset();
    done.textContent = `Thank you! ${body.name} was sent to the game's team. If they join the game, you may meet them in a puzzle soon.`;
  } catch (e) {
    err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again.' : e.message;
    err.hidden = false;
  } finally { btn.disabled = false; }
}

let wired = false;
// themes: [{ id, name }] to choose from.
export function openSuggest(openDialog, themes) {
  const dlg = $('#dlg-suggest');
  const form = $('#suggest-form');
  if (!wired) {
    wired = true;
    form.addEventListener('submit', (e) => { e.preventDefault(); sendSuggestion(form); });
    $('[data-close]', dlg).onclick = () => dlg.close();
  }
  $('#suggest-themes').innerHTML = themes.map((t) => `<label class="check"><input type="checkbox" name="themes" value="${t.id}"> ${t.name.replace(/[<>&"]/g, '')}</label>`).join('');
  $('.error-box', form).hidden = true;
  $('.acct-done', form).textContent = '';
  openDialog(dlg, $('#suggest-name'));
}
