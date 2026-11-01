// The Suggest a storyline page (web/storyline/), opened from Menu > Suggest a
// storyline and from Share an idea. Players send a theme idea, a category idea
// for an existing theme, or a whole storyline; the Worker saves it in the
// Storyline Submission Database (server/src/story-submissions.js).
//
// Signed in with a confirmed email, the player gets a confirmation and a copy
// of the completed form by email. A guest sees a thank-you and can type an
// email address to get the copy (and, for a storyline, the finished puzzle if
// it is approved), or say no thanks.
//
// Editing: the edit link in the confirmation email (storyline/?edit=ID.KEY),
// or Edit and resubmit in "Your entries" when signed in, opens the entry here
// with everything filled in; Resubmit sends the new version
// (POST /v1/story-submissions/:id/resubmit).
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import { OPTIONS } from '../engine/options.js';
import { checkSubmission, TONES, DIFFICULTIES, REWARDS, PUZZLES, MAX_CHARACTERS, MAX_CATEGORIES, MAX_ITEMS, ORDERS, CONSENT_TEXT, KINDS } from './storyline-fields.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The player's saved color theme, as in the game.
try { const s = JSON.parse(localStorage.getItem('flg.settings') || '{}'); if (s.colorTheme && s.colorTheme !== 'system') document.documentElement.dataset.theme = s.colorTheme; } catch (e) { /* default */ }
// Never inside another site's frame.
if (window.top !== window.self) { document.documentElement.hidden = true; try { window.top.location = window.location.href; } catch (e) { /* blocked */ } }

const form = $('#sl-form');
const kind = () => $('input[name=kind]:checked', form).value;
const section = (k = kind()) => $(`section[data-kind="${k}"]`, form);
const option = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;

// ---------- choices
for (const sel of ['#sl-cat-theme', '#sl-story-theme']) $(sel).insertAdjacentHTML('beforeend', OPTIONS.themes.map((t) => option(t.id, t.name)).join(''));
$('#sl-tone').insertAdjacentHTML('beforeend', TONES.map((t) => option(t, t)).join(''));
$('#sl-diff').insertAdjacentHTML('beforeend', DIFFICULTIES.map(([id, name]) => option(id, name)).join(''));
$('#sl-puzzle').innerHTML = PUZZLES.map(([id, name]) => option(id, name)).join('');
$('#sl-puzzle-field').hidden = PUZZLES.length < 2; // one puzzle: no question
$('#sl-rewards').innerHTML = Object.entries(REWARDS).map(([k, r]) => `<div class="field sl-field"><label for="sl-reward-${k}">${esc(r.label)}</label>
  <select id="sl-reward-${k}" name="reward-${k}" aria-describedby="sl-reward-h">${r.options.map((o) => option(o, o)).join('')}</select></div>`).join('');
$('#sl-consent-text').textContent = CONSENT_TEXT;

function showKind() {
  for (const s of $$('section[data-kind]', form)) s.hidden = s.dataset.kind !== kind();
  $('#sl-send').textContent = kind() === 'storyline' ? 'Send my storyline' : `Send my ${KINDS[kind()].toLowerCase()}`;
}
for (const r of $$('input[name=kind]', form)) r.addEventListener('change', () => { clearErrors(); showKind(); });

// ---------- character counters
function wireCount(input) {
  const out = document.getElementById(input.getAttribute('aria-describedby').split(' ').find((id) => id.endsWith('-c')));
  const max = Number(input.maxLength);
  const draw = () => { out.textContent = `${input.value.length} of ${max} characters`; };
  input.addEventListener('input', draw);
  draw();
}
$$('[data-count]', form).forEach(wireCount);

