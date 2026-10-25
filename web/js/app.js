// The Fantastical Logic Grid: app controller (setup, play, saves, hints, print).
import { describeOptions, checkMarks, isSolved, checkAnswers } from '../engine/index.js';
import * as engine from './engine-client.js';
import * as store from './store.js';
import { createGrid, puzzleIndex, esc, STATE_WORDS } from './grid.js';
import { printPuzzle } from './print.js';
import { sceneSvg } from './art.js';
import * as sfx from './audio.js';
import * as ai from './ai.js';
import { portrait } from './portraits.js';
import * as wake from './wakelock.js';
import * as updates from './updates.js';
import { celebrate as confettiBurst } from './effects.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const OPTIONS = describeOptions();
const TIERS = Object.fromEntries(OPTIONS.difficulties.map((d) => [d.id, d]));
const TIER_IDS = OPTIONS.difficulties.map((d) => d.id);
const MINUTES_PER_CELL = { basic: 0.12, easy: 0.16, medium: 0.22, hard: 0.3, expert: 0.36, mensa: 0.42 };
const USED_STORY_LIMIT = 5000;
const isDesktop = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
// The claude.ai preview build cannot print or download files, so those controls are hidden there.
const isPreview = !!document.querySelector('meta[name="flg-mode"][content="preview"]');

let settings = store.loadSettings();
let S = null; // the open game: { save, puzzle, ix, marks, grid, wrong, hint, ... }

// ====================================================================
// Small UI services: announcements, toasts, confirm dialogs, sound
// ====================================================================
function announce(text) {
  const el = $('#announcer');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}
function status(text) { $('#status').textContent = text; }

function toast(text, action, { ms = 6000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>`;
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => { close(); action.run(); };
    el.append(b);
  }
  const start = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', start);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', start);
  $('#toasts').append(el);
  start();
}

function confirmDialog({ title, text, yes, no }) {
  const dlg = $('#dlg-confirm');
  $('#confirm-h').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-yes').textContent = yes;
  $('#confirm-no').textContent = no;
  const back = document.activeElement;
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); resolve(v); back?.focus?.(); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
    $('#confirm-no').focus();
  });
}

function openDialog(dlg, focusEl) {
  const back = document.activeElement;
  dlg.addEventListener('close', () => back?.focus?.(), { once: true });
  dlg.showModal();
  focusEl?.focus();
}

function sound(kind) {
  if (!settings.sound || settings.silent) return;
  try { sfx.setVolumes({ sfx: settings.volume / 100, music: settings.musicVolume / 100 }); sfx.play(kind); } catch (e) { /* sound is optional */ }
}

// Silent mode hides scenes, portraits, sound, music and animation.
function applyMode() {
  document.documentElement.classList.toggle('silent', !!settings.silent);
  const btn = $('#sound-btn');
  btn.textContent = settings.sound ? 'Sound on' : 'Sound off';
  btn.setAttribute('aria-pressed', String(!!settings.sound));
  $$('input[name=playstyle]').forEach((r) => { r.checked = r.value === (settings.silent ? 'silent' : 'full'); });
  updateMusic();
}
function updateMusic() {
  const want = !!(S && settings.music && settings.sound && !settings.silent && !$('#screen-play').hidden);
  try {
    if (want && !sfx.musicPlaying()) { sfx.setVolumes({ sfx: settings.volume / 100, music: settings.musicVolume / 100 }); sfx.startMusic(S.puzzle.theme.id); sfx.setMood((S.save.percent || 0) / 100); }
    else if (!want && sfx.musicPlaying()) sfx.stopMusic();
    else if (want) sfx.setVolumes({ sfx: settings.volume / 100, music: settings.musicVolume / 100 });
  } catch (e) { /* music is optional */ }
}
$('#sound-btn').onclick = () => {
  settings.sound = !settings.sound;
  if (!settings.sound) ai.stopSpeaking();
  store.saveSettings(settings);
  applyMode();
  if (settings.sound) sound('tick');
  status(settings.sound ? 'Sound on.' : 'Sound off.');
};

let themeSetByApp = !!document.documentElement.dataset.theme;
function applyColorTheme() {
  const t = settings.colorTheme;
  // Only clear a theme this app set, so a host page's own light/dark choice survives.
  if (t === 'system') { if (themeSetByApp) delete document.documentElement.dataset.theme; themeSetByApp = false; }
  else { document.documentElement.dataset.theme = t; themeSetByApp = true; }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  $('meta[name=theme-color]').setAttribute('content', bg || '#1F5FAD');
}

// ====================================================================
// Screens
// ====================================================================
function showScreen(name) {
  $('#screen-home').hidden = name !== 'home';
  $('#screen-play').hidden = name !== 'play';
  $('#skip-link').hidden = name !== 'play';
  document.title = name === 'play' && S ? `${S.save.name} · The Fantastical Logic Grid` : 'The Fantastical Logic Grid';
  if (name === 'home') { closeGame(); renderSaved(); renderSuggestion(); setTimeout(offerUpdate, 500); }
  wake.setPlaying(name === 'play' && S && !S.save.solved);
  updateMusic();
}

async function goHome({ focusSaved = false } = {}) {
  await flushSave();
  showScreen('home');
  window.scrollTo(0, 0);
  const h = focusSaved ? $('#saved-h') : $('#setup-h');
  h.tabIndex = -1;
  h.focus();
}

// ====================================================================
// Setup screen
// ====================================================================
const setup = {
  tier: 'easy', theme: 'random', size: null, custom: [4, 4],
};

function sizesFor(tierId) {
  const t = TIERS[tierId];
  const out = [];
  for (let k = t.categories[0]; k <= t.categories[1]; k++) for (let n = t.items[0]; n <= t.items[1]; n++) out.push(`${k}x${n}`);
  return out;
}

function renderSetup() {
  const saved = store.loadSetupChoices();
  if (saved) Object.assign(setup, saved);
  if (!TIERS[setup.tier]) setup.tier = 'easy';

  $('#tier-choices').innerHTML = OPTIONS.difficulties.map((d) => `
    <label class="choice"><input type="radio" name="tier" value="${d.id}"${d.id === setup.tier ? ' checked' : ''}>
    <span><b>${esc(d.name)}</b><small>${esc(d.summary)}</small></span></label>`).join('');
  const themes = [{ id: 'random', name: 'Surprise me', description: 'Any theme' }, ...OPTIONS.themes];
  $('#theme-choices').innerHTML = themes.map((t) => `
    <label class="choice" title="${esc(t.description || '')}"><input type="radio" name="theme" value="${t.id}"${t.id === setup.theme ? ' checked' : ''} aria-describedby="theme-d-${t.id}">
    <span>${esc(t.name)}</span><span class="sr-only" id="theme-d-${t.id}">${esc(t.description || '')}</span></label>`).join('');
  if (!$('input[name=theme]:checked')) $('input[name=theme]').checked = true;
  renderSizes();
  renderClueTypes();
  $('#cats').value = setup.custom[0];
  $('#items').value = setup.custom[1];

  $('#tier-choices').onchange = () => { setup.tier = $('input[name=tier]:checked').value; setup.size = null; renderSizes(); renderClueTypes(); updatePreview(); };
  $('#theme-choices').onchange = () => { setup.theme = $('input[name=theme]:checked').value; updatePreview(); };
  $('#size-choices').onchange = () => { setup.size = $('input[name=size]:checked').value; $('#custom-size').hidden = setup.size !== 'custom'; updatePreview(); };
  $('#cats').oninput = $('#items').oninput = () => { setup.custom = [+$('#cats').value || 4, +$('#items').value || 4]; updatePreview(); };
  $('#clue-count').oninput = updatePreview;
  $('#setup').onsubmit = (e) => { e.preventDefault(); startGeneration(); };
  $('#style-choices').onchange = () => { settings.silent = $('input[name=playstyle]:checked').value === 'silent'; store.saveSettings(settings); applyMode(); };
  updatePreview();
}

function renderSizes() {
  const sizes = sizesFor(setup.tier);
  if (!setup.size || (setup.size !== 'custom' && !sizes.includes(setup.size))) setup.size = sizes[0];
  $('#size-choices').innerHTML = [...sizes, 'custom'].map((s) => {
    const [k, n] = s.split('x');
    const text = s === 'custom' ? '<b>Custom</b><small>Any size</small>' : `<b>${k} × ${n}</b><small>${k} categories, ${n} items</small>`;
    return `<label class="choice"><input type="radio" name="size" value="${s}"${s === setup.size ? ' checked' : ''}><span>${text}</span></label>`;
  }).join('');
  $('#custom-size').hidden = setup.size !== 'custom';
}

function renderClueTypes() {
  const tierTypes = TIERS[setup.tier].clueTypes;
  $('#clue-type-choices').innerHTML = OPTIONS.clueTypes.map((c) => `
    <label class="check"><input type="checkbox" value="${c.id}"${tierTypes.includes(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('');
}

function currentSize() {
  if (setup.size === 'custom') {
    const clampN = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(+v) || d));
    return [clampN($('#cats').value, 3, 6, 4), clampN($('#items').value, 3, 8, 4)];
  }
  return setup.size.split('x').map(Number);
}

function updatePreview() {
  const [k, n] = currentSize();
  const cells = (k * (k - 1) / 2) * n * n;
  const mins = Math.max(5, Math.round((cells * MINUTES_PER_CELL[setup.tier]) / 5) * 5);
  const time = mins >= 60 ? `about ${Math.round(mins / 30) / 2} hours` : `about ${mins} minutes`;
  $('#preview').textContent = `A ${TIERS[setup.tier].name} puzzle with ${k} categories of ${n} items each, ${time}.`;
  const width = 200 + (k - 1) * n * 44;
  const warn = $('#size-warning');
  warn.hidden = width <= window.innerWidth - 32;
  warn.textContent = 'This size is best on a larger screen or printed. On this screen the grid will scroll inside its frame.';
  const t = TIERS[setup.tier];
  if (setup.size === 'custom' && (k < t.categories[0] || k > t.categories[1] || n < t.items[0] || n > t.items[1])) {
    $('#preview').textContent += ` That is outside the usual ${t.name} size, which is fine.`;
  }
  if (k >= 6 && n >= 7) $('#preview').textContent += ' Puzzles this big can take up to 20 seconds to write.';
}

function gatherOptions() {
  const [k, n] = currentSize();
  const o = { difficulty: setup.tier, theme: setup.theme, categories: k, items: n };
  const cc = parseInt($('#clue-count').value, 10);
  if (cc > 0) o.clueCount = cc;
  const q = parseInt($('#questions').value, 10);
  if (q >= 1 && q <= 6) o.questions = q;
  const names = $('#cast').value.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length) o.customNames = names;
  const title = $('#custom-title').value.trim();
  if (title) o.title = title;
  const types = $$('#clue-type-choices input:checked').map((i) => i.value);
  const tierTypes = TIERS[setup.tier].clueTypes;
  if (types.length && (types.length !== tierTypes.length || types.some((t) => !tierTypes.includes(t)))) o.clueTypes = types;
  return o;
}

