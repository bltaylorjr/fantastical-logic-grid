// Logic Grid Basic: the same puzzles as The Fantastical Logic Grid, with only
// the basics. Pick a difficulty, theme and size, solve, save, print. No
// sound, voices, pictures, races, scores or badges. It reuses the game's
// engine (generation and hints in worker.js), grid (js/grid.js) and print
// layout (js/print.js); saves live in calm-store.js.
import { OPTIONS } from '../engine/options.js';
import { checkMarks, isSolved } from '../engine/play.js';
import { createGrid, puzzleIndex, esc, STATE_WORDS } from '../js/grid.js';
import { printPuzzle } from '../js/print.js';
import { sizesFor } from '../js/setup-markup.js';
import { addCloseButtons, closeDialog } from '../js/dialog-close.js';
import * as remote from '../js/remote-config.js';
import * as engine from '../js/engine-client.js';
import * as store from './calm-store.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PREVIEW = document.querySelector('meta[name="flg-mode"]')?.content === 'preview';
const TIERS = Object.fromEntries(OPTIONS.difficulties.map((d) => [d.id, d]));
const SURPRISE = 'random';
// Player Stories need the game's server, and supporter extras need the full
// game's supporter flow, so Calm offers the built-in themes only.
const themes = () => {
  const off = new Set([...remote.disabledThemes(), ...remote.premiumThemes(), 'stories']);
  return OPTIONS.themes.filter((t) => !off.has(t.id));
};

let settings = store.loadSettings();
let setup = { tier: 'easy', theme: SURPRISE, size: null, ...(store.loadSetup() || {}) };
let S = null; // the open puzzle: { save, puzzle, ix, grid, marks, hint }

