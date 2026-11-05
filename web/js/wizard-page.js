// The Puzzle Wizard (web/wizard/ and web/wizard/check/).
//
// wizard/?game=fantastical|ninetimesnine   step-by-step questions for that game
// wizard/check/?game=...                   what is missing or wrong, an editor for
//                                          every answer, the one-answer check, and
//                                          Build my puzzle: the PDF, Saved puzzles
//                                          and a copy for the team
//
// Everything typed is saved on this device as it is typed (localStorage; the
// pictures and sounds in IndexedDB), so leaving and coming back keeps the
// draft. The live storyline at the bottom shows the puzzle's words as players
// will read them.
import { GAMES, GAME_IDS, STEPS, FIELDS, FILES, blankEntry, checkEntry, storyText } from './wizard-fields.js';
import * as form from './wizard-form.js';
import { checkGivens, buildPuzzle, savePuzzle, downloadPdf, printPdf } from './wizard-build.js';
import { prepareImage, ACCEPT } from './image-prep.js';
import * as store from './store.js';
import * as account from './account.js';
import * as engine from './engine-client.js';
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import { OPTIONS } from '../engine/options.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = form.esc;
const MODE = document.body.dataset.mode === 'check' ? 'check' : 'wizard';
const ROOT = MODE === 'check' ? '../../' : '../';

// The player's saved color theme, as in the game; never inside another site's frame.
try { const s = JSON.parse(localStorage.getItem('flg.settings') || '{}'); if (s.colorTheme && s.colorTheme !== 'system') document.documentElement.dataset.theme = s.colorTheme; } catch (e) { /* default */ }
if (window.top !== window.self) { document.documentElement.hidden = true; try { window.top.location = window.location.href; } catch (e) { /* blocked */ } }

const params = new URLSearchParams(location.search);
const game = GAME_IDS.find((id) => id === params.get('game')) || null;

