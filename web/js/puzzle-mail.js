// Puzzle emails (server/src/puzzle-mail.js): anyone, signed in or not, can
// ask for the weekly puzzle and special edition puzzles by email, in
// Menu > Puzzle emails. A guest gets a confirm link first; a signed-in player's
// confirmed account address needs none. Every email has a one-click
// unsubscribe link.
import { CLOUD_URL } from './cloud-config.js';
import * as remote from './remote-config.js';
import * as account from './account.js';

const $ = (s, el = document) => el.querySelector(s);
const OFFLINE = 'You seem to be offline. Connect to the internet and try again.';

export const available = () => !!CLOUD_URL && remote.feature('puzzleMail');
const lists = () => ({ weekly: remote.feature('weeklyMail'), special: remote.feature('specialMail') });

async function call(path, method, body, signedIn) {
  const token = signedIn ? await account.getIdToken().catch(() => null) : null;
  const res = await fetch(`${CLOUD_URL}/v1/mail${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'That did not work right now. Please try again later.');
  return data;
}

let wired = false;
let mine = null; // a signed-in player's lists: { weekly, special, verified }

function showLists() {
  const open = lists();
  $('#mail-weekly-row').hidden = !open.weekly;
  $('#mail-special-row').hidden = !open.special;
}

async function refresh() {
  const me = account.current();
  const form = $('#mail-form');
  $('#mail-error').hidden = true;
  $('#mail-done').textContent = '';
  mine = null;
  $('#mail-email-row').hidden = false;
  $('#mail-to').hidden = true;
  if (me) {
    try { mine = await call('', 'GET', null, true); } catch (e) { mine = null; }
  }
  if (mine && mine.verified) {
    // A confirmed account: no address to type and no confirm link.
    $('#mail-email-row').hidden = true;
    $('#mail-to').hidden = false;
    $('#mail-to-addr').textContent = me.email;
    form.elements.weekly.checked = !!mine.weekly;
    form.elements.special.checked = !!mine.special;
    $('#mail-submit').textContent = 'Save';
  } else {
    if (me && me.email && !form.elements.email.value) form.elements.email.value = me.email;
    $('#mail-submit').textContent = 'Sign up';
  }
  showLists();
}

async function submit(e) {
  e.preventDefault();
  const form = $('#mail-form');
  const err = $('#mail-error');
  const done = $('#mail-done');
  err.hidden = true;
  done.textContent = '';
  const open = lists();
  const weekly = open.weekly && form.elements.weekly.checked;
  const special = open.special && form.elements.special.checked;
  const btn = $('#mail-submit');
  btn.disabled = true;
  try {
    if (mine && mine.verified) {
      const r = await call('', 'POST', { weekly, special }, true);
      mine = { ...mine, ...r };
      done.textContent = r.weekly || r.special ? 'Saved. Every email has a one-click unsubscribe link.' : 'Saved. No more puzzle emails.';
      return;
    }
    if (!weekly && !special) { err.textContent = 'Tick at least one kind of email.'; err.hidden = false; return; }
    const email = form.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Type your email address, like name@example.com.'; err.hidden = false; form.elements.email.focus(); return; }
    const r = await call('/signup', 'POST', { email, weekly, special }, !!account.current());
    done.textContent = r.message || 'Check your inbox for a link to confirm.';
  } catch (ex) {
    err.textContent = navigator.onLine === false ? OFFLINE : ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

export function open(openDialog) {
  const dlg = $('#dlg-mail');
  if (!wired) {
    wired = true;
    $('#mail-form').addEventListener('submit', submit);
    $('#mail-close').onclick = () => dlg.close();
  }
  openDialog(dlg, $('#mail-form').elements.weekly);
  refresh();
}