// ====================================================================
// Small helpers
// ====================================================================
let liveTimer = null;
function announce(text) {
  const live = $('#live');
  live.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = text; }, 30);
}
let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function confirmDialog({ title, text, yes, no = 'Cancel' }) {
  const dlg = $('#dlg-confirm');
  $('#confirm-h').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-yes').textContent = yes;
  $('#confirm-no').textContent = no;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true }));
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`);
const sizeOf = (s) => s.split('x').map(Number);
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ====================================================================
// Settings
// ====================================================================
function applySettings() {
  const root = document.documentElement;
  if (settings.look === 'auto') delete root.dataset.theme; else root.dataset.theme = settings.look;
  root.style.setProperty('--scale', settings.text);
  const bg = getComputedStyle(root).getPropertyValue('--page').trim();
  if (bg) $('meta[name="theme-color"]').content = bg;
}
function openSettings() {
  const dlg = $('#dlg-settings');
  $(`input[name=look][value="${settings.look}"]`, dlg).checked = true;
  ($(`input[name=text][value="${settings.text}"]`, dlg) || $('input[name=text]', dlg)).checked = true;
  $('#set-autox').checked = settings.autoX;
  $('#set-instant').checked = settings.instant;
  dlg.showModal();
}
function wireSettings() {
  const dlg = $('#dlg-settings');
  dlg.addEventListener('change', () => {
    settings = {
      look: $('input[name=look]:checked', dlg).value,
      text: $('input[name=text]:checked', dlg).value,
      autoX: $('#set-autox').checked,
      instant: $('#set-instant').checked,
    };
    store.saveSettings(settings);
    applySettings();
    if (S) { if (!settings.instant) S.wrong.clear(); paintAll(); }
  });
  $('#settings-btn').onclick = openSettings;
}

// ====================================================================
// Home: setup choices and saved puzzles
// ====================================================================
function renderSetup() {
  const tier = TIERS[setup.tier] || TIERS.easy;
  setup.tier = tier.id;
  $('#tiers').innerHTML = OPTIONS.difficulties.map((d) => `<label class="choice"><input type="radio" name="tier" value="${d.id}"${d.id === tier.id ? ' checked' : ''}><span><b>${esc(d.name)}</b><small>${esc(d.summary)}</small></span></label>`).join('');

  // Every theme, in the full game's groups; "Surprise me" leads on its own.
  const list = themes();
  if (setup.theme !== SURPRISE && !list.some((t) => t.id === setup.theme)) setup.theme = SURPRISE;
  const groups = OPTIONS.themeGroups.map((g) => ({ id: g.id, name: g.name, list: g.themes.map((id) => list.find((t) => t.id === id)).filter(Boolean) })).filter((g) => g.list.length);
  const loose = list.filter((t) => !groups.some((g) => g.list.includes(t)));
  if (loose.length) groups.push({ id: 'more', name: 'More themes', list: loose });
  const chip = (t) => `<label class="choice" title="${esc(t.description || '')}"><input type="radio" name="theme" value="${t.id}"${t.id === setup.theme ? ' checked' : ''}><span>${esc(t.name)}</span></label>`;
  $('#themes').innerHTML = `<div class="choices chips">${chip({ id: SURPRISE, name: 'Surprise me', description: 'A different theme each time' })}</div>`
    + groups.map((g) => `<div class="theme-group" role="group" aria-labelledby="tg-${g.id}"><p class="theme-group-name" id="tg-${g.id}">${esc(g.name)}</p><div class="choices chips">${g.list.map(chip).join('')}</div></div>`).join('');
  renderTopics();

  const sizes = sizesFor(tier);
  if (!sizes.includes(setup.size)) setup.size = (tier.defaultSize || []).join('x');
  if (!sizes.includes(setup.size)) setup.size = sizes[0];
  $('#sizes').innerHTML = sizes.map((s) => { const [k, n] = sizeOf(s); return `<label class="choice"><input type="radio" name="size" value="${s}"${s === setup.size ? ' checked' : ''}><span><b>${k} × ${n}</b><small>${k} categories, ${n} items</small></span></label>`; }).join('');
  renderSizeAbout();
}
// Topics narrow a theme (which holiday, which kind of mystery). Surprise me has none.
function renderTopics() {
  const t = themes().find((x) => x.id === setup.theme);
  const topics = (t && t.topics) || [];
  $('#topic-set').hidden = topics.length < 2;
  if (topics.length < 2) { setup.topic = null; return; }
  if (!topics.some((x) => x.id === setup.topic)) setup.topic = t.defaultTopic || topics[0].id;
  $('#topic-legend').textContent = `${t.name} topic`;
  $('#topics').innerHTML = topics.map((x) => `<label class="choice" title="${esc(x.description || '')}"><input type="radio" name="topic" value="${x.id}"${x.id === setup.topic ? ' checked' : ''}><span>${esc(x.name)}</span></label>`).join('');
}
function renderSizeAbout() {
  const [k, n] = sizeOf(setup.size);
  const big = k >= 6 && n >= 7 ? ' Puzzles this big can take up to 20 seconds to write.' : '';
  const name = TIERS[setup.tier].name;
  $('#size-about').textContent = `${/^[AEIOU]/.test(name) ? 'An' : 'A'} ${name} puzzle with ${k} categories of ${n} items each.${big}`;
}
function wireSetup() {
  $('#tiers').addEventListener('change', (e) => { setup.tier = e.target.value; setup.size = null; renderSetup(); store.saveSetup(setup); });
  $('#themes').addEventListener('change', (e) => { setup.theme = e.target.value; setup.topic = null; renderTopics(); store.saveSetup(setup); });
  $('#topics').addEventListener('change', (e) => { setup.topic = e.target.value; store.saveSetup(setup); });
  $('#sizes').addEventListener('change', (e) => { setup.size = e.target.value; renderSizeAbout(); store.saveSetup(setup); });
  $('#start').onclick = () => startPuzzle();
}

async function renderSaved() {
  const saves = await store.listSaves();
  const open = saves.find((s) => !s.solved);
  $('#continue').hidden = !open;
  if (open) {
    $('#continue-what').textContent = `${open.puzzle.title}, ${open.puzzle.difficulty.name}, ${open.percent || 0}% marked.`;
    $('#continue-btn').onclick = () => openSave(open.id);
  }
  $('#saved-empty').hidden = saves.length > 0;
  $('#saved').innerHTML = saves.map((s) => {
    const p = s.puzzle;
    const state = s.solved ? (s.revealed ? 'Answer shown' : 'Solved') : `${Math.max(0, Math.min(100, Number(s.percent) || 0))}% marked`;
    return `<li><button class="saved-open" type="button" data-open="${esc(s.id)}"><b>${esc(p.title)}</b><small>${esc(p.theme.name)} · ${esc(p.difficulty.name)} · ${esc(state)} · ${esc(fmtDate(s.lastPlayed))}</small><span class="pbar" aria-hidden="true"><i style="width:${s.solved ? 100 : Math.max(0, Math.min(100, Number(s.percent) || 0))}%"></i></span></button>
      <button class="btn quiet small" type="button" data-del="${esc(s.id)}" aria-label="Delete ${esc(p.title)}">Delete</button></li>`;
  }).join('');
}
function wireSaved() {
  $('#saved').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) return openSave(o.dataset.open);
    const d = e.target.closest('[data-del]');
    if (!d) return;
    const s = await store.getSave(d.dataset.del);
    if (!s || !(await confirmDialog({ title: 'Delete this puzzle?', text: `"${s.puzzle.title}" and your marks will be removed from this device.`, yes: 'Delete', no: 'Keep it' }))) return;
    await store.deleteSave(s.id);
    announce('Puzzle deleted.');
    renderSaved();
  });
}

function showHome() {
  if (S) { saveNow(); S.grid.destroy(); S = null; }
  $('#play').hidden = true;
  $('#home').hidden = false;
  document.title = 'Logic Grid Basic';
  renderSaved();
  scrollTo(0, 0);
}

// ====================================================================
// A new puzzle, with a story this player has never had (in either app)
// ====================================================================
let generating = false;
async function startPuzzle() {
  if (generating) return;
  generating = true;
  const btn = $('#start');
  const err = $('#gen-error');
  btn.disabled = true;
  err.hidden = true;
  $('#gen-status').textContent = 'Writing your story…';
  try {
    const [categories, items] = sizeOf(setup.size);
    let theme = setup.theme;
    if (theme === SURPRISE) { const list = themes(); theme = list[Math.floor(Math.random() * list.length)].id; }
    const used = await store.usedStories();
    const usedSet = new Set(used);
    let puzzle = null;
    // The engine skips used stories itself; the loop is a safety net.
    for (let i = 0; i < 4 && !puzzle; i++) {
      const options = { difficulty: setup.tier, theme, categories, items, usedStories: used };
      if (setup.theme !== SURPRISE && setup.topic && setup.topic !== 'any') options.topic = setup.topic;
      const p = await engine.generate(options);
      if (!usedSet.has(storyIdOf(p))) puzzle = p;
    }
    if (!puzzle) throw new Error('Every story we tried has already been used. Try another theme.');
    await store.rememberStory(storyIdOf(puzzle));
    const now = Date.now();
    const save = { id: newId(), puzzle, marks: {}, ticked: [], undo: [], redo: [], hintsUsed: 0, solved: false, revealed: false, percent: 0, created: now, lastPlayed: now, chosenTheme: setup.theme, chosenTopic: setup.topic || null };
    await store.putSave(save);
    $('#gen-status').textContent = '';
    openPuzzle(save);
  } catch (e) {
    $('#gen-status').textContent = '';
    err.textContent = `Sorry, that puzzle could not be made. ${e.message || ''}`.trim();
    err.hidden = false;
  } finally {
    btn.disabled = false;
    generating = false;
  }
}
// Same rule as the full game: the engine's story id, or a fingerprint of the text.
function storyIdOf(puzzle) {
  if (puzzle.story && puzzle.story.id) return String(puzzle.story.id);
  let h = 2166136261;
  for (const ch of puzzle.story.paragraphs.join(' ')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `text-${(h >>> 0).toString(36)}`;
}

// ====================================================================
// Play
// ====================================================================
async function openSave(id) {
  const save = await store.getSave(id);
  if (save) openPuzzle(save);
}

function openPuzzle(save) {
  if (S) S.grid.destroy();
  const puzzle = save.puzzle;
  const ix = puzzleIndex(puzzle);
  S = { save, puzzle, ix, marks: new Map(Object.entries(save.marks || {})), wrong: new Set(), hint: null, grid: null };
  $('#home').hidden = true;
  $('#play').hidden = false;
  $('#solved').hidden = true;
  $('#hintbox').hidden = true;
  document.title = `${puzzle.title} · Logic Grid Basic`;
  $('#p-title').textContent = puzzle.title;
  $('#p-meta').textContent = `${puzzle.theme.name} · ${puzzle.difficulty.name} · ${ix.K} × ${ix.N}`;
  $('#story-text').innerHTML = puzzle.story.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  $('#story').open = !save.marks || !Object.keys(save.marks).length;
  const ticked = new Set(save.ticked || []);
  $('#clue-list').innerHTML = puzzle.clues.map((c) => `<li><label class="clue"><input type="checkbox" value="${c.number}"${ticked.has(c.number) ? ' checked' : ''}><span>${esc(c.text)}</span></label></li>`).join('');
  $('#question-list').innerHTML = puzzle.questions.map((q) => `<li>${esc(q.text)}</li>`).join('');
  S.grid = createGrid($('#gridframe'), puzzle, ix, {
    onCycle: (k) => { const v = S.marks.get(k) || ''; setCell(k, v === '' ? 'X' : v === 'X' || v === 'A' ? 'O' : ''); },
    onMark: (k, v) => setCell(k, v),
    onDescribeRow: describeRow,
    onFocus: () => {},
  });
  paintAll();
  updateButtons();
  if (save.solved) showSolved(false);
  scrollTo(0, 0);
  $('#p-title').focus?.();
}

function paintCell(k) {
  S.grid.paint(k, S.marks.get(k) || '', { wrong: S.wrong.has(k), target: !!(S.hint && S.hint.level >= 1 && S.hint.targets.has(k)) });
}
function paintAll() { for (const k of S.grid.cells.keys()) paintCell(k); }

// Cells in the same section row and column as k (for the automatic Xs).
function lineMates(k) {
  const [a, b] = k.split('|');
  const ca = S.ix.byId[a.split(':')[0]], cb = S.ix.byId[b.split(':')[0]];
  return [...cb.items.filter((it) => it.id !== b).map((it) => S.ix.key(a, it.id)), ...ca.items.filter((it) => it.id !== a).map((it) => S.ix.key(it.id, b))];
}
const hasO = (k, except) => lineMates(k).some((m) => m !== except && S.marks.get(m) === 'O');

// One change = one undo step: [{ k, b: before, a: after }].
function setCell(k, v) {
  if (!S || S.save.revealed) return;
  const before = S.marks.get(k) || '';
  if (before === v) return;
  const changes = [{ k, b: before, a: v }];
  if (v === 'O' && settings.autoX) {
    for (const m of lineMates(k)) if (!S.marks.get(m)) changes.push({ k: m, b: '', a: 'A' });
  }
  // Taking away an O also takes away the automatic Xs that only it explained.
  if (before === 'O') {
    for (const m of lineMates(k)) if (S.marks.get(m) === 'A' && !hasO(m, k)) changes.push({ k: m, b: 'A', a: '' });
  }
  commit(changes);
  const [a, b] = k.split('|');
  let wrong = false;
  if (v && settings.instant && checkMarks(S.puzzle, [{ a, b, mark: v === 'O' ? 'O' : 'X' }]).length) { S.wrong.add(k); paintCell(k); wrong = true; }
  const auto = changes.length - 1;
  announce(`${S.ix.label(a)}, ${S.ix.label(b)}, ${STATE_WORDS[v]}${wrong ? ', does not fit' : ''}${auto && v === 'O' ? `. Also ruled out ${auto} other square${auto > 1 ? 's' : ''}` : ''}.`);
}

function apply(changes, dir) {
  for (const c of changes) {
    const v = dir > 0 ? c.a : c.b;
    if (v) S.marks.set(c.k, v); else S.marks.delete(c.k);
    S.wrong.delete(c.k);
    paintCell(c.k);
  }
}
function commit(changes) {
  apply(changes, 1);
  S.save.undo.push(changes);
  if (S.save.undo.length > 5000) S.save.undo.shift();
  S.save.redo = [];
  afterChange();
}
function afterChange() {
  clearHint();
  updateButtons();
  updateProgress();
  scheduleSave();
  checkSolved();
}
function undo() {
  const c = S.save.undo.pop();
  if (!c) return;
  apply([...c].reverse(), -1);
  S.save.redo.push(c);
  announce('Undone.');
  afterChange();
}
function redo() {
  const c = S.save.redo.pop();
  if (!c) return;
  apply(c, 1);
  S.save.undo.push(c);
  announce('Redone.');
  afterChange();
}
function updateButtons() {
  $('[data-act=undo]').disabled = !S.save.undo.length;
  $('[data-act=redo]').disabled = !S.save.redo.length;
  const done = S.save.solved || S.save.revealed;
  $('[data-act=hint]').disabled = done;
  $('[data-act=check]').disabled = done;
}
function updateProgress() {
  const { K, N } = S.ix;
  S.save.percent = Math.round((S.marks.size / ((K * (K - 1) / 2) * N * N)) * 100);
}
function markList() {
  return [...S.marks].map(([k, v]) => { const [a, b] = k.split('|'); return { a, b, mark: v === 'O' ? 'O' : 'X' }; });
}

function describeRow(rowItem) {
  const parts = [];
  const rowCat = rowItem.split(':')[0];
  for (const c of S.ix.cats) {
    if (c.id === rowCat) continue;
    const states = c.items.map((it) => ({ it, s: S.marks.get(S.ix.key(rowItem, it.id)) || '' }));
    const o = states.find((x) => x.s === 'O');
    const out = states.filter((x) => x.s && x.s !== 'O').map((x) => x.it.label);
    parts.push(o ? `${c.name}: ${o.it.label}` : `${c.name}: ${out.length ? `${out.join(', ')} ruled out` : 'nothing marked'}`);
  }
  announce(`${S.ix.label(rowItem)}. ${parts.join('. ')}.`);
}

// Saving: within a second of each change, and when the page is hidden.
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 800); }
function saveNow() {
  clearTimeout(saveTimer);
  if (!S) return;
  S.save.marks = Object.fromEntries(S.marks);
  S.save.ticked = $$('#clue-list input:checked').map((i) => Number(i.value));
  S.save.lastPlayed = Date.now();
  store.putSave(S.save).catch(() => toast('Your progress could not be saved on this device.'));
}

// ---- Hints: what to look at, then which square, then why ----
let hintBusy = false;
async function hint() {
  if (!S || hintBusy || S.save.solved) return;
  if (S.hint && S.hint.level < 2) S.hint.level++;
  else if (!S.hint) {
    hintBusy = true;
    announce('Finding a hint…');
    try {
      const res = await engine.hint(S.puzzle, markList());
      if (!S) return;
      S.hint = { res, level: 0, targets: new Set((res.marks || []).slice(0, 1).map((m) => S.ix.key(m.a, m.b))) };
    } catch (e) {
      toast('No hint right now. Try again in a moment.');
      return;
    } finally { hintBusy = false; }
  }
  S.save.hintsUsed = (S.save.hintsUsed || 0) + 1;
  renderHint();
  scheduleSave();
}
function renderHint() {
  const { res, level } = S.hint;
  const box = $('#hintbox');
  const clue = res.clue ? S.puzzle.clues.find((c) => c.number === res.clue) : null;
  const lines = res.levels.slice(0, level + 1).map((t, i) => `<p>${esc(t)}${i === 0 && clue ? ` <q>${esc(clue.text)}</q>` : ''}</p>`).join('');
  const more = level < 2 && res.kind !== 'done' ? `<button class="btn small" type="button" id="hint-more">${level === 0 ? 'Which square?' : 'Why?'}</button>` : '';
  box.innerHTML = `<h3>Hint</h3>${lines}<div class="row">${more}<button class="btn quiet small" type="button" id="hint-close">Close</button></div>`;
  box.hidden = false;
  $$('#clue-list li.hinted').forEach((li) => li.classList.remove('hinted'));
  if (clue) $(`#clue-list input[value="${clue.number}"]`)?.closest('li').classList.add('hinted');
  for (const k of S.hint.targets) paintCell(k);
  announce(res.levels[level]);
  $('#hint-more')?.addEventListener('click', hint);
  $('#hint-close').onclick = () => { clearHint(); S.grid.focusKey(S.grid.focusedKey()); };
}
function clearHint() {
  if (!S || !S.hint) return;
  const t = S.hint.targets;
  S.hint = null;
  for (const k of t) paintCell(k);
  $('#hintbox').hidden = true;
  $$('#clue-list li.hinted').forEach((li) => li.classList.remove('hinted'));
}