// ---------- characters: one box for each, keeping what was typed
const typed = [];
function readCharacters() {
  $$('.sl-char:not(.sl-cat)', form).forEach((box, i) => {
    typed[i] = { name: $('[data-c=name]', box).value, trait: $('[data-c=trait]', box).value, role: ($('[data-c=role]:checked', box) || {}).value || 'Supporting', gender: ($('[data-c=gender]:checked', box) || {}).value || '' };
  });
}
function drawCharacters() {
  readCharacters();
  const input = $('#sl-nchar');
  const n = Math.max(1, Math.min(MAX_CHARACTERS, Math.round(Number(input.value)) || 1));
  if (String(n) !== input.value) input.value = n;
  const box = $('#sl-chars');
  const have = $$('.sl-char', box).length; // only the characters' boxes are in #sl-chars
  if (have === n) return;
  box.innerHTML = Array.from({ length: n }, (_, i) => {
    const c = typed[i] || { name: '', trait: '', role: i === 0 ? 'Main' : 'Supporting', gender: '' };
    const id = `sl-c${i}`;
    return `<fieldset class="sl-char"><legend>Character ${i + 1}</legend>
      <div class="field sl-field" data-field="name${i}">
        <label for="${id}-name">Character name <span class="sl-req" aria-hidden="true">*</span></label>
        <p class="help" id="${id}-name-h">Who they are. Required so clues can refer to them.</p>
        <input type="text" id="${id}-name" data-c="name" maxlength="30" required value="${esc(c.name)}" aria-describedby="${id}-name-h ${id}-name-x">
        <p class="sl-ex" id="${id}-name-x">Example: Lady Ashford</p>
        <p class="sl-err" role="alert"></p>
      </div>
      <div class="field sl-field">
        <label for="${id}-trait">Character trait</label>
        <p class="help" id="${id}-trait-h">One word or phrase that describes them.</p>
        <input type="text" id="${id}-trait" data-c="trait" maxlength="30" value="${esc(c.trait)}" aria-describedby="${id}-trait-h ${id}-trait-x">
        <p class="sl-ex" id="${id}-trait-x">Example: Nervous</p>
      </div>
      <fieldset class="sl-field" aria-describedby="${id}-gender-h"><legend class="sl-legend">Gender</legend>
        <p class="help" id="${id}-gender-h">So the story says he or she, and the character gets a fitting voice and picture.</p>
        <div class="sl-radios">
          <label class="radio"><input type="radio" name="${id}-gender" data-c="gender" value="Male"${c.gender === 'Male' ? ' checked' : ''}> Male</label>
          <label class="radio"><input type="radio" name="${id}-gender" data-c="gender" value="Female"${c.gender === 'Female' ? ' checked' : ''}> Female</label>
        </div>
        <p class="sl-ex">Example: Female</p>
      </fieldset>
      <fieldset class="sl-field"><legend class="sl-legend">Character role</legend>
        <div class="sl-radios">
          <label class="radio"><input type="radio" name="${id}-role" data-c="role" value="Main"${c.role === 'Main' ? ' checked' : ''}> Main</label>
          <label class="radio"><input type="radio" name="${id}-role" data-c="role" value="Supporting"${c.role !== 'Main' ? ' checked' : ''}> Supporting</label>
        </div>
        <p class="sl-ex">Example: Main</p>
      </fieldset>
    </fieldset>`;
  }).join('');
}
$('#sl-nchar').addEventListener('change', drawCharacters);
$('#sl-nchar').addEventListener('input', () => { if ($('#sl-nchar').value) drawCharacters(); });
drawCharacters();