// A story's id comes from the engine (puzzle.story.id). Older engine builds
// do not have one, so fall back to a fingerprint of the story text.
function storyIdOf(puzzle) {
  if (puzzle.story && puzzle.story.id) return String(puzzle.story.id);
  let h = 2166136261;
  for (const ch of puzzle.story.text || puzzle.story.paragraphs.join(' ')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `text-${(h >>> 0).toString(36)}`;
}

async function rememberStory(id) {
  const used = await store.getMeta('usedStories', []);
  if (!used.includes(id)) used.push(id);
  await store.setMeta('usedStories', used.slice(-USED_STORY_LIMIT));
}

let generating = false;
async function startGeneration() {
  if (generating) return;
  generating = true;
  const btn = $('#gen-btn');
  const st = $('#gen-status');
  const err = $('#gen-error');
  err.hidden = true;
  btn.disabled = true;
  st.textContent = 'Writing your story… Large puzzles can take up to 20 seconds.';
  const options = gatherOptions();
  store.saveSetupChoices({ tier: setup.tier, theme: setup.theme, size: setup.size, custom: currentSize() });
  try {
    const used = await store.getMeta('usedStories', []);
    const usedSet = new Set(used);
    let puzzle = null;
    // The engine skips used stories itself; the loop is a safety net.
    for (let i = 0; i < 4 && !puzzle; i++) {
      const p = await engine.generate({ ...options, usedStories: used });
      if (!usedSet.has(storyIdOf(p))) puzzle = p;
    }
    if (!puzzle) throw new Error('Every story we tried has already been used. Try another theme.');
    await rememberStory(storyIdOf(puzzle));
    const save = newSave(puzzle);
    await store.putSave(save);
    st.textContent = '';
    openGame(save, { fresh: true });
  } catch (e) {
    st.textContent = '';
    err.innerHTML = `<p><b>The story could not be written.</b> ${esc(e.message || e)}</p><p>Your choices are kept. You can try again, or pick a smaller size or more clue types.</p><button class="btn" type="button" id="retry-btn">Try again</button>`;
    err.hidden = false;
    $('#retry-btn').onclick = startGeneration;
  } finally {
    btn.disabled = false;
    generating = false;
  }
}

function newSave(puzzle) {
  const now = Date.now();
  return {
    id: (crypto.randomUUID && crypto.randomUUID()) || `s${now}${Math.random().toString(36).slice(2)}`,
    name: puzzle.title,
    storyId: storyIdOf(puzzle),
    puzzle,
    marks: {}, ticked: [], answers: {},
    undo: [], redo: [],
    hintsUsed: 0, checksUsed: 0, elapsedMs: 0,
    focus: null, view: 'grid',
    solved: false, revealed: false, completedAt: null,
    coach: settings.coach && ['basic', 'easy'].includes(puzzle.difficulty.id),
    created: now, lastPlayed: now, percent: 0,
  };
}

// ====================================================================
// Saved puzzles
// ====================================================================
async function renderSaved() {
  let saves = [];
  try { saves = await store.listSaves(); } catch (e) { $('#saved-empty').textContent = 'Saved puzzles could not be loaded on this device.'; }
  saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
  $('#saved-empty').hidden = saves.length > 0;
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('#saved-list').innerHTML = saves.map((s) => {
    const p = s.puzzle;
    const pct = s.solved ? 100 : s.percent || 0;
    const state = s.solved ? (s.revealed ? 'Solution revealed' : 'Solved') : `${pct}% complete`;
    return `<li class="saved-item" data-id="${s.id}">
      <h3 class="name">${esc(s.name)}</h3>
      <div class="info">${esc(p.theme.name)} · ${esc(p.difficulty.name)} · ${p.categories.length} × ${p.categories[0].items.length} · ${state}<br>Last played ${esc(fmt.format(new Date(s.lastPlayed)))}</div>
      <div class="bar" role="img" aria-label="${state}"><i style="width:${pct}%"></i></div>
      <div class="row">
        <button class="btn primary small" type="button" data-do="resume">${s.solved ? 'Open' : 'Resume'}<span class="sr-only"> ${esc(s.name)}</span></button>
        <button class="btn small" type="button" data-do="rename">Rename<span class="sr-only"> ${esc(s.name)}</span></button>
        ${isPreview ? '' : `<button class="btn small" type="button" data-do="export">Save to file<span class="sr-only"> ${esc(s.name)}</span></button>`}
        <button class="btn small" type="button" data-do="delete">Delete<span class="sr-only"> ${esc(s.name)}</span></button>
      </div></li>`;
  }).join('');
}

$('#saved-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-do]');
  if (!b) return;
  const li = b.closest('li');
  const id = li.dataset.id;
  const save = await store.getSave(id);
  if (!save) return;
  const act = b.dataset.do;
  if (act === 'resume') openGame(save);
  else if (act === 'export') exportSave(save);
  else if (act === 'rename') startRename(li, save);
  else if (act === 'delete') {
    const ok = await confirmDialog({ title: `Delete “${save.name}”?`, text: 'This removes the puzzle and your progress from this device. You can undo for 10 seconds.', yes: 'Delete puzzle', no: 'Keep it' });
    if (!ok) return;
    await store.deleteSave(id);
    await renderSaved();
    $('#saved-h').focus();
    toast(`Deleted “${save.name}”.`, { label: 'Undo', run: async () => { await store.putSave(save); await renderSaved(); announce(`Restored ${save.name}.`); } }, { ms: 10000 });
  }
});