function check() {
  const bad = checkMarks(S.puzzle, markList());
  for (const m of bad) S.wrong.add(S.ix.key(m.a, m.b));
  paintAll();
  const text = bad.length ? `${bad.length} mark${bad.length > 1 ? 's don’t' : ' doesn’t'} fit. ${bad.length > 1 ? 'They have' : 'It has'} a red outline.` : S.marks.size ? 'Everything fits so far.' : 'Nothing marked yet.';
  toast(text);
  announce(text);
}

async function restart() {
  if (!(await confirmDialog({ title: 'Start this puzzle over?', text: 'Every mark and ticked clue is cleared. The story and clues stay the same.', yes: 'Start over', no: 'Keep my marks' }))) return;
  S.marks.clear();
  S.wrong.clear();
  S.save.undo = [];
  S.save.redo = [];
  S.save.solved = false;
  S.save.revealed = false;
  $$('#clue-list input').forEach((i) => { i.checked = false; });
  $('#solved').hidden = true;
  clearHint();
  paintAll();
  updateButtons();
  updateProgress();
  saveNow();
  announce('Started over.');
}

function openPrint() {
  const dlg = $('#dlg-print');
  $('#print-note').hidden = !PREVIEW;
  $('#print-go').disabled = PREVIEW;
  $('#print-marks').checked = S.marks.size > 0;
  $('#print-key').checked = false;
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'print' || !S) return;
    printPuzzle(S.puzzle, { withMarks: $('#print-marks').checked, answerKey: $('#print-key').checked, paper: $('input[name=paper]:checked', dlg).value, marks: S.marks });
  }, { once: true });
}

