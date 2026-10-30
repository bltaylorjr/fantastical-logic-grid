// Number Place module: setup, play screen, daily puzzle, stats and printing.
// Self-contained so it can drop into The Fantastical Logic Grid app or run on
// its own test page:
//
//   import { mount } from './ui.js';
//   mount(document.querySelector('#np'), { engine, celebrate, storagePrefix });
//
// `engine` is { generate(options), hint(puzzle, entries) }, both returning
// promises (engine/src/number-place.js run in a worker, or directly).
import { markup } from './markup.js';

let root = null;
const $ = (s) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let KEY_GAME = 'flg.np.current';
let KEY_STATS = 'flg.np.stats';
let KEY_PREFS = 'flg.np.prefs';
let engine = null;

export const NP_LEVELS = [
  { id: 'basic', name: 'Basic', note: '4×4, a gentle start' },
  { id: 'easy', name: 'Easy', note: '6×6, singles only' },
  { id: 'medium', name: 'Medium', note: '9×9, line and box overlaps' },
  { id: 'hard', name: 'Hard', note: '9×9, pairs and hidden pairs' },
  { id: 'expert', name: 'Expert', note: '9×9, rectangles and bent triples' },
  { id: 'master', name: 'Master', note: '9×9, the hardest patterns, more than once' },
];
const VARIANTS = [
  { id: 'diagonal', name: 'Diagonals', note: 'Both long diagonals hold every number once' },
  { id: 'parity', name: 'Odd and even', note: 'Shaded cells are even, the rest are odd' },
];
// The daily puzzle walks up the week: Monday Easy to Sunday Master.
const DAILY_BY_WEEKDAY = ['master', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'];

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };

let G = null; // the game in progress
let deps = {};
let prefs = {};

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
const rowOf = (c) => Math.floor(c / G.p.size), colOf = (c) => c % G.p.size;
const boxOf = (c) => { const [br, bc] = G.p.box; return Math.floor(rowOf(c) / br) * (G.p.size / bc) + Math.floor(colOf(c) / bc); };
const onDiag = (c) => rowOf(c) === colOf(c) ? 1 : rowOf(c) + colOf(c) === G.p.size - 1 ? 2 : 0;
const sees = (a, b) => a !== b && (rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b)
  || (G.p.variants.includes('diagonal') && ((rowOf(a) === colOf(a) && rowOf(b) === colOf(b)) || (rowOf(a) + colOf(a) === G.p.size - 1 && rowOf(b) + colOf(b) === G.p.size - 1))));
const valueAt = (c) => G.p.givens[c] || G.v[c];
const bit = (d) => 1 << (d - 1);

// ---------- setup card on the home screen ----------

export function mount(container, host) {
  if (root) unmount();
  root = container;
  deps = host || {};
  engine = deps.engine;
  const pre = deps.storagePrefix || 'flg.np';
  KEY_GAME = `${pre}.current`; KEY_STATS = `${pre}.stats`; KEY_PREFS = `${pre}.prefs`;
  prefs = { notes: false, showMistakes: false, autoClean: true, highlight: true, ...load(KEY_PREFS, {}) };
  root.classList.add('np-app');
  root.innerHTML = markup;
  const levels = $('#np-levels');
  levels.innerHTML = NP_LEVELS.map((l, i) => `<label class="choice"><input type="radio" name="np-level" value="${l.id}"${i === 2 ? ' checked' : ''}><span><b>${l.name}</b><small>${l.note}</small></span></label>`).join('');
  $('#np-variants').innerHTML = VARIANTS.map((v) => `<label class="choice"><input type="checkbox" name="np-variant" value="${v.id}"><span><b>${v.name}</b><small>${v.note}</small></span></label>`).join('');
  $('#np-setup').addEventListener('submit', (e) => { e.preventDefault(); startNew(readSetup()); });
  $('#np-daily-btn').onclick = () => startNew({ ...dailyOptions(), daily: todayUtc() });
  $('#np-continue').onclick = () => resume();
  wirePlayScreen();
  // Some hosts (a framed preview) cannot print.
  if (deps.canPrint === false) $('.np-print-row').querySelectorAll('#np-print, #np-print-key').forEach((b) => { b.hidden = true; });
  showView('setup');
  if (deps.autoResume && load(KEY_GAME, null) && !load(KEY_GAME, null).solved) resume();
}

