// The Educators page form (educators/, built by scripts/seo.mjs): reads the
// choices, checks them with the same rules the Worker uses
// (engine/classroom.js), sends the request, then takes the 6-digit code that
// was emailed to the school address. A link in that email (?ref=&code=)
// confirms it in one click. Talks only to the game's Worker (server/src/educators.js).
import { classroomOptions, checkRequest, bandOf, gradeById, CUSTOM_STARTERS } from '../engine/classroom.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const form = $('#edu-form');
const O = classroomOptions();
const KEY = 'flg.educatorRequest';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const API = (form.dataset.api || (local ? new URLSearchParams(location.search).get('api') || '' : '')).replace(/\/+$/, '');
const TIER = Object.fromEntries(O.difficulties.map((d) => [d.id, d.name]));
const v = (name) => form.elements[name];

const remember = (x) => { try { x ? sessionStorage.setItem(KEY, JSON.stringify(x)) : sessionStorage.removeItem(KEY); } catch (e) { /* private window */ } };
const recall = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };

async function call(path, body) {
  if (!API) throw new Error('Requests are not open on this copy of the page. Please use thelogicgrid.com/educators/.');
  let res;
  try {
    res = await fetch(`${API}/v1/educators/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { throw new Error('We could not reach our server. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.message || 'Something went wrong. Please try again.'); err.data = data; err.status = res.status; throw err; }
  return data;
}

// ---------------------------------------------------------------- the form
function gradeChanged() {
  const g = gradeById(v('grade').value);
  const help = $('#grade-help');
  if (!g) return;
  const b = bandOf(g.id);
  help.textContent = `${b.name}: ${b.about} Suggested: ${TIER[b.recommended]}, ${b.size[0]} categories × ${b.size[1]} items, ${b.questions} question${b.questions === 1 ? '' : 's'} per puzzle${b.largePrint ? ', large print' : ''}.`;
  $('#diff-grade').textContent = `(${TIER[b.recommended]})`;
  $('#diff-prog').textContent = b.tiers.length > 1 ? `(${b.tiers.map((t) => TIER[t]).join(', then ')})` : `(${TIER[b.tiers[0]]} only, for this grade)`;
  if (!v('largePrint').dataset.touched) v('largePrint').checked = b.largePrint;
  // Mark the levels and sizes that suit the grade.
  for (const opt of v('level').options) {
    const d = O.difficulties.find((x) => x.id === opt.value);
    opt.textContent = `${d.name}: ${d.summary}${b.tiers.includes(d.id) ? ' (suits this grade)' : ''}`;
  }
  if (!b.tiers.includes(v('level').value)) v('level').value = b.recommended;
  for (const opt of v('size').options) {
    if (opt.value === 'grade') { opt.textContent = `Suited to the grade (${b.size[0]} categories × ${b.size[1]} items)`; continue; }
    const [k, n] = opt.value.split('x').map(Number);
    opt.textContent = `${k} categories × ${n} items${b.sizes.some(([a, c]) => a === k && c === n) ? ' (suits this grade)' : ''}`;
  }
}

function sourceChanged() {
  const custom = v('source').value === 'custom';
  $('#themes-panel').hidden = custom;
  $('#custom-panel').hidden = !custom;
}

function fillStarter(id) {
  const s = CUSTOM_STARTERS.find((x) => x.id === id);
  const set = (n, val) => { v(n).value = val || ''; };
  set('c-theme', s?.theme); set('c-title', s?.title); set('c-story', s?.story);
  set('c-one', s?.cast.one); set('c-many', s?.cast.many); set('c-names', (s?.names || []).join(', '));
  for (let i = 0; i < 4; i++) {
    const c = s?.categories[i];
    set(`cat-name-${i}`, c?.name); set(`cat-items-${i}`, (c?.items || []).join(', '));
    set(`cat-pos-${i}`, c?.pos); set(`cat-neg-${i}`, c?.neg); set(`cat-less-${i}`, c?.less); set(`cat-more-${i}`, c?.more);
    v(`cat-ordered-${i}`).checked = !!c?.order;
    if (c?.order) v(`cat-order-${i}`).value = c.order;
  }
}

function readForm() {
  const f = form.elements;
  const diff = f.difficulty.value;
  const themes = $$('input[name=theme]:checked', form).map((x) => `${x.value}/${f[`topic-${x.value}`].value}`);
  const categories = [0, 1, 2, 3].map((i) => ({
    name: f[`cat-name-${i}`].value, items: f[`cat-items-${i}`].value, pos: f[`cat-pos-${i}`].value, neg: f[`cat-neg-${i}`].value,
    order: f[`cat-ordered-${i}`].checked ? f[`cat-order-${i}`].value : null, less: f[`cat-less-${i}`].value, more: f[`cat-more-${i}`].value,
  })).filter((c) => c.name.trim() || c.items.trim());
  return {
    educator: { name: f.name.value, email: f.email.value.trim(), school: f.school.value, district: f.district.value, role: f.role.value },
    grade: f.grade.value,
    count: Number(f.count.value),
    difficulty: diff === 'level' ? f.level.value : diff,
    size: f.size.value,
    questions: f.questions.value ? Number(f.questions.value) : undefined,
    clueTypes: $$('input[name=clue]:checked', form).map((x) => x.value),
    source: f.source.value,
    themes,
    names: f.names.value,
    custom: f.source.value === 'custom' ? {
      theme: f['c-theme'].value, title: f['c-title'].value, story: f['c-story'].value, ending: f['c-ending'].value,
      cast: { one: f['c-one'].value, many: f['c-many'].value }, names: f['c-names'].value, categories,
    } : null,
    paper: f.paper.value, keys: f.keys.value, solutions: f.solutions.checked, largePrint: f.largePrint.checked, nameLine: f.nameLine.checked,
    title: f.title.value, note: f.note.value, agree: f.agree.checked,
  };
}

function showErrors(list) {
  const box = $('#edu-errors');
  if (!list || !list.length) { box.hidden = true; box.textContent = ''; return; }
  box.innerHTML = `<p>Please fix ${list.length === 1 ? 'this' : `these ${list.length} things`}:</p><ul>${list.map((e) => `<li>${e.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</li>`).join('')}</ul>`;
  box.hidden = false;
  box.focus();
}

// ---------------------------------------------------------------- steps
function step(name, data = {}) {
  form.hidden = name !== 'form';
  $('#edu-verify').hidden = name !== 'verify';
  $('#edu-done').hidden = name !== 'done';
  if (name === 'verify') { $('#verify-email').textContent = data.email || ''; $('#verify-form').elements.code.value = ''; $('#verify-h').focus(); }
  if (name === 'done') {
    $('#done-ref').textContent = data.ref || '';
    $('#done-status').textContent = { pending: 'Waiting for review.', approved: 'Approved: your puzzles are being made.', building: 'Your puzzles are being made now.', sent: 'Sent: check your email for the PDFs.', declined: 'This request was not approved; we emailed you about it.' }[data.status] || '';
    $('#done-h').focus();
  }
  if (name === 'form') $('#form-h').scrollIntoView({ block: 'start' });
}

async function verify(ref, code) {
  const err = $('#verify-error');
  err.hidden = true;
  try {
    const r = await call('verify', { ref, code });
    remember(null);
    step('done', { ref, status: r.status });
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const req = readForm();
  const checked = checkRequest(req, { maxPuzzles: Number(v('count').max) || O.maxPuzzles });
  if (checked.errors) { showErrors(checked.errors); return; }
  showErrors(null);
  const btn = $('#edu-send');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const r = await call('request', req);
    remember({ ref: r.ref, email: r.email });
    step('verify', { email: r.email });
  } catch (ex) {
    showErrors(ex.data?.errors || [ex.message]);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send my request';
  }
});

$('#verify-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const saved = recall();
  const code = e.target.elements.code.value.replace(/\D/g, '');
  if (code.length !== 6) { $('#verify-error').textContent = 'Enter the 6-digit code from the email.'; $('#verify-error').hidden = false; return; }
  if (saved) verify(saved.ref, code);
});
$('#verify-resend').addEventListener('click', async (e) => {
  const saved = recall();
  if (!saved) return;
  e.target.disabled = true;
  try {
    await call('resend', { ref: saved.ref });
    $('#verify-error').textContent = 'We sent a new code. The older one no longer works.';
  } catch (ex) { $('#verify-error').textContent = ex.message; }
  $('#verify-error').hidden = false;
  e.target.disabled = false;
});
$('#verify-restart').addEventListener('click', () => { remember(null); step('form'); });

v('grade').addEventListener('change', gradeChanged);
$$('input[name=source]', form).forEach((r) => r.addEventListener('change', sourceChanged));
v('starter').addEventListener('change', (e) => fillStarter(e.target.value));
v('largePrint').addEventListener('change', (e) => { e.target.dataset.touched = '1'; });
v('level').addEventListener('change', () => { $('input[name=difficulty][value=level]', form).checked = true; });
// A theme's topic picked means the theme is wanted.
$$('.theme-row select', form).forEach((s) => s.addEventListener('change', () => { if (s.value !== 'any') s.closest('.theme-row').querySelector('input').checked = true; }));
sourceChanged();

// ---------------------------------------------------------------- start
(async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('ref') && q.get('code')) {
    // The link in the code email.
    const ref = q.get('ref');
    remember({ ref, email: '' });
    history.replaceState(null, '', location.pathname + (local && q.get('api') ? `?api=${encodeURIComponent(q.get('api'))}` : ''));
    step('verify', { email: 'your school address' });
    await verify(ref, q.get('code'));
    return;
  }
  const saved = recall();
  if (saved) {
    try {
      const s = await call(`status?ref=${encodeURIComponent(saved.ref)}`);
      if (s.status === 'unverified') step('verify', saved);
      else if (s.status !== 'expired') { remember(null); step('done', { ref: saved.ref, status: s.status }); }
      else remember(null);
    } catch (e) { /* show the form */ }
  }
  try {
    const opts = await call('options');
    v('count').max = String(opts.maxPuzzles);
    $('#max-puzzles').textContent = String(opts.maxPuzzles);
    if (!opts.enabled) {
      const p = $('#edu-paused');
      p.textContent = 'New requests are paused for a little while. Please come back soon. This week\'s free worksheets are on the Printables page.';
      p.hidden = false;
      $('#edu-send').disabled = true;
    }
  } catch (e) { /* the form still works; the server checks everything */ }
})();