// ---- Finished ----
function checkSolved() {
  const solved = isSolved(S.puzzle, markList());
  if (solved && !S.save.solved) {
    S.save.solved = true;
    S.save.completedAt = Date.now();
    saveNow();
    showSolved(true);
  } else if (!solved && S.save.solved && !S.save.revealed) {
    S.save.solved = false;
    $('#solved').hidden = true;
  }
  updateButtons();
}
function showSolved(moveFocus) {
  $('#solved-h').textContent = S.save.revealed ? 'The answer' : 'All done. Nicely solved.';
  $('#ending').textContent = S.puzzle.story.ending || '';
  $('#answers').innerHTML = S.puzzle.answerKey.questions.map((q) => `<li>${esc(q.question)} <b>${esc(q.answer)}</b></li>`).join('');
  $('#solved').hidden = false;
  if (moveFocus) { $('#solved').focus(); $('#solved').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  announce(`${$('#solved-h').textContent} ${$('#ending').textContent}`);
}

function wirePlay() {
  $('#play').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !S) return;
    const act = b.dataset.act;
    if (act === 'home') showHome();
    else if (act === 'undo') undo();
    else if (act === 'redo') redo();
    else if (act === 'hint') hint();
    else if (act === 'check') check();
    else if (act === 'print') openPrint();
    else if (act === 'restart') restart();
  });
  $('#clue-list').addEventListener('change', scheduleSave);
  $('#again').onclick = () => {
    const p = S.puzzle;
    setup = { tier: p.difficulty.id, theme: S.save.chosenTheme || p.theme.id, topic: S.save.chosenTopic || null, size: `${S.ix.K}x${S.ix.N}` };
    store.saveSetup(setup);
    showHome();
    renderSetup();
    startPuzzle();
  };
  // Ctrl+Z / Ctrl+Y anywhere on the play screen.
  document.addEventListener('keydown', (e) => {
    if (!S || $('#play').hidden || document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
  });
  addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
}