export function unmount() {
  close();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', onLeave);
  if (root) root.innerHTML = '';
  root = null; G = null;
}

function showView(name) {
  $('#np-setup-view').hidden = name !== 'setup';
  $('#np-play-view').hidden = name !== 'play';
  if (name === 'setup') { close(); renderHome(); }
  deps.onView?.(name);
}

function readSetup() {
  const difficulty = $('input[name=np-level]:checked').value;
  const variants = [...root.querySelectorAll('input[name=np-variant]:checked')].map((i) => i.value);
  return { difficulty, variants: difficulty === 'basic' ? [] : variants };
}

export function renderHome() {
  const saved = load(KEY_GAME, null);
  const btn = $('#np-continue');
  btn.hidden = !saved || saved.solved;
  if (saved && !saved.solved) $('#np-continue-name').textContent = `${saved.p.difficulty.name}${saved.daily ? ' daily' : ''}, ${fmtTime(saved.ms)}`;
  const st = stats();
  const d = dailyOptions();
  const doneToday = st.solves.some((s) => s.daily === todayUtc());
  const rows = st.byLevel.filter((l) => l.solved);
  $('#np-stats').innerHTML = rows.length ? `<h3>Your times</h3><table><thead><tr><th scope="col">Level</th><th scope="col">Solved</th><th scope="col">Best, no hints</th></tr></thead><tbody>${rows.map((l) => `<tr><th scope="row">${l.name}</th><td>${l.solved}</td><td>${l.best ? fmtTime(l.best) : '–'}</td></tr>`).join('')}</tbody></table>` : '';
  $('#np-daily-note').textContent = `${doneToday ? 'Solved today. ' : ''}Today is ${NP_LEVELS.find((l) => l.id === d.difficulty).name}.${st.streak ? ` Streak: ${st.streak} day${st.streak === 1 ? '' : 's'}.` : ''}`;
}

// ---------- start, resume, save ----------

async function startNew(opts) {
  const status = $('#np-status');
  status.textContent = 'Building a puzzle with exactly one answer…';
  $('#np-gen').disabled = true;
  try {
    const p = await engine.generate({ seed: Math.random().toString(36).slice(2), ...opts });
    G = { p, v: Array(p.size ** 2).fill(0), n: Array(p.size ** 2).fill(0), undo: [], redo: [], ms: 0, hints: 0, mistakes: 0, checks: 0, daily: opts.daily || null, solved: false, sel: p.givens.findIndex((d) => !d) };
    status.textContent = '';
    open();
  } catch (e) {
    status.textContent = `Could not build that puzzle: ${e.message}`;
  } finally {
    $('#np-gen').disabled = false;
  }
}

function resume() {
  const saved = load(KEY_GAME, null);
  if (!saved) return;
  G = { ...saved, undo: saved.undo || [], redo: saved.redo || [] };
  open();
}

function save() {
  if (!G) return;
  // Keep history short enough for storage but long enough to be useful.
  keep(KEY_GAME, { ...G, undo: G.undo.slice(-500), redo: G.redo.slice(-500), hint: undefined });
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
  if (G.paused || document.hidden) { lastTick = now; return; }
  G.ms += now - lastTick; lastTick = now;
  $('#np-time').textContent = fmtTime(G.ms);
}
function stopTimer() { if (timer) clearInterval(timer); timer = null; }

function open() {
  showView('play');
  G.paused = false;
  G.hint = null;
  $('#np-title').textContent = `Number Place · ${G.p.difficulty.name}${G.daily ? ` · Daily ${G.daily}` : ''}`;
  $('#np-rules').innerHTML = G.p.rules.map((r) => `<li>${esc(r)}</li>`).join('');
  $('#np-solved').hidden = !G.solved;
  buildBoard();
  buildPad();
  render();
  startTimer();
  save();
  setTimeout(() => focusCell(G.sel >= 0 ? G.sel : 0), 0);
}

