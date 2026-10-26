// How to play: a step-by-step tutorial for players who have never solved a
// logic grid puzzle, played on real grids, plus a page of tips and tricks.
// The lessons use their own small fixed puzzles (tutorial-lessons.js), so they
// never save, never count toward stats or the scoreboard, and never use up a
// story. Everything shown is plain page text, so the language feature
// translates it like the rest of the game, and nothing here plays pictures,
// music or animation.
import { createGrid, puzzleIndex, esc, STATE_WORDS } from './grid.js';
import { LESSONS, TIPS } from './tutorial-lessons.js';
import * as store from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const PROGRESS_KEY = 'tutorial';

let deps = null;
let T = null; // the open lesson: { li, si, lesson, puzzle, ix, grid, marks, wrong, undo, redo, match, hint, done }

export function initTutorial(d) {
  deps = d;
  $('#learn-tips-btn').onclick = () => showTips();
  $('#learn-exit').onclick = () => deps.onExit();
  $('#learn-intro').onclick = () => deps.openVideo();
  $('#learn-back').onclick = () => showOverview();
  $('#tips-back').onclick = () => showOverview();
  $('#tips-start').onclick = () => openLesson(firstUnfinished());
  $('#step-prev').onclick = () => goStep(T.si - 1);
  $('#step-next').onclick = next;
  $('#step-show').onclick = showMe;
  $('#learn-undo').onclick = undo;
  $('#learn-redo').onclick = redo;
  $('#learn-restart').onclick = () => goStep(T.si, { fresh: true });
  $('#learn-hint-btn').onclick = hint;
  $('#learn-check').onclick = check;
  $('#lesson-list').onclick = (e) => { const b = e.target.closest('button[data-lesson]'); if (b) openLesson(+b.dataset.lesson); };
  $('#screen-learn').addEventListener('keydown', (e) => {
    if (!T || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
  });
}

// ---- progress (which lessons are finished), kept on this device only
function progress() {
  const p = store.getLocal(PROGRESS_KEY);
  return p && Array.isArray(p.done) ? p : { done: [] };
}
function markDone(id) {
  const p = progress();
  if (!p.done.includes(id)) p.done.push(id);
  try { store.setLocal(PROGRESS_KEY, p); } catch (e) { /* progress is optional */ }
}
const firstUnfinished = () => { const done = progress().done; const i = LESSONS.findIndex((l) => !done.includes(l.id)); return i < 0 ? 0 : i; };

// ---- views
export function open({ tips = false, lesson = null } = {}) {
  if (lesson !== null) openLesson(lesson);
  else if (tips) showTips();
  else showOverview();
}

export function close() {
  if (!T) return;
  T.grid?.destroy();
  T = null;
}

function view(name) {
  $('#learn-overview').hidden = name !== 'overview';
  $('#learn-lesson').hidden = name !== 'lesson';
  $('#learn-tips').hidden = name !== 'tips';
  window.scrollTo(0, 0);
}
function focusHeading(sel) { const h = $(sel); h.tabIndex = -1; h.focus(); }

function showOverview() {
  close();
  const done = progress().done;
  $('#lesson-list').innerHTML = LESSONS.map((l, i) => {
    const finished = done.includes(l.id);
    return `<li class="lesson${finished ? ' done' : ''}"><span class="num" aria-hidden="true">${finished ? '✓' : i + 1}</span>
      <span class="what"><b>${esc(l.title)}</b><small>${esc(l.summary)}</small></span>
      <span class="state">${finished ? 'Done' : `${l.steps.length} steps`}</span>
      <button class="btn${!finished && i === firstUnfinished() ? ' primary' : ''}" type="button" data-lesson="${i}" aria-label="${finished ? 'Do again' : 'Start'}: lesson ${i + 1}, ${esc(l.title)}">${finished ? 'Do again' : 'Start'}</button></li>`;
  }).join('');
  $('#learn-summary').textContent = done.length >= LESSONS.length ? 'You have finished every lesson. Do any of them again, or read the tips.' : done.length ? `${done.length} of ${LESSONS.length} lessons done.` : `${LESSONS.length} short lessons, about 15 minutes in all. Each one is played on a real grid.`;
  view('overview');
  focusHeading('#learn-h');
}

function showTips() {
  close();
  $('#tips-body').innerHTML = TIPS.map(([h, tips]) => `<section><h3>${esc(h)}</h3><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('');
  view('tips');
  focusHeading('#tips-h');
}

function openLesson(li) {
  close();
  const lesson = LESSONS[li];
  T = { li, si: 0, lesson, puzzle: null, marks: new Map(), wrong: new Set(), undo: [], redo: [], hint: null, done: false };
  $('#lesson-h').textContent = lesson.title;
  view('lesson');
  goStep(0, { focus: '#lesson-h' });
}

// The puzzle and starting marks for a step: the nearest earlier step that
// sets a puzzle or given marks, plus every expected mark after it.
function startOf(si) {
  const steps = T.lesson.steps;
  let r = si;
  while (r > 0 && !steps[r].puzzle && !steps[r].given) r--;
  let puzzle = T.lesson.puzzle;
  for (let i = 0; i <= r; i++) if (steps[i].puzzle) puzzle = steps[i].puzzle;
  const marks = [...(steps[r].given || [])];
  for (let i = r; i < si; i++) marks.push(...(steps[i].expect || []));
  return { puzzle, marks };
}

function goStep(si, { fresh = false, focus = '#step-h' } = {}) {
  const steps = T.lesson.steps;
  si = Math.max(0, Math.min(steps.length - 1, si));
  const forward = si === T.si + 1;
  const step = steps[si];
  const { puzzle, marks } = startOf(si);
  // Going forward keeps the player's own marks, unless the step sets up a new grid.
  const keep = forward && !fresh && puzzle === T.puzzle && !step.given;
  T.si = si;
  if (!keep) {
    if (puzzle !== T.puzzle) buildGrid(puzzle);
    T.marks = new Map();
    for (const m of marks) { const { k, v } = parse(m); T.marks.set(k, v); }
    T.undo = []; T.redo = [];
  } else {
    // Show me on the last step may have been skipped by the player's own route: fill it in.
    for (const m of steps[si - 1].expect || []) { const { k, v } = parse(m); if (!T.marks.has(k)) T.marks.set(k, v); }
  }
  T.wrong = new Set();
  T.hint = null;
  T.done = false;

  $('#step-count').textContent = `Lesson ${T.li + 1} of ${LESSONS.length} · Step ${si + 1} of ${steps.length}`;
  $('#step-progress').value = (si + 1) / steps.length;
  $('#step-h').textContent = step.title;
  $('#step-text').innerHTML = step.text;
  $('#step-feedback').textContent = '';
  $('#learn-hint').hidden = true;
  const doing = !!(step.expect || step.free);
  $('#step-task').hidden = !doing;
  $('#step-task').textContent = step.free ? 'Your turn: solve the whole grid.' : step.expect ? 'Your turn: make the marks on the grid.' : '';
  $('#step-show').hidden = !step.expect;
  $('#learn-hint-btn').hidden = !step.free;
  $('#learn-check').hidden = !step.free;
  $('#step-prev').disabled = si === 0;
  const last = si === steps.length - 1;
  $('#step-next').textContent = last ? (T.li < LESSONS.length - 1 ? 'Next lesson' : 'Play a Basic puzzle') : 'Next';
  if (last) markDone(T.lesson.id);

  $('#learn-clues').innerHTML = T.puzzle.clues.map((c) => `<li data-n="${c.number}"${(step.clues || []).includes(c.number) ? ' class="spot"' : ''}><span class="num" aria-hidden="true">${c.number}</span><p><span class="sr-only">Clue ${c.number}${(step.clues || []).includes(c.number) ? ', in use' : ''}: </span><span class="txt">${esc(c.text)}</span><small class="kind">${esc(c.typeName)}</small></p></li>`).join('');
  paintAll();
  updateNext();
  if (doing && isDone()) complete(false);
  if (focus) focusHeading(focus);
}

function buildGrid(puzzle) {
  T.grid?.destroy();
  T.puzzle = puzzle;
  T.ix = puzzleIndex(puzzle);
  const match = new Set();
  for (const row of puzzle.solution) {
    const ids = Object.values(row);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) match.add(T.ix.key(ids[i], ids[j]));
  }
  T.match = match;
  T.grid = createGrid($('#learn-grid'), puzzle, T.ix, {
    onCycle: (k) => { const cur = T.marks.get(k) || ''; setCell(k, cur === '' ? 'X' : cur === 'O' ? '' : 'O'); },
    onMark: (k, v) => setCell(k, v),
    onDescribeRow: describeRow,
    onFocus: () => {},
  });
}

// 'O Ava Owl' -> { k, v }
function parse(text) {
  const [v, a, b] = text.split(' ');
  return { k: T.ix.key(idOf(a), idOf(b)), v };
}
function idOf(label) {
  for (const c of T.ix.cats) { const it = c.items.find((x) => x.label === label); if (it) return it.id; }
  throw new Error(`Tutorial: no item ${label}`);
}
const fits = (k, v) => !v || (v === 'O') === T.match.has(k);

function paintAll() {
  const step = T.lesson.steps[T.si];
  const spot = new Set((step.spot || []).map((s) => parse(`X ${s}`).k));
  if (T.hint && T.hint.level >= 1) for (const k of T.hint.targets) spot.add(k);
  for (const k of T.grid.cells.keys()) T.grid.paint(k, T.marks.get(k) || '', { wrong: T.wrong.has(k), target: spot.has(k) && !T.marks.get(k) });
}

function setCell(k, v, { quiet = false } = {}) {
  if (!T) return;
  const before = T.marks.get(k) || '';
  if (before === v) return;
  apply([{ k, b: before, a: v }]);
  const step = T.lesson.steps[T.si];
  const [a, b] = k.split('|');
  const wrongNow = !step.free && !fits(k, v);
  if (wrongNow) T.wrong.add(k);
  paintAll();
  if (quiet) return;
  deps.sound(wrongNow ? 'error' : v === 'O' ? 'O' : v ? 'X' : 'clear');
  const name = `${T.ix.label(a)}, ${T.ix.label(b)}, ${STATE_WORDS[v]}`;
  if (wrongNow) {
    const why = v === 'O' ? `${T.ix.label(a)} and ${T.ix.label(b)} don't go together.` : `${T.ix.label(a)} and ${T.ix.label(b)} do go together.`;
    $('#step-feedback').textContent = `Not quite: ${why} Tap the square again to change it, or press Undo.`;
    deps.announce(`${name}. Not quite: ${why}`);
  } else {
    if ($('#step-feedback').textContent.startsWith('Not quite') && !T.wrong.size) $('#step-feedback').textContent = '';
    deps.announce(`${name}.`);
  }
  afterChange();
}

function apply(changes, dir = 1) {
  for (const ch of changes) {
    const v = dir > 0 ? ch.a : ch.b;
    if (v) T.marks.set(ch.k, v); else T.marks.delete(ch.k);
    T.wrong.delete(ch.k);
  }
  if (dir > 0) { T.undo.push(changes); T.redo = []; }
  T.hint = null;
  $('#learn-hint').hidden = true;
}
function undo() {
  const act = T && T.undo.pop();
  if (!act) { deps.status('Nothing to undo.'); return; }
  for (const ch of [...act].reverse()) { if (ch.b) T.marks.set(ch.k, ch.b); else T.marks.delete(ch.k); T.wrong.delete(ch.k); }
  T.redo.push(act);
  paintAll();
  deps.status('Undone.');
  afterChange();
}
function redo() {
  const act = T && T.redo.pop();
  if (!act) { deps.status('Nothing to redo.'); return; }
  for (const ch of act) { if (ch.a) T.marks.set(ch.k, ch.a); else T.marks.delete(ch.k); }
  T.undo.push(act);
  for (const ch of act) if (!T.lesson.steps[T.si].free && !fits(ch.k, ch.a)) T.wrong.add(ch.k);
  paintAll();
  deps.status('Redone.');
  afterChange();
}

function isDone() {
  const step = T.lesson.steps[T.si];
  if (step.free) {
    for (const [k, v] of T.marks) if (!fits(k, v)) return false;
    return [...T.match].every((k) => T.marks.get(k) === 'O');
  }
  if (!step.expect) return true;
  if (T.wrong.size) return false;
  return step.expect.every((m) => { const { k, v } = parse(m); return T.marks.get(k) === v; });
}

function afterChange() {
  $('#learn-undo').disabled = !T.undo.length;
  $('#learn-redo').disabled = !T.redo.length;
  const was = T.done;
  T.done = isDone();
  updateNext();
  if (T.done && !was) complete(true);
  else if (!T.done && was) $('#step-feedback').textContent = '';
}

function complete(fromPlay) {
  T.done = true;
  const step = T.lesson.steps[T.si];
  const text = step.free ? 'Solved! Every match is in place. Press Next.' : 'Well done! That step is finished. Press Next to go on.';
  $('#step-feedback').textContent = text;
  updateNext();
  if (fromPlay) { deps.sound(step.free ? 'solve' : 'ok'); deps.announce(text); }
}

function updateNext() {
  const step = T.lesson.steps[T.si];
  const waiting = !!(step.expect || step.free) && !T.done;
  const btn = $('#step-next');
  btn.disabled = waiting;
  btn.classList.toggle('ready', !!(step.expect || step.free) && T.done);
  $('#learn-undo').disabled = !T.undo.length;
  $('#learn-redo').disabled = !T.redo.length;
}

function next() {
  if (!T) return;
  if (T.si < T.lesson.steps.length - 1) { goStep(T.si + 1); return; }
  if (T.li < LESSONS.length - 1) openLesson(T.li + 1);
  else deps.onPlayBasic();
}

// Show me: takes back marks that don't fit, then places this step's marks.
function showMe() {
  const step = T.lesson.steps[T.si];
  if (!step.expect) return;
  const changes = [];
  for (const k of T.wrong) changes.push({ k, b: T.marks.get(k) || '', a: '' });
  for (const m of step.expect) {
    const { k, v } = parse(m);
    const cur = T.marks.get(k) || '';
    if (cur !== v) { const i = changes.findIndex((c) => c.k === k); if (i >= 0) changes[i].a = v; else changes.push({ k, b: cur, a: v }); }
  }
  if (!changes.length) return;
  apply(changes);
  paintAll();
  deps.announce(`Marked for you: ${step.expect.map((m) => { const [v, a, b] = m.split(' '); return `${a} and ${b}, ${v === 'O' ? 'O' : 'X'}`; }).join('; ')}.`);
  afterChange();
  T.grid.focusKey(parse(step.expect[0]).k);
}

// ---- hints and check (the solo step)
async function hint() {
  if (!T) return;
  const box = $('#learn-hint');
  if (T.hint && T.hint.level < T.hint.levels.length - 1) {
    T.hint.level++;
  } else {
    const marks = [...T.marks].map(([k, v]) => { const [a, b] = k.split('|'); return { a, b, mark: v === 'O' ? 'O' : 'X' }; });
    let res;
    try { res = await deps.hint(T.puzzle, marks); } catch (e) { box.hidden = false; box.innerHTML = '<p>Hints are not available right now. Try the clue that names the most squares you have not marked yet.</p>'; return; }
    if (!T) return;
    T.hint = { level: 0, levels: res.levels, kind: res.kind, targets: new Set((res.marks || []).map((m) => T.ix.key(m.a, m.b))) };
    if (res.kind === 'mistake') for (const k of T.hint.targets) T.wrong.add(k);
  }
  const h = T.hint;
  const more = h.level < h.levels.length - 1;
  box.innerHTML = `<p><b>Hint${h.levels.length > 1 ? ` ${h.level + 1} of ${h.levels.length}` : ''}:</b> ${esc(h.levels[h.level])}</p>${more ? '<div class="row"><button class="btn small" type="button" id="learn-hint-more">Tell me more</button></div>' : ''}`;
  box.hidden = false;
  const m = $('#learn-hint-more');
  if (m) m.onclick = hint;
  paintAll();
  deps.sound('hint');
  deps.announce(`Hint: ${h.levels[h.level]}`);
}

function check() {
  if (!T) return;
  T.wrong = new Set([...T.marks].filter(([k, v]) => !fits(k, v)).map(([k]) => k));
  paintAll();
  const n = T.wrong.size;
  const text = n ? `${n} mark${n > 1 ? 's are' : ' is'} wrong, shown with a warning sign. Change ${n > 1 ? 'them' : 'it'} or press Undo.` : T.marks.size ? 'All your marks are right so far.' : 'Nothing to check yet: make some marks first.';
  $('#step-feedback').textContent = text;
  deps.sound(n ? 'error' : 'ok');
  deps.announce(text);
}

function describeRow(rowItem) {
  const parts = [];
  const rowCat = rowItem.split(':')[0];
  for (const c of T.ix.cats) {
    if (c.id === rowCat) continue;
    const states = c.items.map((it) => ({ it, s: T.marks.get(T.ix.key(rowItem, it.id)) || '' }));
    const o = states.find((x) => x.s === 'O');
    if (o) parts.push(`${c.name}: ${o.it.label} confirmed`);
    else {
      const out = states.filter((x) => x.s).map((x) => x.it.label);
      parts.push(`${c.name}: ${out.length ? `${out.join(', ')} ruled out` : 'nothing marked'}`);
    }
  }
  deps.announce(`${T.ix.label(rowItem)}. ${parts.join('. ')}.`);
}

// For tests.
export const state = () => T;
