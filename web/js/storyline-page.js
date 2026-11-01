// The Suggest a storyline page (web/storyline/), opened from Menu > Suggest a
// storyline and from Share an idea. Players send a theme idea, a category idea
// for an existing theme, or a whole storyline; the Worker saves it in the
// Storyline Submission Database (server/src/story-submissions.js).
//
// Signed in with a confirmed email, the player gets a confirmation and a copy
// of the completed form by email. A guest sees a thank-you and can type an
// email address to get the copy (and, for a storyline, the finished puzzle if
// it is approved), or say no thanks.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import { OPTIONS } from '../engine/options.js';
import { checkSubmission, TONES, DIFFICULTIES, REWARDS, PUZZLES, MAX_CHARACTERS, CONSENT_TEXT, KINDS } from './storyline-fields.js';
import { prepareImage, ACCEPT } from './image-prep.js';

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
  $$('.sl-char', form).forEach((box, i) => {
    typed[i] = { name: $('[data-c=name]', box).value, trait: $('[data-c=trait]', box).value, role: ($('[data-c=role]:checked', box) || {}).value || 'Supporting' };
  });
}
function drawCharacters() {
  readCharacters();
  const input = $('#sl-nchar');
  const n = Math.max(1, Math.min(MAX_CHARACTERS, Math.round(Number(input.value)) || 1));
  if (String(n) !== input.value) input.value = n;
  const box = $('#sl-chars');
  const have = $$('.sl-char', box).length;
  if (have === n) return;
  box.innerHTML = Array.from({ length: n }, (_, i) => {
    const c = typed[i] || { name: '', trait: '', role: i === 0 ? 'Main' : 'Supporting' };
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

// ---------- pictures (up to 3, shrunk and saved as WebP before sending)
const MAX_PICS = 3;
const pics = []; // { dataUrl, width, height, bytes, name }
function drawPics() {
  $('#sl-pics').innerHTML = pics.map((p, i) => `<li><img src="${esc(p.dataUrl)}" alt="Picture ${i + 1}: ${esc(p.name)}">
    <p>${esc(p.name)}</p><button class="btn small quiet" type="button" data-pic-remove="${i}" aria-label="Remove picture ${i + 1}, ${esc(p.name)}">Remove</button></li>`).join('');
  $('#sl-images').disabled = pics.length >= MAX_PICS;
}
$('#sl-images').accept = ACCEPT;
$('#sl-images').addEventListener('change', async (e) => {
  const input = e.target;
  const files = [...input.files];
  input.value = '';
  const status = $('#sl-images-status');
  const field = input.closest('.sl-field');
  const problems = [];
  if (pics.length + files.length > MAX_PICS) problems.push(`You can add up to ${MAX_PICS} pictures.`);
  for (const f of files.slice(0, MAX_PICS - pics.length)) {
    status.textContent = `Getting ${f.name} ready…`;
    try { pics.push(await prepareImage(f, { maxSide: 1600, maxBytes: 850_000 })); } catch (err) { problems.push(`${f.name}: ${err.message}`); }
  }
  status.textContent = `${pics.length} of ${MAX_PICS} pictures added.`;
  $('.sl-err', field).textContent = problems.join(' ');
  field.classList.toggle('invalid', problems.length > 0);
  drawPics();
});
$('#sl-pics').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pic-remove]');
  if (!b) return;
  pics.splice(Number(b.dataset.picRemove), 1);
  drawPics();
  $('#sl-images-status').textContent = `${pics.length} of ${MAX_PICS} pictures added.`;
  $('#sl-images').focus();
});

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
    characters: typed.slice(0, $$('.sl-char', s).length),
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
    const res = await fetch(`${CLOUD_URL}/v1/story-submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...checked.value, platform: platform(), version: CLOUD.appVersion || 'dev', ...(value.kind === 'storyline' && pics.length ? { images: pics.map(({ dataUrl, width, height, name }) => ({ dataUrl, width, height, name })) } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 && data.errors) { showErrors(data.errors); return; }
    if (!res.ok) throw new Error(data.message || 'Your entry could not be sent. Check your connection and try again.');
    receipt = data.key ? { id: data.id, key: data.key } : null;
    done(value.kind, data.copy);
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
function done(k, copy) {
  sentKind = k;
  const words = k === 'storyline' ? 'storyline' : KINDS[k].toLowerCase();
  $('#sl-formwrap').hidden = true;
  const box = $('#sl-done');
  box.hidden = false;
  $('#sl-done-h').textContent = `Thank you for your ${words}`;
  const me = account.current();
  if (copy === 'emailed') {
    $('#sl-done-text').textContent = `We sent a confirmation and a copy of your completed form to ${maskEmail(me && me.email)}.`
      + (k === 'storyline' ? ' Once the team approves it, your story comes back as a finished logic puzzle: a PDF by email, and in Saved puzzles in the game.' : ' We\'ll email you if it is approved.');
    $('#sl-copy').hidden = true;
    $('#sl-done-actions').hidden = false;
  } else if (copy === 'saved') {
    $('#sl-done-text').textContent = 'Your entry is saved, and the team reads every one. We could not email a copy today.';
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
  form.reset();
  typed.length = 0;
  $('#sl-chars').innerHTML = '';
  drawCharacters();
  $$('[data-count]', form).forEach((i) => i.dispatchEvent(new Event('input')));
  $('#sl-copy-email').value = '';
  $('#sl-done').hidden = true;
  $('#sl-formwrap').hidden = false;
  showKind();
  $('#sl-main').focus();
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
showKind();
if (!CLOUD_URL) $('#sl-closed').hidden = false;
// Opened as storyline/?kind=theme or ?kind=category: start on that kind.
{
  const k = new URLSearchParams(location.search).get('kind');
  const r = k && $(`input[name=kind][value="${CSS.escape(k)}"]`, form);
  if (r) { r.checked = true; showKind(); }
}