function startRename(li, save) {
  const h = li.querySelector('.name');
  const form = document.createElement('form');
  form.className = 'field';
  form.innerHTML = `<label for="rn-${save.id}">New name</label><input id="rn-${save.id}" type="text" value="${esc(save.name)}"><div class="row"><button class="btn primary small">Save name</button><button class="btn small" type="button">Keep old name</button></div>`;
  h.replaceWith(form);
  const input = form.querySelector('input');
  input.focus();
  input.select();
  const finish = async (name) => {
    if (name && name !== save.name) { save.name = name; await store.putSave(save); announce(`Renamed to ${name}.`); }
    await renderSaved();
    $(`li[data-id="${save.id}"] [data-do=rename]`)?.focus();
  };
  form.onsubmit = (e) => { e.preventDefault(); finish(input.value.trim()); };
  form.querySelector('button[type=button]').onclick = () => finish(null);
  input.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
}

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportSave(save) {
  const safe = save.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'puzzle';
  download(`${safe}.flg.json`, JSON.stringify({ format: 'fantastical-logic-grid', version: 1, save }, null, 1));
  toast(`Saved “${save.name}” to a file in your downloads.`);
}

$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let save;
    if (data && data.format === 'fantastical-logic-grid' && data.save && data.save.puzzle) save = { ...newSave(data.save.puzzle), ...data.save };
    else if (data && data.clues && data.grid && data.solution) save = newSave(data);
    else throw new Error('This file is not a Fantastical Logic Grid puzzle.');
    save.id = newSave(save.puzzle).id;
    save.lastPlayed = Date.now();
    await store.putSave(save);
    await rememberStory(save.storyId || storyIdOf(save.puzzle));
    await renderSaved();
    toast(`Opened “${save.name}”. It is now in your saved puzzles.`);
  } catch (err) {
    toast(`Could not open that file. ${err.message}`);
  }
};

// ====================================================================
// Play: open, render, marks, undo
// ====================================================================
function openGame(save, { fresh = false } = {}) {
  closeGame();
  const puzzle = save.puzzle;
  const ix = puzzleIndex(puzzle);
  S = {
    save, puzzle, ix,
    marks: new Map(Object.entries(save.marks || {})),
    wrong: new Set(),
    hint: null,
    dirty: false,
    started: performance.now(),
  };
  save.ticked = save.ticked || [];
  save.answers = save.answers || {};
  save.undo = save.undo || [];
  save.redo = save.redo || [];

  $('#p-title').textContent = save.name;
  const K = ix.K, N = ix.N;
  $('#p-meta').innerHTML = [puzzle.difficulty.name, puzzle.theme.name, `${K} categories × ${N} items`, `${puzzle.clues.length} clues`].map((t) => `<span class="pill">${esc(t)}</span>`).join('');
  const paras = puzzle.story.paragraphs;
  $('#p-story').innerHTML = paras.map((p, i) => `<p${i === paras.length - 1 ? ' class="goal"' : ''}>${esc(p)}</p>`).join('');
  $('#story').open = !fresh ? !save.storyRead : true;
  const notes = (puzzle.notes || []).filter((n) => !/Closest match/.test(n));
  $('#p-notes').hidden = !notes.length;
  $('#p-notes').innerHTML = notes.map(esc).join('<br>');

  S.witness = assignWitnesses(puzzle, ix);
  $('#clue-list').innerHTML = puzzle.clues.map((c) => `
    <li data-n="${c.number}"${save.ticked.includes(c.number) ? ' class="used"' : ''}><span class="num" aria-hidden="true">${c.number}</span>
    <label><input type="checkbox" data-n="${c.number}"${save.ticked.includes(c.number) ? ' checked' : ''} aria-label="Clue ${c.number}, used"><span><span class="txt">${esc(c.text)}</span><span class="from media">From ${esc(S.witness[c.number])}</span></span></label></li>`).join('');
  renderMedia();
  $('#q-list').innerHTML = puzzle.questions.map((q) => `
    <li><label for="q-${q.number}">${esc(q.text)}</label>
    <select id="q-${q.number}" data-n="${q.number}"><option value="">Choose an answer</option>${q.options.map((o) => `<option value="${o}"${save.answers[q.number] === o ? ' selected' : ''}>${esc(ix.label(o))}</option>`).join('')}</select>
    <span class="res" id="qr-${q.number}"></span></li>`).join('');
  $('#answer-result').textContent = '';

  S.grid = createGrid($('#gridframe'), puzzle, ix, {
    onCycle: (k) => { const cur = S.marks.get(k) || ''; setCell(k, cur === '' ? 'X' : cur === 'O' ? '' : 'O'); },
    onMark: (k, v) => setCell(k, v),
    onDescribeRow: describeRow,
    onFocus: (k) => { save.focus = k; },
  });
  paintAll();
  $$('input[name=view]').forEach((r) => { r.checked = r.value === (save.view || 'grid'); });
  setView(save.view || 'grid', false);
  $('#hintbox').hidden = true;
  $('#solved').hidden = true;
  updateHintCount();
  updateUndoButtons();
  updateProgress();
  showScreen('play');
  window.scrollTo(0, 0);

  if (save.solved) showSolved(false);
  if (fresh) {
    $('#p-title').setAttribute('tabindex', '-1');
    $('#p-title').focus();
    announce(`${save.name}. ${puzzle.difficulty.name}, ${puzzle.clues.length} clues. Read the story, then use the grid.`);
  } else {
    S.grid.focusKey(save.focus);
    announce(`Resumed: ${save.name}, ${save.solved ? 'solved' : `${save.percent || 0}% complete`}.`);
  }
  startTimer();
  updateCoach();
  updateMusic();
}

function closeGame() {
  $('#toasts').replaceChildren(); // toast actions belong to the game they came from
  if (!S) return;
  try { sfx.stopMusic(); ai.stopSpeaking(); } catch (e) { /* ignore */ }
  stopTimer();
  S.grid?.destroy();
  S = null;
}

function markList() {
  return [...S.marks].map(([k, m]) => { const [a, b] = k.split('|'); return { a, b, mark: m === 'O' ? 'O' : 'X' }; });
}

function paintAll() {
  for (const k of S.grid.cells.keys()) paintCell(k);
  if (S.save.view === 'list') renderList();
}
function paintCell(k) {
  const target = S.hint && S.hint.level >= 1 && S.hint.targets.has(k);
  S.grid.paint(k, S.marks.get(k) || '', { wrong: S.wrong.has(k), target });
}

// Every change is a list of { t: 'm' (mark) | 't' (clue tick), k, b (before), a (after) }.
function applyChanges(changes, dir) {
  for (const ch of changes) {
    const v = dir > 0 ? ch.a : ch.b;
    if (ch.t === 'm') {
      if (v) S.marks.set(ch.k, v); else S.marks.delete(ch.k);
      S.wrong.delete(ch.k);
      paintCell(ch.k);
    } else if (ch.t === 't') {
      const n = Number(ch.k);
      S.save.ticked = S.save.ticked.filter((x) => x !== n);
      if (v) S.save.ticked.push(n);
      const li = $(`#clue-list li[data-n="${n}"]`);
      li.classList.toggle('used', !!v);
      li.querySelector('input').checked = !!v;
    }
  }
}

function commit(changes, label) {
  changes = changes.filter((c) => (c.b || '') !== (c.a || ''));
  if (!changes.length) return false;
  applyChanges(changes, 1);
  S.save.undo.push({ label, changes });
  if (S.save.undo.length > 5000) S.save.undo.shift();
  S.save.redo = [];
  afterChange();
  return true;
}

function afterChange() {
  if (S.hint) clearHint();
  if (S.save.view === 'list') renderList();
  updateUndoButtons();
  updateProgress();
  scheduleSave();
  checkSolved();
  updateCoach();
}

function undo() {
  const act = S.save.undo.pop();
  if (!act) { status('Nothing to undo.'); return; }
  applyChanges([...act.changes].reverse(), -1);
  S.save.redo.push(act);
  status(`Undid: ${act.label}.`);
  afterChange();
}
function redo() {
  const act = S.save.redo.pop();
  if (!act) { status('Nothing to redo.'); return; }
  applyChanges(act.changes, 1);
  S.save.undo.push(act);
  status(`Redid: ${act.label}.`);
  afterChange();
}
function updateUndoButtons() {
  $('[data-act=undo]').disabled = !S.save.undo.length;
  $('[data-act=redo]').disabled = !S.save.redo.length;
}