// ---------------------------------------------------------------- the draft
const DRAFT = (g) => `flg.wizard.${g}`;
let entry = null;
let step = 0;
let fileData = []; // [{ dataUrl, bytes }] in the same order as entry.files
let savedAt = 0;

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT(game)) || 'null');
    if (d && d.entry && d.entry.game === game) return d;
  } catch (e) { /* none */ }
  return null;
}
let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  $('#w-saved').textContent = 'Saving…';
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT(game), JSON.stringify({ entry, step, updated: Date.now() }));
      savedAt = Date.now();
      $('#w-saved').textContent = `Saved on this device at ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (e) {
      $('#w-saved').textContent = 'Could not save on this device (storage is full or blocked). Keep this page open.';
    }
  }, 350);
}

// Pictures and sounds: too big for localStorage, so they go in IndexedDB.
function filesDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('flg-wizard', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function filesGet() {
  try {
    const db = await filesDb();
    return await new Promise((res) => { const q = db.transaction('files').objectStore('files').get(game); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
  } catch (e) { return []; }
}
async function filesPut() {
  try {
    const db = await filesDb();
    db.transaction('files', 'readwrite').objectStore('files').put(fileData, game);
  } catch (e) { /* kept for this visit only */ }
}
async function clearDraft() {
  try { localStorage.removeItem(DRAFT(game)); } catch (e) { /* none */ }
  fileData = [];
  await filesPut();
}

// ---------------------------------------------------------------- drawing
const guidanceOn = () => $('#w-guidance').checked;
const ctx = () => ({ themes: OPTIONS.themes, fileData, accept: { image: ACCEPT }, screenName: (store.getLocal('profile') || {}).screenName || '' });
const formEl = () => $('#w-form');

function draw() {
  const steps = MODE === 'wizard' ? [STEPS[game][step].id] : null;
  form.render(formEl(), game, entry, { steps, guidance: guidanceOn(), ctx: ctx() });
  drawProgress();
  check();
  drawStory();
}

function drawProgress() {
  if (MODE !== 'wizard') return;
  const list = STEPS[game];
  $('#w-steps').innerHTML = list.map((s, i) => `<li><button type="button" class="w-stepbtn" data-go="${i}"${i === step ? ' aria-current="step"' : ''}><span class="w-num">${i + 1}</span> ${esc(s.title)}</button></li>`).join('');
  $('#w-stepname').textContent = `Step ${step + 1} of ${list.length}: ${list[step].title}`;
  $('#w-prev').hidden = step === 0;
  $('#w-next').textContent = step === list.length - 1 ? 'Check my puzzle' : 'Next';
}

function drawStory() {
  $('#w-preview').value = storyText(entry);
}

// ---------------------------------------------------------------- checking
let lastResult = null;
let buildTimer = 0;
let trial = 0;
function check() {
  const r = checkEntry(entry);
  lastResult = r;
  // In the wizard, only the current step's problems show (and only once a field is filled in or Next was pressed).
  const shown = MODE === 'wizard' ? filterStep(r) : r;
  form.showMessages(formEl(), shown, { warnings: MODE === 'wizard' || $('#c-suggest')?.checked });
  oneCheck(r);
  if (MODE === 'check') drawIssues(r);
  return r;
}
const touched = new Set();
function filterStep(r) {
  const here = STEPS[game][step].id;
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => form.stepOfKey(game, k) === here && (touched.has(here) || touched.has(form.fieldOfKey(k)))));
  return { errors: pick(r.errors), warnings: pick(r.warnings) };
}

// The live one-answer check for an author's own number grid.
let givensSuggestion = null;
function oneCheck(r) {
  const box = $('[data-onecheck]', formEl());
  // The suggestion stays until a new answer replaces it: leaving a cell to
  // click "Add that number" runs this check again first.
  const count = $('[data-givens-count]', formEl());
  if (count) count.textContent = String((entry.givens || []).filter(Boolean).length);
  if (!box || game !== 'ninetimesnine' || entry.givensMode !== 'mine') { givensSuggestion = null; return; }
  const my = ++oneCheckSeq;
  clearTimeout(oneCheckTimer);
  if (r.errors.givens) { givensSuggestion = null; box.innerHTML = ''; box.dataset.html = ''; return; }
  // The check can run on the puzzle server (docs/PUZZLE-SERVER.md), so it
  // waits for a short pause in typing and drops answers that are out of date.
  oneCheckTimer = setTimeout(async () => {
    let g;
    try { g = await checkGivens(r.value); } catch (e) { g = { ok: false, words: e.message, suggestion: null }; }
    if (my !== oneCheckSeq) return;
    givensSuggestion = g.suggestion;
    const html = `<p class="w-msg ${g.ok ? 'good' : 'bad'}">${esc(g.words)}</p>${g.suggestion ? '<button class="btn small" type="button" data-use-suggestion>Add that number</button>' : ''}`;
    // Only redraw when it changed, so a click on the button is never lost.
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  }, 200);
}
let oneCheckSeq = 0;
let oneCheckTimer = null;

// ---------------------------------------------------------------- the check page
let issuesSeq = 0;
function drawIssues(r) {
  issuesSeq++;
  const errs = Object.entries(r.errors);
  const tips = Object.entries(r.warnings).filter(([k]) => !r.errors[k]);
  const showTips = $('#c-suggest').checked;
  const item = ([k, w], cls) => `<li class="${cls}"><a href="#w-${form.fieldOfKey(k)}-f" data-jump="${esc(form.fieldOfKey(k))}">${esc(FIELDS[game][form.fieldOfKey(k)]?.label || 'Entry')}</a>: ${esc(w)}</li>`;
  $('#c-issues').innerHTML = errs.length || (showTips && tips.length)
    ? `<ul>${errs.map((x) => item(x, 'bad')).join('')}${showTips ? tips.map((x) => item(x, 'tip')).join('') : ''}</ul>`
    : '<p class="help">Nothing is missing.</p>';
  $('#c-tips-count').textContent = tips.length ? `(${tips.length})` : '';
  const status = $('#c-status');
  if (errs.length) {
    status.className = 'c-status bad';
    status.innerHTML = `<b>Not ready yet.</b> ${errs.length === 1 ? 'One thing needs' : `${errs.length} things need`} fixing before your puzzle can be built.`;
    $('#c-build').disabled = true;
    return;
  }
  if (game === 'ninetimesnine') {
    const my = ++issuesSeq;
    $('#c-build').disabled = true;
    (async () => {
      let g;
      try { g = entry.givensMode === 'mine' ? await checkGivens(r.value) : { ok: true, words: 'The wizard will make a grid with exactly one answer.' }; } catch (e) { g = { ok: false, words: e.message, suggestion: null }; }
      if (my !== issuesSeq) return;
      status.className = `c-status ${g.ok ? 'good' : 'bad'}`;
      status.innerHTML = `<b>${g.ok ? 'Ready to build.' : 'Not ready yet.'}</b> ${esc(g.words)}${g.suggestion ? ' <button class="btn small" type="button" data-use-suggestion>Add that number</button>' : ''}`;
      givensSuggestion = g.suggestion;
      $('#c-build').disabled = !g.ok;
    })();
    return;
  }
  // The logic grid: a trial build proves the clues lead to one answer.
  status.className = 'c-status wait';
  status.innerHTML = '<b>Checking…</b> The wizard is trying to write clues that lead to exactly one answer.';
  $('#c-build').disabled = true;
  clearTimeout(buildTimer);
  const mine = ++trial;
  buildTimer = setTimeout(async () => {
    try {
      const b = await buildPuzzle(entry, { seed: 'check', generate: engine.generate });
      if (mine !== trial) return;
      status.className = 'c-status good';
      status.innerHTML = `<b>Ready to build.</b> Your puzzle will have exactly one answer${b.puzzle.wizard && entry.answerMode === 'mine' ? ', the one you chose' : ''}, and players can reason it out step by step from the clues the wizard writes.`;
      $('#c-build').disabled = false;
    } catch (e) {
      if (mine !== trial) return;
      status.className = 'c-status bad';
      status.innerHTML = `<b>Not ready yet.</b> ${esc(e.message)} Try fewer names or lists, or another difficulty.`;
    }
  }, 600);
}

// ---------------------------------------------------------------- changes
function onChange(e, { redraw }) {
  autosave();
  if (redraw === true) { const y = scrollY; draw(); scrollTo(0, y); return; }
  if (redraw === 'soft') form.refresh(formEl(), game, entry, { guidance: guidanceOn(), ctx: ctx() });
  check();
  drawStory();
}

async function addFiles(kind, files) {
  const rule = FILES[kind];
  const msg = $('[data-msg-for="filesAdd"]', formEl());
  const problems = [];
  for (const f of files) {
    if (entry.files.filter((x) => x.kind === kind).length >= rule.max) { problems.push(`You can add up to ${rule.max} ${kind === 'image' ? 'pictures' : 'sounds'}.`); break; }
    try {
      let data;
      if (kind === 'image') {
        const p = await prepareImage(f, { maxSide: 1600, maxBytes: 850_000 });
        data = { dataUrl: p.dataUrl, bytes: p.bytes, width: p.width, height: p.height };
      } else {
        if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|ogg|oga|wav|webm)$/i.test(f.name)) throw new Error('That is not a sound file. Try an MP3, M4A, OGG or WAV.');
        if (f.size > rule.bytes) throw new Error(`That sound is ${Math.round(f.size / 1024)} KB. Sounds can be up to ${Math.round(rule.bytes / 1000)} KB; try a shorter clip.`);
        data = { dataUrl: await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('That sound could not be read.')); r.readAsDataURL(f); }), bytes: f.size };
      }
      entry.files.push({ kind, name: String(f.name || kind).slice(0, 80), purpose: kind === 'image' ? 'cover' : 'solved', use: true, credit: true, creditAs: 'screen' });
      fileData.push(data);
    } catch (err) { problems.push(`${f.name}: ${err.message}`); }
  }
  await filesPut();
  autosave();
  draw();
  const m = $('[data-msg-for="filesAdd"]', formEl());
  if (m && problems.length) { m.textContent = problems.join(' '); m.className = 'w-msg bad'; }
  else if (msg) msg.textContent = '';
}
async function removeFile(i) {
  entry.files.splice(i, 1);
  fileData.splice(i, 1);
  await filesPut();
  autosave();
  draw();
  $('[data-add-file]', formEl())?.closest('div')?.querySelector('label')?.focus();
}

// ---------------------------------------------------------------- the video and the guide
function guideHtml() {
  return STEPS[game].map((s, i) => `<h3>${i + 1}. ${esc(s.title)}</h3><p>${esc(s.intro)}</p><dl>${s.fields.map((k) => `<dt>${esc(FIELDS[game][k].label)}${FIELDS[game][k].req ? ' (required)' : ''}</dt><dd>${esc(FIELDS[game][k].help)} <i>${esc(FIELDS[game][k].use)}</i></dd>`).join('')}</dl>`).join('');
}
function openVideo() {
  const d = $('#w-video');
  const v = $('#w-video-player');
  if (!v.dataset.ready) {
    v.dataset.ready = '1';
    v.poster = `${ROOT}media/wizard/${game}.jpg`;
    // Built with DOM calls (game is one of GAME_IDS, never free text from the address).
    const source = Object.assign(document.createElement('source'), { src: `${ROOT}media/wizard/${game}.mp4`, type: 'video/mp4' });
    const track = Object.assign(document.createElement('track'), { kind: 'captions', srclang: 'en', label: 'English', src: `${ROOT}media/wizard/${game}.en.vtt`, default: true });
    v.replaceChildren(source, track);
    v.addEventListener('error', () => { v.hidden = true; $('#w-video-none').hidden = false; }, true);
    $('source', v).addEventListener('error', () => { v.hidden = true; $('#w-video-none').hidden = false; });
    $('#w-guide-list').innerHTML = guideHtml();
  }
  d.showModal();
}

// ---------------------------------------------------------------- building (check page)
let built = null;
function creditName(v) {
  if (v.credit.as === 'none') return '';
  if (v.credit.as === 'real') return v.credit.real;
  return (store.getLocal('profile') || {}).screenName || 'a Logic Grid player';
}
async function build() {
  const r = check();
  if (!r.ready) return;
  const btn = $('#c-build');
  btn.disabled = true;
  btn.textContent = 'Building your puzzle…';
  $('#c-build-error').hidden = true;
  try {
    built = await buildPuzzle(entry, { credit: creditName(r.value), generate: engine.generate });
    const saved = await savePuzzle(built, { store });
    showResult(saved);
    send(r.value, built);
  } catch (e) {
    $('#c-build-error').textContent = e.message;
    $('#c-build-error').hidden = false;
  } finally {
    btn.textContent = 'Build my puzzle';
    btn.disabled = false;
  }
}
async function showResult(saved) {
  const p = built.puzzle;
  $('#c-editor').hidden = true;
  const box = $('#c-result');
  box.hidden = false;
  $('#c-result-title').textContent = built.game === 'ninetimesnine' ? p.story.title : p.title;
  $('#c-result-meta').textContent = built.game === 'ninetimesnine'
    ? `NINETIMESNINE · ${p.difficulty.name} · ${p.size} × ${p.size} · ${p.givens.filter(Boolean).length} starting numbers`
    : `The Fantastical Logic Grid · ${p.difficulty.name} · ${p.categories.length} lists of ${p.categories[0].items.length} · ${p.clues.length} clues`;
  $('#c-saved-msg').textContent = `Saved to ${saved.where}.`;
  const gamePage = built.game === 'ninetimesnine' ? 'ninetimesnine/' : 'fantastical/?open=saved';
  // In the apps the game is at the top of the site; on the website it has its own page.
  let href = `${ROOT}${gamePage}`;
  try { const res = await fetch(`${ROOT}${built.game === 'ninetimesnine' ? 'ninetimesnine/' : 'fantastical/'}`, { method: 'HEAD' }); if (!res.ok) href = `${ROOT}${built.game === 'ninetimesnine' ? '' : '?open=saved'}`; } catch (e) { /* keep */ }
  $('#c-open').href = href;
  $('#c-result').focus();
}

// A copy for the team (Storyline submissions in the admin app), with the pictures and sounds.
async function send(v, b) {
  const out = $('#c-send-msg');
  if (!CLOUD_URL) { out.textContent = 'This copy of the game cannot send puzzles to the team. Your puzzle is saved on this device.'; return; }
  out.textContent = 'Sending a copy to the team…';
  try {
    let token = null;
    if (account.current()) { try { token = await account.getIdToken(); } catch (e) { /* sent as a guest */ } }
    const files = v.files.map((f, i) => ({ ...f, dataUrl: fileData[i]?.dataUrl, width: fileData[i]?.width, height: fileData[i]?.height }));
    const res = await fetch(`${CLOUD_URL}/v1/story-submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ kind: 'puzzle', entry: v, seed: b.puzzle.seed, credit: creditName(v), files, platform: 'web', version: CLOUD.appVersion || 'dev' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'The copy could not be sent.');
    out.textContent = data.copy === 'emailed' ? 'A copy went to the team, and a confirmation is on its way to your email.' : 'A copy went to the team. They review every puzzle, and may publish yours in the game with your credit.';
  } catch (e) {
    out.innerHTML = `${esc(/fetch|network/i.test(e.message) ? 'The copy could not be sent right now.' : e.message)} Your puzzle is saved on this device. <button class="btn small" type="button" id="c-send-again">Try again</button>`;
  }
}