// ---------- categories builder: added one at a time, up to MAX_CATEGORIES
const cats = []; // what was typed: { name, items, order }
const CAT_EXAMPLES = [['Room', 'Library, Kitchen, Garden'], ['Arrival time', '7:00 PM, 7:15 PM, 7:30 PM'], ['Drink', 'Tea, Punch, Cider'], ['Mask', 'Fox, Owl, Swan']];
function readCategories() {
  $$('.sl-cat', form).forEach((box, i) => { cats[i] = { name: $('[data-k=name]', box).value, items: $('[data-k=items]', box).value, order: $('[data-k=order]', box).value }; });
}
function drawCategories(focusIndex = -1) {
  const box = $('#sl-cats');
  box.innerHTML = cats.map((c, i) => {
    const id = `sl-k${i}`;
    const [exName, exItems] = CAT_EXAMPLES[i] || CAT_EXAMPLES[0];
    return `<fieldset class="sl-char sl-cat"><legend class="sr-only">Category ${i + 1}</legend>
      <div class="sl-cat-head"><p class="sl-legend">Category ${i + 1}</p><button class="btn quiet small" type="button" data-remove-cat="${i}" aria-label="Remove category ${i + 1}">Remove</button></div>
      <div class="field sl-field" data-field="catName${i}">
        <label for="${id}-name">Category name <span class="sl-req" aria-hidden="true">*</span></label>
        <p class="help" id="${id}-name-h">What the list is. Required for each category you add, so the grid can label the column.</p>
        <input type="text" id="${id}-name" data-k="name" maxlength="30" value="${esc(c.name)}" aria-describedby="${id}-name-h ${id}-name-x">
        <p class="sl-ex" id="${id}-name-x">Example: ${esc(exName)}</p>
        <p class="sl-err" role="alert"></p>
      </div>
      <div class="field sl-field" data-field="catItems${i}">
        <label for="${id}-items">Items <span class="sl-req" aria-hidden="true">*</span></label>
        <p class="help" id="${id}-items-h">3 to ${MAX_ITEMS} different things, separated by commas. Required so players have something to match. One for each character works best.</p>
        <input type="text" id="${id}-items" data-k="items" maxlength="300" value="${esc(c.items)}" aria-describedby="${id}-items-h ${id}-items-x ${id}-items-n">
        <p class="sl-count" id="${id}-items-n" aria-live="polite"></p>
        <p class="sl-ex" id="${id}-items-x">Example: ${esc(exItems)}</p>
        <p class="sl-err" role="alert"></p>
      </div>
      <div class="field sl-field">
        <label for="${id}-order">Are they in order?</label>
        <p class="help" id="${id}-order-h">For times, numbers, prices or sizes, list them from first to last and choose the order. Ordered lists allow clues like "arrived earlier than".</p>
        <select id="${id}-order" data-k="order" aria-describedby="${id}-order-h ${id}-order-x">${ORDERS.map(([v, l]) => `<option value="${v}"${v === c.order ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <p class="sl-ex" id="${id}-order-x">Example: Earliest to latest (times, dates)</p>
      </div>
    </fieldset>`;
  }).join('');
  $('#sl-add-cat').hidden = cats.length >= MAX_CATEGORIES;
  countItems();
  if (focusIndex >= 0) { const el = $(`#sl-k${focusIndex}-name`); if (el) el.focus(); }
}
// A live count of each category's items, against the number of characters.
function countItems() {
  const n = $$('.sl-char:not(.sl-cat)', form).length;
  $$('.sl-cat', form).forEach((box, i) => {
    const items = $('[data-k=items]', box).value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).length;
    $(`#sl-k${i}-items-n`).textContent = `${items} ${items === 1 ? 'item' : 'items'}${n >= 3 && items && items !== n ? ` (you have ${n} characters)` : ''}`;
  });
  $('#sl-cats-count').textContent = cats.length ? `${cats.length} of ${MAX_CATEGORIES} categories` : '';
}
$('#sl-add-cat').addEventListener('click', () => {
  readCategories();
  if (cats.length >= MAX_CATEGORIES) return;
  cats.push({ name: '', items: '', order: '' });
  drawCategories(cats.length - 1);
});
$('#sl-cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove-cat]');
  if (!b) return;
  readCategories();
  const i = Number(b.dataset.removeCat);
  cats.splice(i, 1);
  drawCategories();
  ($(`#sl-k${Math.min(i, cats.length - 1)}-name`) || $('#sl-add-cat')).focus();
});
$('#sl-cats').addEventListener('input', (e) => { if (e.target.dataset.k === 'items') countItems(); });
$('#sl-chars').addEventListener('input', countItems);
$('#sl-nchar').addEventListener('change', countItems);

