// Number Place: its own game screen, with the Logic Grid's look, for the numbers game.
// Self-contained so it can drop into The Fantastical Logic Grid app or run on
// its own test page:
//
//   import { mount } from './ui.js';
//   mount(document.querySelector('#np'), { engine, storagePrefix, onPlay, shared });
//
// host options
//   engine         { generate(options), hint(puzzle, entries), themes? } returning promises
//   storagePrefix  localStorage key prefix (default 'flg.np')
//   onPlay(rec)    called with each anonymous play record (and again when it is rated):
//                  the one thing Number Place shares, for the learning service
//   shared         what every player's games taught ({ toughness: { level: 0..1 } }), optional
//   celebrate()    the host's solve effect, optional
//   canPrint, canDownload   false where the host frame can't print or save files
import { markup } from './markup.js';
import { createLearning, summary, PAR_MS } from './learning.js';
import { sounds } from './sound.js';
import { printableHtml, printHtml } from './print.js';
import { resultPicture } from './picture.js';

let root = null;
const $ = (s) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let K = {};
let engine = null;
let learn = null;

export const NP_LEVELS = [
  { id: 'basic', name: 'Basic', note: 'A gentle start', sizes: [4, 6] },
  { id: 'easy', name: 'Easy', note: 'Only singles needed', sizes: [6, 9] },
  { id: 'medium', name: 'Medium', note: 'Line and box overlaps', sizes: [9, 6] },
  { id: 'hard', name: 'Hard', note: 'Pairs and hidden pairs', sizes: [9] },
  { id: 'expert', name: 'Expert', note: 'Rectangles and bent triples', sizes: [9] },
  { id: 'master', name: 'Master', note: 'The hardest patterns, more than once', sizes: [9] },
];
const VARIANTS = [
  { id: 'diagonal', name: 'Diagonals', note: 'Both long diagonals hold every number once' },
  { id: 'parity', name: 'Odd and even', note: 'Shaded cells are even, the rest are odd' },
];
const COACH = [
  'Tap a cell, then a number. On a keyboard, use the arrow keys and type the number.',
  'Not sure yet? Switch on Notes (or hold Shift) to pencil in the numbers a cell could be. Fill notes does it for every cell at once.',
  'Stuck? Hint starts with a nudge. Ask again to see where to look, then why it works.',
  'Each puzzle has exactly one answer, and you never need to guess. Every hint can explain itself.',
];
// The daily puzzle walks up the week: Monday Easy to Sunday Master.
const DAILY_BY_WEEKDAY = ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'];

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };

let G = null; // the game in progress
let deps = {};
let prefs = {};
let lastRecord = null;
let deleted = null; // { game, timer } for undo

const todayUtc = () => new Date().toISOString().slice(0, 10);
export function dailyOptions(date = todayUtc()) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { difficulty: DAILY_BY_WEEKDAY[day], seed: `daily-${date}`, variants: [] };
}

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const levelName = (id) => NP_LEVELS.find((l) => l.id === id)?.name || id;
const rowOf = (c) => Math.floor(c / G.p.size), colOf = (c) => c % G.p.size;
const boxOf = (c) => { const [br, bc] = G.p.box; return Math.floor(rowOf(c) / br) * (G.p.size / bc) + Math.floor(colOf(c) / bc); };
const onMain = (c) => rowOf(c) === colOf(c), onAnti = (c) => rowOf(c) + colOf(c) === G.p.size - 1;
const sees = (a, b) => a !== b && (rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b)
  || (G.p.variants.includes('diagonal') && ((onMain(a) && onMain(b)) || (onAnti(a) && onAnti(b)))));
const valueAt = (c) => G.p.givens[c] || G.v[c];
const bit = (d) => 1 << (d - 1);
const quiet = () => !!prefs.silent;
const play = (name) => { if (prefs.sound && !quiet()) { try { sounds[name](); } catch (e) { /* no audio */ } } };

// ---------- mount ----------

export function mount(container, host) {
  if (root) unmount();
  root = container;
  deps = host || {};
  engine = deps.engine;
  const pre = deps.storagePrefix || 'flg.np';
  K = { games: `${pre}.games`, cur: `${pre}.cur`, prefs: `${pre}.prefs`, learn: `${pre}.learn`, old: `${pre}.current` };
  prefs = { notes: false, showMistakes: false, autoClean: true, highlight: true, silent: false, sound: true, adapt: true, theme: '', level: null, size: null, variants: [], coachDone: false, ...load(K.prefs, {}) };
  learn = createLearning({ load, keep, key: K.learn });
  if (deps.shared) learn.setShared(deps.shared);
  migrate();
  root.classList.add('np-app');
  root.innerHTML = markup;
  buildSetup();
  wire();
  showView('setup');
}

export function unmount() {
  close();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', onLeave);
  if (root) root.innerHTML = '';
  root = null; G = null;
}

// What every player's games taught, when the host fetches it later.
export function setShared(shared) { learn?.setShared(shared); }

// A puzzle everyone plays (a race or a shared challenge): never filtered as "seen".
export function startShared(puzzle, { mode = 'race' } = {}) { begin(puzzle, { mode }); }

// Games saved by the first version of this module.
function migrate() {
  const old = load(K.old, null);
  if (old && old.p) {
    const games = load(K.games, {});
    const id = old.id || `g${Date.now()}`;
    games[id] = { ...old, id, name: old.name || old.p.story?.title || `${old.p.difficulty.name} puzzle`, updated: Date.now(), mode: old.daily ? 'daily' : 'free' };
    keep(K.games, games);
    try { localStorage.removeItem(K.old); } catch (e) { /* ignore */ }
  }
}

function savePrefs() { keep(K.prefs, prefs); }

function showView(name) {
  $('#np-setup-view').hidden = name !== 'setup';
  $('#np-play-view').hidden = name !== 'play';
  root.classList.toggle('np-silent', quiet());
  if (name === 'setup') { close(); renderSetup(); }
  deps.onView?.(name);
}

// ---------- setup ----------