// ====================================================================
// Start
// ====================================================================
function wireDialogs() {
  addCloseButtons();
  document.addEventListener('click', (e) => { const x = e.target.closest('.dlg-x'); if (x) closeDialog(x.closest('dialog')); });
}

// Works offline once visited, using the full game's service worker (one
// cache for both apps). A new version waits until the player is on the
// home screen, then a small note offers to reload.
function registerWorker() {
  if (PREVIEW || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('../sw.js').then((reg) => {
    const offer = (w) => {
      if (!w || !navigator.serviceWorker.controller) return;
      const t = $('#toast');
      t.innerHTML = 'A new version is ready. <button class="btn small" type="button" id="reload">Reload</button>';
      t.hidden = false;
      $('#reload').onclick = () => { if (S) saveNow(); asked = true; w.postMessage({ type: 'skip-waiting' }); };
    };
    // Reload only after the player chose Reload. A first install also takes
    // control of the page, and that must not interrupt anything.
    let asked = false;
    offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); }); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (asked) { asked = false; location.reload(); } });
  }).catch(() => {});
}

// The claude.ai preview frame cannot print, so the button is left out there.
if (PREVIEW) $('[data-act=print]').hidden = true;
applySettings();
wireSettings();
wireDialogs();
renderSetup();
wireSetup();
wireSaved();
wirePlay();
renderSaved();
registerWorker();
// For the end-to-end test.
window.__calm = { get state() { return S; } };