function close() { if (G && root) { tick(); save(); } stopTimer(); }

function buildBoard() {
  const N = G.p.size, [br, bc] = G.p.box;
  const board = $('#np-board');
  board.style.setProperty('--n', N);
  board.className = `np-board${G.p.variants.includes('diagonal') ? ' diag' : ''}`;
  board.setAttribute('aria-rowcount', N);
  board.setAttribute('aria-colcount', N);
  let html = '';
  for (let r = 0; r < N; r++) {
    html += '<div role="row" class="np-row">';
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const cls = ['np-cell'];
      if (r % br === 0) cls.push('bt');
      if (c % bc === 0) cls.push('bl');
      if (r === N - 1) cls.push('bb');
      if (c === N - 1) cls.push('br');
      if (G.p.givens[i]) cls.push('given');
      if (G.p.evenCells.includes(i)) cls.push('even');
      html += `<div role="gridcell" class="${cls.join(' ')}" data-i="${i}" tabindex="-1" aria-rowindex="${r + 1}" aria-colindex="${c + 1}"></div>`;
    }
    html += '</div>';
  }
  board.innerHTML = html;
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
  const hintCells = new Set(G.hint?.show ? [G.hint.cell] : []);
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
  // Digits left to place, and finished digits dimmed.
  for (const b of $('#np-digits').children) {
    const d = Number(b.dataset.d);
    const placed = G.p.solution.reduce((n, _, i) => n + (valueAt(i) === d ? 1 : 0), 0);
    const left = N - placed;
    b.querySelector('.left').textContent = left > 0 ? String(left) : '';
    b.classList.toggle('done', left <= 0);
    b.setAttribute('aria-label', `${prefs.notes ? 'Note' : 'Place'} ${d}, ${left > 0 ? `${left} left` : 'all placed'}`);
  }
  $('#np-notes-btn').setAttribute('aria-pressed', String(prefs.notes));
  $('#np-notes-btn .state').textContent = prefs.notes ? 'On' : 'Off';
  $('#np-undo').disabled = !G.undo.length;
  $('#np-redo').disabled = !G.redo.length;
  $('#np-mistakes').checked = prefs.showMistakes;
  $('#np-board').classList.toggle('paused', !!G.paused);
  $('#np-pause').textContent = G.paused ? 'Resume' : 'Pause';
  $('#np-time').textContent = fmtTime(G.ms);
  $('#np-progress').textContent = `${G.p.givens.filter((d, i) => d || G.v[i]).length} of ${N * N} filled`;
  renderHint();
}

// Each change is a list of [cell, oldValue, oldNotes, newValue, newNotes] so undo and redo are exact.
function apply(changes, { record = true } = {}) {
  const real = changes.filter(([i, ov, on, nv, nn]) => ov !== nv || on !== nn);
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
  if (nv && nv !== G.p.solution[i]) G.mistakes++;
  apply(changes);
  if (nv) announce(`${nv} placed at row ${rowOf(i) + 1}, column ${colOf(i) + 1}`);
}

function toggleNote(i, d) {
  if (G.v[i]) return;
  apply([[i, G.v[i], G.n[i], 0, G.n[i] ^ bit(d)]]);
}

function erase() {
  const i = G.sel;
  if (i < 0 || G.p.givens[i] || G.solved) return;
  apply([[i, G.v[i], G.n[i], 0, G.v[i] ? G.n[i] : 0]]);
}

function undo() {
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
  for (let i = 0; i < N * N; i++) {
    if (valueAt(i)) continue;
    let m = (1 << N) - 1;
    if (G.p.variants.includes('parity')) {
      let even = 0;
      for (let d = 2; d <= N; d += 2) even |= bit(d);
      m &= G.p.evenCells.includes(i) ? even : ~even;
    }
    for (let j = 0; j < N * N; j++) if (valueAt(j) && sees(i, j)) m &= ~bit(valueAt(j));
    changes.push([i, 0, G.n[i], 0, m]);
  }
  apply(changes);
  announce('Notes filled in for every empty cell.');
}