// Cells in the same sub-grid row and column as k (for auto-X).
function lineMates(k) {
  const [a, b] = k.split('|');
  const ca = S.ix.byId[a.split(':')[0]], cb = S.ix.byId[b.split(':')[0]];
  const out = [];
  for (const it of cb.items) if (it.id !== b) out.push(S.ix.key(a, it.id));
  for (const it of ca.items) if (it.id !== a) out.push(S.ix.key(it.id, b));
  return out;
}

function setCell(k, v) {
  if (!S) return;
  const before = S.marks.get(k) || '';
  if (before === v) return;
  const changes = [{ t: 'm', k, b: before, a: v }];
  let autoCount = 0;
  if (v === 'O' && settings.autoX) {
    for (const m of lineMates(k)) if (!S.marks.get(m)) { changes.push({ t: 'm', k: m, b: '', a: 'A' }); autoCount++; }
  }
  const [a, b] = k.split('|');
  const what = `${S.ix.label(a)} and ${S.ix.label(b)} ${v === 'O' ? 'confirmed' : v ? 'ruled out' : 'cleared'}`;
  commit(changes, what);
  let wrongNow = false;
  if (settings.instant && v) {
    const [mk] = checkMarks(S.puzzle, [{ a, b, mark: v === 'O' ? 'O' : 'X' }]);
    if (mk) { S.wrong.add(k); paintCell(k); wrongNow = true; }
  }
  sound(wrongNow ? 'error' : v === 'O' ? 'O' : v ? 'X' : 'clear');
  const td = S.grid.cells.get(k);
  announce(`${td ? `${S.ix.label(td.dataset.row)}, ${S.ix.label(td.dataset.col)}` : what}, ${STATE_WORDS[v]}${wrongNow ? ', conflicts with the solution' : ''}${autoCount ? `. Also ruled out ${autoCount} other cell${autoCount > 1 ? 's' : ''}` : ''}.`);
}

function describeRow(rowItem) {
  const parts = [];
  const rowCat = rowItem.split(':')[0];
  for (const c of S.ix.cats) {
    if (c.id === rowCat) continue;
    const states = c.items.map((it) => ({ it, s: S.marks.get(S.ix.key(rowItem, it.id)) || '' }));
    const o = states.find((x) => x.s === 'O');
    if (o) parts.push(`${c.name}: ${o.it.label} confirmed`);
    else {
      const out = states.filter((x) => x.s).map((x) => x.it.label);
      parts.push(`${c.name}: ${out.length ? `${out.join(', ')} ruled out` : 'nothing marked'}`);
    }
  }
  announce(`${S.ix.label(rowItem)}. ${parts.join('. ')}.`);
}

function updateProgress() {
  const { K, N } = S.ix;
  const total = (K * (K - 1) / 2) * N * N;
  const pct = Math.round((S.marks.size / total) * 100);
  S.save.percent = pct;
  let done = 0;
  const newDone = new Set();
  for (const blk of S.puzzle.grid.blocks) {
    const rc = S.ix.byId[blk.row], cc = S.ix.byId[blk.column];
    let os = 0;
    for (const r of rc.items) for (const c of cc.items) if (S.marks.get(S.ix.key(r.id, c.id)) === 'O') os++;
    if (os === N) {
      done++;
      const id = `${blk.row}|${blk.column}`;
      if (S.doneBlocks && !S.doneBlocks.has(id)) { celebrateBlock(rc, cc); }
      newDone.add(id);
    }
  }
  S.doneBlocks = newDone;
  revealScene(done / S.puzzle.grid.blocks.length);
  try { sfx.setMood(pct / 100); } catch (e) { /* ignore */ }
  $('#progress').textContent = `${pct}% filled · ${done} of ${S.puzzle.grid.blocks.length} sections done`;
}

// ---- list view: one select per row of each sub-grid, sharing the same marks ----
function setView(view, focus = true) {
  S.save.view = view;
  $('#gridframe').hidden = view !== 'grid';
  $('#listview').hidden = view !== 'list';
  if (view === 'list') renderList();
  if (focus && view === 'grid') S.grid.focusKey(S.save.focus);
  scheduleSave();
}
function renderList() {
  const lv = $('#listview');
  const active = document.activeElement && lv.contains(document.activeElement) ? document.activeElement.id : null;
  lv.innerHTML = S.puzzle.grid.blocks.map((blk, bi) => {
    const rc = S.ix.byId[blk.row], cc = S.ix.byId[blk.column];
    return `<fieldset><legend>${esc(rc.name)} and ${esc(cc.name)}</legend>${rc.items.map((r, ri) => {
      const o = cc.items.find((c) => S.marks.get(S.ix.key(r.id, c.id)) === 'O');
      const id = `lv-${bi}-${ri}`;
      return `<div class="lv-row"><label for="${id}">${esc(r.label)}</label><select id="${id}" data-row="${r.id}" data-cat="${cc.id}"><option value="">Not decided</option>${cc.items.map((c) => {
        const s = S.marks.get(S.ix.key(r.id, c.id));
        return `<option value="${c.id}"${o && o.id === c.id ? ' selected' : ''}>${esc(c.label)}${s === 'X' || s === 'A' ? ' (ruled out)' : ''}</option>`;
      }).join('')}</select></div>`;
    }).join('')}</fieldset>`;
  }).join('');
  if (active) $(`#${active}`)?.focus();
}
$('#listview').addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  if (!sel) return;
  const cat = S.ix.byId[sel.dataset.cat];
  const row = sel.dataset.row;
  const changes = [];
  for (const c of cat.items) {
    const k = S.ix.key(row, c.id);
    const cur = S.marks.get(k) || '';
    if (c.id === sel.value) changes.push({ t: 'm', k, b: cur, a: 'O' });
    else if (cur === 'O') changes.push({ t: 'm', k, b: cur, a: '' });
  }
  commit(changes, sel.value ? `${S.ix.label(row)} and ${S.ix.label(sel.value)} confirmed` : `${S.ix.label(row)} cleared`);
  announce(sel.value ? `${S.ix.label(row)}, ${S.ix.label(sel.value)}, confirmed.` : `${S.ix.label(row)}, ${cat.name} not decided.`);
});
$$('input[name=view]').forEach((r) => r.addEventListener('change', () => setView(r.value)));

// ---- clues and questions ----
$('#clue-list').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-n]');
  if (!cb) return;
  const n = +cb.dataset.n;
  commit([{ t: 't', k: String(n), b: cb.checked ? '' : 'y', a: cb.checked ? 'y' : '' }], `clue ${n} ${cb.checked ? 'ticked' : 'unticked'}`);
  sound('tick');
});
$('#q-list').addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  if (!sel) return;
  S.save.answers[sel.dataset.n] = sel.value;
  $(`#qr-${sel.dataset.n}`).textContent = '';
  scheduleSave();
});
$('#check-answers').onclick = () => {
  const res = checkAnswers(S.puzzle, S.save.answers);
  let right = 0;
  for (const r of res) {
    const el = $(`#qr-${r.number}`);
    const answered = !!S.save.answers[r.number];
    el.textContent = !answered ? 'No answer yet' : r.correct ? '✓ Correct' : '✗ Not this one';
    el.className = `res${answered && !r.correct ? ' bad' : ''}`;
    if (r.correct) right++;
  }
  $('#answer-result').textContent = `${right} of ${res.length} answers correct.`;
  sound(right === res.length ? 'solve' : 'error');
};
$('#story').addEventListener('toggle', () => { if (S && !$('#story').open) { S.save.storyRead = true; scheduleSave(); } });

// ====================================================================
// Hints, check, clear, reveal
// ====================================================================
function clearHint() {
  const old = S.hint;
  S.hint = null;
  $('#hintbox').hidden = true;
  $$('#clue-list li.hinted').forEach((li) => li.classList.remove('hinted'));
  if (old) for (const k of old.targets) paintCell(k);
}

