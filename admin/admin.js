// The admin dashboard for The Fantastical Logic Grid. Served by the game's
// Worker at /admin/ and talks only to its /admin/v1 API (server/src/admin.js).
// Sign-in uses Firebase's REST API with the admin's game account; the session
// lives only in this tab (sessionStorage) and ends after 30 idle minutes.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());
const when = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const day = (ms) => (ms ? new Date(ms).toLocaleDateString([], { dateStyle: 'medium' }) : '–');
const bytes = (b) => (b == null ? '–' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1';
const SESSION_KEY = 'flg-admin-session';
const IDLE_MS = 30 * 60_000;
const ROLES = { viewer: 1, moderator: 2, admin: 3, owner: 4 };
const TIER_NAMES = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'MENSA' };

let session = null; // { mode: 'firebase'|'token', key?, refreshToken?, idToken?, exp?, email? }
let me = null; // { email, role }
let firebaseKey = null;
let lastActive = Date.now();

// ------------------------------------------------------------- helpers
function announce(text) { $('#live').textContent = ''; setTimeout(() => { $('#live').textContent = text; }, 30); }
let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}
const can = (role) => me && ROLES[me.role] >= ROLES[role];

function saveSession() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* private window */ } }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }

class ApiError extends Error { constructor(code, message, status) { super(message || code); this.code = code; this.status = status; } }

async function firebase(path, body, base = AUTH_URL) {
  if (!firebaseKey) {
    const cfg = await fetch('/admin/v1/client-config').then((r) => r.json());
    firebaseKey = cfg.firebaseApiKey;
    if (!firebaseKey) throw new ApiError('not_set_up', 'Sign-in is not set up yet: add the FIREBASE_WEB_API_KEY secret to the Worker, or use the break-glass key.');
  }
  const res = await fetch(`${base}/${path}?key=${encodeURIComponent(firebaseKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.error?.message || `HTTP_${res.status}`).split(/[\s:]/)[0];
    const words = {
      INVALID_LOGIN_CREDENTIALS: 'That email and password do not match.', INVALID_PASSWORD: 'That email and password do not match.', EMAIL_NOT_FOUND: 'That email and password do not match.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes and try again.', USER_DISABLED: 'This account is switched off.', INVALID_EMAIL: 'Enter a valid email address.',
    };
    throw new ApiError(code, words[code] || 'Sign-in did not work. Please try again.');
  }
  return data;
}

async function bearer(force = false) {
  if (!session) throw new ApiError('sign_in', 'Please sign in.');
  if (session.mode === 'token') return session.key;
  if (!force && session.idToken && Date.now() < session.exp - 60_000) return session.idToken;
  const data = await firebase('token', { grant_type: 'refresh_token', refresh_token: session.refreshToken }, TOKEN_URL);
  session.idToken = data.id_token;
  session.refreshToken = data.refresh_token || session.refreshToken;
  session.exp = Date.now() + Number(data.expires_in || 3600) * 1000;
  saveSession();
  return session.idToken;
}

async function api(path, { method = 'GET', body } = {}) {
  if (session && Date.now() - lastActive > IDLE_MS) { signOut('You were signed out after 30 minutes without activity.'); throw new ApiError('sign_in', 'Signed out.'); }
  const res = await fetch(`/admin/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await bearer()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) signOut('Please sign in again.');
    throw new ApiError(data.error || `http_${res.status}`, data.message || `Request failed (${res.status}).`, res.status);
  }
  return data;
}

// A small form dialog. fields: [{ name, label, type, value, options, help }].
function ask({ title, text = '', fields = [], ok = 'OK', danger = false, check }) {
  const dlg = $('#dialog');
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = (text ? `<p>${text}</p>` : '') + fields.map((f, i) => {
    const id = `dlg-${i}`;
    if (f.type === 'select') return `<div class="field"><label for="${id}">${esc(f.label)}</label><select id="${id}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}"${v === f.value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
    if (f.type === 'textarea') return `<div class="field"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" name="${f.name}" rows="3">${esc(f.value || '')}</textarea></div>`;
    return `<div class="field"><label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" autocomplete="off">${f.help ? `<span class="muted">${esc(f.help)}</span>` : ''}</div>`;
  }).join('');
  $('#dialog-ok').textContent = ok;
  $('#dialog-ok').className = `btn primary${danger ? ' danger' : ''}`;
  $('#dialog-error').hidden = true;
  return new Promise((resolve) => {
    const values = () => Object.fromEntries(fields.map((f) => [f.name, $(`[name="${f.name}"]`, dlg).value]));
    const done = (v) => { dlg.close(); $('#dialog-form').onsubmit = null; $('#dialog-cancel').onclick = null; dlg.oncancel = null; resolve(v); };
    $('#dialog-form').onsubmit = (e) => {
      e.preventDefault();
      const v = values();
      const problem = check && check(v);
      if (problem) { $('#dialog-error').textContent = problem; $('#dialog-error').hidden = false; return; }
      done(v);
    };
    $('#dialog-cancel').onclick = () => done(null);
    dlg.oncancel = () => done(null);
    dlg.showModal();
    ($('input, select, textarea', $('#dialog-body')) || $('#dialog-ok')).focus();
  });
}