function check() {
  G.checks++;
  const wrong = new Set(G.v.map((d, i) => (d && d !== G.p.solution[i] ? i : -1)).filter((i) => i >= 0));
  G.checked = wrong;
  render();
  const empty = G.p.givens.filter((d, i) => !d && !G.v[i]).length;
  announce(wrong.size ? `${wrong.size} number${wrong.size === 1 ? ' is' : 's are'} wrong. They are marked in red.` : `Everything so far is right. ${empty} cell${empty === 1 ? '' : 's'} to go.`, true);
}

// ---------- hints: a nudge, then where, then why ----------

async function hint() {
  if (G.solved) return;
  if (G.hint && G.hint.level < G.hint.levels.length - 1) { G.hint.level++; if (G.hint.level >= 1) G.hint.show = true; render(); return; }
  if (G.hint) return;
  const h = await engine.hint(G.p, G.v);
  G.hints++;
  G.hint = { ...h, level: 0, show: false };
  if (h.kind === 'mistake') { G.checked = new Set(h.cells); }
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
  $('#np-hint-fill')?.addEventListener('click', () => { const { cell, digit } = G.hint; G.sel = cell; const was = prefs.notes; prefs.notes = false; place(digit); prefs.notes = was; render(); focusCell(cell); });
  $('#np-hint-close').addEventListener('click', () => { G.hint = null; render(); focusCell(G.sel); });
}

// ---------- solved ----------

function solved() {
  G.solved = true;
  tick();
  stopTimer();
  G.hint = null;
  const st = load(KEY_STATS, { solves: [] });
  const best = st.solves.filter((s) => s.d === G.p.difficulty.id && !s.hints).reduce((m, s) => Math.min(m, s.ms), Infinity);
  st.solves.push({ d: G.p.difficulty.id, ms: Math.round(G.ms), hints: G.hints, mistakes: G.mistakes, at: Date.now(), daily: G.daily, variants: G.p.variants });
  keep(KEY_STATS, st);
  save();
  render();
  const record = !G.hints && G.ms < best;
  $('#np-solved-text').textContent = `${G.p.difficulty.name} solved in ${fmtTime(G.ms)}${G.hints ? ` with ${G.hints} hint${G.hints === 1 ? '' : 's'}` : ' with no hints'}.${record && best !== Infinity ? ' A new best time!' : ''}`;
  $('#np-solved').hidden = false;
  $('#np-solved').focus();
  deps.celebrate?.();
}

export function stats() {
  const st = load(KEY_STATS, { solves: [] });
  // Streak: consecutive UTC days with a solved daily, counting back from today or yesterday.
  const days = new Set(st.solves.map((s) => s.daily).filter(Boolean));
  let streak = 0;
  const d = new Date(`${todayUtc()}T00:00:00Z`);
  if (!days.has(todayUtc())) d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
  const byLevel = NP_LEVELS.map((l) => {
    const s = st.solves.filter((x) => x.d === l.id);
    const clean = s.filter((x) => !x.hints);
    return { id: l.id, name: l.name, solved: s.length, best: clean.length ? Math.min(...clean.map((x) => x.ms)) : null };
  });
  return { solves: st.solves, streak, byLevel };
}

function shareText() {
  const grid = G.p.size === 9 ? '🟦🟦🟦\n🟦🟦🟦\n🟦🟦🟦' : '🟦🟦\n🟦🟦';
  return `Number Place · ${G.p.difficulty.name}${G.daily ? ` · Daily ${G.daily}` : ''}\n${grid}\nSolved in ${fmtTime(G.ms)}, ${G.hints ? `${G.hints} hint${G.hints === 1 ? '' : 's'}` : 'no hints'}\nThe Fantastical Logic Grid`;
}

async function share() {
  const text = shareText();
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    announce('Result copied. Paste it anywhere.', true);
  } catch (e) { /* the player closed the share sheet */ }
}

