// Messages (Menu > Messages): news from the game's team for everyone, and,
// for signed-in players, conversations with the team: write to them, read
// their replies and answer. The team answers from the admin dashboard's
// Communication section and is always shown as "The team". Talks to the
// shared Worker (server/src/messages.js); news comes with GET /v1/config.
//
// Puzzles for you: puzzles the team made for this player (usually from their
// suggestion), kept on the server for 30 days. Play opens one as a saved
// puzzle on this device; Download saves it as a puzzle file.
//
// The Menu button and the Messages item show how many things are new: team
// replies the player has not opened, and news not seen on this device.
import { CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import * as store from './store.js';
import { feature, news } from './remote-config.js';
import { esc } from './grid.js';

const $ = (s, el = document) => el.querySelector(s);
const SEEN_NEWS = 'seenNews';
const EVERY_MS = 10 * 60_000;
const TOPICS = { question: 'A question', idea: 'An idea', problem: 'A problem', team: 'From the team' };

let state = { conversations: [], puzzles: [], unread: 0, email: false, banned: false, loaded: false };
let deps = { openDialog: () => {}, openAccount: () => {}, announce: () => {}, playPuzzle: async () => {}, downloadPuzzle: () => {} };
let lastFetch = 0;

export const available = () => !!CLOUD_URL && feature('messages');

const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const seenNews = () => new Set(store.getLocal(SEEN_NEWS) || []);
const newNews = () => news().filter((n) => !seenNews().has(n.id));

async function call(path, body) {
  const token = await account.getIdToken();
  const res = await fetch(`${CLOUD_URL}/v1/messages${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Messages could not be reached right now. Please try again later.');
  return data;
}

// How many new things, for the badge on the Menu button.
export function newCount() {
  if (!available()) return 0;
  return newNews().length + (account.current() ? state.unread : 0);
}

function renderBadges() {
  const n = newCount();
  const item = $('[data-cmd=messages]');
  if (item) {
    item.hidden = !available();
    $('.count', item).textContent = n ? ` (${n} new)` : '';
  }
  const menu = $('#menu-count');
  if (menu) { menu.hidden = !n; menu.textContent = n ? String(n) : ''; }
  const btn = $('#menu-btn');
  if (btn && n) btn.setAttribute('aria-label', `Menu, ${n} new ${n === 1 ? 'message' : 'messages'}`);
  else btn?.removeAttribute('aria-label');
}

export async function refresh({ quiet = true } = {}) {
  if (!available() || !account.current()) { state = { conversations: [], puzzles: [], unread: 0, email: false, banned: false, loaded: false }; renderBadges(); return; }
  try {
    const d = await call('');
    state = { conversations: d.conversations || [], puzzles: d.puzzles || [], unread: d.unread || 0, email: !!d.email, banned: !!d.banned, loaded: true, off: !!d.off };
    lastFetch = Date.now();
  } catch (e) {
    if (!quiet) throw e;
  }
  renderBadges();
}

function messageHtml(m) {
  return `<li class="msg ${m.from === 'team' ? 'team' : 'me'}"><p class="msg-who"><b>${m.from === 'team' ? 'The team' : 'You'}</b> <span class="help">${esc(when(m.at))}</span></p>
    <p class="msg-text">${esc(m.text)}</p></li>`;
}

function renderConversations() {
  const list = $('#msg-convs');
  if (!state.conversations.length) { list.innerHTML = '<li class="help">No messages yet. Write to the team below.</li>'; return; }
  list.innerHTML = state.conversations.map((c) => `<li><details data-id="${Number(c.id)}"${c.unread ? ' data-unread="1"' : ''}>
    <summary><b>${esc(c.subject)}</b> ${c.unread ? '<span class="pill new">New reply</span>' : ''} <span class="help">${esc(TOPICS[c.topic] || '')} · ${esc(when(c.updatedAt))}${c.status === 'done' ? ' · answered' : ''}</span></summary>
    <ol class="msg-list">${c.messages.map(messageHtml).join('')}</ol>
    ${state.banned ? '' : `<form class="msg-reply" novalidate>
      <div class="field"><label for="msg-reply-${Number(c.id)}">Your reply</label><textarea id="msg-reply-${Number(c.id)}" rows="3" maxlength="1000"></textarea></div>
      <div class="error-box" role="alert" hidden></div>
      <div class="row-inline"><button class="btn primary" type="submit">Send reply</button></div>
    </form>`}
  </details></li>`).join('');
}

const TIERS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'Quantum Physicist' };
const day = (ms) => new Date(ms).toLocaleDateString([], { dateStyle: 'medium' });

function renderPuzzles() {
  const box = $('#msg-puzzles-box');
  if (!box) return;
  box.hidden = !state.puzzles.length;
  $('#msg-puzzles').innerHTML = state.puzzles.map((p) => `<li data-puzzle="${Number(p.id)}">
    <p><b>${esc(p.title)}</b> ${p.openedAt ? '' : '<span class="pill new">New</span>'}</p>
    <p class="help">${esc(TIERS[p.tier] || '')}${p.tier ? ' · ' : ''}From the team on ${esc(day(p.at))} · kept until ${esc(day(p.expiresAt))}</p>
    <div class="row-inline"><button class="btn primary small" type="button" data-pz="play">Play</button><button class="btn small" type="button" data-pz="download">Download</button></div>
    <div class="error-box" role="alert" hidden></div>
  </li>`).join('');
}

async function usePuzzle(btn) {
  const li = btn.closest('[data-puzzle]');
  const id = Number(li.dataset.puzzle);
  const err = $('.error-box', li);
  err.hidden = true;
  btn.disabled = true;
  try {
    const d = await call(`/puzzles/${id}`);
    if (btn.dataset.pz === 'play') { $('#dlg-messages').close(); await deps.playPuzzle(d.puzzle, id); } else deps.downloadPuzzle(d.puzzle);
    const p = state.puzzles.find((x) => x.id === id);
    if (p && !p.openedAt) { p.openedAt = Date.now(); $('.pill.new', li)?.remove(); call(`/puzzles/${id}/opened`, {}).catch(() => {}); }
  } catch (e) {
    err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again.' : e.message;
    err.hidden = false;
  } finally { btn.disabled = false; }
}

function renderNews() {
  const items = news();
  const seen = seenNews();
  $('#msg-news-box').hidden = !items.length;
  $('#msg-news').innerHTML = items.map((n) => `<li><h4>${esc(n.title)} ${seen.has(n.id) ? '' : '<span class="pill new">New</span>'}</h4>
    <p class="msg-text">${esc(n.text)}</p><p class="help">${esc(when(n.at))}</p></li>`).join('');
}

function render() {
  renderNews();
  const me = account.current();
  $('#msg-signed-out').hidden = !!me;
  $('#msg-signed-in').hidden = !me;
  if (!me) { $('#msg-puzzles-box').hidden = true; return; }
  renderPuzzles();
  renderConversations();
  const box = $('#msg-email-on');
  box.checked = state.email;
  $('#msg-email-to').textContent = me.email ? ` at ${me.email}` : '';
  $('#msg-new').hidden = state.banned;
  $('#msg-banned').hidden = !state.banned;
}

function showError(form, text) {
  const err = $('.error-box', form);
  err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again.' : text;
  err.hidden = false;
}

async function sendNew(form) {
  const text = $('#msg-new-text').value.trim();
  $('.error-box', form).hidden = true;
  $('#msg-new-done').textContent = '';
  if (text.length < 2) { showError(form, 'Write your message first.'); $('#msg-new-text').focus(); return; }
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    await call('', { topic: $('#msg-new-topic').value, text });
    $('#msg-new-text').value = '';
    await refresh({ quiet: false });
    render();
    $('#msg-new-done').textContent = 'Sent. The team\'s reply will show here.';
    deps.announce('Message sent.');
  } catch (e) { showError(form, e.message); } finally { btn.disabled = false; }
}

async function sendReply(form) {
  const details = form.closest('details');
  const id = Number(details.dataset.id);
  const area = $('textarea', form);
  const text = area.value.trim();
  $('.error-box', form).hidden = true;
  if (text.length < 2) { showError(form, 'Write your reply first.'); area.focus(); return; }
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    await call(`/${id}`, { text });
    await refresh({ quiet: false });
    render();
    const again = $(`#msg-convs details[data-id="${id}"]`);
    if (again) { again.open = true; $('textarea', again)?.focus(); }
    deps.announce('Reply sent.');
  } catch (e) { showError(form, e.message); btn.disabled = false; }
}

async function markRead(details) {
  if (!details.open || !details.dataset.unread) return;
  delete details.dataset.unread;
  $('.pill.new', details)?.remove();
  const id = Number(details.dataset.id);
  const c = state.conversations.find((x) => x.id === id);
  if (c && c.unread) { c.unread = false; state.unread = Math.max(0, state.unread - 1); renderBadges(); }
  try { await call(`/${id}/read`, {}); } catch (e) { /* tried again next time it is opened */ }
}

async function setEmail(box) {
  const err = $('#msg-email-error');
  err.hidden = true;
  box.disabled = true;
  try {
    if (box.checked) await account.getIdToken({ force: true }); // a just-confirmed email shows in a fresh token
    const d = await call('/email', { on: box.checked });
    state.email = d.email;
    deps.announce(d.email ? 'You will get an email when the team writes.' : 'No more emails about messages.');
  } catch (e) {
    box.checked = !box.checked;
    err.textContent = e.message;
    err.hidden = false;
  } finally { box.disabled = false; }
}

let wired = false;
function wire(dlg) {
  if (wired) return;
  wired = true;
  $('[data-close]', dlg).onclick = () => dlg.close();
  $('#msg-signin').onclick = () => { dlg.close(); deps.openAccount(); };
  $('#msg-new').addEventListener('submit', (e) => { e.preventDefault(); sendNew(e.target); });
  $('#msg-convs').addEventListener('submit', (e) => { if (e.target.matches('.msg-reply')) { e.preventDefault(); sendReply(e.target); } });
  $('#msg-convs').addEventListener('toggle', (e) => { if (e.target.matches('details')) markRead(e.target); }, true);
  $('#msg-email-on').onchange = (e) => setEmail(e.target);
  $('#msg-puzzles').addEventListener('click', (e) => { const b = e.target.closest('button[data-pz]'); if (b) usePuzzle(b); });
  // News counts as seen once the player has had Messages open.
  dlg.addEventListener('close', () => { store.setLocal(SEEN_NEWS, news().map((n) => n.id)); renderBadges(); });
}

export async function open() {
  const dlg = $('#dlg-messages');
  wire(dlg);
  $('#msg-new-done').textContent = '';
  for (const b of dlg.querySelectorAll('.error-box')) b.hidden = true;
  render();
  deps.openDialog(dlg, account.current() ? $('#msg-convs summary') || $('#msg-new-topic') : $('#msg-signin'));
  if (account.current()) {
    const loading = $('#msg-loading');
    loading.hidden = state.loaded;
    try { await refresh({ quiet: false }); render(); } catch (e) {
      $('#msg-load-error').textContent = e.message;
      $('#msg-load-error').hidden = false;
    } finally { loading.hidden = true; }
  }
}

export function init(options) {
  deps = { ...deps, ...options };
  renderBadges();
  if (!CLOUD_URL) return;
  account.onChange(() => refresh());
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > EVERY_MS) refresh();
  });
}

// Called when the admin dashboard's switches or news change.
export function configChanged() {
  renderBadges();
  if (available() && account.current() && !state.loaded) refresh();
}