// Runs an action from a button, with feedback either way.
async function act(button, fn, okText) {
  if (button) button.disabled = true;
  try {
    await fn();
    if (okText) { toast(okText); announce(okText); }
    return true;
  } catch (e) {
    if (e.code !== 'sign_in') { toast(e.message); announce(e.message); }
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

// ------------------------------------------------------------- charts
// Bars per day; optional second series drawn inside the first, and a cap line.
function bars(title, values, { second, cap, labels = [], names = [] } = {}) {
  const w = 600;
  const h = 120;
  const max = Math.max(1, cap || 0, ...values);
  const n = values.length || 1;
  const bw = w / n;
  const y = (v) => h - (v / max) * (h - 6);
  const rects = values.map((v, i) => `<rect class="b1" x="${(i * bw + bw * 0.12).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${(h - y(v)).toFixed(1)}"><title>${esc(labels[i] || '')}: ${fmt(v)}${second ? `, ${esc(names[1] || '')} ${fmt(second[i])}` : ''}</title></rect>`).join('');
  const inner = second ? second.map((v, i) => `<rect class="b2" x="${(i * bw + bw * 0.3).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.4).toFixed(1)}" height="${(h - y(v)).toFixed(1)}"></rect>`).join('') : '';
  const capLine = cap ? `<line class="capline" x1="0" x2="${w}" y1="${y(cap).toFixed(1)}" y2="${y(cap).toFixed(1)}"></line>` : '';
  const total = values.reduce((s, v) => s + v, 0);
  const summary = `${title}: ${fmt(total)} in total, highest day ${fmt(Math.max(0, ...values))}${cap ? `, daily cap ${fmt(cap)}` : ''}.`;
  const legend = (names.length || cap) ? `<div class="legend">${names[0] ? `<span><i class="k1"></i>${esc(names[0])}</span>` : ''}${names[1] ? `<span><i class="k2"></i>${esc(names[1])}</span>` : ''}${cap ? '<span><i class="kc"></i>Daily cap</span>' : ''}</div>` : '';
  return `<figure class="chart"><h3>${esc(title)}</h3><p class="muted">${fmt(total)} in total</p>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}"><line class="axis" x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}"></line>${rects}${inner}${capLine}</svg>${legend}</figure>`;
}

function meter(used, limit) {
  const f = limit ? Math.min(1, used / limit) : 0;
  const cls = f >= 0.9 ? 'bad' : f >= 0.7 ? 'warn' : '';
  return `<div class="meter" role="img" aria-label="${pct(used, limit)} of the free limit"><svg viewBox="0 0 100 10" preserveAspectRatio="none"><rect class="fill ${cls}" x="0" y="0" height="10" width="${(f * 100).toFixed(1)}"></rect></svg></div>`;
}

const tile = (label, value, sub = '') => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

function table(head, rows, empty = 'Nothing yet.') {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>${head.map((h) => `<th scope="col"${h.num ? ' class="num"' : ''}>${esc(h.label || h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${head[i].num ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ------------------------------------------------------------- views
const views = {};

views.overview = async () => {
  const d = await api(`analytics?days=${$('#ov-days').value}`);
  const p = d.players;
  const g = d.games;
  const plays = g.byDay.reduce((s, v) => s + v, 0);
  const solved = g.solvedByDay.reduce((s, v) => s + v, 0);
  const races = d.races.byDay.reduce((s, v) => s + v, 0);
  const errors = d.errors.byDay.reduce((s, v) => s + v, 0);
  const labels = d.dayList;
  setCount('#count-parts', d.review.parts.pending || 0);
  setCount('#count-names', d.review.namesWaiting || 0);
  const review = [];
  if (can('moderator') && d.review.parts.pending) review.push(`<a href="#stories">${fmt(d.review.parts.pending)} story ${d.review.parts.pending === 1 ? 'part' : 'parts'} waiting for review</a>`);
  const fb = d.review.feedback || {};
  setCount('#count-feedback', (fb.idea || 0) + (fb.problem || 0));
  if (can('moderator') && (fb.idea || fb.problem)) review.push(`<a href="#feedback">${fmt(fb.idea || 0)} new ${fb.idea === 1 ? 'idea' : 'ideas'} and ${fmt(fb.problem || 0)} new ${fb.problem === 1 ? 'problem' : 'problems'} from players</a>`);
  if (can('moderator') && d.review.namesWaiting) review.push(`<a href="#names">${fmt(d.review.namesWaiting)} new or changed screen ${d.review.namesWaiting === 1 ? 'name' : 'names'}</a>`);
  $('#ov-body').innerHTML = `
    ${review.length ? `<div class="note">${review.join(' · ')}</div>` : ''}
    <h2>Players</h2>
    <div class="tiles">
      ${tile('Accounts', fmt(p.accounts), `${fmt(p.newAccounts.reduce((s, v) => s + v, 0))} new in this period`)}
      ${tile('Screen names', fmt(p.screenNames), `${fmt(p.newScreenNames)} new in this period`)}
      ${tile('Scoring players', fmt(p.active7), `last 7 days · ${fmt(p.activePeriod)} in this period`)}
      ${tile('Banned', fmt(p.banned))}
      ${tile('Accounts deleted', fmt(p.deletedAccounts), 'in this period')}
    </div>
    <h2>Games</h2>
    <p class="muted">${esc(g.note)}</p>
    <div class="tiles">
      ${tile('Games finished', fmt(plays))}
      ${tile('Solved', fmt(solved), `${pct(solved, plays)} of games`)}
      ${tile('Races started', fmt(races), `${fmt(d.races.open)} open now`)}
      ${tile('Race entries', fmt(d.races.entries), `${fmt(d.races.solved)} solved`)}
      ${tile('Free voices today', `${fmt(d.voices.today)} <span class="muted">/ ${fmt(d.voices.cap)}</span>`, d.voices.enabled ? meter(d.voices.today, d.voices.cap) : 'Switched off')}
      ${tile('AI pictures today', `${fmt(d.pictures.today)} <span class="muted">/ ${fmt(d.pictures.cap)}</span>`, d.pictures.mode !== 'none' ? meter(d.pictures.today, d.pictures.cap) : 'Switched off')}
      ${tile('Error reports', fmt(errors), 'in this period')}
    </div>
    <div class="charts">
      ${bars('Games finished per day', g.byDay, { second: g.solvedByDay, labels, names: ['Finished', 'Solved'] })}
      ${bars('New accounts per day', p.newAccounts, { labels })}
      ${bars('Scores posted per day', d.scores.byDay, { labels })}
      ${bars('Races started per day', d.races.byDay, { labels })}
      ${bars('Free voice clips per day', d.voices.byDay, { cap: d.voices.cap, labels, names: ['Clips made'] })}
      ${bars('AI pictures per day', d.pictures.byDay, { cap: d.pictures.cap, labels, names: ['Pictures made'] })}
      ${bars('Error reports per day', d.errors.byDay, { labels })}
    </div>
    <h2>By theme</h2>
    ${table([{ label: 'Theme' }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Solve rate', num: 1 }, { label: 'Rating (1–5)', num: 1 }, { label: 'Minutes to solve', num: 1 }],
      g.byTheme.map((t) => [esc(t.id), fmt(t.n), fmt(t.solved), pct(t.solved, t.n), t.rating ?? '–', t.minutes ?? '–']), 'No games shared in this period.')}
    <h2>By difficulty</h2>
    ${table([{ label: 'Difficulty' }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Solve rate', num: 1 }, { label: 'Rating', num: 1 }, { label: 'Minutes', num: 1 }, { label: 'Hints', num: 1 }],
      sortTiers(g.byTier).map((t) => [esc(TIER_NAMES[t.id] || t.id), fmt(t.n), fmt(t.solved), pct(t.solved, t.n), t.rating ?? '–', t.minutes ?? '–', t.hints ?? '–']), 'No games shared in this period.')}
    <h2>Scoreboard solves by difficulty</h2>
    ${table([{ label: 'Difficulty' }, { label: 'Kind' }, { label: 'Solves', num: 1 }, { label: 'Average points', num: 1 }],
      sortTiers(d.scores.byTier).map((t) => [esc(TIER_NAMES[t.id] || t.id), t.kind === 'race' ? 'Race' : 'Solo', fmt(t.n), fmt(t.points)]), 'No scores in this period.')}
    <div class="charts">
      <div class="chart"><h3>Platforms</h3>${table([{ label: 'Platform' }, { label: 'Games', num: 1 }], g.byPlatform.map((x) => [esc(x.id), fmt(x.n)]))}</div>
      <div class="chart"><h3>How games ended</h3>${table([{ label: 'Outcome' }, { label: 'Games', num: 1 }], g.outcomes.map((x) => [esc(x.id), fmt(x.n)]))}</div>
      <div class="chart"><h3>How hard it felt</h3>${table([{ label: 'Answer' }, { label: 'Games', num: 1 }], g.feel.map((x) => [esc({ easy: 'Too easy', right: 'Just right', hard: 'Too hard' }[x.id] || x.id), fmt(x.n)]))}</div>
    </div>
    <p class="muted">Updated ${when(d.generatedAt)}. Figures are kept for two minutes to save free database reads.</p>`;
};
const TIER_ORDER = Object.keys(TIER_NAMES);
const sortTiers = (rows) => [...rows].sort((a, b) => TIER_ORDER.indexOf(a.id) - TIER_ORDER.indexOf(b.id) || String(a.kind).localeCompare(String(b.kind)));
function setCount(sel, n) { const el = $(sel); el.textContent = n; el.hidden = !n; el.setAttribute('aria-label', `${n} waiting`); }

views.usage = async () => {
  const [s, u] = await Promise.all([api('storage'), api('usage?days=14')]);
  const L = s.limits;
  const cf = !u.configured
    ? `<div class="note"><p><b>Daily request and database counts are not connected.</b> To see them here, create a free Cloudflare API token with <i>Account Analytics: Read</i>, then add the Worker secrets <code>CF_API_TOKEN</code> and <code>CF_ACCOUNT_ID</code>. See admin/README.md.</p></div>`
    : u.error ? `<p class="error">Cloudflare's numbers did not load: ${esc(u.error)}</p>`
      : table([{ label: 'Day (UTC)' }, { label: 'Worker requests', num: 1 }, { label: 'of 100,000' }, { label: 'D1 rows read', num: 1 }, { label: 'of 5 million' }, { label: 'D1 rows written', num: 1 }, { label: 'of 100,000' }],
        [...u.days].reverse().map((x) => [esc(x.date), fmt(x.requests), meter(x.requests, L.workerRequestsPerDay), fmt(x.rowsRead), meter(x.rowsRead, L.d1RowsReadPerDay), fmt(x.rowsWritten), meter(x.rowsWritten, L.d1RowsWrittenPerDay)]), 'No usage yet.');
  $('#usage-body').innerHTML = `
    <h2>Database</h2>
    <div class="tiles">
      ${tile('Database size', bytes(s.databaseBytes), s.databaseBytes != null ? `${meter(s.databaseBytes, L.d1DatabaseBytes)}of ${bytes(L.d1DatabaseBytes)} free` : '')}
    </div>
    ${table([{ label: 'Table' }, { label: 'Rows (up to)', num: 1 }], s.tables.map((t) => [`<code>${esc(t.table)}</code>`, fmt(t.rows)]))}
    <h2>Cloudflare, last 14 days</h2>
    ${cf}
    <h2>Free allowances</h2>
    ${table(['Service', 'Free allowance', 'When it runs out'], [
    ['Cloudflare Workers', '100,000 requests a day', 'Requests are refused until midnight UTC'],
    ['Cloudflare D1', '5 million rows read and 100,000 rows written a day; 500 MB per database', 'Queries are refused until midnight UTC'],
    ['Firebase Authentication (Spark)', '50,000 monthly active players', 'New sign-ins are refused; Spark never bills'],
    ['Gemini voices (free tier)', 'Google\'s daily free limit; this game also stops at the voice cap in Settings', 'Players hear the offline Kokoro voices'],
  ])}`;
};

// ---- Story workshop: admins add story parts for every player.
let workshop = null;
let drafts = [];
const wsKind = () => $('#ws-kind').value;
const partText = (kind, v) => (kind === 'incidents' ? `${v.name}: ${v.text} (at stake: ${v.prize})` : String(v));
function showWsKind() {
  const k = workshop.kinds.find((x) => x.id === wsKind());
  $('#ws-tip').textContent = k ? k.tip : '';
  $('#ws-name-row').hidden = wsKind() !== 'incidents';
  $('#ws-prize-row').hidden = wsKind() !== 'incidents';
  $('#ws-error').hidden = true;
}
function renderDrafts() {
  $('#ws-drafts').innerHTML = drafts.map((d, i) => `<li><p>${esc(partText(d.kind, d.value))}</p>${d.ok
    ? `<div class="row"><button class="btn small" type="button" data-draft="${i}">Add for every player</button></div>`
    : `<p class="muted">Can't be used: ${esc((d.errors || [])[0] || '')}</p>`}</li>`).join('');
}
async function addPart(value, source, button) {
  const body = { story: $('#ws-story').value, kind: wsKind(), value, source };
  try {
    button.disabled = true;
    await api('workshop/add', { method: 'POST', body });
    toast('Added. Players get it within about 15 minutes.');
    announce('Story part added.');
    return true;
  } catch (e) {
    $('#ws-error').textContent = e.message;
    $('#ws-error').hidden = false;
    return false;
  } finally { button.disabled = false; }
}
$('#ws-kind').onchange = () => { drafts = []; renderDrafts(); showWsKind(); };
$('#ws-story').onchange = () => { drafts = []; renderDrafts(); };
$('#ws-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#ws-text').value.trim();
  const value = wsKind() === 'incidents' ? { name: $('#ws-name').value.trim(), text, prize: $('#ws-prize').value.trim() } : text;
  if (await addPart(value, 'admin', $('#ws-form button[type=submit]'))) { $('#ws-text').value = ''; $('#ws-name').value = ''; $('#ws-prize').value = ''; show('stories', { keepFocus: true }); }
};
$('#ws-draft').onclick = async () => {
  const b = $('#ws-draft');
  $('#ws-error').hidden = true;
  b.disabled = true;
  b.textContent = 'Drafting…';
  try {
    const d = await api('workshop/draft', { method: 'POST', body: { story: $('#ws-story').value, kind: wsKind(), idea: $('#ws-idea').value } });
    drafts = d.drafts.map((x) => ({ ...x, kind: wsKind() }));
    renderDrafts();
    announce(`${drafts.length} drafts ready.`);
  } catch (err) {
    $('#ws-error').textContent = err.message;
    $('#ws-error').hidden = false;
  } finally { b.disabled = false; b.textContent = 'Draft story parts'; }
};
$('#ws-drafts').onclick = async (e) => {
  const b = e.target.closest('button[data-draft]');
  if (!b) return;
  const d = drafts[Number(b.dataset.draft)];
  if (await addPart(d.value, 'ai', b)) { drafts.splice(Number(b.dataset.draft), 1); renderDrafts(); show('stories', { keepFocus: true }); }
};

views.stories = async () => {
  if (!workshop) {
    workshop = await api('workshop');
    $('#ws-story').innerHTML = workshop.stories.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('');
    $('#ws-kind').innerHTML = workshop.kinds.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('');
    showWsKind();
  }
  const d = await api(`parts?status=${$('#parts-status').value}`);
  const text = (p) => (p.kind === 'incidents' ? `${p.value.name}: ${p.value.text} (at stake: ${p.value.prize})` : typeof p.value === 'string' ? p.value : JSON.stringify(p.value));
  $('#parts-list').innerHTML = d.parts.length ? d.parts.map((p) => `<li>
      <b>${esc(p.theme)} · ${esc(p.kind)}</b> ${p.source === 'ai' ? '<span class="badge">Drafted with AI</span>' : ''}${p.source === 'admin' ? '<span class="badge ok">Written here</span>' : ''} <span class="muted">${p.source === 'admin' || p.source === 'ai' ? 'added' : 'sent'} ${esc(p.submitted)}</span>
      <p>${esc(text(p))}</p>
      <div class="row">${p.status !== 'approved' ? `<button class="btn primary small" data-key="${esc(p.key)}" data-status="approved">Approve</button>` : ''}
      ${p.status !== 'rejected' ? `<button class="btn small" data-key="${esc(p.key)}" data-status="rejected">Reject</button>` : ''}
      ${p.status !== 'pending' ? `<button class="btn small" data-key="${esc(p.key)}" data-status="pending">Back to waiting</button>` : ''}</div></li>`).join('')
    : '<li class="muted">Nothing here.</li>';
};
$('#parts-status').onchange = () => show('stories');
$('#parts-list').onclick = async (e) => {
  const b = e.target.closest('button[data-key]');
  if (!b) return;
  const words = { approved: 'Approved.', rejected: 'Rejected.', pending: 'Moved back to waiting.' };
  if (await act(b, () => api('parts/review', { method: 'POST', body: { key: b.dataset.key, status: b.dataset.status } }), words[b.dataset.status])) show('stories', { keepFocus: true });
};

// ---- Ideas and problems players sent.
const FB_TOPICS = { story: 'Storyline idea', other: 'Other', play: 'Playing', sound: 'Sound and voices', pictures: 'Pictures', saving: 'Saving and sync' };
const fbKind = () => $('input[name=fb-kind]:checked').value;
views.feedback = async () => {
  const d = await api(`feedback?kind=${fbKind()}&status=${$('#fb-status').value}`);
  setCount('#count-ideas', d.waiting.idea || 0);
  setCount('#count-problems', d.waiting.problem || 0);
  setCount('#count-feedback', (d.waiting.idea || 0) + (d.waiting.problem || 0));
  $('#fb-list').innerHTML = d.items.length ? d.items.map((f) => `<li>
      <b>${esc(FB_TOPICS[f.topic] || f.topic)}</b> ${f.status === 'done' ? '<span class="badge ok">Done</span>' : '<span class="badge">New</span>'}
      <span class="muted">${when(f.createdAt)} · ${esc(f.platform)} ${esc(f.version)}</span>
      <p class="fb-text">${esc(f.text)}</p>
      <div class="row">${f.status === 'new' ? `<button class="btn primary small" data-fb="${f.id}" data-status="done">Mark done</button>` : `<button class="btn small" data-fb="${f.id}" data-status="new">Mark new</button>`}
      <button class="btn small" data-fb="${f.id}" data-status="delete">Delete</button></div></li>`).join('')
    : '<li class="muted">Nothing here.</li>';
};
$('#fb-status').onchange = () => show('feedback', { keepFocus: true });
$$('input[name=fb-kind]').forEach((r) => { r.onchange = () => show('feedback', { keepFocus: true }); });
$('#fb-list').onclick = async (e) => {
  const b = e.target.closest('button[data-fb]');
  if (!b) return;
  const words = { done: 'Marked done.', new: 'Marked new.', delete: 'Deleted.' };
  if (await act(b, () => api(`feedback/${b.dataset.fb}`, { method: 'POST', body: { status: b.dataset.status } }), words[b.dataset.status])) show('feedback', { keepFocus: true });
};

views.names = async () => {
  const d = await api(`names?status=${$('#names-status').value}`);
  $('#names-rows').innerHTML = d.names.length ? d.names.map((n) => `<tr>
      <td><b>${esc(n.name)}</b> ${n.flagged ? '<span class="badge warn">Check</span>' : ''}</td>
      <td>${day(n.updatedAt)}</td>
      <td>${n.banned ? '<span class="badge bad">Banned</span>' : n.reviewed ? `<span class="badge ok">Looked at</span>` : '<span class="badge">New</span>'}</td>
      <td><div class="actions">
        ${!n.reviewed ? `<button class="btn small primary" data-act="approve" data-uid="${esc(n.uid)}" aria-label="Name ${esc(n.name)} is fine">Fine</button>` : ''}
        <button class="btn small" data-act="rename" data-uid="${esc(n.uid)}" data-name="${esc(n.name)}">Rename</button>
        <button class="btn small" data-act="reset" data-uid="${esc(n.uid)}" data-name="${esc(n.name)}">Reset name</button>
        ${n.banned ? '' : `<button class="btn small danger" data-act="ban" data-uid="${esc(n.uid)}" data-name="${esc(n.name)}">Ban</button>`}
        <button class="btn small" data-act="open" data-uid="${esc(n.uid)}">Player</button>
      </div></td></tr>`).join('') : '<tr><td colspan="4" class="muted">Nothing here.</td></tr>';
};
$('#names-status').onchange = () => show('names');
$('#names-rows').onclick = async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { uid, name } = b.dataset;
  if (b.dataset.act === 'open') { location.hash = 'players'; await show('players'); openPlayer(uid); return; }
  const done = await playerAction(b.dataset.act, uid, name, b);
  if (done) show('names', { keepFocus: true });
};

// Rename, reset name, ban, unban, reset scores, delete. Returns true when done.
async function playerAction(kind, uid, name, button) {
  if (kind === 'approve') return act(button, () => api(`names/${uid}/approve`, { method: 'POST' }), 'Marked as looked at.');
  if (kind === 'rename') {
    const v = await ask({ title: `Rename ${name}`, fields: [{ name: 'name', label: 'New screen name (3 to 20 characters)', value: name }], ok: 'Rename', check: (x) => (x.name.trim().length < 3 ? 'Use at least 3 characters.' : null) });
    return v && act(button, () => api(`players/${uid}/rename`, { method: 'POST', body: { name: v.name } }), 'Renamed.');
  }
  if (kind === 'reset') {
    const v = await ask({ title: `Reset ${name}?`, text: 'The name becomes "Player" and four random letters. The player can choose a new name later.', ok: 'Reset name' });
    return v && act(button, () => api(`players/${uid}/rename`, { method: 'POST', body: { reset: true } }), 'Name reset.');
  }
  if (kind === 'ban') {
    const v = await ask({
      title: `Ban ${name || uid}?`, text: 'A banned player keeps their saves and can play alone, but cannot race, post scores or change their name, and is hidden from the scoreboard.',
      fields: [{ name: 'days', label: 'How long', type: 'select', value: '7', options: [['1', '1 day'], ['7', '7 days'], ['30', '30 days'], ['365', '1 year'], ['', 'No end']] }, { name: 'reason', label: 'Reason (only admins see it)', type: 'textarea' }],
      ok: 'Ban', danger: true,
    });
    return v && act(button, () => api(`players/${uid}/ban`, { method: 'POST', body: { days: v.days ? Number(v.days) : null, reason: v.reason } }), 'Banned.');
  }
  if (kind === 'unban') return act(button, () => api(`players/${uid}/unban`, { method: 'POST' }), 'Ban lifted.');
  if (kind === 'reset-scores') {
    const v = await ask({ title: `Reset scores for ${name || uid}?`, text: 'This removes their points from the scoreboard. It cannot be undone.', fields: [{ name: 'period', label: 'Which scores', type: 'select', value: 'week', options: [['week', 'This week only'], ['all', 'All time']] }], ok: 'Reset scores', danger: true });
    return v && act(button, () => api(`players/${uid}/reset-scores`, { method: 'POST', body: { period: v.period } }), 'Scores reset.');
  }
  if (kind === 'delete') {
    const v = await ask({
      title: 'Delete this account\'s data?',
      text: `This removes the player's synced saves, settings, screen name, scores and race entries from the game's server. It cannot be undone. Their sign-in stays in Firebase: delete it there too (Firebase console > Authentication > Users, search for the id).<br><br>Type the player id <code>${esc(uid)}</code> to confirm.`,
      fields: [{ name: 'confirm', label: 'Player id' }], ok: 'Delete', danger: true, check: (x) => (x.confirm.trim() !== uid ? 'The id does not match.' : null),
    });
    return v && act(button, () => api(`players/${uid}/delete`, { method: 'POST', body: { confirm: uid } }), 'Account data deleted.');
  }
  return false;
}

views.players = async () => {
  const q = $('#players-q').value.trim();
  const d = await api(`players?q=${encodeURIComponent(q)}&filter=${$('#players-filter').value}`);
  $('#players-rows').innerHTML = d.players.length ? d.players.map((p) => `<tr>
      <td><button class="rowlink" data-uid="${esc(p.uid)}">${p.name ? esc(p.name) : `<i>No screen name</i> <code>${esc(p.uid)}</code>`}</button></td>
      <td class="num">${fmt(p.points)}</td><td class="num">${fmt(p.solves)}</td><td>${day(p.lastScore)}</td>
      <td>${p.banned ? '<span class="badge bad">Banned</span>' : ''}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No players found.</td></tr>';
};
$('#players-form').onsubmit = (e) => { e.preventDefault(); $('#player-detail').innerHTML = ''; show('players'); };
$('#players-filter').onchange = () => show('players');
$('#players-rows').onclick = (e) => { const b = e.target.closest('button[data-uid]'); if (b) openPlayer(b.dataset.uid); };

async function openPlayer(uid) {
  const box = $('#player-detail');
  box.innerHTML = '<p class="muted">Loading…</p>';
  let p;
  try { p = await api(`players/${encodeURIComponent(uid)}`); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const sc = p.scores;
  const name = p.screenName || 'this player';
  box.innerHTML = `<div class="card" tabindex="-1" id="player-card">
    <h2>${p.screenName ? esc(p.screenName) : 'No screen name'} ${p.ban ? '<span class="badge bad">Banned</span>' : ''}</h2>
    <p class="muted">Player id <code>${esc(p.uid)}</code></p>
    ${p.deletedAt ? `<p class="note">This account's data was deleted on ${when(p.deletedAt)}.</p>` : ''}
    ${p.ban ? `<p class="note">Banned by ${esc(p.ban.banned_by)} on ${when(p.ban.banned_at)}, ${p.ban.until ? `until ${when(p.ban.until)}` : 'with no end'}.${p.ban.reason ? ` Reason: ${esc(p.ban.reason)}` : ''}</p>` : ''}
    <div class="tiles">
      ${tile('Points', fmt((sc.solo?.points || 0) + (sc.race?.points || 0)), `solo ${fmt(sc.solo?.points || 0)} · races ${fmt(sc.race?.points || 0)}`)}
      ${tile('Scored solves', fmt((sc.solo?.solves || 0) + (sc.race?.solves || 0)))}
      ${tile('Races', fmt(p.races.entered), `${fmt(p.races.solved)} solved · ${fmt(p.races.hosted)} hosted`)}
      ${p.account ? tile('Synced account', `${fmt(p.account.saves)} saves`, `${bytes(p.account.bytes)} · since ${day(p.account.createdAt)} · last sync ${day(p.account.lastSync)}`) : tile('Synced account', 'None')}
      ${tile('Screen name', p.screenName ? (p.nameReviewed ? 'Looked at' : 'Not looked at') : '–', p.nameSince ? `since ${day(p.nameSince)}` : '')}
    </div>
    <div class="row">
      ${p.screenName ? `<button class="btn" data-act="rename">Rename</button><button class="btn" data-act="reset">Reset name</button>` : ''}
      ${p.ban ? '<button class="btn" data-act="unban">Lift ban</button>' : '<button class="btn danger" data-act="ban">Ban</button>'}
      ${can('admin') ? '<button class="btn danger" data-act="reset-scores">Reset scores</button><button class="btn danger" data-act="delete">Delete account data</button>' : ''}
    </div>
    <h3>Latest scores</h3>
    ${table([{ label: 'When' }, { label: 'Kind' }, { label: 'Difficulty' }, { label: 'Cells', num: 1 }, { label: 'Time', num: 1 }, { label: 'Hints', num: 1 }, { label: 'Points', num: 1 }],
      p.recentScores.map((s) => [when(s.at), s.kind === 'race' ? 'Race' : 'Solo', esc(TIER_NAMES[s.tier] || s.tier), fmt(s.cells), `${Math.round(s.elapsedMs / 60000)} min`, fmt(s.hints), fmt(s.points)]), 'No scores.')}
  </div>`;
  $('#player-card').focus();
  $('#player-card').onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (await playerAction(b.dataset.act, uid, name, b)) { if (b.dataset.act === 'delete') show('players'); openPlayer(uid); }
  };
}

views.settings = async () => {
  const d = await api('settings');
  const groups = {};
  for (const s of d.settings) (groups[s.group] ||= []).push(s);
  const editable = can('admin');
  const control = (s) => {
    const dis = editable ? '' : ' disabled';
    if (s.type === 'bool') return `<label class="check"><input type="checkbox" data-key="${s.key}"${s.value ? ' checked' : ''}${dis}> <span>${s.value ? 'On' : 'Off'}</span></label>`;
    const save = editable ? `<button class="btn small" data-save="${s.key}">Save</button>` : '';
    const label = `<label class="sr-only" for="set-${s.key}">${esc(s.label)}</label>`;
    if (s.type === 'int') return `<div class="row"><div class="field">${label}<input id="set-${s.key}" type="number" min="${s.min}" max="${s.max}" value="${s.value}" inputmode="numeric"${dis}></div>${save}</div>`;
    if (s.type === 'choice') return `<div class="row"><div class="field">${label}<select id="set-${s.key}"${dis}>${s.options.map((o) => `<option value="${esc(o.value)}"${o.value === s.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>${save}</div>`;
    if (s.type === 'model') return `<div class="row"><div class="field">${label}<input id="set-${s.key}" type="text" value="${esc(s.value)}" autocomplete="off" spellcheck="false"${dis}></div>${save}</div>`;
    if (s.type === 'themes') return `${editable ? `<button class="btn small" data-save="${s.key}">Save themes</button>` : ''}`;
    return `${editable ? `<button class="btn small" data-save="${s.key}">Save words</button>` : ''}`;
  };
  const extra = (s) => {
    if (s.type === 'themes') return `<fieldset class="themes"><legend class="sr-only">${esc(s.label)}</legend>${d.themes.map((t) => `<label class="check"><input type="checkbox" name="theme-off" value="${esc(t.id)}"${s.value.includes(t.id) ? ' checked' : ''}${editable ? '' : ' disabled'}> ${esc(t.name)} off</label>`).join('')}</fieldset>`;
    if (s.type === 'words') return `<div class="field words"><label for="set-${s.key}">One word per line</label><textarea id="set-${s.key}" rows="4"${editable ? '' : ' disabled'}>${esc(s.value.join('\n'))}</textarea></div>`;
    return '';
  };
  const keyLine = (ok, name, what) => `<p>${ok ? '<span class="badge ok">Set</span>' : '<span class="badge warn">Not set</span>'} <b>${esc(name)}</b>: ${esc(what)}</p>`;
  const services = `<div class="card"><h2>Keys and services</h2><div class="services">
    ${keyLine(d.services.gemini, 'GEMINI_API_KEY', 'server voices and the Story workshop\'s AI writer (Google\'s free tier).')}
    ${keyLine(d.services.pictures, 'Workers AI', 'AI pictures (the AI binding in wrangler.toml, on Cloudflare\'s free allowance).')}
    <p class="muted">Keys are never typed here or kept in the game. Add or change them in Cloudflare: Workers &amp; Pages &gt; flg-api &gt; Settings &gt; Variables and Secrets, as type Secret.</p></div></div>`;
  $('#settings-body').innerHTML = services + (editable ? '' : '<p class="note">You can see the settings. Changing them needs the admin role.</p>')
    + Object.entries(groups).map(([g, list]) => `<div class="card"><h2>${esc(g)}</h2>${list.map((s) => `<div class="setting">
      <div><b id="lbl-${s.key}">${esc(s.label)}</b><p class="help">${esc(s.help)}</p>${s.updatedBy ? `<p class="meta">Changed by ${esc(s.updatedBy)} on ${when(s.updatedAt)}</p>` : ''}</div>
      <div>${control(s)}</div>${extra(s)}</div>`).join('')}</div>`).join('');
  $$('#settings-body input[type=checkbox][data-key]').forEach((c) => c.setAttribute('aria-labelledby', `lbl-${c.dataset.key}`));
};
async function saveSettingValue(key, value, button) {
  if (await act(button, () => api('settings', { method: 'POST', body: { key, value } }), 'Saved. Players get it within about a minute.')) show('settings', { keepFocus: true });
  else show('settings', { keepFocus: true });
}
$('#settings-body').onchange = (e) => {
  const c = e.target.closest('input[type=checkbox][data-key]');
  if (c) saveSettingValue(c.dataset.key, c.checked, c);
};
$('#settings-body').onclick = (e) => {
  const b = e.target.closest('button[data-save]');
  if (!b) return;
  const key = b.dataset.save;
  if (key === 'disabled_themes') saveSettingValue(key, $$('input[name=theme-off]:checked').map((x) => x.value), b);
  else if (key === 'blocked_words') saveSettingValue(key, $(`#set-${key}`).value.split(/[\s,]+/).filter(Boolean), b);
  else if ($(`#set-${key}`).type === 'number') saveSettingValue(key, Number($(`#set-${key}`).value), b);
  else saveSettingValue(key, $(`#set-${key}`).value.trim(), b);
};

views.announcements = async () => {
  const d = await api('announcements');
  $('#ann-form').hidden = !can('admin');
  $('#ann-list').innerHTML = d.announcements.length ? d.announcements.map((a) => `<li>
      ${a.live ? '<span class="badge ok">Showing now</span>' : a.startsAt > Date.now() ? '<span class="badge">Scheduled</span>' : '<span class="badge">Ended</span>'}
      ${a.level === 'warning' ? '<span class="badge warn">Warning</span>' : ''}
      <p>${esc(a.text)}</p>
      <p class="muted">From ${when(a.startsAt)} ${a.endsAt ? `to ${when(a.endsAt)}` : 'until ended'} · by ${esc(a.createdBy)}</p>
      ${can('admin') ? `<div class="row">${a.live || a.startsAt > Date.now() ? `<button class="btn small" data-act="end" data-id="${a.id}">End now</button>` : ''}<button class="btn small danger" data-act="delete" data-id="${a.id}">Delete</button></div>` : ''}
    </li>`).join('') : '<li class="muted">No announcements yet.</li>';
};
$('#ann-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#ann-text').value.trim();
  const err = $('#ann-error');
  err.hidden = true;
  if (text.length < 3) { err.textContent = 'Write at least 3 characters.'; err.hidden = false; $('#ann-text').focus(); return; }
  const start = $('#ann-start').value ? new Date($('#ann-start').value).getTime() : undefined;
  const end = $('#ann-end').value ? new Date($('#ann-end').value).getTime() : undefined;
  try {
    await api('announcements', { method: 'POST', body: { text, level: $('#ann-level').value, startsAt: start, endsAt: end } });
    $('#ann-form').reset();
    toast('Published. Players see it within about a minute.');
    show('announcements', { keepFocus: true });
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#ann-list').onclick = async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'delete' && !(await ask({ title: 'Delete this announcement?', ok: 'Delete', danger: true }))) return;
  if (await act(b, () => api(`announcements/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' }), b.dataset.act === 'end' ? 'Ended.' : 'Deleted.')) show('announcements', { keepFocus: true });
};

views.errors = async () => {
  const d = await api(`errors?days=${$('#err-days').value}`);
  $('#err-rows').innerHTML = d.errors.length ? d.errors.map((x) => `<tr><td class="num">${fmt(x.count)}</td><td>${esc(x.message)} <span class="badge">${esc(x.kind)}</span></td>
      <td><code>${esc(x.place || '–')}</code></td><td>${esc(x.platform)} ${esc(x.version)}</td><td>${esc(x.first)}${x.last !== x.first ? ` to ${esc(x.last)}` : ''}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No error reports in this period.</td></tr>';
};
$('#err-days').onchange = () => show('errors');

let auditBefore = null;
views.audit = async ({ more } = {}) => {
  const actor = $('#audit-actor').value.trim();
  const d = await api(`audit?actor=${encodeURIComponent(actor)}${more && auditBefore ? `&before=${auditBefore}` : ''}`);
  const rows = d.entries.map((x) => `<tr><td>${when(x.at)}</td><td>${esc(x.actor)} ${x.role ? `<span class="badge">${esc(x.role)}</span>` : ''}</td>
    <td>${esc(x.action)}${x.detail ? `<br><span class="muted">${esc(JSON.stringify(x.detail)).slice(0, 300)}</span>` : ''}</td><td>${x.target ? `<code>${esc(x.target)}</code>` : ''}</td>
    <td>${x.status < 300 ? '<span class="badge ok">Done</span>' : `<span class="badge bad">Refused ${x.status}</span>`}</td></tr>`).join('');
  if (more) $('#audit-rows').insertAdjacentHTML('beforeend', rows);
  else $('#audit-rows').innerHTML = rows || '<tr><td colspan="5" class="muted">Nothing logged yet.</td></tr>';
  auditBefore = d.entries.length ? d.entries[d.entries.length - 1].id : auditBefore;
  $('#audit-more').hidden = d.entries.length < 100;
};
let auditTimer;
$('#audit-actor').oninput = () => { clearTimeout(auditTimer); auditTimer = setTimeout(() => show('audit', { keepFocus: true }), 400); };
$('#audit-more').onclick = () => views.audit({ more: true }).catch((e) => toast(e.message));

views.admins = async () => {
  const d = await api('admins');
  const rows = [
    `<tr><td>${d.owner ? esc(d.owner) : '<i>Not set: add the OWNER_EMAIL secret</i>'}</td><td><span class="badge ok">owner</span></td><td>–</td><td></td></tr>`,
    ...d.admins.map((a) => `<tr><td>${esc(a.email)}</td><td><span class="badge">${esc(a.role)}</span></td><td>${day(a.addedAt)} by ${esc(a.addedBy)}</td>
      <td><div class="actions"><button class="btn small danger" data-email="${esc(a.email)}">Remove</button></div></td></tr>`),
  ];
  $('#admin-rows').innerHTML = rows.join('');
};
$('#admin-form').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('#admin-email').value.trim();
  if (!email) { $('#admin-email').focus(); return; }
  if (await act(e.submitter, () => api('admins', { method: 'POST', body: { email, role: $('#admin-role').value } }), `${email} can now sign in. They must use a game account with that email, confirmed.`)) { $('#admin-form').reset(); show('admins', { keepFocus: true }); }
};
$('#admin-rows').onclick = async (e) => {
  const b = e.target.closest('button[data-email]');
  if (!b) return;
  if (!(await ask({ title: `Remove ${b.dataset.email}?`, text: 'They lose access within an hour, when their sign-in next refreshes, and right away for new requests.', ok: 'Remove', danger: true }))) return;
  if (await act(b, () => api('admins/remove', { method: 'POST', body: { email: b.dataset.email } }), 'Removed.')) show('admins', { keepFocus: true });
};

$('#ov-days').onchange = () => show('overview');

// ------------------------------------------------------------- navigation
const MIN_ROLE = Object.fromEntries($$('#nav-list a').map((a) => [a.hash.slice(1), a.dataset.min]));

async function show(name, { keepFocus = false } = {}) {
  if (!views[name] || !can(MIN_ROLE[name])) name = 'overview';
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== name; });
  $$('#nav-list a').forEach((a) => (a.hash === `#${name}` ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  try { await views[name](); } catch (e) {
    if (e.code === 'sign_in') return;
    const sec = $(`[data-view="${name}"]`);
    $('.load-error', sec)?.remove();
    sec.insertAdjacentHTML('beforeend', `<p class="error load-error">${esc(e.message)}</p>`);
  }
  if (!keepFocus) $(`[data-view="${name}"] h1`)?.focus?.();
}
$$('[data-view] h1').forEach((h) => h.setAttribute('tabindex', '-1'));
addEventListener('hashchange', () => { if (me) show(location.hash.slice(1)); });

// ------------------------------------------------------------- sign-in
async function enter() {
  me = await api('me');
  $('#login').hidden = true;
  $('#verify').hidden = true;
  $('#app').hidden = false;
  $('#who').hidden = false;
  $('#who-email').textContent = me.email;
  $('#who-role').textContent = me.role;
  $$('#nav-list a').forEach((a) => { a.parentElement.hidden = !can(a.dataset.min); });
  show(location.hash.slice(1) || 'overview');
}

function signOut(message) {
  session = null;
  me = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  $('#app').hidden = true;
  $('#who').hidden = true;
  $('#login').hidden = false;
  if (message) { const err = $('#login-error'); err.textContent = message; err.hidden = false; }
  $('#login-email').focus();
}

async function tryEnter() {
  const err = $('#login-error');
  err.hidden = true;
  try { await enter(); } catch (e) {
    if (e.code === 'verify_email') {
      $('#verify-email').textContent = session.email || 'your email';
      $('#verify').hidden = false;
      $('#login').hidden = false;
      $('#verify-done').focus();
      return;
    }
    if (e.code !== 'sign_in') { session = null; saveSession(); }
    err.textContent = e.message;
    err.hidden = false;
  }
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
  try {
    const d = await firebase('accounts:signInWithPassword', { email, password, returnSecureToken: true });
    session = { mode: 'firebase', email: d.email, idToken: d.idToken, refreshToken: d.refreshToken, exp: Date.now() + Number(d.expiresIn || 3600) * 1000 };
    saveSession();
    $('#login-password').value = '';
    lastActive = Date.now();
    await tryEnter();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#token-form').onsubmit = async (e) => {
  e.preventDefault();
  const key = $('#token-input').value.trim();
  if (!key) return;
  session = { mode: 'token', key };
  saveSession();
  $('#token-input').value = '';
  lastActive = Date.now();
  await tryEnter();
};
$('#forgot').onclick = async () => {
  const email = $('#login-email').value.trim();
  if (!email) { $('#login-email').focus(); toast('Enter your email first.'); return; }
  try { await firebase('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); } catch (e) { if (e.code === 'not_set_up') { toast(e.message); return; } }
  toast('If that email has an account, a reset link is on its way.');
};
$('#verify-send').onclick = async (e) => {
  await act(e.currentTarget, async () => firebase('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: await bearer() }), 'Link sent. Check your email.');
};
$('#verify-done').onclick = async (e) => {
  // A fresh ID token carries the confirmed flag.
  await act(e.currentTarget, async () => { await bearer(true); await tryEnter(); });
};
$('#sign-out').onclick = () => signOut();

for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true });
setInterval(() => { if (session && Date.now() - lastActive > IDLE_MS) signOut('You were signed out after 30 minutes without activity.'); }, 60_000);

session = loadSession();
if (session) tryEnter();
else $('#login').hidden = false;