function buildSetup() {
  const level = prefs.level || learn.suggestLevel();
  $('#np-levels').innerHTML = NP_LEVELS.map((l) => `<label class="choice"><input type="radio" name="np-level" value="${l.id}"${l.id === level ? ' checked' : ''}><span><b>${l.name}</b><small>${l.note}</small></span></label>`).join('');
  $('#np-variants').innerHTML = VARIANTS.map((v) => `<label class="choice"><input type="checkbox" name="np-variant" value="${v.id}"${prefs.variants.includes(v.id) ? ' checked' : ''}><span><b>${v.name}</b><small>${v.note}</small></span></label>`).join('');
  const themes = engine.themes || [];
  $('#np-theme').innerHTML = `<option value="">Any, a surprise each time</option>${themes.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}`;
  $('#np-theme').value = prefs.theme || '';
  $('#np-theme').closest('.np-field').hidden = !themes.length;
  for (const [id, key] of [['#np-silent', 'silent'], ['#np-sound', 'sound'], ['#np-adapt', 'adapt'], ['#np-autoclean', 'autoClean'], ['#np-highlight', 'highlight']]) {
    $(id).checked = !!prefs[key];
    $(id).onchange = (e) => { prefs[key] = e.target.checked; savePrefs(); root.classList.toggle('np-silent', quiet()); renderSetup(); };
  }
  $('#np-theme').onchange = (e) => { prefs.theme = e.target.value; savePrefs(); };
  renderSizes();
  if (deps.canDownload === false) $('#np-save-file').hidden = true;
  if (deps.canPrint === false) $('#np-print').hidden = true;
}

function renderSizes() {
  const level = NP_LEVELS.find((l) => l.id === $('input[name=np-level]:checked').value);
  const size = level.sizes.includes(prefs.size) ? prefs.size : level.sizes[0];
  $('#np-sizes').innerHTML = level.sizes.map((n) => `<label class="choice"><input type="radio" name="np-size" value="${n}"${n === size ? ' checked' : ''}><span><b>${n}×${n}</b></span></label>`).join('');
  $('#np-size-field').hidden = level.sizes.length < 2;
  $('#np-variants').closest('fieldset').hidden = size === 4;
}

function readSetup() {
  const difficulty = $('input[name=np-level]:checked').value;
  const size = Number($('input[name=np-size]:checked')?.value) || NP_LEVELS.find((l) => l.id === difficulty).sizes[0];
  const variants = size === 4 ? [] : [...root.querySelectorAll('input[name=np-variant]:checked')].map((i) => i.value);
  prefs.level = difficulty; prefs.size = size; prefs.variants = variants;
  savePrefs();
  return { difficulty, size, variants };
}

const games = () => load(K.games, {});
function putGame(g) { const all = games(); all[g.id] = g; trimGames(all); keep(K.games, all); }
function trimGames(all) {
  const ids = Object.keys(all).sort((a, b) => (all[b].updated || 0) - (all[a].updated || 0));
  for (const id of ids.slice(60)) delete all[id];
}