// ---------- reading and checking
function entry() {
  const k = kind();
  const s = section(k);
  if (k === 'theme') return { kind: k, idea: $('#sl-theme-idea').value };
  if (k === 'category') return { kind: k, theme: $('#sl-cat-theme').value, idea: $('#sl-cat-idea').value };
  readCharacters();
  const val = (name) => $(`[name="${name}"]`, s).value;
  return {
    kind: k, theme: val('theme'), title: val('title'), pitch: val('pitch'), setting: val('setting'),
    characters: typed.slice(0, $$('.sl-char:not(.sl-cat)', s).length),
    categories: (readCategories(), cats.slice()),
    goal: val('goal'), puzzle: val('puzzle'), clues: val('clues'), beat: val('beat'), branch: val('branch'), alt: val('alt'),
    tone: val('tone'), difficulty: val('difficulty'),
    reward: Object.fromEntries(Object.keys(REWARDS).map((r) => [r, val(`reward-${r}`)])),
    credit: val('credit'), consent: $('#sl-consent').checked,
  };
}

function clearErrors() {
  for (const f of $$('.sl-field.invalid', form)) {
    f.classList.remove('invalid');
    const e = $('.sl-err', f);
    if (e) e.textContent = '';
    for (const c of $$('input, select, textarea', f)) c.removeAttribute('aria-invalid');
  }
  $('#sl-error').hidden = true;
}

function showErrors(errors) {
  let first = null;
  for (const [key, words] of Object.entries(errors)) {
    const f = $(`[data-field="${key}"]`, section()) || $(`[data-field="${key}"]`, form);
    if (!f) continue;
    f.classList.add('invalid');
    const e = $('.sl-err', f);
    if (e) e.textContent = words;
    const control = $('input:not([type=radio]), select, textarea', f);
    if (control) { control.setAttribute('aria-invalid', 'true'); first = first || control; }
  }
  const n = Object.keys(errors).length;
  $('#sl-error').textContent = `${n === 1 ? 'One field needs' : `${n} fields need`} a look before you send.`;
  $('#sl-error').hidden = false;
  if (first) first.focus();
}

// A field's error clears as soon as it is edited.
form.addEventListener('input', (e) => {
  const f = e.target.closest('.sl-field.invalid');
  if (!f) return;
  f.classList.remove('invalid');
  const err = $('.sl-err', f);
  if (err) err.textContent = '';
  e.target.removeAttribute('aria-invalid');
});
form.addEventListener('change', (e) => { if (e.target.id === 'sl-consent') e.target.dispatchEvent(new Event('input', { bubbles: true })); });

// ---------- sending
let receipt = null; // { id, key } for a guest's copy

function platform() {
  if (window.__TAURI_INTERNALS__) return 'desktop';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios';
  return 'web';
}