function updateHintCount() {
  $('#hint-count').textContent = S.save.hintsUsed ? `(${S.save.hintsUsed})` : '';
  $('[data-act=hint]').setAttribute('aria-label', `Hint, ${S.save.hintsUsed} used`);
}

let hintBusy = false;
async function hint() {
  if (hintBusy || S.save.solved) return;
  if (S.hint && S.hint.level < 2) {
    S.hint.level++;
    S.save.hintsUsed++;
  } else if (!S.hint) {
    hintBusy = true;
    status('Finding a hint…');
    try {
      const res = await engine.hint(S.puzzle, markList());
      if (!S) return;
      const targets = new Set((res.marks || []).slice(0, 1).map((m) => S.ix.key(m.a, m.b)));
      S.hint = { res, level: 0, targets };
      S.save.hintsUsed++;
      status('');
    } catch (e) {
      status(`No hint right now: ${e.message}`);
      return;
    } finally { hintBusy = false; }
  } else {
    // Already at the last level: show it again.
  }
  renderHint();
  updateHintCount();
  scheduleSave();
  sound('hint');
}

function renderHint() {
  const { res, level } = S.hint;
  const box = $('#hintbox');
  const lines = res.levels.slice(0, level + 1).map((t, i) => `<p>${i === 0 ? '<b>Hint:</b> ' : ''}${esc(t)}</p>`).join('');
  const more = level < 2 ? '<button class="btn small" type="button" id="hint-more">Show more</button>' : '';
  const apply = level === 2 && res.kind !== 'done' ? `<button class="btn small" type="button" id="hint-apply">${res.kind === 'mistake' ? 'Fix it for me' : 'Mark it for me'}</button>` : '';
  box.innerHTML = `${lines}<div class="row">${more}${apply}<button class="btn quiet small" type="button" id="hint-close">Close hint</button></div>`;
  box.hidden = false;
  $$('#clue-list li.hinted').forEach((li) => li.classList.remove('hinted'));
  if (res.clue) $(`#clue-list li[data-n="${res.clue}"]`)?.classList.add('hinted');
  for (const k of S.hint.targets) paintCell(k);
  announce(res.levels[level]);
  $('#hint-more')?.addEventListener('click', hint);
  $('#hint-close').onclick = () => { clearHint(); S.grid.focusKey(S.save.focus); };
  $('#hint-apply')?.addEventListener('click', () => {
    const changes = res.kind === 'mistake'
      ? res.marks.slice(0, 1).map((m) => { const k = S.ix.key(m.a, m.b); return { t: 'm', k, b: S.marks.get(k) || '', a: '' }; })
      : res.marks.map((m) => { const k = S.ix.key(m.a, m.b); return { t: 'm', k, b: S.marks.get(k) || '', a: m.mark }; });
    const first = changes[0] && changes[0].k;
    commit(changes, res.kind === 'mistake' ? 'hint fix' : 'hint step');
    announce(res.kind === 'mistake' ? 'Removed the wrong mark.' : `Marked ${changes.length} cell${changes.length > 1 ? 's' : ''} from the hint.`);
    if (first) S.grid.focusKey(first);
  });
}

function check() {
  const bad = checkMarks(S.puzzle, markList());
  const old = S.wrong;
  S.wrong = new Set(bad.map((m) => S.ix.key(m.a, m.b)));
  for (const k of new Set([...old, ...S.wrong])) paintCell(k);
  S.save.checksUsed = (S.save.checksUsed || 0) + 1;
  const msg = bad.length ? `${bad.length} mark${bad.length > 1 ? 's conflict' : ' conflicts'} with the solution. ${bad.length > 1 ? 'They are' : 'It is'} outlined with a warning sign.` : (S.marks.size ? 'No errors so far.' : 'No marks to check yet.');
  status(msg);
  sound(bad.length ? 'error' : 'tick');
  scheduleSave();
}

async function clearGrid() {
  if (!S.marks.size) { status('The grid is already empty.'); return; }
  const ok = await confirmDialog({ title: 'Clear the grid?', text: 'This removes every X and O. You can undo it.', yes: 'Clear grid', no: 'Keep my marks' });
  if (!ok) return;
  commit([...S.marks].map(([k, v]) => ({ t: 'm', k, b: v, a: '' })), 'clear grid');
  status('Grid cleared.');
  toast('Grid cleared.', { label: 'Undo', run: undo }, { ms: 10000 });
}

async function reveal() {
  if (S.save.solved && !S.save.revealed) { status('This puzzle is already solved.'); return; }
  const ok = await confirmDialog({ title: 'Reveal the solution?', text: 'Every cell will be filled in and this puzzle will no longer count as solved by you. You can undo for 10 seconds.', yes: 'Reveal solution', no: 'Keep solving' });
  if (!ok) return;
  const wasRevealed = S.save.revealed;
  const changes = [];
  for (const k of S.grid.cells.keys()) {
    const [a, b] = k.split('|');
    const match = S.puzzle.solution.some((row) => { const v = Object.values(row); return v.includes(a) && v.includes(b); });
    changes.push({ t: 'm', k, b: S.marks.get(k) || '', a: match ? 'O' : 'X' });
  }
  S.save.revealed = true;
  commit(changes, 'reveal solution');
  toast('Solution revealed.', { label: 'Undo', run: () => { S.save.revealed = wasRevealed; S.save.solved = false; $('#solved').hidden = true; undo(); } }, { ms: 10000 });
}