export function renderSetup() {
  const all = Object.values(games()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const curId = load(K.cur, null);
  const cur = all.find((g) => g.id === curId && !g.solved) || all.find((g) => !g.solved);
  $('#np-continue').hidden = !cur;
  if (cur) { $('#np-continue').dataset.id = cur.id; $('#np-continue-name').textContent = `${cur.name}, ${fmtTime(cur.ms)}`; }

  const d = dailyOptions();
  const sum = summary(learn.plays());
  const doneToday = learn.plays().some((r) => r.daily === todayUtc() && r.outcome === 'solved');
  $('#np-daily-note').textContent = `${doneToday ? 'You solved today\'s puzzle. ' : ''}Today's puzzle is ${levelName(d.difficulty)}.${sum.streak ? ` Streak: ${sum.streak} day${sum.streak === 1 ? '' : 's'}.` : ''}`;

  const suggested = learn.suggestLevel();
  const chosen = $('input[name=np-level]:checked')?.value;
  const sBtn = $('#np-suggest');
  sBtn.hidden = !prefs.adapt || !learn.plays().length || suggested === chosen;
  sBtn.textContent = `Suggested for you: ${levelName(suggested)}`;
  sBtn.dataset.level = suggested;

  const t = learn.toughness(chosen);
  const weak = learn.weakTechnique();
  $('#np-tuning-note').textContent = prefs.adapt && learn.plays().some((r) => r.d === chosen)
    ? `Tuned to you: ${t > 0.62 ? 'a little tougher' : t < 0.38 ? 'a little gentler' : 'right in the middle'} inside ${levelName(chosen)}.${weak ? ' Some puzzles will practice a technique you have asked for help with.' : ''}`
    : '';

  // Saved puzzles
  const list = $('#np-saved');
  $('#np-saved-empty').hidden = all.length > 0;
  list.innerHTML = all.slice(0, 30).map((g) => {
    const status = g.revealed ? 'Answer shown' : g.solved ? `Solved in ${fmtTime(g.ms)}` : `${fmtTime(g.ms)} so far`;
    return `<li data-id="${esc(g.id)}"><button class="np-saved-open" type="button"><b class="np-saved-name">${esc(g.name)}</b><small>${esc(levelName(g.p.difficulty.id))} · ${g.p.size}×${g.p.size}${g.mode === 'daily' ? ` · Daily ${esc(g.daily)}` : ''} · ${status}</small></button>
      <span class="np-saved-tools"><button class="btn quiet small" type="button" data-act="rename" aria-label="Rename ${esc(g.name)}">Rename</button><button class="btn quiet small" type="button" data-act="delete" aria-label="Delete ${esc(g.name)}">Delete</button></span></li>`;
  }).join('');

  // Stats and badges
  const rows = sum.byLevel.filter((l) => l.solved);
  $('#np-stats').innerHTML = rows.length
    ? `<div class="np-table-wrap"><table><thead><tr><th scope="col">Level</th><th scope="col">Solved</th><th scope="col">Best, no hints</th><th scope="col">Average</th></tr></thead><tbody>${rows.map((l) => `<tr><th scope="row">${levelName(l.id)}</th><td>${l.solved}</td><td>${l.best ? fmtTime(l.best) : '–'}</td><td>${fmtTime(l.average)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="np-muted">Solve a puzzle to see your times here.</p>';
  const earned = sum.badges.filter((b) => b.earned).length;
  const badge = (b) => `<li class="np-badge${b.earned ? ' earned' : ''}"><b>${esc(b.name)}</b><small>${esc(b.note)}</small></li>`;
  const got = sum.badges.filter((b) => b.earned), todo = sum.badges.filter((b) => !b.earned);
  $('#np-badges').innerHTML = `<li class="np-badge-count">${earned} of ${sum.badges.length} badges</li>${got.map(badge).join('')}${todo.length ? `<li class="np-badge-more"><details><summary>${got.length ? 'Badges still to earn' : 'Badges to earn'}</summary><ul class="np-badges">${todo.map(badge).join('')}</ul></details></li>` : ''}`;
}

// ---------- start, resume, save ----------

async function startNew(opts, { mode = 'free' } = {}) {
  const status = $('#np-status');
  status.textContent = 'Building a puzzle just for you, with exactly one answer…';
  $('#np-gen').disabled = true;
  try {
    const tuned = mode === 'free' ? learn.optionsFor(opts.difficulty) : {};
    if (mode === 'free' && !prefs.adapt) { tuned.toughness = 0.5; tuned.practice = null; }
    const p = await engine.generate({ seed: Math.random().toString(36).slice(2), theme: prefs.theme || null, ...tuned, ...opts });
    status.textContent = '';
    begin(p, { mode, daily: opts.daily || null, practice: tuned.practice || null });
  } catch (e) {
    status.textContent = `Could not build that puzzle: ${e.message}`;
  } finally {
    $('#np-gen').disabled = false;
  }
}

function begin(p, { mode = 'free', daily = null, practice = null } = {}) {
  close();
  G = {
    id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, p, mode, daily, practice,
    name: uniqueName(p.story?.title || `${levelName(p.difficulty.id)} puzzle`),
    v: Array(p.size ** 2).fill(0), n: Array(p.size ** 2).fill(0), undo: [], redo: [],
    ms: 0, hints: 0, mistakes: 0, checks: 0, stuck: [], solved: false, revealed: false,
    created: Date.now(), updated: Date.now(), sel: p.givens.findIndex((d) => !d),
  };
  learn.started(p);
  open();
}

// "Morning Rush", then "Morning Rush 2", so saved puzzles are easy to tell apart.
function uniqueName(base) {
  const names = new Set(Object.values(games()).map((g) => g.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

async function startDaily() {
  const date = todayUtc();
  const existing = Object.values(games()).find((g) => g.mode === 'daily' && g.daily === date);
  if (existing) { resume(existing.id); return; }
  // Everyone gets the same daily puzzle and story, so nothing is filtered out.
  await startNew({ ...dailyOptions(date), daily: date, usedStories: [], theme: null }, { mode: 'daily' });
}

function resume(id) {
  const g = games()[id];
  if (!g) return;
  G = { stuck: [], checks: 0, ...g, undo: g.undo || [], redo: g.redo || [] };
  open();
}

function save() {
  if (!G) return;
  G.updated = Date.now();
  // History is capped so a long game still fits in storage.
  const { hint, checked, wrongShown, paused, ...rest } = G;
  putGame({ ...rest, undo: G.undo.slice(-400), redo: G.redo.slice(-400) });
  keep(K.cur, G.id);
}

// ---------- play screen ----------

let timer = null, lastTick = 0;
function startTimer() {
  stopTimer();
  if (G.solved) return;
  lastTick = performance.now();
  timer = setInterval(tick, 500);
}
function tick() {
  const now = performance.now();
  if (!G || !root) return;
  if (G.paused || document.hidden || G.solved) { lastTick = now; return; }
  G.ms += now - lastTick; lastTick = now;
  $('#np-time').textContent = fmtTime(G.ms);
}
function stopTimer() { if (timer) clearInterval(timer); timer = null; }

function open() {
  showView('play');
  G.paused = false;
  G.hint = null;
  const p = G.p;
  $('#np-kicker').textContent = `Number Place · ${p.difficulty.name} · ${p.size}×${p.size}${G.daily ? ` · Daily ${G.daily}` : ''}${G.practice ? ' · Practice' : ''}`;
  $('#np-title').textContent = quiet() || !p.story ? `${p.difficulty.name} puzzle` : p.story.title;
  $('#np-story').textContent = quiet() || !p.story ? '' : p.story.intro;
  $('#np-story').hidden = quiet() || !p.story;
  if (p.story?.theme?.world) deps.setWorld?.(p.story.theme.world);
  $('#np-rules').innerHTML = p.rules.map((r) => `<li>${esc(r)}</li>`).join('');
  $('#np-solved').hidden = true;
  $('#np-share-box').hidden = true;
  $('#np-reveal-confirm').hidden = true;
  buildBoard();
  buildPad();
  render();
  if (G.solved) showSolved({ fresh: false });
  startTimer();
  save();
  coach();
  setTimeout(() => focusCell(G.sel >= 0 ? G.sel : 0), 0);
}

function close() { if (G && root) { tick(); save(); } stopTimer(); }

function coach(step) {
  const box = $('#np-coach');
  if (prefs.coachDone || quiet() || G.solved) { box.hidden = true; return; }
  const i = step ?? 0;
  box.hidden = false;
  box.dataset.i = i;
  $('#np-coach-n').textContent = `${i + 1} of ${COACH.length}`;
  $('#np-coach-text').textContent = COACH[i];
  $('#np-coach-next').hidden = i >= COACH.length - 1;
}

function buildBoard() {
  const N = G.p.size, [br, bc] = G.p.box;
  const board = $('#np-board');
  board.style.setProperty('--n', N);
  board.className = `np-board${G.p.variants.includes('diagonal') ? ' diag' : ''}`;
  board.setAttribute('aria-rowcount', N);
  board.setAttribute('aria-colcount', N);
  board.innerHTML = boardHtml(G.p, N, br, bc, true);
}

function boardHtml(p, N, br, bc, interactive) {
  let html = '';
  for (let r = 0; r < N; r++) {
    html += `<div${interactive ? ' role="row"' : ''} class="np-row">`;
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const cls = ['np-cell'];
      if (r % br === 0) cls.push('bt');
      if (c % bc === 0) cls.push('bl');
      if (r === N - 1) cls.push('bb');
      if (c === N - 1) cls.push('br');
      if (p.givens[i]) cls.push('given');
      if (p.evenCells.includes(i)) cls.push('even');
      html += interactive
        ? `<div role="gridcell" class="${cls.join(' ')}" data-i="${i}" tabindex="-1" aria-rowindex="${r + 1}" aria-colindex="${c + 1}" style="--d:${r + c}"></div>`
        : `<div class="${cls.join(' ')}" data-i="${i}"></div>`;
    }
    html += '</div>';
  }
  return html;
}

function buildPad() {
  const N = G.p.size;
  $('#np-digits').style.setProperty('--cols', N);
  $('#np-digits').dataset.cols = N;
  $('#np-digits').innerHTML = [...Array(N)].map((_, k) => `<button type="button" class="np-digit" data-d="${k + 1}" aria-keyshortcuts="${k + 1}"><span class="d">${k + 1}</span><small class="left"></small></button>`).join('');
}

const cellLabel = (i) => {
  const d = valueAt(i);
  const notes = [...Array(G.p.size)].map((_, k) => k + 1).filter((k) => G.n[i] & bit(k));
  const where = `Row ${rowOf(i) + 1}, column ${colOf(i) + 1}`;
  const shade = G.p.evenCells.includes(i) ? ', shaded, even' : G.p.variants.includes('parity') ? ', odd' : '';
  if (G.p.givens[i]) return `${where}${shade}, given ${d}`;
  if (d) return `${where}${shade}, ${d}${G.wrongShown?.has(i) ? ', wrong' : ''}`;
  return `${where}${shade}, empty${notes.length ? `, notes ${notes.join(' ')}` : ''}`;
};

function clashes() {
  // Two equal numbers that see each other: shown always, since the rules alone say it's wrong.
  const out = new Set();
  const N2 = G.p.size ** 2;
  for (let a = 0; a < N2; a++) {
    if (!valueAt(a)) continue;
    for (let b = a + 1; b < N2; b++) if (valueAt(a) === valueAt(b) && sees(a, b)) { out.add(a); out.add(b); }
  }
  return out;
}

function render() {
  const N = G.p.size, sel = G.sel;
  const selV = sel >= 0 ? valueAt(sel) : 0;
  const clash = clashes();
  G.wrongShown = prefs.showMistakes ? new Set(G.v.map((d, i) => (d && d !== G.p.solution[i] ? i : -1)).filter((i) => i >= 0)) : (G.checked || new Set());
  const hintCells = new Set(G.hint?.show && G.hint.cell != null ? [G.hint.cell] : []);
  for (const el of $('#np-board').querySelectorAll('.np-cell')) {
    const i = Number(el.dataset.i), d = valueAt(i);
    el.classList.toggle('sel', i === sel);
    el.classList.toggle('peer', prefs.highlight && sel >= 0 && i !== sel && sees(i, sel));
    el.classList.toggle('same', prefs.highlight && !!selV && d === selV && i !== sel);
    el.classList.toggle('clash', clash.has(i) && !G.p.givens[i]);
    el.classList.toggle('clash-given', clash.has(i) && !!G.p.givens[i]);
    el.classList.toggle('wrong', G.wrongShown.has(i));
    el.classList.toggle('hinted', hintCells.has(i));
    if (d) el.innerHTML = `<span class="v">${d}</span>`;
    else if (G.n[i]) el.innerHTML = `<span class="np-notes" style="--nc:${G.p.box[1]}">${[...Array(N)].map((_, k) => `<i>${G.n[i] & bit(k + 1) ? k + 1 : ''}</i>`).join('')}</span>`;
    else el.innerHTML = '';
    el.setAttribute('aria-label', cellLabel(i));
    el.setAttribute('aria-selected', String(i === sel));
    el.tabIndex = i === sel ? 0 : -1;
  }
  // Numbers left to place; finished ones dim.
  for (const b of $('#np-digits').children) {
    const d = Number(b.dataset.d);
    const left = N - G.p.solution.reduce((n, _, i) => n + (valueAt(i) === d ? 1 : 0), 0);
    b.querySelector('.left').textContent = left > 0 ? String(left) : '';
    b.classList.toggle('done', left <= 0);
    b.setAttribute('aria-label', `${prefs.notes ? 'Note' : 'Place'} ${d}, ${left > 0 ? `${left} left` : 'all placed'}`);
  }
  $('#np-notes-btn').setAttribute('aria-pressed', String(prefs.notes));
  $('#np-notes-btn .state').textContent = prefs.notes ? 'On' : 'Off';
  $('#np-undo').disabled = !G.undo.length || G.solved;
  $('#np-redo').disabled = !G.redo.length || G.solved;
  for (const id of ['#np-erase', '#np-auto', '#np-hint-btn', '#np-check', '#np-reveal', '#np-pause']) $(id).disabled = G.solved;
  $('#np-mistakes').checked = prefs.showMistakes;
  $('#np-board').classList.toggle('paused', !!G.paused);
  $('#np-pause').textContent = G.paused ? 'Resume' : 'Pause';
  $('#np-time').textContent = fmtTime(G.ms);
  $('#np-progress').textContent = `${G.p.givens.filter((d, i) => d || G.v[i]).length} of ${N * N} filled`;
  renderHint();
}

// Each change is a list of [cell, oldValue, oldNotes, newValue, newNotes] so undo and redo are exact.
function apply(changes, { record = true } = {}) {
  const real = changes.filter(([, ov, on, nv, nn]) => ov !== nv || on !== nn);
  if (!real.length) return;
  for (const [i, , , nv, nn] of real) { G.v[i] = nv; G.n[i] = nn; }
  if (record) { G.undo.push(real); G.redo = []; }
  G.checked = null;
  G.hint = null;
  afterChange();
}

function afterChange() {
  render();
  save();
  if (!G.solved && G.p.solution.every((d, i) => valueAt(i) === d)) solved();
}

// Rows, columns and boxes (and diagonals) a cell belongs to, as cell lists.
function unitsOf(i) {
  const N = G.p.size, all = [...Array(N * N).keys()];
  const units = [all.filter((c) => rowOf(c) === rowOf(i)), all.filter((c) => colOf(c) === colOf(i)), all.filter((c) => boxOf(c) === boxOf(i))];
  if (G.p.variants.includes('diagonal')) {
    if (onMain(i)) units.push(all.filter(onMain));
    if (onAnti(i)) units.push(all.filter(onAnti));
  }
  return units;
}

function place(d) {
  const i = G.sel;
  if (i < 0 || G.p.givens[i] || G.solved || G.paused) return;
  if (prefs.notes && d) { toggleNote(i, d); return; }
  const nv = G.v[i] === d ? 0 : d;
  const changes = [[i, G.v[i], G.n[i], nv, nv ? 0 : G.n[i]]];
  if (nv && prefs.autoClean) {
    // Placing a number crosses it off the notes of every cell that sees it.
    for (let j = 0; j < G.p.size ** 2; j++) if (j !== i && sees(i, j) && G.n[j] & bit(nv)) changes.push([j, G.v[j], G.n[j], G.v[j], G.n[j] & ~bit(nv)]);
  }
  const before = nv ? unitsOf(i).map((u) => u.every((c) => valueAt(c) === G.p.solution[c])) : [];
  if (nv && nv !== G.p.solution[i]) G.mistakes++;
  apply(changes);
  if (!nv) return;
  announce(`${nv} placed at row ${rowOf(i) + 1}, column ${colOf(i) + 1}`);
  if (G.solved) return;
  // A finished row, column or box chimes and glows.
  const done = unitsOf(i).filter((u, k) => !before[k] && u.every((c) => valueAt(c) === G.p.solution[c]));
  if (done.length) {
    play('unit');
    if (!quiet()) for (const u of done) for (const c of u) {
      const el = $(`#np-board [data-i="${c}"]`);
      el.classList.remove('glow'); void el.offsetWidth; el.classList.add('glow');
    }
  } else play(prefs.showMistakes && nv !== G.p.solution[i] ? 'wrong' : 'place');
}

function toggleNote(i, d) {
  if (G.v[i] || G.p.givens[i] || G.solved) return;
  apply([[i, G.v[i], G.n[i], 0, G.n[i] ^ bit(d)]]);
  play('note');
}

function erase() {
  const i = G.sel;
  if (i < 0 || G.p.givens[i] || G.solved) return;
  apply([[i, G.v[i], G.n[i], 0, G.v[i] ? G.n[i] : 0]]);
}

function undo() {
  if (G.solved) return;
  const ch = G.undo.pop();
  if (!ch) return;
  for (const [i, ov, on] of ch) { G.v[i] = ov; G.n[i] = on; }
  G.redo.push(ch);
  G.sel = ch[0][0];
  G.hint = null;
  afterChange();
  focusCell(G.sel);
}
function redo() {
  if (G.solved) return;
  const ch = G.redo.pop();
  if (!ch) return;
  for (const [i, , , nv, nn] of ch) { G.v[i] = nv; G.n[i] = nn; }
  G.undo.push(ch);
  G.sel = ch[0][0];
  afterChange();
  focusCell(G.sel);
}

// Fills every empty cell's notes with the numbers its row, column and box still allow (one undo step).
function autoNotes() {
  if (G.solved) return;
  const N = G.p.size, changes = [];
  let even = 0;
  for (let d = 2; d <= N; d += 2) even |= bit(d);
  for (let i = 0; i < N * N; i++) {
    if (valueAt(i)) continue;
    let m = (1 << N) - 1;
    if (G.p.variants.includes('parity')) m &= G.p.evenCells.includes(i) ? even : ~even;
    for (let j = 0; j < N * N; j++) if (valueAt(j) && sees(i, j)) m &= ~bit(valueAt(j));
    changes.push([i, 0, G.n[i], 0, m]);
  }
  apply(changes);
  announce('Notes filled in for every empty cell.');
}

function check() {
  if (G.solved) return;
  G.checks++;
  const wrong = new Set(G.v.map((d, i) => (d && d !== G.p.solution[i] ? i : -1)).filter((i) => i >= 0));
  G.checked = wrong;
  render();
  save();
  const empty = G.p.givens.filter((d, i) => !d && !G.v[i]).length;
  announce(wrong.size ? `${wrong.size} number${wrong.size === 1 ? ' is' : 's are'} wrong. They are marked in red.` : `Everything so far is right. ${empty} cell${empty === 1 ? '' : 's'} to go.`, true);
}

// ---------- hints: a nudge, then where, then why ----------

async function hint() {
  if (G.solved) return;
  if (G.hint && G.hint.level < G.hint.levels.length - 1) { G.hint.level++; G.hint.show = true; render(); return; }
  if (G.hint) return;
  const h = await engine.hint(G.p, G.v);
  G.hints++;
  // The techniques a player needs help with steer future practice puzzles.
  if (h.kind === 'step') G.stuck.push(h.technique);
  G.hint = { ...h, level: 0, show: false };
  if (h.kind === 'mistake') G.checked = new Set(h.cells);
  play('hint');
  save();
  render();
}

function renderHint() {
  const box = $('#np-hint');
  const h = G.hint;
  if (!h) { box.hidden = true; return; }
  box.hidden = false;
  const lines = h.levels.slice(0, h.level + 1).map((l) => `<li>${esc(l)}</li>`).join('');
  const more = h.level < h.levels.length - 1;
  box.innerHTML = `<p class="np-hint-h">${h.kind === 'step' ? `Hint: ${esc(h.techniqueName)}` : 'Hint'}</p><ol>${lines}</ol>
    <div class="np-hint-actions">${more ? '<button type="button" class="btn small" id="np-hint-more">Tell me more</button>' : ''}
    ${h.kind === 'step' && !more ? '<button type="button" class="btn small primary" id="np-hint-fill">Fill it in</button>' : ''}
    <button type="button" class="btn quiet small" id="np-hint-close">Close</button></div>`;
  $('#np-hint-more')?.addEventListener('click', hint);
  $('#np-hint-fill')?.addEventListener('click', () => { const { cell, digit } = G.hint; G.sel = cell; const was = prefs.notes; prefs.notes = false; place(digit); prefs.notes = was; if (G && !G.solved) { render(); focusCell(cell); } });
  $('#np-hint-close').addEventListener('click', () => { G.hint = null; render(); focusCell(G.sel); });
}

// ---------- the end of a puzzle ----------

function record(outcome) {
  if (G.recorded) return null;
  G.recorded = outcome;
  const rec = learn.finished(G, outcome);
  lastRecord = rec;
  try { deps.onPlay?.(rec); } catch (e) { /* sharing is optional */ }
  return rec;
}

function solved() {
  const before = summary(learn.plays()).badges.filter((b) => b.earned).map((b) => b.id);
  G.solved = true;
  tick();
  stopTimer();
  G.hint = null;
  record('solved');
  save();
  render();
  play('solved');
  if (!quiet()) {
    const board = $('#np-board');
    board.classList.remove('won'); void board.offsetWidth; board.classList.add('won');
    deps.celebrate?.();
  }
  const after = summary(learn.plays()).badges.filter((b) => b.earned && !before.includes(b.id));
  showSolved({ fresh: true, newBadges: after });
}

function showSolved({ fresh, newBadges = [] }) {
  const p = G.p;
  const box = $('#np-solved');
  $('#np-solved-h').textContent = G.revealed ? 'The answer' : 'Solved!';
  $('#np-ending').textContent = !quiet() && p.story?.ending && !G.revealed ? p.story.ending : '';
  $('#np-ending').hidden = !$('#np-ending').textContent;
  if (G.revealed) $('#np-solved-text').textContent = 'Here is the whole answer. Watch the solution to see how each number follows from the last.';
  else {
    const others = learn.plays().filter((r) => r.d === p.difficulty.id && r.outcome === 'solved' && !r.hints && r.fp !== p.fingerprint);
    const best = others.reduce((m, r) => Math.min(m, r.ms), Infinity);
    const record = !G.hints && G.ms < best && best !== Infinity;
    const par = PAR_MS[p.difficulty.id];
    $('#np-solved-text').textContent = `${p.difficulty.name} solved in ${fmtTime(G.ms)}${G.hints ? ` with ${G.hints} hint${G.hints === 1 ? '' : 's'}` : ' with no hints'}${G.mistakes ? ` and ${G.mistakes} slip${G.mistakes === 1 ? '' : 's'}` : ''}.${record ? ' A new best time!' : G.ms < par * 0.6 && !G.hints ? ' That was quick: the next one will be a little tougher.' : ''}`;
  }
  $('#np-feel').hidden = G.revealed || !fresh;
  $('#np-feel-done').textContent = '';
  for (const b of root.querySelectorAll('[data-feel]')) b.setAttribute('aria-pressed', 'false');
  $('#np-share').hidden = G.revealed;
  $('#np-new-badges').hidden = !newBadges.length;
  $('#np-new-badges').textContent = newBadges.length ? `New badge${newBadges.length === 1 ? '' : 's'}: ${newBadges.map((b) => b.name).join(', ')}` : '';
  box.hidden = false;
  if (fresh) box.focus();
}

function reveal() {
  $('#np-reveal-confirm').hidden = true;
  const changes = [];
  for (let i = 0; i < G.p.size ** 2; i++) if (!G.p.givens[i] && G.v[i] !== G.p.solution[i]) changes.push([i, G.v[i], G.n[i], G.p.solution[i], 0]);
  for (const [i, , , nv, nn] of changes) { G.v[i] = nv; G.n[i] = nn; }
  G.revealed = true;
  G.solved = true;
  tick();
  stopTimer();
  G.hint = null;
  record('revealed');
  save();
  render();
  showSolved({ fresh: true });
}

function rate(feel) {
  const rec = learn.rate(G.p.fingerprint, feel);
  for (const b of root.querySelectorAll('[data-feel]')) b.setAttribute('aria-pressed', String(b.dataset.feel === feel));
  $('#np-feel-done').textContent = feel === 'easy' ? 'Thanks. The next one will be tougher.' : feel === 'hard' ? 'Thanks. The next one will be gentler.' : 'Thanks. We\'ll keep it about here.';
  if (rec) { try { deps.onPlay?.(rec); } catch (e) { /* optional */ } }
}

function shareText() {
  return `${G.p.story && !quiet() ? `${G.p.story.title}\n` : ''}Number Place · ${G.p.difficulty.name}${G.daily ? ` · Daily ${G.daily}` : ''}\nSolved in ${fmtTime(G.ms)}, ${G.hints ? `${G.hints} hint${G.hints === 1 ? '' : 's'}` : 'no hints'}\nThe Fantastical Logic Grid`;
}

async function share() {
  const text = shareText();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  const accent = getComputedStyle(root).getPropertyValue('--np-accent').trim() || '#5B3CC4';
  const canvas = resultPicture(G, { title: !quiet() && G.p.story ? G.p.story.title : 'Number Place', accent, dark });
  const box = $('#np-share-box');
  const img = new Image();
  img.alt = `Result picture: ${text.replaceAll('\n', ', ')}`;
  img.src = canvas.toDataURL('image/png');
  $('#np-share-pic').replaceChildren(img);
  box.hidden = false;
  try {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const file = blob && new File([blob], 'number-place.png', { type: 'image/png' });
    if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (e) { /* fall through to copying */ }
  try { await navigator.clipboard.writeText(text); announce('Result copied. Paste it anywhere.', true); } catch (e) { /* the picture is shown to save by hand */ }
}

// ---------- step-by-step solution ----------

let stepAt = 0;
function openSteps() {
  const p = G.p, N = p.size;
  const b = $('#np-steps-board');
  b.style.setProperty('--n', N);
  b.className = `np-board np-mini${p.variants.includes('diagonal') ? ' diag' : ''}`;
  b.innerHTML = boardHtml(p, N, p.box[0], p.box[1], false);
  stepAt = 0;
  drawStep();
  $('#np-steps-dlg').showModal();
}

function drawStep() {
  const p = G.p, path = p.solvePath, N = p.size;
  const vals = p.givens.slice();
  for (let k = 0; k < stepAt; k++) if (path[k].place) vals[path[k].place[0]] = path[k].place[1];
  const s = path[Math.max(0, stepAt - 1)];
  const focus = new Set(stepAt && s ? (s.place ? [s.place[0]] : (s.remove || []).map(([c]) => c)) : []);
  for (const el of $('#np-steps-board').querySelectorAll('.np-cell')) {
    const i = Number(el.dataset.i);
    el.innerHTML = vals[i] ? `<span class="v">${vals[i]}</span>` : '';
    el.classList.toggle('hinted', focus.has(i));
    el.classList.toggle('elim', !!(stepAt && s && !s.place && focus.has(i)));
  }
  $('#np-step-n').textContent = stepAt ? `Step ${stepAt} of ${path.length}` : `${path.length} steps`;
  $('#np-step-tech').textContent = stepAt && s ? s.techniqueName : 'The puzzle as given';
  $('#np-step-why').textContent = stepAt && s ? `${s.why}${s.place ? ` So ${s.place[1]} goes at row ${Math.floor(s.place[0] / N) + 1}, column ${(s.place[0] % N) + 1}.` : ''}` : 'Press Next step to watch every number follow from logic, one at a time.';
  $('#np-step-prev').disabled = stepAt === 0;
  $('#np-step-next').disabled = stepAt >= path.length;
}

// ---------- files and printing ----------

function saveFile() {
  const data = JSON.stringify({ format: 'number-place', version: 1, game: { ...G, hint: undefined, checked: undefined, wrongShown: undefined } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `${G.name.replace(/[^\w -]+/g, '').trim() || 'number-place'}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  announce('Saved to a file.', true);
}

// Opens a saved file after checking it is a real Number Place game with a valid answer.
async function openFile(file) {
  const status = $('#np-status');
  try {
    const data = JSON.parse(await file.text());
    const g = data?.game;
    const p = g?.p;
    const N = p?.size;
    const ok = data.format === 'number-place' && p && [4, 6, 9].includes(N) && Array.isArray(p.givens) && Array.isArray(p.solution)
      && p.givens.length === N * N && p.solution.length === N * N && p.givens.every((d, i) => !d || d === p.solution[i])
      && [...Array(N).keys()].every((r) => new Set(p.solution.slice(r * N, r * N + N)).size === N)
      && [...Array(N).keys()].every((c) => new Set([...Array(N).keys()].map((r) => p.solution[r * N + c])).size === N);
    if (!ok) throw new Error('That file is not a Number Place puzzle.');
    G = { ...g, id: `g${Date.now().toString(36)}`, mode: g.mode === 'daily' ? 'daily' : 'file', recorded: g.recorded || null, undo: g.undo || [], redo: g.redo || [], stuck: g.stuck || [], n: g.n || Array(N * N).fill(0), v: (g.v || Array(N * N).fill(0)).map((d) => (Number.isInteger(d) && d >= 0 && d <= N ? d : 0)) };
    learn.started(p);
    open();
  } catch (e) {
    status.textContent = e instanceof SyntaxError ? 'That file could not be read. Choose a .json file saved from Number Place.' : e.message;
  }
}

function doPrint(form) {
  const opts = {
    marks: form.querySelector('input[name=np-pmarks]:checked').value === 'marks',
    paper: form.querySelector('input[name=np-paper]:checked').value,
    answers: $('#np-p-key').checked,
    steps: $('#np-p-steps').checked,
  };
  printHtml(printableHtml(G, opts));
}

// ---------- saved list actions ----------

function deleteGame(id) {
  const all = games();
  const g = all[id];
  if (!g) return;
  // Deleting an unfinished puzzle you worked on counts as giving up on it.
  if (!g.solved && !g.recorded && g.v.some(Boolean)) {
    const was = G; G = g; record('abandoned'); G = was;
  }
  delete all[id];
  keep(K.games, all);
  if (deleted?.timer) clearTimeout(deleted.timer);
  deleted = { game: g, timer: setTimeout(() => { deleted = null; $('#np-undo-bar').hidden = true; }, 8000) };
  $('#np-undo-text').textContent = `Deleted "${g.name}".`;
  $('#np-undo-bar').hidden = false;
  renderSetup();
  $('#np-undo-delete').focus();
}

function renameGame(li) {
  const id = li.dataset.id;
  const g = games()[id];
  const nameEl = li.querySelector('.np-saved-name');
  const input = document.createElement('input');
  input.type = 'text'; input.value = g.name; input.className = 'np-rename'; input.id = `np-rename-${id}`;
  input.setAttribute('aria-label', 'Puzzle name');
  li.querySelector('.np-saved-open').replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = (saveIt) => {
    if (done) return; done = true;
    if (saveIt && input.value.trim()) { const all = games(); all[id].name = input.value.trim().slice(0, 80); keep(K.games, all); }
    renderSetup();
    root.querySelector(`#np-saved li[data-id="${id}"] [data-act=rename]`)?.focus();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
  input.onblur = () => finish(true);
  void nameEl;
}

// ---------- input ----------

function announce(msg, polite = false) {
  const live = $(polite ? '#np-status-live' : '#np-live');
  live.textContent = '';
  setTimeout(() => { if (root) live.textContent = msg; }, 30);
}

function focusCell(i) {
  if (i < 0 || !G) return;
  G.sel = i;
  render();
  $(`#np-board [data-i="${i}"]`)?.focus({ preventScroll: true });
}

function move(dr, dc) {
  const N = G.p.size;
  const r = (rowOf(G.sel) + dr + N) % N, c = (colOf(G.sel) + dc + N) % N;
  focusCell(r * N + c);
}

function wire() {
  // Setup
  $('#np-setup').addEventListener('submit', (e) => { e.preventDefault(); startNew(readSetup()); });
  $('#np-levels').addEventListener('change', () => { renderSizes(); renderSetup(); });
  $('#np-sizes').addEventListener('change', (e) => { prefs.size = Number(e.target.value); savePrefs(); renderSizes(); });
  $('#np-daily-btn').onclick = startDaily;
  $('#np-continue').onclick = (e) => resume(e.currentTarget.dataset.id);
  $('#np-suggest').onclick = (e) => {
    const r = root.querySelector(`input[name=np-level][value="${e.currentTarget.dataset.level}"]`);
    r.checked = true; renderSizes(); renderSetup(); r.focus();
  };
  $('#np-saved').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'delete') deleteGame(li.dataset.id);
    else if (act === 'rename') renameGame(li);
    else if (e.target.closest('.np-saved-open')) resume(li.dataset.id);
  });
  $('#np-undo-delete').onclick = () => {
    if (!deleted) return;
    putGame(deleted.game);
    clearTimeout(deleted.timer); deleted = null;
    $('#np-undo-bar').hidden = true;
    renderSetup();
  };
  $('#np-open-file').onclick = () => $('#np-file').click();
  $('#np-file').onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };

  // Play
  const board = $('#np-board');
  board.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.np-cell');
    if (!cell || !G) return;
    e.preventDefault();
    focusCell(Number(cell.dataset.i));
  });
  $('#np-digits').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (b && G) { place(Number(b.dataset.d)); if (G && !G.solved) focusCell(G.sel); }
  });
  $('#np-notes-btn').onclick = () => { prefs.notes = !prefs.notes; savePrefs(); render(); };
  $('#np-erase').onclick = () => { erase(); focusCell(G.sel); };
  $('#np-undo').onclick = undo;
  $('#np-redo').onclick = redo;
  $('#np-hint-btn').onclick = hint;
  $('#np-auto').onclick = autoNotes;
  $('#np-check').onclick = check;
  $('#np-pause').onclick = () => { G.paused = !G.paused; render(); };
  $('#np-mistakes').onchange = (e) => { prefs.showMistakes = e.target.checked; savePrefs(); render(); };
  $('#np-new').onclick = () => showView('setup');
  $('#np-reveal').onclick = () => { $('#np-reveal-confirm').hidden = false; $('#np-reveal-no').focus(); };
  $('#np-reveal-no').onclick = () => { $('#np-reveal-confirm').hidden = true; focusCell(G.sel); };
  $('#np-reveal-yes').onclick = reveal;
  $('#np-coach-next').onclick = () => coach(Number($('#np-coach').dataset.i) + 1);
  $('#np-coach-close').onclick = () => { prefs.coachDone = true; savePrefs(); $('#np-coach').hidden = true; focusCell(G.sel); };
  $('#np-again').onclick = () => {
    if (G.mode === 'daily' || G.mode === 'race') { showView('setup'); return; }
    const p = G.p;
    startNew({ difficulty: p.difficulty.id, size: p.size, variants: p.variants });
  };
  $('#np-share').onclick = share;
  $('#np-home').onclick = () => showView('setup');
  root.querySelectorAll('[data-feel]').forEach((b) => { b.onclick = () => rate(b.dataset.feel); });
  $('#np-steps-btn').onclick = openSteps;
  $('#np-step-prev').onclick = () => { stepAt = Math.max(0, stepAt - 1); drawStep(); };
  $('#np-step-next').onclick = () => { stepAt = Math.min(G.p.solvePath.length, stepAt + 1); drawStep(); };
  $('#np-step-end').onclick = () => { stepAt = G.p.solvePath.length; drawStep(); };
  $('#np-save-file').onclick = saveFile;
  $('#np-print').onclick = () => { $('#np-p-steps').closest('label').hidden = G.p.size === 9 && G.p.solvePath.length > 120; $('#np-print-dlg').showModal(); };
  $('#np-print-dlg').addEventListener('close', (e) => { if (e.target.returnValue === 'print') doPrint(e.target.querySelector('form')); });

  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onLeave);
}

