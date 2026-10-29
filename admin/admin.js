// The admin dashboard for The Fantastical Logic Grid. Served by the game's
// Worker at /admin/ and talks only to its /admin/v1 API (server/src/admin.js).
// Sign-in uses Firebase's REST API with the admin's game account; the session
// lives only in this tab (sessionStorage) and ends after 30 idle minutes.

import { initPullRefresh } from './pull-refresh.js';
import { renderConnections } from './connections-view.js';
import { takeOAuthReturn, finishOAuth } from './oauth.js';
import { characterView } from './characters.js';
import { ratingsView, initRatings } from './ratings.js';
import { marketingView, initMarketing } from './marketing.js';
import { puzzleMailView, initPuzzleMail } from './puzzle-mail.js';
import { educatorsView, initEducators } from './educators.js';
import { badgesView, initBadges, playerBadgesHtml, playerBadgeClick } from './badges.js';

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
const TIER_NAMES = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'Quantum Physicist' };

let session = null; // { mode: 'firebase'|'token', key?, refreshToken?, idToken?, exp?, email? }
let me = null; // { email, role }
let firebaseKey = null;
let lastActive = Date.now();
// Back from a marketing site's sign-in (Connections and setup > Get the key).
let oauthBack = takeOAuthReturn();

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
  const back = document.activeElement;
  return new Promise((resolve) => {
    const values = () => Object.fromEntries(fields.map((f) => [f.name, $(`[name="${f.name}"]`, dlg).value]));
    const done = (v) => { dlg.close(); $('#dialog-form').onsubmit = null; $('#dialog-cancel').onclick = null; $('#dialog-x').onclick = null; dlg.oncancel = null; resolve(v); back?.focus?.(); };
    $('#dialog-form').onsubmit = (e) => {
      e.preventDefault();
      const v = values();
      const problem = check && check(v);
      if (problem) { $('#dialog-error').textContent = problem; $('#dialog-error').hidden = false; return; }
      done(v);
    };
    $('#dialog-cancel').onclick = () => done(null);
    $('#dialog-x').onclick = () => done(null);
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

function table(head, rows, empty = 'Nothing yet.', { csv = true } = {}) {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `${csv ? '<button class="btn small link csv-btn" type="button" data-csv>Download this table (CSV)</button>' : ''}<div class="table-wrap"><table class="table"><thead><tr>${head.map((h) => `<th scope="col"${h.num ? ' class="num"' : ''}>${esc(h.label || h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${head[i].num ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ------------------------------------------------------------- spreadsheets
// Any table can be saved as a CSV file for Excel; cells a spreadsheet would
// read as a formula get an apostrophe, because some text comes from players.
function csvText(rows) {
  const cell = (v) => {
    let t = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (/^[=+\-@]/.test(t)) t = `'${t}`;
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const slug = (t) => String(t || 'table').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table';
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-csv]');
  if (b) {
    const tbl = b.nextElementSibling && b.nextElementSibling.querySelector('table');
    if (!tbl) return;
    const rows = [...tbl.rows].map((r) => [...r.cells].map((c) => c.innerText));
    const sec = b.closest('[data-view]');
    let h = b.previousElementSibling;
    while (h && !/^H[1-3]$/.test(h.tagName)) h = h.previousElementSibling;
    const title = [sec && sec.querySelector('h1') && sec.querySelector('h1').textContent, h && h.textContent].filter(Boolean).join(' ');
    saveFile(new Blob([csvText(rows)], { type: 'text/csv' }), `${slug(title)}-${new Date().toISOString().slice(0, 10)}.csv`);
    announce('Table saved as a CSV file.');
    return;
  }
  const x = e.target.closest('[data-export]');
  if (x) {
    await act(x, async () => {
      const res = await fetch(`/admin/v1/export/${x.dataset.export}.csv`, { headers: { Authorization: `Bearer ${await bearer()}` } });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(d.error || 'export', d.message || `Download failed (${res.status}).`); }
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${x.dataset.export}.csv`;
      saveFile(await res.blob(), name);
    }, 'Download ready.');
  }
});

// ------------------------------------------------------------- views
const views = {};

function alertsHtml(a) {
  if (!a || !a.alerts.length) return '';
  return `<div class="note alerts" role="alert"><h2>Free limits</h2><ul>${a.alerts.map((x) => `<li><span class="badge ${x.level === 'full' ? 'bad' : 'warn'}">${x.percent}%</span> <b>${esc(x.label)}</b>: ${esc(x.text)}</li>`).join('')}</ul></div>`;
}

views.overview = async () => {
  const [d, al] = await Promise.all([api(`analytics?days=${$('#ov-days').value}`), api('alerts').catch(() => null)]);
  const p = d.players;
  const g = d.games;
  const plays = g.byDay.reduce((s, v) => s + v, 0);
  const solved = g.solvedByDay.reduce((s, v) => s + v, 0);
  const races = d.races.byDay.reduce((s, v) => s + v, 0);
  const errors = d.errors.byDay.reduce((s, v) => s + v, 0);
  const labels = d.dayList;
  setCount('#count-parts', d.review.parts.pending || 0);
  setCount('#count-names', d.review.namesWaiting || 0);
  setCount('#count-educators', d.review.educators || 0);
  const review = [];
  if (can('moderator') && d.review.parts.pending) review.push(`<a href="#stories">${fmt(d.review.parts.pending)} story ${d.review.parts.pending === 1 ? 'part' : 'parts'} waiting for review</a>`);
  const fb = d.review.feedback || {};
  const unread = d.review.messages || 0;
  setCount('#count-comm', can('moderator') ? (fb.idea || 0) + (fb.problem || 0) + unread : 0);
  if (can('moderator') && unread) review.push(`<a href="#communication">${fmt(unread)} unread ${unread === 1 ? 'message' : 'messages'} from players</a>`);
  if (can('moderator') && (fb.idea || fb.problem)) review.push(`<a href="#communication">${fmt(fb.idea || 0)} new ${fb.idea === 1 ? 'idea' : 'ideas'} and ${fmt(fb.problem || 0)} new ${fb.problem === 1 ? 'problem' : 'problems'} from players</a>`);
  if (can('moderator') && d.review.educators) review.push(`<a href="#educators">${fmt(d.review.educators)} educator ${d.review.educators === 1 ? 'request' : 'requests'} waiting for review</a>`);
  if (can('moderator') && d.review.namesWaiting) review.push(`<a href="#names">${fmt(d.review.namesWaiting)} new or changed screen ${d.review.namesWaiting === 1 ? 'name' : 'names'}</a>`);
  $('#ov-body').innerHTML = `
    ${alertsHtml(al)}
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

// ---- Communication: one inbox for messages, ideas, problems, error reports
// and emails to players, and sending messages, news and banners to players.
const FB_TOPICS = { story: 'Storyline idea', theme: 'Theme or topic idea', feature: 'Game feature idea', other: 'Other', play: 'Playing', sound: 'Sound and voices', pictures: 'Pictures', saving: 'Saving and sync' };
const MSG_TOPICS = { question: 'Question', idea: 'Idea', problem: 'Problem', team: 'Started by the team' };
const TYPE_NAMES = { message: 'Message', idea: 'Idea', problem: 'Problem', error: 'Error report', email: 'Email' };
const commTab = () => $('input[name=comm-tab]:checked').value;
let openThread = null;
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

function commCounts(c) {
  const waiting = (c.unread || 0) + (c.idea || 0) + (c.problem || 0);
  setCount('#count-comm', waiting);
  setCount('#count-inbox', waiting);
  const parts = [];
  if ('message' in c) parts.push(`${plural(c.message, 'open conversation', 'open conversations')}${c.unread ? ` (${fmt(c.unread)} unread)` : ''}`, plural(c.idea, 'new idea', 'new ideas'), plural(c.problem, 'new problem', 'new problems'));
  parts.push(`${plural(c.error, 'error report', 'different error reports')} in the last 7 days`, plural(c.email, 'email waiting to go out', 'emails waiting to go out'));
  return `Waiting: ${parts.join(', ')}.`;
}

const FB_BADGES = { new: '<span class="badge">New</span>', addressed: '<span class="badge ok">Addressed</span>', done: '<span class="badge ok">Done</span>' };
// An error report the team marked addressed (fixed in a version), or a button to mark it.
let errItems = [];
const errFix = (i) => { const f = i.meta.fix; return !f ? (can('admin') ? `<div class="row"><button class="btn small" type="button" data-err="${errItems.indexOf(i)}">Mark addressed</button></div>` : '')
  : f.missed ? `<p class="fb-note"><span class="badge warn">Still happening</span> Marked fixed in ${esc(f.fixedIn)}, but this report is from ${esc(i.meta.version)}. ${esc(f.note)}</p>`
  : `<p class="fb-note"><span class="badge ok">Addressed</span> Fixed in ${esc(f.fixedIn)}: ${esc(f.note)}</p>`; };

function itemHtml(i) {
  const type = `<span class="badge${i.type === 'error' ? ' bad' : i.type === 'problem' ? ' warn' : ''}">${TYPE_NAMES[i.type]}</span>`;
  const state = i.type === 'message'
    ? (i.status === 'done' ? '<span class="badge ok">Done</span>' : i.meta.unread ? '<span class="badge warn">Unread</span>' : '<span class="badge">Open</span>')
    : i.type === 'error' || i.type === 'email' ? '' : FB_BADGES[i.status] || FB_BADGES.new;
  if (i.type === 'message') {
    const m = i.meta;
    return `<li>${type} ${state} <b>${esc(i.title)}</b>
      <p class="muted">${esc(m.name || 'A signed-in player')} · ${esc(MSG_TOPICS[m.topic] || m.topic)} · ${plural(m.count, 'message', 'messages')} · last from ${m.lastFrom === 'team' ? 'the team' : 'the player'} ${when(i.at)}</p>
      <p class="fb-text">${esc(i.text)}</p>
      <div class="row"><button class="btn primary small" type="button" data-open="${i.id}">Open and reply</button></div></li>`;
  }
  if (i.type === 'idea' || i.type === 'problem') {
    const m = i.meta;
    return `<li>${type} ${state} <b>${esc(FB_TOPICS[m.topic] || m.topic)}</b>${m.themeName ? ` <span class="badge">Theme: ${esc(m.themeName)}</span>` : ''}
      <span class="muted">${when(i.at)} · ${esc(m.platform)} ${esc(m.version)}${m.conversationId ? ' · the player asked for a reply' : ''}</span>
      <p class="fb-text">${esc(i.text)}</p>
      ${i.status === 'addressed' && m.note ? `<p class="fb-note"><b>What we did:</b> ${esc(m.note)} <span class="muted">${when(m.doneAt)}</span></p>` : ''}
      <div class="row">${m.conversationId ? `<button class="btn primary small" type="button" data-open="${m.conversationId}">Reply</button>` : ''}
      ${i.status === 'new' ? `<button class="btn${m.conversationId ? '' : ' primary'} small" type="button" data-fb="${i.id}" data-status="addressed">Mark addressed</button>
        <button class="btn small" type="button" data-fb="${i.id}" data-status="done">Mark done</button>` : `<button class="btn small" type="button" data-fb="${i.id}" data-status="new">Mark new</button>`}
      <button class="btn small" type="button" data-fb="${i.id}" data-status="delete">Delete</button></div></li>`;
  }
  if (i.type === 'error') {
    const m = i.meta;
    return `<li>${type} <b>${esc(i.text)}</b> <span class="badge">${esc(i.title)}</span>
      <p class="muted">Seen ${plural(m.count, 'time', 'times')} · <code>${esc(m.place || '–')}</code> · ${esc(m.platform)} ${esc(m.version)} · ${esc(m.first)}${m.last !== m.first ? ` to ${esc(m.last)}` : ''}</p>${errFix(i)}</li>`;
  }
  return `<li>${type} <b>${esc(i.title)}</b> <span class="badge${i.meta.state === 'sent' ? ' ok' : i.meta.state === 'failed' ? ' bad' : ''}">${esc(i.text)}</span>
    <span class="muted">${when(i.at)}${i.meta.sentAt ? ` · sent ${when(i.meta.sentAt)}` : ''}</span></li>`;
}

views.communication = async () => {
  const tab = commTab();
  $('#comm-inbox').hidden = tab !== 'inbox';
  $('#comm-send').hidden = tab !== 'send';
  if (tab === 'send') { await sendView(); return; }
  const q = $('#comm-q').value.trim();
  const d = await api(`inbox?type=${$('#comm-type').value}&status=${$('#comm-status').value}&q=${encodeURIComponent(q)}`);
  for (const o of $('#comm-type').options) o.hidden = o.value !== 'all' && !d.types.includes(o.value);
  $('#comm-summary').textContent = `${commCounts(d.counts)} Showing ${plural(d.items.length, 'item', 'items')}${q ? ` with "${q}"` : ''}.`;
  const r = d.replies;
  $('#fb-replies').textContent = !r ? '' : r.enabled
    ? `Emails to players (thank-you notes, and notices of a team message for players who turned them on): ${fmt(r.sentToday)} sent in the last 24 hours, ${fmt(r.waiting)} waiting${r.failedToday ? `, ${fmt(r.failedToday)} could not be sent` : ''}. Limit ${fmt(r.cap)} a day. They go out every 15 minutes from noreply@thelogicgrid.com (or the game's Gmail as a backup); addresses are removed once sent.`
    : 'Emails to players are switched off (Settings and switches > Ideas and problems).';
  errItems = d.items;
  $('#comm-list').innerHTML = d.items.length ? d.items.map(itemHtml).join('') : '<li class="muted">Nothing here.</li>';
  if (openThread) await showThread(openThread, { keepFocus: true }).catch(() => closeThread());
};

async function showThread(id, { keepFocus = false } = {}) {
  const c = await api(`conversations/${id}`);
  openThread = id;
  const who = c.name ? esc(c.name) : 'The player';
  const panel = $('#comm-thread');
  panel.innerHTML = `<div class="head"><h2 id="thread-h" tabindex="-1">${esc(c.subject)}</h2><button class="btn small" type="button" data-thread="close">Back to the inbox</button></div>
    <p class="muted">${who}${c.name ? '' : ` (player id <code>${esc(c.uid)}</code>)`} · ${esc(MSG_TOPICS[c.topic] || c.topic)}${c.feedback ? ` from their ${c.feedback.kind === 'idea' ? 'idea' : 'problem report'}` : ''} · started ${when(c.createdAt)} ·
      ${c.status === 'done' ? '<span class="badge ok">Done</span>' : '<span class="badge">Open</span>'}${c.playerUnread ? ' · the player has not read the latest reply yet' : ''}</p>
    <ol class="messages">${c.messages.map((m) => `<li class="msg ${m.sender === 'team' ? 'team' : 'player'}">
      <p><b>${m.sender === 'team' ? `The team <span class="muted">(${esc(m.author || 'admin')})</span>` : who}</b> <span class="muted">${when(m.at)}</span></p>
      <p class="fb-text">${esc(m.text)}</p></li>`).join('')}</ol>
    <form id="reply-form" class="stack" novalidate>
      <div class="field"><label for="reply-text">Your reply (up to 2,000 characters). The player sees it signed "The team".</label><textarea id="reply-text" rows="4" maxlength="2000"></textarea></div>
      ${c.emailOn ? '<label class="check"><input type="checkbox" id="reply-email" checked> Also email them a notice (at most one a day; it never includes the message)</label>' : '<p class="muted">This player has not turned on email notices, so they will see the reply the next time they open Messages.</p>'}
      <label class="check"><input type="checkbox" id="reply-done"> Mark the conversation done after sending</label>
      <p class="error" id="reply-error" role="alert" hidden></p>
      <div class="row"><button class="btn primary" type="submit">Send reply</button>
        ${c.status === 'done' ? '<button class="btn" type="button" data-thread="open">Reopen</button>' : '<button class="btn" type="button" data-thread="done">Mark done</button>'}
        ${can('admin') ? '<button class="btn danger" type="button" data-thread="delete">Delete conversation</button>' : ''}</div>
    </form>`;
  panel.hidden = false;
  if (!keepFocus) { panel.scrollIntoView({ block: 'start' }); $('#thread-h').focus(); }
}
function closeThread() {
  openThread = null;
  $('#comm-thread').hidden = true;
  $('#comm-thread').innerHTML = '';
}

async function sendView() {
  const [n, a] = await Promise.all([api('news'), api('announcements')]);
  $('#news-list').innerHTML = n.news.length ? n.news.map((x) => `<li>
      ${x.live ? '<span class="badge ok">Showing now</span>' : '<span class="badge">Ended</span>'} <b>${esc(x.title)}</b>
      <p class="fb-text">${esc(x.text)}</p>
      <p class="muted">Since ${when(x.createdAt)} ${x.endsAt ? `until ${when(x.endsAt)}` : 'until ended'} · by ${esc(x.createdBy)}</p>
      ${can('admin') ? `<div class="row">${x.live ? `<button class="btn small" type="button" data-news="end" data-id="${x.id}">End now</button>` : ''}<button class="btn small danger" type="button" data-news="delete" data-id="${x.id}">Delete</button></div>` : ''}
    </li>`).join('') : '<li class="muted">No news yet.</li>';
  $('#ann-list').innerHTML = a.announcements.length ? a.announcements.map((x) => `<li>
      ${x.live ? '<span class="badge ok">Showing now</span>' : x.startsAt > Date.now() ? '<span class="badge">Scheduled</span>' : '<span class="badge">Ended</span>'}
      ${x.level === 'warning' ? '<span class="badge warn">Warning</span>' : ''}
      <p>${esc(x.text)}</p>
      <p class="muted">From ${when(x.startsAt)} ${x.endsAt ? `to ${when(x.endsAt)}` : 'until ended'} · by ${esc(x.createdBy)}</p>
      ${can('admin') ? `<div class="row">${x.live || x.startsAt > Date.now() ? `<button class="btn small" type="button" data-act="end" data-id="${x.id}">End now</button>` : ''}<button class="btn small danger" type="button" data-act="delete" data-id="${x.id}">Delete</button></div>` : ''}
    </li>`).join('') : '<li class="muted">No announcements yet.</li>';
}

$$('input[name=comm-tab]').forEach((r) => { r.onchange = () => show('communication', { keepFocus: true }); });
$('#comm-filter').onsubmit = (e) => { e.preventDefault(); closeThread(); show('communication', { keepFocus: true }); };
$('#comm-type').onchange = () => { closeThread(); show('communication', { keepFocus: true }); };
$('#comm-status').onchange = () => { closeThread(); show('communication', { keepFocus: true }); };
$('#comm-list').onclick = async (e) => {
  const o = e.target.closest('button[data-open]');
  if (o) { await act(o, () => showThread(Number(o.dataset.open))); return; }
  const eb = e.target.closest('button[data-err]');
  const x = eb && errItems[Number(eb.dataset.err)];
  if (x) {
    const m = x.meta;
    const v = await ask({ title: 'Mark this error addressed', text: `Every report of this error from ${esc(m.place ? m.place.split(':')[0] : 'this place')} counts as fixed for versions older than the one below.`, ok: 'Mark addressed',
      fields: [{ name: 'fixedIn', label: 'Fixed in version', value: '', help: 'The game version the fix shipped in, like 1.7.1.' }, { name: 'note', label: 'What was done', type: 'textarea' }],
      check: (y) => (!/^\d+(\.\d+){1,3}$/.test(y.fixedIn.trim()) ? 'Give a version like 1.7.1.' : y.note.trim() ? '' : 'Write a short note.') });
    if (!v) return;
    if (await act(eb, () => api('errors/fix', { method: 'POST', body: { message: x.text, place: m.place, fixedIn: v.fixedIn.trim(), note: v.note } }), 'Marked addressed.')) show('communication', { keepFocus: true });
    return;
  }
  const b = e.target.closest('button[data-fb]');
  if (!b) return;
  if (b.dataset.status === 'delete' && !(await ask({ title: 'Delete this message?', text: 'It cannot be brought back.', ok: 'Delete', danger: true }))) return;
  const words = { addressed: 'Marked addressed.', done: 'Marked done.', new: 'Marked new.', delete: 'Deleted.' };
  const body = { status: b.dataset.status };
  if (body.status === 'addressed') {
    const v = await ask({ title: 'Mark addressed', text: 'Say what was done in plain, everyday words a player would understand, like "Fixed: the grid no longer scrolls twice on tablets." If the player ticked "Email me an update", they get this note by email, with what they wrote.', ok: 'Mark addressed',
      fields: [{ name: 'note', label: 'What was done (plain words for the player)', type: 'textarea' }], check: (x) => (x.note.trim() ? plainWords(x.note) : 'Write a short note.') });
    if (!v) return;
    body.note = v.note;
  }
  let emailed = 0;
  if (await act(b, async () => { emailed = (await api(`feedback/${b.dataset.fb}`, { method: 'POST', body }))?.emailed || 0; }, '')) {
    const done = words[b.dataset.status] + (emailed ? ' The player gets an email update with your note.' : '');
    toast(done);
    announce(done);
    show('communication', { keepFocus: true });
  }
};
// The "What was done" note can go to the player by email, so it should read
// in everyday words: this catches the usual technical giveaways.
const TECH_WORDS = /\b[\w-]+\.(?:js|mjs|cjs|css|html|py|json|sql|yml)\b|\bPR\s*#?\d+|\b(?:commit|merged?|refactor(?:ed)?|regex|CSS|DOM|API|endpoint|null|undefined|stack trace|exception|D1|Worker|CI|repo|branch|viewport|z-index|async|callback|deploy(?:ed)?)\b/i;
function plainWords(note) {
  const m = note.match(TECH_WORDS);
  return m ? `"${m[0]}" is a technical word. Say what changed for the player in everyday words instead.` : '';
}
$('#comm-thread').onclick = async (e) => {
  const b = e.target.closest('button[data-thread]');
  if (!b) return;
  const kind = b.dataset.thread;
  if (kind === 'close') { closeThread(); $('#comm-list button, #comm-list')?.focus?.(); return; }
  if (kind === 'delete' && !(await ask({ title: 'Delete this conversation?', text: 'It goes from the player\'s Messages too, and cannot be brought back.', ok: 'Delete', danger: true }))) return;
  const id = openThread;
  const words = { done: 'Marked done.', open: 'Reopened.', delete: 'Deleted.' };
  if (await act(b, () => api(`conversations/${id}/status`, { method: 'POST', body: { status: kind } }), words[kind])) {
    if (kind === 'delete') closeThread();
    show('communication', { keepFocus: true });
  }
};
$('#comm-thread').addEventListener('submit', async (e) => {
  if (e.target.id !== 'reply-form') return;
  e.preventDefault();
  const text = $('#reply-text').value.trim();
  const err = $('#reply-error');
  err.hidden = true;
  if (text.length < 2) { err.textContent = 'Write the reply first.'; err.hidden = false; $('#reply-text').focus(); return; }
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  try {
    const r = await api(`conversations/${openThread}/reply`, { method: 'POST', body: { text, email: $('#reply-email') ? $('#reply-email').checked : false, done: $('#reply-done').checked } });
    const note = { queued: ' An email notice will go out within 15 minutes.', limit: ' No email notice: they already got one today.', off: ' No email notice: emails to players are switched off.' }[r.email] || '';
    toast(`Reply sent.${note}`);
    announce(`Reply sent.${note}`);
    await show('communication', { keepFocus: true });
    $('#thread-h')?.focus();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
});

$('#msg-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('#msg-error');
  err.hidden = true;
  const to = $('#msg-to').value.trim();
  const text = $('#msg-text').value.trim();
  if (!to) { err.textContent = 'Write their screen name or player id.'; err.hidden = false; $('#msg-to').focus(); return; }
  if (text.length < 2) { err.textContent = 'Write the message first.'; err.hidden = false; $('#msg-text').focus(); return; }
  try {
    const r = await api('conversations', { method: 'POST', body: { to, subject: $('#msg-subject').value.trim(), text, email: $('#msg-email').checked } });
    $('#msg-form').reset();
    toast('Sent. It shows in their Messages, and in the inbox here.');
    announce('Message sent.');
    openThread = r.id;
    $('input[name=comm-tab][value=inbox]').checked = true;
    $('#comm-status').value = 'all';
    await show('communication', { keepFocus: true });
    $('#thread-h')?.focus();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#news-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('#news-error');
  err.hidden = true;
  const title = $('#news-title').value.trim();
  const text = $('#news-text').value.trim();
  if (title.length < 3) { err.textContent = 'Write a title of at least 3 characters.'; err.hidden = false; $('#news-title').focus(); return; }
  if (text.length < 3) { err.textContent = 'Write the news first.'; err.hidden = false; $('#news-text').focus(); return; }
  const end = $('#news-end').value ? new Date($('#news-end').value).getTime() : undefined;
  try {
    await api('news', { method: 'POST', body: { title, text, endsAt: end } });
    $('#news-form').reset();
    toast('Published. Players see it in Messages within about a minute.');
    show('communication', { keepFocus: true });
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#news-list').onclick = async (e) => {
  const b = e.target.closest('button[data-news]');
  if (!b) return;
  if (b.dataset.news === 'delete' && !(await ask({ title: 'Delete this news?', ok: 'Delete', danger: true }))) return;
  if (await act(b, () => api(`news/${b.dataset.id}/${b.dataset.news}`, { method: 'POST' }), b.dataset.news === 'end' ? 'Ended.' : 'Deleted.')) show('communication', { keepFocus: true });
};
// Write to a player from their page under Players.
function messagePlayer(uid) {
  $('input[name=comm-tab][value=send]').checked = true;
  location.hash = 'communication';
  $('#msg-to').value = uid;
  setTimeout(() => $('#msg-subject').focus(), 50);
}

views.names = async () => {
  const d = await api(`names?status=${$('#names-status').value}`);
  $('#names-rows').innerHTML = d.names.length ? d.names.map((n) => `<tr>
      <td><b>${esc(n.name)}</b> ${n.flagged ? '<span class="badge warn">Check</span>' : ''}</td>
      <td>${day(n.updatedAt)}</td>
      <td>${n.banned ? '<span class="badge bad">Banned</span>' : n.reviewed ? `<span class="badge ok">Approved</span>` : '<span class="badge">New</span>'}</td>
      <td><div class="actions">
        ${!n.reviewed ? `<button class="btn small primary" data-act="approve" data-uid="${esc(n.uid)}" aria-label="Approve ${esc(n.name)}">Approve</button>` : ''}
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
  if (b.dataset.act === 'open') { location.hash = `players/${encodeURIComponent(uid)}`; return; }
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

const SECTION_BADGES = {
  pending: '<span class="badge warn">Needs approval</span>',
  active: '<span class="badge ok">Approved, active</span>',
  inactive: '<span class="badge">Approved, inactive</span>',
  blocked: '<span class="badge bad">Blocked</span>',
  account: '<span class="badge">No screen name yet</span>',
};
const playerList = { section: 'all', page: 1, dir: '' };
views.players = async ({ arg } = {}) => {
  const sort = $('#players-sort').value;
  const qs = new URLSearchParams({ q: $('#players-q').value.trim(), filter: playerList.section, sort, page: playerList.page, per: $('#players-per').value });
  if (playerList.dir) qs.set('dir', playerList.dir);
  const d = await api(`players?${qs}`);
  playerList.page = d.page;
  $$('#players-sections [data-section]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.section === d.filter));
    $('.n', b).textContent = `(${fmt(d.sections[b.dataset.section])})`;
  });
  $$('#players-table th[data-sort]').forEach((th) => (th.dataset.sort === d.sort ? th.setAttribute('aria-sort', d.dir === 'asc' ? 'ascending' : 'descending') : th.removeAttribute('aria-sort')));
  const moderator = can('moderator') && d.ids;
  const nameCell = (p) => {
    const label = p.name ? esc(p.name) : `<i>No screen name</i>${moderator ? ` <code>${esc(p.uid)}</code>` : ''}`;
    return moderator ? `<a class="rowlink" href="#players/${encodeURIComponent(p.uid)}">${label}</a>` : label;
  };
  const actions = (p) => {
    if (!moderator) return '';
    const n = esc(p.name || '');
    return `<td><div class="actions">
      ${p.section === 'pending' ? `<button class="btn small primary" data-act="approve" data-uid="${esc(p.uid)}" data-name="${n}" aria-label="Approve ${n}">Approve</button>` : ''}
      ${p.banned ? `<button class="btn small" data-act="unban" data-uid="${esc(p.uid)}" data-name="${n}" aria-label="Unblock ${n || 'this player'}">Unblock</button>`
        : `<button class="btn small danger" data-act="ban" data-uid="${esc(p.uid)}" data-name="${n}" aria-label="Block ${n || 'this player'}">Block</button>`}
    </div></td>`;
  };
  const cols = moderator ? 8 : 7;
  $('#players-rows').innerHTML = d.players.length ? d.players.map((p) => `<tr>
      <td>${nameCell(p)}</td><td>${day(p.joined)}</td><td>${day(p.seen)}</td>
      <td class="num">${fmt(p.solves)}</td><td class="num">${fmt(p.races)}</td><td class="num">${fmt(p.points)}</td>
      <td>${SECTION_BADGES[p.section] || ''}</td>${actions(p)}</tr>`).join('')
    : `<tr><td colspan="${cols}" class="muted">No players here.</td></tr>`;
  const from = d.total ? (d.page - 1) * d.per + 1 : 0;
  const to = Math.min(d.total, d.page * d.per);
  $('#players-count').textContent = d.total ? `Showing ${fmt(from)} to ${fmt(to)} of ${fmt(d.total)} players.` : 'No players here.';
  $('#players-page').textContent = `Page ${fmt(d.page)} of ${fmt(d.pages)}`;
  $('#players-prev').disabled = d.page <= 1;
  $('#players-next').disabled = d.page >= d.pages;
  if (arg && moderator) openPlayer(arg);
  else if (!arg) $('#player-detail').innerHTML = '';
};
// Changing the list closes any open player page, so the address goes back to #players.
const reloadPlayers = () => {
  if (location.hash !== '#players') history.replaceState(null, '', '#players');
  return show('players', { keepFocus: true });
};
$('#players-form').onsubmit = (e) => { e.preventDefault(); playerList.page = 1; if (location.hash !== '#players') location.hash = 'players'; else reloadPlayers(); };
$('#players-sort').onchange = () => { playerList.page = 1; playerList.dir = ''; reloadPlayers(); };
$('#players-per').onchange = () => { playerList.page = 1; reloadPlayers(); };
$('#players-prev').onclick = () => { playerList.page -= 1; reloadPlayers(); };
$('#players-next').onclick = () => { playerList.page += 1; reloadPlayers(); };
$('#players-sections').onclick = (e) => {
  const b = e.target.closest('[data-section]');
  if (!b) return;
  playerList.section = b.dataset.section;
  playerList.page = 1;
  reloadPlayers();
};
// A column heading sorts by that column; a second press turns the order round.
$('#players-table thead').onclick = (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th || !e.target.closest('button')) return;
  const cur = th.getAttribute('aria-sort');
  playerList.dir = cur === 'descending' ? 'asc' : cur === 'ascending' ? 'desc' : (th.dataset.sort === 'name' ? 'asc' : 'desc');
  $('#players-sort').value = th.dataset.sort;
  playerList.page = 1;
  reloadPlayers();
};
$('#players-rows').onclick = async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { uid, name } = b.dataset;
  const done = b.dataset.act === 'approve'
    ? await act(b, () => api(`names/${uid}/approve`, { method: 'POST' }), `${name} approved.`)
    : await playerAction(b.dataset.act, uid, name, b);
  if (done) reloadPlayers();
};

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
      ${tile('Screen name', p.screenName ? (p.nameReviewed ? 'Approved' : 'Needs approval') : '–', p.nameSince ? `since ${day(p.nameSince)}` : '')}
    </div>
    <div class="row">
      ${can('admin') && !p.deletedAt ? '<button class="btn primary" type="button" data-act="message">Send a message</button>' : ''}
      ${p.screenName ? `<button class="btn" data-act="rename">Rename</button><button class="btn" data-act="reset">Reset name</button>` : ''}
      ${p.ban ? '<button class="btn" data-act="unban">Lift ban</button>' : '<button class="btn danger" data-act="ban">Ban</button>'}
      ${can('admin') ? '<button class="btn danger" data-act="reset-scores">Reset scores</button><button class="btn danger" data-act="delete">Delete account data</button>' : ''}
    </div>
    ${playerBadgesHtml(badgeHelpers, p)}
    <h3>Latest scores</h3>
    ${table([{ label: 'When' }, { label: 'Kind' }, { label: 'Difficulty' }, { label: 'Cells', num: 1 }, { label: 'Time', num: 1 }, { label: 'Hints', num: 1 }, { label: 'Points', num: 1 }],
      p.recentScores.map((s) => [when(s.at), s.kind === 'race' ? 'Race' : 'Solo', esc(TIER_NAMES[s.tier] || s.tier), fmt(s.cells), `${Math.round(s.elapsedMs / 60000)} min`, fmt(s.hints), fmt(s.points)]), 'No scores.')}
  </div>`;
  $('#player-card').focus();
  $('#player-card').onclick = async (e) => {
    if (await playerBadgeClick(badgeHelpers, e, p, () => openPlayer(uid))) return;
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'message') { messagePlayer(uid); return; }
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
    if (s.type === 'url') return `<div class="row"><div class="field">${label}<input id="set-${s.key}" type="url" value="${esc(s.value)}" placeholder="https://" autocomplete="off" spellcheck="false"${dis}></div>${save}</div>`;
    if (s.type === 'themes') return `${editable ? `<button class="btn small" data-save="${s.key}">Save themes</button>` : ''}`;
    if (s.type === 'days') return `${editable ? `<button class="btn small" data-save="${s.key}">Save dates</button>` : ''}`;
    return `${editable ? `<button class="btn small" data-save="${s.key}">Save words</button>` : ''}`;
  };
  const extra = (s) => {
    if (s.type === 'themes') return `<fieldset class="themes"><legend class="sr-only">${esc(s.label)}</legend>${d.themes.map((t) => `<label class="check"><input type="checkbox" name="theme-${s.key}" value="${esc(t.id)}"${s.value.includes(t.id) ? ' checked' : ''}${editable ? '' : ' disabled'}> ${esc(t.name)}${s.key === 'disabled_themes' ? ' off' : ''}</label>`).join('')}</fieldset>`;
    if (s.type === 'days') return `<div class="field words"><label for="set-${s.key}">One date per line, like 2026-11-03</label><textarea id="set-${s.key}" rows="4"${editable ? '' : ' disabled'}>${esc(s.value.join('\n'))}</textarea></div>`;
    if (s.type === 'words') return `<div class="field words"><label for="set-${s.key}">One word per line</label><textarea id="set-${s.key}" rows="4"${editable ? '' : ' disabled'}>${esc(s.value.join('\n'))}</textarea></div>`;
    return '';
  };
  const keyLine = (ok, name, what) => `<p>${ok ? '<span class="badge ok">Set</span>' : '<span class="badge warn">Not set</span>'} <b>${esc(name)}</b>: ${esc(what)}</p>`;
  const services = `<div class="card"><h2>Keys and services</h2><div class="services">
    ${keyLine(d.services.gemini, 'GEMINI_API_KEY', 'server voices and the Story workshop\'s AI writer (Google\'s free tier).')}
    ${keyLine(d.services.pictures, 'Workers AI', 'AI pictures (the AI binding in wrangler.toml, on Cloudflare\'s free allowance).')}
    <p class="muted">Keys are never typed here or kept in the game. Add or change them in Cloudflare: Workers &amp; Pages &gt; flg-api &gt; Settings &gt; Variables and Secrets, as type Secret.</p>
    <p><a href="#connections">Every key, service and setting, with steps: Connections and setup</a></p></div></div>`;
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
  if (key === 'disabled_themes' || key === 'premium_themes') saveSettingValue(key, $$(`input[name=theme-${key}]:checked`).map((x) => x.value), b);
  else if (key === 'blocked_words' || key === 'hand_picked_days') saveSettingValue(key, $(`#set-${key}`).value.split(/[\s,]+/).filter(Boolean), b);
  else if ($(`#set-${key}`).type === 'number') saveSettingValue(key, Number($(`#set-${key}`).value), b);
  else saveSettingValue(key, $(`#set-${key}`).value.trim(), b);
};

const SUP_TIER = ['', 'Bronze', 'Silver', 'Gold', 'Platinum'];
const SUP_SOURCE = { admin: 'Added here', kofi: 'Ko-fi', lemonsqueezy: 'Lemon Squeezy' };
const SUP_ENDED = { ended: 'Ended', refund: 'Refunded', chargeback: 'Chargeback', blocked: 'Blocked' };
views.supporters = async () => {
  const [d, b] = await Promise.all([api('supporters'), api('supporters/blocks')]);
  $('#sup-rows').innerHTML = d.supporters.length ? d.supporters.map((s) => `<tr>
      <td>${s.name ? `<bdi>${esc(s.name)}</bdi><br>` : ''}<span class="muted">${esc(s.email || s.uid || '')}</span>${s.note ? `<br><small>${esc(s.note)}</small>` : ''}</td>
      <td>${s.kind === 'premium' ? 'Premium' : 'Supporter'}${s.active ? '' : ` <span class="badge${s.endedReason === 'chargeback' || s.endedReason === 'blocked' ? ' warn' : ''}">${SUP_ENDED[s.endedReason] || 'Ended'}</span>`}</td>
      <td>${SUP_TIER[s.tier] || 'Bronze'}</td>
      <td>${esc(SUP_SOURCE[s.source] || s.source)}${s.createdBy ? `<br><small class="muted">${esc(s.createdBy)}</small>` : ''}</td>
      <td>${when(s.createdAt)}</td>
      <td>${s.until ? when(s.until) : 'Never'}</td>
      <td><div class="row">${s.active ? `<button class="btn small" data-sup-end="${s.id}" data-reason="refund">Refunded</button>
        <button class="btn small danger" data-sup-end="${s.id}" data-reason="chargeback">Chargeback</button>
        <button class="btn small" data-sup-end="${s.id}" data-reason="ended">End now</button>` : ''}
        ${s.source === 'admin' ? '' : `<button class="btn small" data-sup-evidence="${s.id}">Dispute evidence</button>`}</div></td>
    </tr>`).join('') : '<tr><td colspan="7" class="muted">No supporters yet.</td></tr>';
  $('#sup-blocks').innerHTML = b.blocks.length ? b.blocks.map((x) => `<tr>
      <td><span class="muted">${esc(x.email || x.uid || '')}</span>${x.note ? `<br><small>${esc(x.note)}</small>` : ''}</td>
      <td>${when(x.createdAt)}${x.createdBy ? `<br><small class="muted">${esc(x.createdBy)}</small>` : ''}</td>
      <td><button class="btn small" data-sup-unblock="${x.id}">Lift the block</button></td>
    </tr>`).join('') : '<tr><td colspan="3" class="muted">No one is blocked.</td></tr>';
};
const SUP_ASK = {
  refund: { title: 'Mark as refunded?', text: 'Use this after you refund the payment in the payment service. The badge and any extras for this payment stop now. The record stays here.', ok: 'Mark refunded' },
  chargeback: { title: 'Mark as a chargeback?', text: 'Use this when the payment service tells you about a dispute or chargeback. Every badge and extra this player has stops now, the records stay here for the dispute, and new payments from them add nothing until you lift the block. Download the dispute evidence to answer the payment service.', ok: 'Mark chargeback', danger: true, fields: [{ name: 'note', label: 'Dispute id or note (optional, for you)' }] },
  ended: { title: 'End this grant now?', text: 'The badge and any extras stop for this player. A payment service may add a new grant if they pay again.', ok: 'End now', danger: true },
};
$('#sup-form').onsubmit = async (e) => {
  e.preventDefault();
  const who = $('#sup-who').value.trim();
  const err = $('#sup-error');
  err.hidden = true;
  if (!who) { err.textContent = 'Give the player\'s email or player id.'; err.hidden = false; $('#sup-who').focus(); return; }
  const day = $('#sup-until').value;
  const body = { kind: $('#sup-kind').value, tier: Number($('#sup-tier').value), note: $('#sup-note').value.trim(), until: day ? new Date(`${day}T23:59:59`).getTime() : null, ...(who.includes('@') ? { email: who } : { uid: who }) };
  try {
    await api('supporters', { method: 'POST', body });
    $('#sup-form').reset();
    toast('Added. They see it the next time the game checks, within a few minutes.');
    show('supporters', { keepFocus: true });
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#sup-rows').onclick = async (e) => {
  const ev = e.target.closest('button[data-sup-evidence]');
  if (ev) {
    await act(ev, async () => {
      const res = await fetch(`/admin/v1/supporters/${ev.dataset.supEvidence}/evidence`, { headers: { Authorization: `Bearer ${await bearer()}` } });
      if (!res.ok) throw new ApiError('evidence', `The download failed (${res.status}).`);
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'payment-evidence.txt';
      saveFile(await res.blob(), name);
    }, 'Download ready.');
    return;
  }
  const b = e.target.closest('button[data-sup-end]');
  if (!b) return;
  const reason = b.dataset.reason || 'ended';
  const v = await ask(SUP_ASK[reason]);
  if (!v) return;
  const done = { refund: 'Marked refunded.', chargeback: 'Marked as a chargeback. Their perks stopped and new payments are blocked.', ended: 'Ended.' }[reason];
  if (await act(b, () => api(`supporters/${b.dataset.supEnd}/remove`, { method: 'POST', body: { reason, note: (v.note || '').trim() } }), done)) show('supporters', { keepFocus: true });
};
$('#sup-blocks').onclick = async (e) => {
  const b = e.target.closest('button[data-sup-unblock]');
  if (!b) return;
  if (!(await ask({ title: 'Lift this block?', text: 'New payments from this player will add a badge and extras again. Do this once the dispute is settled in your favor or the player has paid it back.', ok: 'Lift the block' }))) return;
  if (await act(b, () => api(`supporters/blocks/${b.dataset.supUnblock}/remove`, { method: 'POST' }), 'Block lifted.')) show('supporters', { keepFocus: true });
};
views.connections = () => renderConnections($('#connections-view'), { api, esc, when, toast, announce, ask });

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
    show('communication', { keepFocus: true });
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
};
$('#ann-list').onclick = async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'delete' && !(await ask({ title: 'Delete this announcement?', ok: 'Delete', danger: true }))) return;
  if (await act(b, () => api(`announcements/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' }), b.dataset.act === 'end' ? 'Ended.' : 'Deleted.')) show('communication', { keepFocus: true });
};


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

const ARCHIVE_STATUS = { exported: ['warn', 'Made; email not confirmed'], sent: ['ok', 'Sent'], empty: ['ok', 'Nothing to archive'], off: ['', 'Switched off'], not_set_up: ['warn', 'Email not set up'], failed: ['bad', 'Failed'] };

views.backups = async () => {
  const d = await api('archive');
  const owner = can('owner');
  const yes = (ok, text) => `<span class="badge ${ok ? 'ok' : 'warn'}">${ok ? 'Done' : 'Not yet'}</span> ${text}`;
  const viaGitHub = d.route === 'github';
  const ready = d.setUp.binding && d.setUp.to;
  const mode = !d.emailOn ? 'Off. The daily cleanup removes old rows without a backup, as before.'
    : d.removeOn ? 'On. Each Monday the rows below are emailed, then removed.'
      : 'Email only. Each Monday the rows below are emailed and nothing is removed, so they pile up until removal is switched on.';
  const lastSent = d.runs.find((r) => r.status === 'sent' || r.status === 'empty');
  const pendingRows = d.plan.flatMap((p) => [[`<b>${esc(p.label)}</b><br><span class="muted">${esc(p.table)}${p.children.length ? ` + ${esc(p.children.join(', '))}` : ''}</span>`,
    `${p.keepDays} days`, esc(p.why), fmt([p.table, ...p.children].reduce((s, t) => s + (d.pending[t] || 0), 0))]]);
  const runs = d.runs.map((r) => {
    const [cls, label] = ARCHIVE_STATUS[r.status] || ['', r.status];
    const rows = Object.values(r.rows || {}).reduce((s, n) => s + n, 0);
    return [when(r.ranAt), esc(r.trigger === 'weekly' ? 'Weekly' : r.trigger), `<span class="badge ${cls}">${esc(label)}</span>${r.message ? `<br><span class="muted">${esc(r.message)}</span>` : ''}`,
      fmt(rows), bytes(r.bytes), r.removed ? 'Yes' : 'No'];
  });
  const route = viaGitHub
    ? `<p><b>Sent by:</b> the GitHub Action "Weekly archive email", from the game's Gmail account. Last sent: ${lastSent ? when(lastSent.ranAt) : 'not yet'}.</p>
      <p class="muted">It needs the repository secrets <code>FLG_ADMIN_TOKEN</code>, <code>GMAIL_USER</code>, <code>GMAIL_APP_PASSWORD</code> and <code>ARCHIVE_TO</code> (steps in <code>server/ARCHIVE.md</code>). To send now, run that workflow from the repository's Actions tab.</p>`
    : `<ul class="plain">
        <li>${yes(d.setUp.binding, 'Cloudflare Email Routing connected to the Worker (the <code>ARCHIVE_EMAIL</code> binding)')}</li>
        <li>${yes(d.setUp.to, 'Where it goes: the <code>ARCHIVE_TO</code> secret, a verified destination address')}</li>
      </ul>`;
  $('#backups-body').innerHTML = `<div class="card"><h2>Status</h2>
      <p><b>Weekly email:</b> ${esc(mode)} <a href="#settings">Change in Settings and switches</a> (group Backups).</p>
      <p><b>When:</b> ${esc(d.schedule)}.</p>
      ${route}
      ${owner ? `<div class="row">${viaGitHub ? '' : `<button class="btn primary" type="button" id="archive-send"${ready ? '' : ' disabled'}>Send the archive email now</button>`}
        <button class="btn" type="button" id="archive-download">Download the zip now</button></div>
        <p class="muted">Rows are removed only after an email is confirmed sent and both Backups switches are on. Downloading never removes anything.</p>` : ''}
    </div>
    <div class="card"><h2>What gets archived</h2>
      <p class="muted">Rows older than the number of days shown. "Waiting" is how many would go in the next archive.</p>
      ${table(['What', 'Kept in the database', 'Why the game does not need older rows', { label: 'Waiting', num: true }], pendingRows)}
      <h3>Personal data in the zip</h3><ul>${d.personalData.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    </div>
    <h2>Recent runs</h2>
    ${table(['When', 'Started by', 'Result', { label: 'Rows', num: true }, { label: 'Zip', num: true }, 'Removed'], runs, 'No runs yet.')}`;
};
$('#backups-body').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'archive-send') {
    const ok = await ask({ title: 'Send the archive email now?', text: 'The zip goes to the ARCHIVE_TO address. Rows are removed afterwards only if both Backups switches are on.', ok: 'Send' });
    if (!ok) return;
    let r;
    if (await act(b, async () => { r = await api('archive/run', { method: 'POST', body: {} }); })) {
      toast(r.status === 'sent' ? `Sent${r.removed ? ' and removed' : ''}.` : (ARCHIVE_STATUS[r.status] || [, r.status])[1]);
      show('backups', { keepFocus: true });
    }
  }
  if (b.id === 'archive-download') {
    await act(b, async () => {
      const res = await fetch('/admin/v1/archive/download', { headers: { Authorization: `Bearer ${await bearer()}` } });
      if (!res.ok) throw new ApiError('download', `The download failed (${res.status}).`);
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'flg-archive.zip';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, 'Downloaded. Nothing was removed.');
  }
};

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

views.search = async () => {
  const d = await api('search');
  $('#search-refresh').hidden = !can('admin');
  $('#search-body').innerHTML = [['google', 'Google Search Console'], ['bing', 'Bing Webmaster Tools']].map(([key, title]) => searchSource(title, key, d.sources[key])).join('');
};
const SEARCH_SETUP = {
  google: 'Add the Worker secret <code>GSC_SERVICE_ACCOUNT</code> (a Google Cloud service account key that is a user on the Search Console property). Steps are in admin/README.md.',
  bing: 'Add the Worker secret <code>BING_WEBMASTER_KEY</code> (Bing Webmaster Tools, Settings, API access). Steps are in admin/README.md.',
};
function searchSource(title, key, s) {
  const head = `<h2>${esc(title)}</h2>`;
  if (!s.connected && !s.data) return `<div class="card">${head}<p class="note">Not connected yet. ${SEARCH_SETUP[key]}</p></div>`;
  const status = s.error
    ? `<p class="error">The last fetch (${when(s.triedAt)}) failed: ${esc(s.error)}${s.data ? ' The numbers below are from the last good fetch.' : ''}</p>`
    : s.fetchedAt ? `<p class="muted">Fetched ${when(s.fetchedAt)}.</p>` : '<p class="muted">Not fetched yet: it runs every night at 2 am Eastern, or press Refresh now.</p>';
  const x = s.data;
  if (!x) return `<div class="card">${head}${status}</div>`;
  const t = x.totals;
  const short = (u) => esc(String(u).replace(/^https?:\/\/(www\.)?thelogicgrid\.com/, '') || '/');
  const rows = (list, label, link) => table([{ label }, { label: 'Clicks', num: 1 }, { label: 'Impressions', num: 1 }, { label: 'CTR', num: 1 }, { label: 'Position', num: 1 }],
    list.map((r) => [link ? `<span title="${esc(r.key)}">${short(r.key)}</span>` : esc(r.key), fmt(r.clicks), fmt(r.impressions), r.ctr == null ? '–' : `${r.ctr}%`, r.position ?? '–']), 'No data yet.');
  const maps = x.sitemaps.length ? table([{ label: 'Sitemap' }, { label: 'Submitted' }, { label: 'Last read' }, { label: 'Pages', num: 1 }, { label: 'Indexed', num: 1 }, { label: 'Status' }],
    x.sitemaps.map((m) => [short(m.path), m.lastSubmitted ? when(Date.parse(m.lastSubmitted)) : '–', m.lastDownloaded ? when(Date.parse(m.lastDownloaded)) : '–', fmt(m.submitted), m.indexed == null ? '–' : fmt(m.indexed),
      m.errors ? `<span class="badge bad">${fmt(m.errors)} errors</span>` : m.pending ? '<span class="badge">Waiting</span>' : m.status ? esc(m.status) : '<span class="badge ok">OK</span>'])) : '<p class="muted">No sitemaps listed.</p>';
  const index = key === 'google'
    ? (x.home ? `<p>Home page: <span class="badge ${x.home.verdict === 'PASS' ? 'ok' : 'warn'}">${esc(x.home.coverage || x.home.verdict || 'Unknown')}</span>${x.home.lastCrawl ? ` · last crawled ${when(Date.parse(x.home.lastCrawl))}` : ''}</p>` : '')
    : (x.crawl ? `<p>Pages in Bing's index: <b>${fmt(x.crawl.inIndex)}</b> · crawled ${fmt(x.crawl.crawled)} on ${esc(x.crawl.date)}${x.crawl.errors ? ` · <span class="badge bad">${fmt(x.crawl.errors)} crawl errors</span>` : ''}</p>` : '');
  return `<div class="card">${head}${status}
    ${x.errors?.length ? `<p class="note">Some parts did not load: ${esc(x.errors.join(' · '))}</p>` : ''}
    <p class="muted">${esc(x.start)} to ${esc(x.end)}</p>
    <div class="tiles">${tile('Clicks', fmt(t.clicks))}${tile('Impressions', fmt(t.impressions))}${tile('Click rate', `${t.ctr ?? 0}%`)}${t.position != null ? tile('Average position', t.position) : ''}</div>
    <div class="charts">${bars('Clicks per day', x.byDay.map((r) => r.clicks), { labels: x.byDay.map((r) => r.date) })}${bars('Impressions per day', x.byDay.map((r) => r.impressions), { labels: x.byDay.map((r) => r.date) })}</div>
    <h3>Indexing and sitemaps</h3>${index}${maps}
    <h3>Top searches</h3>${rows(x.queries, 'Search')}
    <h3>Top pages</h3>${rows(x.pages, 'Page', true)}</div>`;
}
$('#search-refresh').onclick = async (e) => {
  if (await act(e.currentTarget, () => api('search/refresh', { method: 'POST' }), 'Fetched the latest numbers.')) show('search', { keepFocus: true });
};

$('#ov-days').onchange = () => show('overview');

// ---- Daily puzzles: preview the coming days and plan changes.
let dailyData = null;
views.daily = async () => {
  const d = dailyData = await api('daily');
  const plan = new Map(d.plan.map((p) => [p.date, p]));
  const theme = (id) => (d.themes.find((t) => t.id === id) || {}).name || id;
  const tier = (id) => (d.tiers.find((t) => t.id === id) || {}).name || id;
  const days = (d.upcoming && d.upcoming.days) || [];
  const built = d.upcoming ? `Preview from the site build of ${when(Date.parse(d.upcoming.built))}.` : '';
  const rows = days.map((u) => {
    const p = plan.get(u.date);
    const changed = p && (!u.planned || (p.updatedAt && Date.parse(d.upcoming.built) < p.updatedAt));
    const want = p ? [p.theme && theme(p.theme), p.difficulty && tier(p.difficulty), p.categories && `${p.categories} × ${p.items}`, p.reroll && `new story ${p.reroll}`].filter(Boolean).join(', ') : '';
    return `<tr><td><b>${esc(new Date(`${u.date}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }))}</b></td>
      <td><b>${esc(u.title)}</b><br><span class="muted">${esc(u.opening)}</span>${p && p.note ? `<br><span class="badge">${esc(p.note)}</span>` : ''}${changed ? `<br><span class="badge warn">Changes after the next build</span>${want ? ` <span class="muted">(${esc(want)})</span>` : ''}` : p ? ' <span class="badge ok">Planned</span>' : ''}</td>
      <td>${esc(u.themeName)}</td><td>${esc(u.difficultyName)}</td><td class="num">${u.categories} × ${u.items}</td>
      <td>${can('admin') ? `<div class="row"><button class="btn small" data-plan="${esc(u.date)}">Change</button><button class="btn small" data-plan-new="${esc(u.date)}">New story</button>${p ? `<button class="btn small" data-plan-reset="${esc(u.date)}">Back to automatic</button>` : ''}</div>` : ''}</td></tr>`;
  }).join('');
  // Changes for days past the preview are listed too.
  const later = d.plan.filter((p) => !days.some((u) => u.date === p.date));
  $('#daily-body').innerHTML = `
    ${d.siteError ? `<p class="error">The preview could not be loaded: ${esc(d.siteError)}</p>` : `<p class="muted">${built}</p>`}
    ${days.length ? `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Puzzle</th><th scope="col">Theme</th><th scope="col">Difficulty</th><th scope="col" class="num">Size</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${later.length ? `<h2>Planned further ahead</h2>${table([{ label: 'Day' }, { label: 'Change' }, { label: 'Note' }, { label: '' }], later.map((p) => [esc(p.date), esc([p.theme && theme(p.theme), p.difficulty && tier(p.difficulty), p.categories && `${p.categories} × ${p.items}`, p.reroll && `new story ${p.reroll}`].filter(Boolean).join(', ') || 'automatic'), esc(p.note || ''), can('admin') ? `<button class="btn small" data-plan="${esc(p.date)}">Change</button> <button class="btn small" data-plan-reset="${esc(p.date)}">Back to automatic</button>` : '']), '', { csv: false })}` : ''}
    ${can('admin') ? `<form id="daily-other" class="row card" novalidate><div class="field"><label for="daily-date">Plan another day (up to ${d.aheadDays} days ahead)</label><input id="daily-date" type="date" min="${esc(d.today)}"></div><button class="btn" type="submit">Plan this day</button></form>` : ''}`;
};
function sizesFor(tierId) {
  const t = dailyData.tiers.find((x) => x.id === tierId);
  if (!t) return [];
  const out = [];
  for (let k = t.categories[0]; k <= t.categories[1]; k++) for (let n = t.items[0]; n <= t.items[1]; n++) out.push(`${k}x${n}`);
  return out;
}
async function planDay(date, button) {
  const p = dailyData.plan.find((x) => x.date === date) || {};
  const sizes = ['3x3', '3x4', '3x5', '4x4', '4x5', '5x5', '5x6', '6x6', '6x7', '6x8'];
  const v = await ask({
    title: `Plan ${new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`,
    text: 'Leave a choice on Automatic to keep that day\'s usual pick.',
    fields: [
      { name: 'theme', label: 'Theme', type: 'select', value: p.theme || '', options: [['', 'Automatic'], ...dailyData.themes.map((t) => [t.id, t.name])] },
      { name: 'difficulty', label: 'Difficulty', type: 'select', value: p.difficulty || '', options: [['', 'Automatic (by weekday)'], ...dailyData.tiers.map((t) => [t.id, t.name])] },
      { name: 'size', label: 'Size (categories × items)', type: 'select', value: p.categories ? `${p.categories}x${p.items}` : 'auto', options: [['auto', 'Automatic (the level\'s usual size)'], ...sizes.map((x) => [x, x.replace('x', ' × ')])] },
      { name: 'note', label: 'Note for other admins (optional)', value: p.note || '' },
    ],
    ok: 'Save the plan',
    check: (x) => {
      if (x.size !== 'auto' && x.difficulty && !sizesFor(x.difficulty).includes(x.size)) return `That size is outside ${dailyData.tiers.find((t) => t.id === x.difficulty).name}'s usual sizes (${sizesFor(x.difficulty).map((z) => z.replace('x', ' × ')).join(', ')}). It still works, but the puzzle may feel harder or easier than the level says. Choose Automatic or one of those sizes.`;
      return null;
    },
  });
  if (!v) return;
  if (await act(button, () => api(`daily/${date}`, { method: 'POST', body: v }), 'Saved. It shows after the next site build.')) show('daily', { keepFocus: true });
}
$('#daily-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.plan) planDay(b.dataset.plan, b);
  else if (b.dataset.planNew) {
    const date = b.dataset.planNew;
    const p = dailyData.plan.find((x) => x.date === date) || {};
    const body = { theme: p.theme || '', difficulty: p.difficulty || '', size: p.categories ? `${p.categories}x${p.items}` : 'auto', note: p.note || '', newStory: true };
    if (await act(b, () => api(`daily/${date}`, { method: 'POST', body }), 'A different story will be picked at the next site build.')) show('daily', { keepFocus: true });
  } else if (b.dataset.planReset) {
    if (await act(b, () => api(`daily/${b.dataset.planReset}/reset`, { method: 'POST', body: {} }), 'Back to automatic.')) show('daily', { keepFocus: true });
  }
});
$('#daily-body').addEventListener('submit', (e) => {
  if (e.target.id !== 'daily-other') return;
  e.preventDefault();
  const date = $('#daily-date').value;
  if (!date) { toast('Pick a day first.'); return; }
  planDay(date, e.target.querySelector('button'));
});

// ---- Characters (characters.js): the game's own cast and narrators.
views.characters = () => characterView({ api, esc, toast, announce, act, can, setCount });

// ---- Puzzle quality: what to fix first.
views.quality = async () => {
  const q = await api(`quality?days=${$('#q-days').value}`);
  setCount('#count-quality', q.flagged);
  const p = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
  $('#quality-body').innerHTML = `
    <div class="tiles">${tile('Groups to look at', fmt(q.flagged), `of ${fmt(q.rows.length)} theme and level groups`)}${tile('Games', fmt(q.rows.reduce((s, r) => s + r.games, 0)), `since ${esc(q.since)}`)}</div>
    ${table([{ label: 'Theme' }, { label: 'Difficulty' }, { label: 'What players say' }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Gave up', num: 1 }, { label: 'Too hard', num: 1 }, { label: 'Too easy', num: 1 }, { label: 'Rating', num: 1 }, { label: 'Minutes', num: 1 }, { label: 'Hints', num: 1 }],
      q.rows.map((r) => [esc(r.theme), esc(TIER_NAMES[r.tier] || r.tier), r.issues.length ? r.issues.map((x) => `<span class="badge warn">${esc(x.text)}</span>`).join(' ') : (r.games < q.minGames ? '<span class="muted">Too few games yet</span>' : '<span class="badge ok">Fine</span>'),
        fmt(r.games), p(r.solveRate), p(r.quitRate), p(r.tooHard), p(r.tooEasy), r.rating ?? '–', r.minutes ?? '–', r.hints ?? '–']), 'No games shared in this period.')}`;
};
$('#q-days').onchange = () => show('quality');

// ---- Ratings and insights (ratings.js): stars after each solve, and what they say.
const ratingHelpers = { api, esc, fmt, when, tile, table, can, act, setCount };
views.ratings = () => ratingsView(ratingHelpers);
initRatings(ratingHelpers, (name, o) => show(name, o));

// ---- Marketing (marketing.js): campaigns, ads, media, tracked links and their numbers.
const marketingHelpers = { api, esc, fmt, when, tile, table, can, act, ask, toast, announce };
views.marketing = () => marketingView(marketingHelpers);
initMarketing(marketingHelpers, (name, o) => show(name, o));
const educatorHelpers = { api, esc, fmt, when, can, act, ask, setCount };
views.educators = () => educatorsView(educatorHelpers);
initEducators(educatorHelpers, (name, o) => show(name, o));
// ---- Badges (badges.js): special badges by hand and for milestones.
const badgeHelpers = { api, esc, fmt, when, day, table, can, act, ask, toast, announce };
views.badges = () => badgesView(badgeHelpers);
initBadges(badgeHelpers, (name, o) => show(name, o));

// ---- Puzzle emails (puzzle-mail.js): the weekly and special edition lists, sends and planner.
views.mail = () => puzzleMailView();
initPuzzleMail({ api, esc, fmt, when, tile, table, can, act, ask, toast, show });

// ------------------------------------------------------------- navigation
const MIN_ROLE = Object.fromEntries($$('#nav-list a').map((a) => [a.hash.slice(1), a.dataset.min]));

// Older links: the idea and problem inbox, error reports and announcements now live in Communication.
const ALIASES = { feedback: { type: 'idea' }, errors: { type: 'error' }, announcements: { tab: 'send' } };

async function show(route, { keepFocus = false } = {}) {
  // #players/<id> opens a player's page under the list.
  let [name, ...rest] = String(route || '').split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
  const alias = ALIASES[name];
  if (alias) {
    if (alias.type) { $('input[name=comm-tab][value=inbox]').checked = true; $('#comm-type').value = alias.type; }
    if (alias.tab) $(`input[name=comm-tab][value=${alias.tab}]`).checked = true;
    history.replaceState(null, '', '#communication');
    name = 'communication';
  }
  if (!views[name] || !can(MIN_ROLE[name])) name = 'overview';
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== name; });
  $$('#nav-list a').forEach((a) => (a.hash === `#${name}` ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  try { await views[name]({ arg }); } catch (e) {
    if (e.code === 'sign_in') return;
    const sec = $(`[data-view="${name}"]`);
    $('.load-error', sec)?.remove();
    sec.insertAdjacentHTML('beforeend', `<p class="error load-error">${esc(e.message)}</p>`);
  }
  if (!keepFocus && !arg) $(`[data-view="${name}"] h1`)?.focus?.();
}
$$('[data-view] h1').forEach((h) => h.setAttribute('tabindex', '-1'));
addEventListener('hashchange', () => { if (me) show(location.hash.slice(1)); });
// Home: back to the Overview from anywhere. Already on #overview there is no
// hashchange, so reload it and go back to the top here.
$('#home').onclick = (e) => {
  if (location.hash !== '#overview') return;
  e.preventDefault();
  scrollTo(0, 0);
  show('overview');
};

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
  $$('main [data-min]').forEach((el) => { el.hidden = !can(el.dataset.min); });
  show(location.hash.slice(1) || 'overview');
  if (oauthBack) { const back = oauthBack; oauthBack = null; finishOAuth(back, { api, ask, esc, toast }); }
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

// Pull down to refresh on a phone. The session lives in sessionStorage, so a
// refresh keeps the admin signed in; typed text that is not saved yet is lost,
// so ask first.
initPullRefresh({
  beforeReload: () => {
    const unsaved = $$('#main textarea, #main input[type=text], #main input:not([type])').some((i) => i.value.trim() && i.value !== i.defaultValue);
    return !unsaved || confirm('Some text you typed is not saved yet. Refresh anyway?');
  },
});

session = loadSession();
if (session) tryEnter();
else $('#login').hidden = false;

// ------------------------------------------------------------- install
// The dashboard installs as an app (manifest.webmanifest, sw.js). Chrome and
// Edge offer their install prompt through the header button; iPhone users add
// it from Safari's Share menu (steps on the sign-in page).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {});
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); if (window.__FLG_ADMIN_DESKTOP__) return; installPrompt = e; $('#install').hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('#install').hidden = true; toast('Installed. Open Grid Admin from your home screen or apps.'); });
$('#install').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('#install').hidden = true;
};
// The Windows app (desktop-admin/) opens this same page and marks itself with
// __FLG_ADMIN_DESKTOP__, so neither the download nor the install steps show there.
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone || window.__FLG_ADMIN_DESKTOP__;
if (installed) $('#phone-help').hidden = true;
$('#get-windows').hidden = installed || !/Windows/.test(navigator.userAgent);
