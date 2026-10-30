// The educators' private ideas, problems and feedback section
// (educators/feedback/, built by scripts/seo.mjs). It opens only with the
// link in the email that carried their PDFs (?ref=&key=); the key is kept in
// this tab's session storage and taken out of the address bar. Talks only to
// the game's Worker (server/src/educators.js, /v1/educators/feedback/...).
import { EDUCATOR_SURVEY, FEEDBACK_KINDS, checkSurvey, checkFeedback } from '../../engine/classroom.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#fb-app');
const KEY = 'flg.educatorFeedback';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// Local test copies (no cloud URL at build) get the server from the test itself.
const API = (app.dataset.api || (local && typeof window.FLG_EDUCATORS_API === 'string' ? window.FLG_EDUCATORS_API : '')).replace(/\/+$/, '');
const escape = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

let access = null;
try { access = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { /* private window */ }
const q = new URLSearchParams(location.search);
const linkRef = (q.get('ref') || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
const linkKey = (q.get('key') || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
if (linkRef && linkKey) {
  access = { ref: linkRef, key: linkKey };
  try { sessionStorage.setItem(KEY, JSON.stringify(access)); } catch (e) { /* private window */ }
  history.replaceState(null, '', location.pathname);
}

async function call(path, extra = {}) {
  if (!API || !access) throw Object.assign(new Error('locked'), { status: 403 });
  let res;
  try {
    res = await fetch(`${API}/v1/educators/feedback/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...access, ...extra }) });
  } catch (e) { throw new Error('We could not reach our server. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Please try again.'), { status: res.status, data });
  return data;
}

function show(state) {
  $('#fb-locked').hidden = true;
  $('#fb-open').hidden = false;
  $('#fb-hello').textContent = `Hello ${state.name}! Your ${state.puzzles} ${state.puzzles === 1 ? 'puzzle' : 'puzzles'} for ${state.school} were emailed on ${day(state.sentAt)}.`;
  if (state.survey) {
    const a = state.survey.answers;
    for (const sq of EDUCATOR_SURVEY) {
      const name = `q-${sq.id}`;
      if (sq.type === 'text') { $(`[name="${name}"]`).value = a[sq.id] || ''; continue; }
      const picked = sq.type === 'many' ? a[sq.id] || [] : a[sq.id] == null ? [] : [a[sq.id]];
      for (const box of $$(`[name="${name}"]`)) box.checked = picked.includes(Number(box.value));
    }
    $('#survey-state').textContent = `Thank you: we have your answers from ${day(state.survey.at)}. You can change them and send again.`;
  }
  $('#fb-items').innerHTML = state.items.length ? state.items.map((x) => `<div class="fb-item"><p><span class="kind">${escape(FEEDBACK_KINDS[x.kind] || 'A note')}</span> · ${escape(day(x.at))}</p>
<blockquote>${escape(x.text).replace(/\n/g, '<br>')}</blockquote>
${x.reply ? `<p><strong>Our answer</strong> (${escape(day(x.answeredAt))}):</p><blockquote>${escape(x.reply).replace(/\n/g, '<br>')}</blockquote>` : '<p class="muted">Our team will read this soon.</p>'}</div>`).join('') : '<p class="muted">Nothing sent yet.</p>';
}

function errors(box, list) {
  if (!list || !list.length) { box.hidden = true; box.textContent = ''; return; }
  box.innerHTML = list.length === 1 ? `<p>${escape(list[0])}</p>` : `<ul>${list.map((e) => `<li>${escape(e)}</li>`).join('')}</ul>`;
  box.hidden = false;
}

function locked(e) {
  if (e && e.status !== 403) $('#fb-locked-why').textContent = e.message;
  $('#fb-locked').hidden = false;
  $('#fb-open').hidden = true;
}

$('#survey-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const answers = {};
  for (const sq of EDUCATOR_SURVEY) {
    const name = `q-${sq.id}`;
    if (sq.type === 'text') answers[sq.id] = $(`[name="${name}"]`).value;
    else if (sq.type === 'many') answers[sq.id] = $$(`[name="${name}"]:checked`).map((b) => Number(b.value));
    else answers[sq.id] = $(`[name="${name}"]:checked`)?.value ?? '';
  }
  const checked = checkSurvey(answers);
  const box = $('#survey-errors');
  $('#survey-done').textContent = '';
  if (checked.errors) { errors(box, checked.errors); box.focus(); return; }
  errors(box, null);
  const btn = $('#survey-send');
  btn.disabled = true;
  try {
    show(await call('survey', { answers: checked.value }));
    $('#survey-done').textContent = 'Thank you! Your answers are saved.';
  } catch (ex) { if (ex.status === 403) locked(ex); else errors(box, ex.data?.errors || [ex.message]); }
  btn.disabled = false;
});

$('#note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const checked = checkFeedback({ kind: f.kind.value, text: f.text.value });
  const box = $('#note-errors');
  $('#note-done').textContent = '';
  if (checked.errors) { errors(box, checked.errors); return; }
  errors(box, null);
  const btn = $('#note-send');
  btn.disabled = true;
  try {
    show(await call('send', checked.value));
    f.text.value = '';
    $('#note-done').textContent = 'Thank you! Our team will read it.';
  } catch (ex) { if (ex.status === 403) locked(ex); else errors(box, ex.data?.errors || [ex.message]); }
  btn.disabled = false;
});

(async () => {
  if (!access) return;
  try { show(await call('open')); } catch (e) { locked(e); }
})();