// ====================================================================
// Solve, coach tips, timer
// ====================================================================
function checkSolved() {
  const solved = isSolved(S.puzzle, markList());
  if (solved && !S.save.solved) {
    S.save.solved = true;
    S.save.completedAt = Date.now();
    tickTimer();
    recordSolve(S.save);
    stopTimer();
    showSolved(true);
    scheduleSave();
  } else if (!solved && S.save.solved) {
    S.save.solved = false;
    $('#solved').hidden = true;
    startTimer();
  }
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function showSolved(celebrate) {
  const save = S.save;
  wake.setPlaying(false);
  const tier = S.puzzle.difficulty.id;
  const i = TIER_IDS.indexOf(tier);
  $('#solved-h').textContent = save.revealed ? 'Solution revealed' : 'Case closed!';
  $('#ending').textContent = S.puzzle.story.ending;
  $('#solved-stats').innerHTML = [
    ['Time', fmtTime(save.elapsedMs)], ['Hints used', save.hintsUsed], ['Checks', save.checksUsed || 0],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  let next = tier;
  let tip;
  if (save.revealed || save.hintsUsed >= 5) {
    tip = i > 0 ? `Try another ${TIERS[tier].name} puzzle, or step down to ${TIERS[TIER_IDS[i - 1]].name} for a gentler one.` : `Try another ${TIERS[tier].name} puzzle.`;
  } else if (save.hintsUsed <= 1 && i < TIER_IDS.length - 1) {
    next = TIER_IDS[i + 1];
    tip = `Nicely done. Ready for ${TIERS[next].name}?`;
  } else tip = `Try another ${TIERS[tier].name} puzzle with a brand new story.`;
  $('#next-tip').textContent = tip;
  $('#next-btn').textContent = next === tier ? `New ${TIERS[tier].name} puzzle` : `Try ${TIERS[next].name}`;
  $('#next-btn').onclick = () => {
    setup.tier = next;
    setup.size = null;
    store.saveSetupChoices({ ...setup, custom: setup.custom });
    renderSetup();
    goHome();
  };
  const res = $('#resolution');
  const winner = winnerOf(S.puzzle, S.ix);
  const bg = S.sceneUrl ? `<img class="bg" src="${S.sceneUrl}" alt="">` : sceneSvg(S.puzzle, 5, { animate: false });
  const face = S.portraitUrls && S.portraitUrls[winner] ? `<img src="${S.portraitUrls[winner]}" alt="">` : winner ? portrait(S.puzzle, winner, { size: 120, style: settings.portraitStyle }) : '';
  res.innerHTML = `${bg}<div class="spot"></div>${winner ? `<div class="hero">${face}<b>${esc(winner)}</b></div>` : ''}`;
  if (celebrate && voiceOn()) setTimeout(() => { if (S && S.save.solved) ai.speak(settings, S.puzzle, 'narrator', S.puzzle.story.ending, { volume: settings.volume / 100 }); }, 1200);
  res.classList.remove('celebrate');
  if (celebrate) { void res.offsetWidth; res.classList.add('celebrate'); }
  $('#solved').hidden = false;
  clearHint();
  $('#coach').hidden = true;
  if (celebrate) {
    sound('solve');
    if (settings.confetti && !save.revealed) confettiBurst();
    $('#solved').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    $('#solved').focus({ preventScroll: true });
    announce(`${save.revealed ? 'Solution revealed.' : 'Solved!'} ${S.puzzle.story.ending}`);
  }
}

let coachBusy = false;
async function updateCoach() {
  const box = $('#coach');
  if (!S || !S.save.coach || S.save.solved || S.marks.size >= 4) {
    if (S && S.save.coach && S.marks.size >= 4) endCoach();
    box.hidden = true;
    return;
  }
  if (coachBusy) return;
  coachBusy = true;
  try {
    const res = await engine.hint(S.puzzle, markList());
    if (!S || !S.save.coach) return;
    if (res.kind === 'step' && res.marks.length) {
      const m = res.marks[0];
      $('#coach-text').innerHTML = `<b>Tip:</b> ${esc(res.levels[2])} So mark <b>${m.mark}</b> where ${esc(S.ix.label(m.a))} meets ${esc(S.ix.label(m.b))}.`;
    } else if (res.kind === 'mistake') {
      $('#coach-text').innerHTML = `<b>Tip:</b> ${esc(res.levels[1])} Undo (Ctrl+Z) takes back the last mark.`;
    }
    box.hidden = false;
  } catch (e) { box.hidden = true; } finally { coachBusy = false; }
}
function endCoach() {
  S.save.coach = false;
  settings.coach = false;
  store.saveSettings(settings);
  $('#coach').hidden = true;
  scheduleSave();
}
$('#coach-skip').onclick = () => { endCoach(); S.grid.focusKey(S.save.focus); };

let timerId = null;
function startTimer() {
  stopTimer();
  if (!S || S.save.solved) { renderTimer(); return; }
  S.started = performance.now();
  timerId = setInterval(tickTimer, 1000);
  renderTimer();
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
function tickTimer() {
  if (!S) return;
  const now = performance.now();
  if (!document.hidden) S.save.elapsedMs += now - S.started;
  S.started = now;
  renderTimer();
}
function renderTimer() {
  $('#timer').hidden = !settings.showTimer;
  if (S) $('#timer').textContent = `Time ${fmtTime(S.save.elapsedMs)}`;
}
document.addEventListener('visibilitychange', () => { if (S && timerId) { if (document.hidden) tickTimer(); else S.started = performance.now(); } if (document.hidden) flushSave(); });

// ====================================================================
// Autosave
// ====================================================================
let saveTimer = null;
let retryTimer = null;
function scheduleSave() {
  if (!S) return;
  S.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}
async function flushSave({ manual = false } = {}) {
  clearTimeout(saveTimer);
  if (!S || (!S.dirty && !manual)) return;
  const save = S.save;
  save.marks = Object.fromEntries(S.marks);
  save.lastPlayed = Date.now();
  try {
    await store.putSave(save);
    if (S && S.save === save) S.dirty = false;
    clearTimeout(retryTimer);
    $('#saveind').textContent = 'Saved';
    if (manual) status('Saved on this device.');
  } catch (e) {
    $('#saveind').textContent = '';
    showError('Could not save your progress. Retrying in 5 seconds. Your marks are still here.');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => flushSave(), 5000);
  }
}
function showError(text) {
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.className = 'sr-only';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 8000);
  status(text);
}
window.addEventListener('pagehide', () => flushSave());

// ====================================================================
// Multimedia: scene, cast, witness clues, section chimes, adaptive difficulty
// ====================================================================
const SAYINGS = ['I saw it with my own eyes:', 'I am sure of this much:', 'Here is what I noticed:', 'I remember it clearly:', 'You might want to write this down:', 'I was there, and', 'Between you and me,', 'I can tell you this:'];

// Each clue is told by one character, preferably one the clue is not about.
function assignWitnesses(puzzle, ix) {
  const names = ix.cats[0].items.map((i) => i.label);
  const out = {};
  const load = Object.fromEntries(names.map((n) => [n, 0]));
  for (const c of puzzle.clues) {
    const free = names.filter((n) => !c.text.includes(n));
    const pool = free.length ? free : names;
    const who = pool.reduce((best, n) => (load[n] < load[best] ? n : best), pool[(c.number - 1) % pool.length]);
    load[who]++;
    out[c.number] = who;
  }
  return out;
}

function winnerOf(puzzle, ix) {
  const q = puzzle.questions[0];
  return q && q.category === ix.cats[0].id ? ix.label(q.answer) : null;
}

function renderMedia() {
  const p = S.puzzle;
  S.sceneLayers = -1;
  $('#scene').innerHTML = sceneSvg(p, 0);
  const names = S.ix.cats[0].items.map((i) => i.label);
  $('#cast-row').innerHTML = names.map((n) => {
    const count = Object.values(S.witness).filter((w) => w === n).length;
    return `<button class="cast-btn" type="button" data-who="${esc(n)}" aria-pressed="false">${portrait(p, n, { style: settings.portraitStyle })}<span>${esc(n)}</span><small>${count} clue${count === 1 ? '' : 's'}</small></button>`;
  }).join('');
  $('#bubble').hidden = true;
  S.sceneUrl = null;
  S.portraitUrls = {};
  loadAiArt();
  // Make the start of the story narration ahead of time so Read aloud plays at once.
  if (voiceOn()) ai.warmVoice(settings, p, 'narrator', p.story.paragraphs.join(' '));
}

const voiceOn = () => settings.sound && settings.readAloud && !settings.silent;

// Swap in AI pictures when a key is set. Built-in art stays until they arrive.
async function loadAiArt() {
  if (isPreview || settings.silent || !ai.aiReady(settings) || settings.aiPictures === 'none') return;
  const game = S;
  const p = game.puzzle;
  const tag = document.createElement('span');
  tag.className = 'painting';
  tag.textContent = 'Painting the scene…';
  $('#scene').append(tag);
  try {
    const blob = await ai.sceneImage(settings, p);
    if (S !== game) return;
    game.sceneUrl = URL.createObjectURL(blob);
    $('#scene').innerHTML = `<div class="ai-scene"><img src="${game.sceneUrl}" alt=""><div class="veil">${'<i></i>'.repeat(5)}</div></div>`;
    game.sceneLayers = -1;
    updateProgress();
  } catch (e) {
    tag.remove();
    if (S === game) status(`AI picture not made: ${e.message} Using the built-in art.`);
    return;
  }
  if (settings.aiPictures !== 'all') return;
  for (const btn of $$('#cast-row .cast-btn')) {
    const who = btn.dataset.who;
    try {
      const blob = await ai.portraitImage(settings, p, who);
      if (S !== game) return;
      game.portraitUrls[who] = URL.createObjectURL(blob);
      btn.querySelector('svg, img').outerHTML = `<img class="portrait-img" src="${game.portraitUrls[who]}" alt="">`;
    } catch (e) { if (S === game) status(`AI portrait not made: ${e.message}`); return; }
  }
}

function revealScene(fraction) {
  const n = Math.min(5, Math.ceil(fraction * 5 - 1e-9));
  const layers = $$('#scene .layer');
  layers.forEach((g, i) => g.classList.toggle('on', i < Math.max(n, 1)));
  $$('#scene .veil i').forEach((v, i) => v.classList.toggle('gone', i < Math.max(n, 1)));
  if (S.sceneLayers >= 0 && n > S.sceneLayers && !settings.silent) status('A new part of the scene appears.');
  S.sceneLayers = n;
}

function celebrateBlock(rc, cc) {
  sound('section');
  for (const r of rc.items) for (const c of cc.items) {
    const td = S.grid.cells.get(S.ix.key(r.id, c.id));
    if (td) { td.classList.remove('pulse'); void td.offsetWidth; td.classList.add('pulse'); }
  }
  announce(`${rc.name} and ${cc.name} section complete.`);
}

$('#cast-row').addEventListener('click', (e) => {
  const b = e.target.closest('.cast-btn');
  if (!b) return;
  const who = b.dataset.who;
  $$('#cast-row .cast-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const clues = S.puzzle.clues.filter((c) => S.witness[c.number] === who);
  $$('#clue-list li.spot').forEach((li) => li.classList.remove('spot'));
  clues.forEach((c) => $(`#clue-list li[data-n="${c.number}"]`)?.classList.add('spot'));
  $('#bubble').innerHTML = clues.length
    ? clues.map((c) => `<p><span class="who">${esc(who)}:</span> “${esc(SAYINGS[(c.number + who.length) % SAYINGS.length])} ${esc(c.text)}” <span class="muted">(clue ${c.number})</span></p>`).join('')
    : `<p><span class="who">${esc(who)}:</span> “I didn't see anything, I promise.”</p>`;
  $('#bubble').hidden = false;
  sound('whoosh');
  if (voiceOn()) {
    const lines = clues.length ? clues.map((c) => `${SAYINGS[(c.number + who.length) % SAYINGS.length]} ${c.text}`).join(' ') : "I didn't see anything, I promise.";
    voiceWaitNote();
    ai.speak(settings, S.puzzle, who, lines, { volume: settings.volume / 100 });
  }
});

$('#read-story').addEventListener('click', () => {
  if (!S) return;
  if (!settings.sound) { status('Sound is off. Turn it on to hear the story.'); return; }
  voiceWaitNote();
  ai.speak(settings, S.puzzle, 'narrator', S.puzzle.story.paragraphs.join(' '), { volume: settings.volume / 100 });
});
// Free Kokoro voices: one-time model download, then they run on this computer.
function kokoroStatus() {
  $('#kokoro-status').textContent = ai.kokoroReady(settings) ? 'Free voices are on this computer.' : '';
  $('#kokoro-get').textContent = ai.kokoroReady(settings) ? 'Check the free voices' : 'Download free voices';
}
$('#kokoro-get').addEventListener('click', async () => {
  const btn = $('#kokoro-get'), out = $('#kokoro-status'), bar = $('#kokoro-progress');
  btn.disabled = true;
  bar.hidden = false;
  bar.value = 0;
  out.textContent = ai.kokoroReady(settings) ? 'Loading the voices…' : 'Downloading the voices (about 90 MB, one time only)…';
  try {
    await ai.kokoroDownload((x) => { bar.value = x; });
    settings.kokoroReady = true;
    settings.voiceProvider = 'kokoro';
    store.saveSettings(settings);
    for (const r of $$('#settings-form input[name=voiceProvider]')) r.checked = r.value === 'kokoro';
    kokoroStatus();
    out.textContent = 'Free voices are ready. They now read the story and clues.';
  } catch (e) {
    out.textContent = `The voices could not be downloaded (${e.message.replace(/\.+$/, "")}). Check the internet connection and try again.`;
  } finally {
    btn.disabled = false;
    bar.hidden = true;
  }
});
// Natural voices are the default for all speech. On first launch they download
// in the background; later launches load them from the browser's cache early,
// so the first Read aloud starts promptly.
async function ensureNaturalVoices() {
  if ((settings.voiceProvider || 'kokoro') !== 'kokoro' || settings.silent || ai.kokoroLoading()) return;
  const first = !ai.kokoroReady(settings);
  if (first && (navigator.onLine === false || navigator.connection?.saveData)) return;
  if (first) toast('Getting the natural voices ready. This is a one-time download of about 90 MB.', null, { ms: 8000 });
  try {
    await ai.kokoroDownload();
    if (first) {
      settings.kokoroReady = true;
      store.saveSettings(settings);
      kokoroStatus();
      toast('Natural voices are ready.');
    }
  } catch (e) {
    console.warn('Natural voices not ready:', e.message);
    if (first) toast('The natural voices could not be downloaded yet. The game will try again next time.', { label: 'Try again', run: ensureNaturalVoices });
  }
}
function voiceWaitNote() {
  if (ai.kokoroLoading() && (settings.voiceProvider || 'kokoro') === 'kokoro') status(`The natural voices are still getting ready (${Math.round(ai.kokoroProgress() * 100)}%). Speech starts when they are.`);
}

$('#gemini-test').addEventListener('click', async () => {
  const out = $('#gemini-test-result');
  if (!ai.geminiReady(settings)) { out.textContent = 'Paste a Google key first.'; return; }
  out.textContent = 'Checking…';
  try { await ai.testGeminiKey(settings); out.textContent = 'The key works.'; } catch (e) { out.textContent = `Not working: ${e.message}`; }
});
$('#ai-test').addEventListener('click', async () => {
  const out = $('#ai-test-result');
  if (!ai.aiReady(settings)) { out.textContent = 'Paste an API key first.'; return; }
  out.textContent = 'Checking…';
  try { await ai.testKey(settings); out.textContent = 'The key works.'; } catch (e) { out.textContent = `Not working: ${e.message}`; }
});

// Adaptive difficulty: suggest a level from the last few solves.
async function recordSolve(save) {
  const hist = await store.getMeta('history', []);
  const { K, N } = S.ix;
  hist.push({ tier: S.puzzle.difficulty.id, ms: save.elapsedMs, hints: save.hintsUsed, revealed: !!save.revealed, cells: (K * (K - 1) / 2) * N * N, at: Date.now() });
  await store.setMeta('history', hist.slice(-50));
}

function suggestTier(hist) {
  if (!hist.length) return null;
  const last = hist[hist.length - 1];
  const i = TIER_IDS.indexOf(last.tier);
  const expectedMs = last.cells * MINUTES_PER_CELL[last.tier] * 60000;
  const recent = hist.slice(-3).filter((h) => h.tier === last.tier);
  if (last.revealed || last.hints >= 5) return { tier: TIER_IDS[Math.max(0, i - 1)], why: 'Your last puzzle needed a lot of help, so a gentler level may be more fun.' };
  if (last.hints <= 1 && last.ms <= expectedMs && i < TIER_IDS.length - 1) return { tier: TIER_IDS[i + 1], why: 'You solved your last puzzle quickly with little help.' };
  if (recent.length >= 2 && recent.every((h) => h.hints <= 2) && i < TIER_IDS.length - 1) return { tier: TIER_IDS[i + 1], why: 'You have solved several in a row at this level.' };
  return { tier: last.tier, why: 'This level looks like a good fit right now.' };
}

async function renderSuggestion() {
  $$('#tier-choices .suggest').forEach((el) => el.remove());
  let hist = [];
  try { hist = await store.getMeta('history', []); } catch (e) { return; }
  const s = suggestTier(hist);
  if (!s) return;
  const span = $(`#tier-choices input[value="${s.tier}"] + span`);
  if (span) span.insertAdjacentHTML('beforeend', `<small class="suggest"><strong>Suggested for you.</strong> ${esc(s.why)}</small>`);
}

// ====================================================================
// Print
// ====================================================================
function openPrint() {
  if (!S || isPreview) return;
  const dlg = $('#dlg-print');
  const paper = /^en-(US|CA)|es-(MX|US)|fil|-PH$/.test(navigator.language || '') ? 'letter' : 'A4';
  $$('input[name=ppaper]').forEach((r) => { r.checked = r.value === (S.save.paper || paper); });
  $('#p-steps-row').hidden = !['basic', 'easy'].includes(S.puzzle.difficulty.id);
  $('#p-steps').checked = false;
  $('#p-key').checked = false;
  $('#print-pdf').hidden = !(window.desktop && window.desktop.savePdf);
  openDialog(dlg, $('input[name=pwhat]:checked'));
}
function printOptions() {
  return {
    withMarks: $('input[name=pwhat]:checked').value === 'progress',
    answerKey: $('#p-key').checked,
    steps: $('#p-key').checked && $('#p-steps').checked && !$('#p-steps-row').hidden,
    paper: $('input[name=ppaper]:checked').value,
    marks: S.marks,
  };
}
$('#print-go').onclick = () => {
  const o = printOptions();
  S.save.paper = o.paper;
  $('#dlg-print').close();
  setTimeout(() => printPuzzle(S.puzzle, o), 50);
};
$('#print-pdf').onclick = () => {
  const o = printOptions();
  $('#dlg-print').close();
  printPuzzle(S.puzzle, o, { pdf: () => window.desktop.savePdf(S.puzzle.title, o.paper) });
};
$('#print-cancel').onclick = () => $('#dlg-print').close();

// ====================================================================
// Settings, help, menu, keyboard
// ====================================================================
function openSettings() {
  const f = $('#settings-form');
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') el.checked = settings[el.name] === el.value;
    else if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else if (el.type === 'range' || el.type === 'password' || el.type === 'text') el.value = settings[el.name] ?? '';
  }
  kokoroStatus();
  openDialog($('#dlg-settings'), f.querySelector('input:checked') || f.querySelector('input'));
}
$('#settings-form').addEventListener('change', (e) => {
  const el = e.target;
  if (!el.name) return;
  settings[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.type === 'password' ? el.value.trim() : el.value;
  if (S && (el.name === 'aiPictures' || el.name === 'aiKey') && !$('#screen-play').hidden) loadAiArt();
  if (S && el.name === 'portraitStyle') {
    for (const btn of $$('#cast-row .cast-btn')) {
      const face = btn.querySelector('svg.portrait-svg');
      if (face) face.outerHTML = portrait(S.puzzle, btn.dataset.who, { style: settings.portraitStyle });
    }
  }
  store.saveSettings(settings);
  applyColorTheme();
  applyMode();
  renderTimer();
  if (el.name === 'coach' && S && el.checked && !S.save.solved) { S.save.coach = true; updateCoach(); }
  if ((el.name === 'sound' && el.checked) || el.name === 'volume') sound('tick');
});

function toggleMenu(open) {
  const menu = $('#app-menu');
  const btn = $('#menu-btn');
  open = open ?? menu.hidden;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button:not([hidden])').focus();
}
$('#menu-btn').onclick = () => toggleMenu();
$('#app-menu').addEventListener('keydown', (e) => {
  const items = $$('#app-menu button:not([hidden])');
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); toggleMenu(false); $('#menu-btn').focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i + items.length - 1) % items.length].focus(); }
  else if (e.key === 'Tab') toggleMenu(false);
});
document.addEventListener('pointerdown', (e) => { if (!$('#app-menu').hidden && !e.target.closest('#app-menu, #menu-btn')) toggleMenu(false); });
$('#app-menu').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (!b) return;
  toggleMenu(false);
  const cmd = b.dataset.cmd;
  if (cmd === 'new') goHome();
  else if (cmd === 'saved') { await goHome({ focusSaved: true }); $('#saved-section').scrollIntoView(); }
  else if (cmd === 'settings') openSettings();
  else if (cmd === 'install') installApp();
});
$('#home-btn').onclick = () => goHome();
$('#help-btn').onclick = () => openDialog($('#dlg-help'), $('#help-close'));
$('#help-close').onclick = () => $('#dlg-help').close();