async function send(e) {
  e.preventDefault();
  clearErrors();
  const value = entry();
  const checked = checkSubmission(value, { themeIds: OPTIONS.themes.map((t) => t.id) });
  if (checked.errors) { showErrors(checked.errors); return; }
  if (!CLOUD_URL) { $('#sl-error').textContent = 'This copy of the game cannot send entries. Open thelogicgrid.com to send yours.'; $('#sl-error').hidden = false; return; }
  const btn = $('#sl-send');
  btn.disabled = true;
  try {
    let token = null;
    if (account.current()) { try { token = await account.getIdToken(); } catch (err) { /* sent as a guest */ } }
    const res = await fetch(editing ? `${CLOUD_URL}/v1/story-submissions/${editing.id}/resubmit` : `${CLOUD_URL}/v1/story-submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...checked.value, platform: platform(), version: CLOUD.appVersion || 'dev', ...(editing && editing.key ? { key: editing.key } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 && data.errors) { showErrors(data.errors); return; }
    if (!res.ok) throw new Error(data.message || 'Your entry could not be sent. Check your connection and try again.');
    receipt = data.key ? { id: data.id, key: data.key } : null;
    const wasEditing = !!editing;
    done(value.kind, data.copy, wasEditing);
    if (wasEditing) { stopEditing({ keepDone: true }); loadMine(); }
  } catch (err) {
    $('#sl-error').textContent = err.message && !/fetch|network/i.test(err.message) ? err.message : 'Your entry could not be sent. Check your connection and try again.';
    $('#sl-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
}
form.addEventListener('submit', send);

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  return domain ? `${user.slice(0, 1)}•••@${domain}` : 'your email address';
}

let sentKind = 'storyline';
function done(k, copy, resubmitted = false) {
  sentKind = k;
  const words = k === 'storyline' ? 'storyline' : KINDS[k].toLowerCase();
  $('#sl-formwrap').hidden = true;
  const box = $('#sl-done');
  box.hidden = false;
  $('#sl-done-h').textContent = resubmitted ? `Your ${words} is updated` : `Thank you for your ${words}`;
  const me = account.current();
  if (copy === 'emailed') {
    $('#sl-done-text').textContent = `${resubmitted ? 'It is back with the team for review. ' : ''}We sent a confirmation and a copy of your completed form to ${maskEmail(me && me.email)}.`
      + (k === 'storyline' ? ' Once the team approves it, your story comes back as a finished logic puzzle: a PDF by email, and in Saved puzzles in the game.' : ' We\'ll email you if it is approved.');
    $('#sl-copy').hidden = true;
    $('#sl-done-actions').hidden = false;
  } else if (copy === 'saved') {
    $('#sl-done-text').textContent = resubmitted ? 'Your changes are saved, and your entry is back with the team for review.' : 'Your entry is saved, and the team reads every one. We could not email a copy today.';
    $('#sl-copy').hidden = true;
    $('#sl-done-actions').hidden = false;
  } else {
    $('#sl-done-text').textContent = k === 'storyline'
      ? 'Want a copy of your form, and the finished puzzle if your storyline is approved? Enter your email.'
      : 'Want a copy of your form, and a note if it is approved? Enter your email.';
    $('#sl-copy').hidden = false;
    $('#sl-done-actions').hidden = true;
  }
  box.focus();
}

function thanks(text) {
  $('#sl-done-h').textContent = 'Thank you, author';
  $('#sl-done-text').textContent = text;
  $('#sl-copy').hidden = true;
  $('#sl-done-actions').hidden = false;
  $('#sl-done').focus();
}

$('#sl-copy').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#sl-copy-email');
  const err = $('#sl-copy-err');
  err.textContent = '';
  input.removeAttribute('aria-invalid');
  const email = input.value.trim();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) { err.textContent = 'Enter a valid email address.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  if (!receipt) { thanks('Your entry is with the team. We read every one.'); return; }
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/story-submissions/copy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...receipt, email }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 400) { err.textContent = data.message || 'Enter a valid email address.'; input.focus(); return; }
    receipt = null;
    if (!res.ok) { thanks(data.message || 'Your entry is saved, but the copy could not be sent.'); return; }
    thanks(data.copy === 'emailed'
      ? `A copy of your form is on its way to ${email}.${sentKind === 'storyline' ? ' If your storyline is approved, the finished puzzle comes to the same address.' : ''}`
      : 'Your entry is saved, and the team reads every one. We could not email a copy today.');
  } catch (er) {
    err.textContent = 'The copy could not be sent. Check your connection and try again.';
  } finally {
    btn.disabled = false;
  }
});
$('#sl-copy-no').addEventListener('click', () => { receipt = null; thanks(`Your ${sentKind === 'storyline' ? 'storyline' : KINDS[sentKind].toLowerCase()} is with the team. We read every entry.`); });

$('#sl-again').addEventListener('click', () => {
  if (editing) stopEditing({ keepDone: true });
  form.reset();
  typed.length = 0;
  $('#sl-chars').innerHTML = '';
  drawCharacters();
  cats.length = 0;
  drawCategories();
  $$('[data-count]', form).forEach((i) => i.dispatchEvent(new Event('input')));
  $('#sl-copy-email').value = '';
  $('#sl-done').hidden = true;
  $('#sl-formwrap').hidden = false;
  showKind();
  $('#sl-main').focus();
});

// ---------- editing an entry
let editing = null; // { id, key, kind } while an entry is open for editing

// Puts an entry's words back in the form.
function fill(kind, f) {
  form.reset();
  $(`input[name=kind][value="${kind}"]`, form).checked = true;
  for (const r of $$('input[name=kind]', form)) r.disabled = r.value !== kind; // the kind stays the same
  showKind();
  const set = (sel, v) => { const el = $(sel); if (el && v != null) el.value = v; };
  if (kind === 'theme') set('#sl-theme-idea', f.idea);
  else if (kind === 'category') { set('#sl-cat-theme', f.theme); set('#sl-cat-idea', f.idea); }
  else {
    set('#sl-story-theme', f.theme || '');
    set('#sl-title', f.title || '');
    set('#sl-pitch', f.pitch || '');
    set('#sl-setting', f.setting || '');
    set('#sl-goal', f.goal || '');
    set('#sl-clues', f.clues || '');
    // A Share an idea entry: the idea goes in the story beat, to build on.
    set('#sl-beat', f.beat || f.idea || '');
    set('#sl-branch', f.branch || '');
    set('#sl-alt', f.alt || '');
    set('#sl-tone', f.tone || '');
    set('#sl-diff', f.difficulty || '');
    set('#sl-credit', f.credit || '');
    if (PUZZLES.length > 1) set('#sl-puzzle', f.puzzle || PUZZLES[0][0]);
    for (const k of Object.keys(REWARDS)) set(`#sl-reward-${k}`, (f.reward || {})[k] || REWARDS[k].options[0]);
    const chars = (f.characters || []).length ? f.characters : [{ name: '', trait: '', role: 'Main', gender: '' }];
    typed.length = 0;
    chars.forEach((c, i) => { typed[i] = { name: c.name || '', trait: c.trait || '', role: c.role || 'Supporting', gender: c.gender || '' }; });
    $('#sl-nchar').value = Math.min(MAX_CHARACTERS, chars.length);
    $('#sl-chars').innerHTML = '';
    drawCharacters();
    cats.length = 0;
    for (const c of f.categories || []) cats.push({ name: c.name || '', items: (c.items || []).join(', '), order: c.order || '' });
    drawCategories();
  }
  $('#sl-consent').checked = false;
  $$('[data-count]', form).forEach((i) => i.dispatchEvent(new Event('input')));
}

async function startEditing(id, key = '') {
  $('#sl-edit-error').hidden = true;
  let token = null;
  if (!key && account.current()) { try { token = await account.getIdToken(); } catch (e) { /* asks with the key only */ } }
  try {
    const res = await fetch(`${CLOUD_URL}/v1/story-submissions/${id}/form${key ? `?key=${encodeURIComponent(key)}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'That entry could not be opened. Check your connection and try again.');
    if (!data.editable) throw new Error(`This entry is ${String(data.statusName || 'decided').toLowerCase()}, so it can no longer be changed. You can send a new one.`);
    editing = { id: data.id, key, kind: data.kind };
    fill(data.kind, data.form || {});
    const words = data.kind === 'storyline' ? 'storyline' : KINDS[data.kind].toLowerCase();
    $('#sl-editing-title').textContent = `Editing your ${words}${data.form && data.form.title ? `: ${data.form.title}` : ''}`;
    $('#sl-editing-help').textContent = data.form && data.form.idea && !data.form.title
      ? 'This idea came from Share an idea. Your words are in the Story beat box: add a title, a pitch, characters and clues to make it a full storyline, tick the permission box and press Resubmit.'
      : 'Change anything you like, tick the permission box again, and press Resubmit. Your first version stays saved with the team.';
    $('#sl-editing').hidden = false;
    $('#sl-send').textContent = `Resubmit my ${words}`;
    $('#sl-formwrap').hidden = false;
    $('#sl-done').hidden = true;
    $('#sl-editing').focus?.();
    $('#sl-editing').scrollIntoView({ block: 'start' });
  } catch (e) {
    $('#sl-edit-error').textContent = e.message;
    $('#sl-edit-error').hidden = false;
  }
}

function stopEditing({ keepDone = false } = {}) {
  editing = null;
  for (const r of $$('input[name=kind]', form)) r.disabled = false;
  $('#sl-editing').hidden = true;
  if (!keepDone) {
    form.reset();
    typed.length = 0;
    $('#sl-chars').innerHTML = '';
    drawCharacters();
    cats.length = 0;
    drawCategories();
    $$('[data-count]', form).forEach((i) => i.dispatchEvent(new Event('input')));
  }
  showKind();
}
$('#sl-edit-cancel').addEventListener('click', () => { stopEditing(); $('#sl-main').focus(); });

// "Your entries", for a signed-in player.
async function loadMine() {
  const box = $('#sl-mine');
  if (!CLOUD_URL || !account.current()) { box.hidden = true; return; }
  try {
    const token = await account.getIdToken();
    const res = await fetch(`${CLOUD_URL}/v1/story-submissions/mine`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    const list = (res.ok && data.entries) || [];
    box.hidden = !list.length;
    if (!list.length) return;
    $('#sl-mine-count').textContent = `(${list.length})`;
    if (list.some((e) => e.invited)) box.open = true;
    $('#sl-mine-list').innerHTML = list.map((e) => `<li>
      <span class="sl-mine-title">${esc(e.title || e.kindName)}</span>
      <span class="sl-status${e.invited ? ' invited' : ''}">${esc(e.invited ? 'The team asked for changes' : e.statusName)}</span>
      ${e.editable ? `<button class="btn small" type="button" data-edit-entry="${e.id}">Edit and resubmit</button>` : ''}
    </li>`).join('');
  } catch (e) { box.hidden = true; }
}
$('#sl-mine-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit-entry]');
  if (b) startEditing(Number(b.dataset.editEntry));
});

// ---------- who is sending
function drawWho() {
  const me = account.current();
  $('#sl-who').textContent = me && me.verified
    ? `Signed in as ${me.email}: we'll email you a copy of your entry.`
    : me ? 'Confirm your email in the game (Account) to get your copy by email automatically, or ask for one after you send.'
      : 'Not signed in? You can still send an entry, and ask for a copy by email afterwards.';
}
account.onChange(drawWho);
drawWho();
drawCategories();
showKind();
if (!CLOUD_URL) $('#sl-closed').hidden = false;
account.onChange(loadMine);
loadMine();
// Opened from an edit link (storyline/?edit=ID.KEY): the key is taken out of
// the address bar straight away, so it is not shared by accident.
{
  const m = new URLSearchParams(location.search).get('edit')?.match(/^(\d+)\.([\w-]{20,})$/);
  if (m) {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* stays */ }
    if (CLOUD_URL) startEditing(Number(m[1]), m[2]);
  }
}
// Opened as storyline/?kind=theme or ?kind=category: start on that kind.
{
  const k = new URLSearchParams(location.search).get('kind');
  const r = k && $(`input[name=kind][value="${CSS.escape(k)}"]`, form);
  if (r) { r.checked = true; showKind(); }
}