const playing = () => G && root && !$('#np-play-view').hidden;
function onHide() { if (document.hidden && playing()) { tick(); save(); } }
function onLeave() { if (G && root) { tick(); save(); } }

function onKey(e) {
  if (!playing() || document.querySelector('dialog[open]')) return;
  if (typeof e.key !== 'string' || /^(input|select|textarea)$/i.test(e.target.tagName)) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod || e.altKey) return;
  // Grid keys work from the grid and from the tool buttons, so a click on a tool doesn't lose the keyboard.
  if (!e.target.closest('#np-board, .np-tools, .np-digits') && !/^[1-9]$/.test(k)) return;
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (arrows[k]) { e.preventDefault(); move(...arrows[k]); return; }
  // Shift with a number (or the numpad with Shift) writes a note without switching modes.
  const code = /^Digit([1-9])$/.exec(e.code) || /^Numpad([1-9])$/.exec(e.code);
  const d = code ? Number(code[1]) : /^[1-9]$/.test(k) ? Number(k) : 0;
  if (d && d <= G.p.size) {
    e.preventDefault();
    if (e.shiftKey) toggleNote(G.sel, d); else place(d);
    return;
  }
  if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); erase(); return; }
  const lk = k.toLowerCase();
  if (lk === 'n') { e.preventDefault(); $('#np-notes-btn').click(); return; }
  if (lk === 'h') { e.preventDefault(); hint(); return; }
  if (lk === 'a') { e.preventDefault(); autoNotes(); return; }
  if (lk === 'c') { e.preventDefault(); check(); return; }
  if (lk === 'p') { e.preventDefault(); $('#np-pause').click(); return; }
  if (k === 'Home') { e.preventDefault(); focusCell(rowOf(G.sel) * G.p.size); return; }
  if (k === 'End') { e.preventDefault(); focusCell(rowOf(G.sel) * G.p.size + G.p.size - 1); }
}

// For tests.
export const state = () => G;
export const learning = () => learn;