// Narrated how-to-play video: offered once on first launch, always in Help.
function openVideo() {
  if ($('#dlg-help').open) $('#dlg-help').close();
  openDialog($('#dlg-video'), $('#intro-video'));
}
$('#help-video').onclick = openVideo;
$('#video-close').onclick = () => $('#dlg-video').close();
$('#dlg-video').addEventListener('close', () => { $('#intro-video').pause(); });
function offerIntro() {
  if (settings.introOffered) return;
  settings.introOffered = true;
  store.saveSettings(settings);
  openDialog($('#dlg-welcome'), $('#welcome-watch'));
}
// Desktop updates: asked about on the home screen only, never mid-puzzle.
let pendingUpdate = null;
let shownUpdate = null;
function offerUpdate() {
  if (!pendingUpdate || $('#screen-home').hidden || document.querySelector('dialog[open]')) return;
  const u = pendingUpdate;
  pendingUpdate = null;
  shownUpdate = u;
  $('#update-text').textContent = u.kind === 'web'
    ? 'A new version of The Fantastical Logic Grid is ready.'
    : `Version ${u.version} of The Fantastical Logic Grid is available.${u.notes ? ` ${u.notes}` : ''}`;
  $('#update-install').textContent = u.kind === 'web' ? 'Reload now' : 'Install and restart';
  $('#update-status').textContent = '';
  openDialog($('#dlg-update'), $('#update-install'));
}
$('#update-later').onclick = () => $('#dlg-update').close();
$('#update-install').onclick = async () => {
  const bar = $('#update-progress');
  $('#update-install').disabled = true;
  $('#update-later').disabled = true;
  bar.hidden = false;
  if (shownUpdate && shownUpdate.kind === 'web') {
    webUpdateAccepted = true;
    $('#update-status').textContent = 'Reloading…';
    shownUpdate.worker.postMessage({ type: 'skip-waiting' });
    return;
  }
  $('#update-status').textContent = 'Downloading the update…';
  try {
    await updates.install((x) => { if (x == null) bar.removeAttribute('value'); else bar.value = x; });
  } catch (e) {
    $('#update-status').textContent = `The update could not be installed (${String(e.message || e).replace(/\.+$/, '')}). You can keep playing and try again next time.`;
    $('#update-install').disabled = false;
    $('#update-later').disabled = false;
    bar.hidden = true;
  }
};
async function checkUpdates() {
  if (!updates.available()) return;
  pendingUpdate = await updates.check();
  offerUpdate();
}