// ---------- print ----------

function printBoard({ answers = false } = {}) {
  const N = G.p.size, [br, bc] = G.p.box, src = answers ? G.p.solution : G.p.givens;
  let rows = '';
  for (let r = 0; r < N; r++) {
    rows += '<tr>';
    for (let c = 0; c < N; c++) {
      const i = r * N + c, cls = [r % br === 0 ? 'bt' : '', c % bc === 0 ? 'bl' : '', G.p.evenCells.includes(i) ? 'even' : ''].join(' ');
      rows += `<td class="${cls}">${src[i] || ''}</td>`;
    }
    rows += '</tr>';
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Number Place</title><style>
    body{font-family:"Atkinson Hyperlegible",system-ui,sans-serif;margin:24px;color:#000}
    h1{font-size:20px;margin:0 0 4px} ul{margin:0 0 16px;padding-left:18px;font-size:13px}
    table{border-collapse:collapse;border:3px solid #000} td{width:${N === 9 ? 52 : 64}px;height:${N === 9 ? 52 : 64}px;border:1px solid #777;text-align:center;font-size:${N === 9 ? 26 : 30}px;font-weight:700}
    td.bt{border-top:3px solid #000} td.bl{border-left:3px solid #000} td.even{background:#ddd}
    ${G.p.variants.includes('diagonal') ? 'table{background:linear-gradient(to bottom right,transparent calc(50% - 1px),#bbb,transparent calc(50% + 1px)),linear-gradient(to bottom left,transparent calc(50% - 1px),#bbb,transparent calc(50% + 1px))}' : ''}
  </style><h1>Number Place · ${esc(G.p.difficulty.name)}${answers ? ' · Answer key' : ''}</h1><ul>${G.p.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><table>${rows}</table>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1000); }, 50);
}

// ---------- input ----------

function announce(msg, polite = false) {
  const live = $(polite ? '#np-status-live' : '#np-live');
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 30);
}

function focusCell(i) {
  if (i < 0) return;
  G.sel = i;
  render();
  $(`#np-board [data-i="${i}"]`)?.focus({ preventScroll: true });
}

function move(dr, dc) {
  const N = G.p.size;
  const r = (rowOf(G.sel) + dr + N) % N, c = (colOf(G.sel) + dc + N) % N;
  focusCell(r * N + c);
}

function wirePlayScreen() {
  const board = $('#np-board');
  board.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.np-cell');
    if (!cell || !G) return;
    e.preventDefault();
    focusCell(Number(cell.dataset.i));
  });
  $('#np-digits').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (b && G) { place(Number(b.dataset.d)); focusCell(G.sel); }
  });
  $('#np-notes-btn').onclick = () => { prefs.notes = !prefs.notes; keep(KEY_PREFS, prefs); render(); };
  $('#np-erase').onclick = () => { erase(); focusCell(G.sel); };
  $('#np-undo').onclick = undo;
  $('#np-redo').onclick = redo;
  $('#np-hint-btn').onclick = hint;
  $('#np-auto').onclick = autoNotes;
  $('#np-check').onclick = check;
  $('#np-pause').onclick = () => { G.paused = !G.paused; render(); };
  $('#np-print').onclick = () => printBoard();
  $('#np-print-key').onclick = () => printBoard({ answers: true });
  $('#np-mistakes').onchange = (e) => { prefs.showMistakes = e.target.checked; keep(KEY_PREFS, prefs); render(); };
  $('#np-new').onclick = () => showView('setup');
  $('#np-again').onclick = () => startNew({ difficulty: G.p.difficulty.id, variants: G.p.variants });
  $('#np-share').onclick = share;
  $('#np-home').onclick = () => showView('setup');
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onLeave);
}

const playing = () => G && root && !$('#np-play-view').hidden;
function onHide() { if (document.hidden && playing()) { tick(); save(); } }
function onLeave() { if (G) { tick(); save(); } }

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
      if (e.shiftKey && !G.p.givens[G.sel]) toggleNote(G.sel, d); else place(d);
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