// ---------------------------------------------------------------- start
async function start() {
  if (!game) {
    if (MODE === 'check') { location.replace(`../${location.search}`); return; }
    $('#w-choose').hidden = false;
    $('#w-main').hidden = true;
    return;
  }
  $('#w-choose') && ($('#w-choose').hidden = true);
  $('#w-main').hidden = false;
  if (MODE === 'check') $('#w-back').href = `../?game=${game}`;
  const g = GAMES[game];
  $('#w-h1').textContent = MODE === 'check' ? `Check your puzzle: ${g.name}` : `Submit Puzzle Ideas: ${g.name}`;
  document.title = `${MODE === 'check' ? 'Check your puzzle' : 'Submit Puzzle Ideas'} · ${g.name}`;
  $('#w-blurb').textContent = g.blurb;
  const d = loadDraft();
  entry = d ? { ...blankEntry(game), ...d.entry } : blankEntry(game);
  step = d && MODE === 'wizard' ? Math.min(Math.max(0, d.step || 0), STEPS[game].length - 1) : 0;
  fileData = await filesGet();
  if (fileData.length !== entry.files.length) { fileData = fileData.slice(0, entry.files.length); while (fileData.length < entry.files.length) entry.files.pop(); }
  if (d) {
    $('#w-restored').hidden = false;
    $('#w-saved').textContent = `Draft saved on this device ${new Date(d.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    if (MODE === 'wizard') for (let i = 0; i < step; i++) touched.add(STEPS[game][i].id);
  }
  $('#w-guidance').checked = MODE === 'wizard';
  formEl().addEventListener('submit', (e) => e.preventDefault());
  form.wire(formEl(), () => entry, onChange, { onAddFile: addFiles, onRemoveFile: removeFile });
  formEl().addEventListener('focusout', (e) => { const f = e.target.closest('.w-field'); if (f && MODE === 'wizard') { touched.add(f.dataset.field); check(); } });
  formEl().addEventListener('click', (e) => {
    if (e.target.closest('[data-use-suggestion]') && givensSuggestion && !entry.givens[givensSuggestion.cell]) {
      entry.givens[givensSuggestion.cell] = givensSuggestion.digit;
      autosave();
      draw();
    }
  });
  draw();
}

function go(i) {
  touched.add(STEPS[game][step].id);
  step = Math.max(0, Math.min(STEPS[game].length - 1, i));
  autosave();
  draw();
  scrollTo(0, 0);
  $('#w-form h2')?.setAttribute('tabindex', '-1');
  $('#w-form h2')?.focus();
}

// Buttons outside the form.
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.go !== undefined) { go(Number(t.dataset.go)); return; }
  if (t.dataset.jump) {
    e.preventDefault();
    const f = $(`[data-field="${CSS.escape(t.dataset.jump)}"]`, formEl());
    if (f) { f.scrollIntoView({ block: 'center' }); ($('input:not([type=hidden]), select, textarea, button', f) || f).focus(); }
    return;
  }
  switch (t.id) {
    case 'w-prev': go(step - 1); break;
    case 'w-next': {
      const here = STEPS[game][step].id;
      touched.add(here);
      for (const k of STEPS[game][step].fields) touched.add(k);
      const r = check();
      const left = Object.keys(r.errors).filter((k) => form.stepOfKey(game, k) === here).length;
      if (step < STEPS[game].length - 1) {
        go(step + 1);
        if (left) $('#w-saved').textContent = `Saved. Step ${step} has ${left === 1 ? 'one thing' : `${left} things`} to finish; you can come back to it.`;
      } else {
        try { localStorage.setItem(DRAFT(game), JSON.stringify({ entry, step, updated: Date.now() })); } catch (err) { /* autosave tried already */ }
        location.href = `check/?game=${game}`;
      }
      break;
    }
    case 'w-restart':
      if (!confirm('Start over? This clears your draft on this device, including pictures and sounds.')) return;
      await clearDraft();
      entry = blankEntry(game);
      step = 0;
      touched.clear();
      $('#w-restored').hidden = true;
      $('#w-saved').textContent = 'Started a new draft.';
      draw();
      break;
    case 'w-watch': openVideo(); break;
    case 'w-video-close': $('#w-video').close(); $('#w-video-player').pause(); break;
    case 'c-build': build(); break;
    case 'c-pdf': if (built) $('#c-pdf-msg').textContent = `Downloaded ${downloadPdf(built.pdf, $('#c-result-title').textContent)}.`; break;
    case 'c-print': if (built) printPdf(built.pdf); break;
    case 'c-edit':
      $('#c-result').hidden = true;
      $('#c-editor').hidden = false;
      $('#c-suggest').checked = true;
      check();
      $('#c-edit-note').hidden = false;
      $('#c-status').focus();
      break;
    case 'c-send-again': send(checkEntry(entry).value, built); break;
    default:
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'w-guidance') { for (const el of $$('.w-guide', formEl())) el.hidden = !e.target.checked; }
  if (e.target.id === 'c-suggest') check();
});

start();