$('#welcome-skip').onclick = () => $('#dlg-welcome').close();
$('#welcome-watch').onclick = () => { $('#dlg-welcome').close(); openVideo(); };
$('#back-saved').onclick = async () => { await goHome({ focusSaved: true }); $('#saved-section').scrollIntoView(); };

const ACTIONS = {
  undo, redo, hint, check,
  clear: clearGrid, reveal,
  save: () => flushSave({ manual: true }),
  print: openPrint,
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && S && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act]();
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const typing = /^(input|select|textarea)$/i.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'radio';
  if (S && !$('#screen-play').hidden) {
    if (mod && k === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); flushSave({ manual: true }); return; }
    if (mod && k === 'p') { e.preventDefault(); openPrint(); return; }
    if (!mod && !e.altKey && !typing && settings.singleKeys) {
      if (k === 'h') { e.preventDefault(); hint(); return; }
      if (k === 'c') { e.preventDefault(); check(); return; }
    }
  }
  if (!mod && !e.altKey && !typing && e.key === '?' && settings.singleKeys) { e.preventDefault(); $('#help-btn').click(); }
  if (e.key === 'Escape' && !$('#app-menu').hidden) { toggleMenu(false); $('#menu-btn').focus(); }
});

// ====================================================================
// Install (PWA) and offline
// ====================================================================
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('[data-cmd=install]').hidden = false;
});
async function installApp() {
  if (!installEvent) return;
  installEvent.prompt();
  const choice = await installEvent.userChoice;
  if (choice.outcome === 'accepted') { $('[data-cmd=install]').hidden = true; toast('Installed. You can open the game from your Start menu, dock or home screen.'); }
  installEvent = null;
}
if ('serviceWorker' in navigator && !isDesktop && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  watchWebUpdates();
}

// Website updates: a new version installs in the background; the player is
// offered a reload on the home screen, never mid-puzzle.
async function watchWebUpdates() {
  let reg;
  try { reg = await navigator.serviceWorker.register('sw.js'); } catch (e) { return; /* offline support is optional */ }
  const waiting = () => {
    if (!reg.waiting || !navigator.serviceWorker.controller) return; // first install needs no reload
    pendingUpdate = { kind: 'web', worker: reg.waiting };
    offerUpdate();
  };
  waiting();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') waiting(); });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && webUpdateAccepted) { reloading = true; location.reload(); } });
  const check = () => reg.update().catch(() => {});
  setInterval(check, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
let webUpdateAccepted = false;

// ====================================================================
// Start
// ====================================================================
async function init() {
  if (isPreview) {
    document.documentElement.classList.add('preview');
    $$('[data-act=print]').forEach((b) => b.remove());
  }
  applyColorTheme();
  applyMode();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyColorTheme);
  renderSetup();
  await renderSaved();
  renderSuggestion();
  store.requestPersistence();
  window.addEventListener('resize', () => { if (!$('#screen-home').hidden) updatePreview(); });
  document.documentElement.classList.add('ready');
  offerIntro();
  setTimeout(checkUpdates, 4000);
  if (!isPreview) setTimeout(ensureNaturalVoices, 1500);
}
init();

// For tests and debugging.
window.__flg = { get state() { return S; }, settings: () => settings };
