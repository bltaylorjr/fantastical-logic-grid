// The Account and sync window, and the sync line above Saved puzzles.
// Accounts are optional: everything works the same without one.
import * as account from './account.js';
import * as sync from './sync.js';
import * as store from './store.js';
import * as biometric from './biometric.js';
import * as idle from './idle.js';
import { feature } from './remote-config.js';
import { esc } from './grid.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const dlg = () => $('#dlg-account');
const TITLES = { signin: 'Sign in', signup: 'Create an account', reset: 'Reset your password', account: 'Your account', signout: 'Sign out?' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let ui = null;
// Where to pick up after an idle sign-out: { uid, email, saveId }.
const RESUME = 'resumeAfterSignIn';
const bioOn = () => feature('biometrics');
let starting = false;
let leaving = false;
let countdown = null;

export function signedIn() { return !!(account.enabled() && account.current()); }

export async function initAccounts(hooks) {
  ui = hooks;
  if (!account.enabled()) return; // accounts not switched on in this build
  $('[data-cmd=account]').hidden = false;
  $('#sync-line').hidden = false;
  $('#sync-btn').onclick = () => openAccount();
  wireDialog();
  account.onChange(() => { renderStatus(sync.status()); if (dlg().open) show(account.current() ? 'account' : 'signin'); });
  await sync.start({
    isBusy: hooks.isBusy,
    onStatus: renderStatus,
    onApplied: (changed) => {
      if (changed.settings) hooks.onSettingsChanged();
      if (changed.saves) hooks.onSavesChanged();
    },
  });
  renderStatus(sync.status());
  account.onChange((user) => { if (user) resumeIfWaiting(user); });
  wireIdle();
  starting = true;
  try { await idle.init({ onWarn: warnIdle, onIdle: () => idleSignOut() }); } finally { starting = false; }
}

// ------------------------------------------------------- idle sign-out
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function wireIdle() {
  const d = $('#dlg-idle');
  $('#idle-stay').onclick = () => d.close();
  $('#idle-out').onclick = () => { leaving = true; d.close(); idleSignOut({ byHand: true }); };
  d.addEventListener('close', () => {
    clearInterval(countdown);
    if (!leaving) idle.touch();
    leaving = false;
  });
}

function warnIdle(msLeft) {
  const d = $('#dlg-idle');
  const end = Date.now() + msLeft;
  const tick = () => {
    const secs = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $('#idle-left').textContent = secs > 60 ? plural(Math.ceil(secs / 60), 'minute') : plural(secs, 'second');
  };
  tick();
  clearInterval(countdown);
  countdown = setInterval(tick, 1000);
  if (!d.open) ui.openDialog(d, $('#idle-stay'));
}

// Saves and syncs everything first, then signs out. With fingerprint or face
// sign-in on, the session is kept locked on this device for the device check.
async function idleSignOut({ byHand = false } = {}) {
  const user = account.current();
  if (!user) return;
  const d = $('#dlg-idle');
  if (d.open) { leaving = true; d.close(); }
  const atStart = starting;
  const saveId = await ui.leavePuzzle().catch(() => null);
  await Promise.race([sync.syncNow().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  if (account.current()?.uid !== user.uid) return; // signed out meanwhile
  store.setLocal(RESUME, { uid: user.uid, email: user.email, saveId: saveId || (atStart ? 'latest' : null) });
  account.lock({ keep: bioOn() && biometric.enrolledFor(user.uid) });
  const mins = idle.minutes();
  const why = byHand
    ? 'Signed out. Your progress is saved; sign back in to pick up where you left off.'
    : `You were signed out after ${plural(mins, 'minute')} without any activity, to keep your account safe. Your progress is saved; sign back in to pick up where you left off.`;
  if (atStart) { ui.toast(why, { label: 'Sign in', run: () => openAccount() }, { ms: 12000 }); return; }
  $$('dialog[open]').forEach((x) => { if (x !== dlg()) x.close(); });
  openAccount({ note: why });
}

// Opens the puzzle the player was on before an idle sign-out, once the same
// player is back.
function resumeIfWaiting(user) {
  const r = store.getLocal(RESUME);
  if (!r) return;
  store.setLocal(RESUME, undefined);
  if (r.uid !== user.uid || !r.saveId) return;
  if (dlg().open) dlg().close();
  ui.resume(r.saveId);
}

async function renderBio() {
  const user = account.current();
  const mins = idle.minutes();
  $('#acct-idle').hidden = !mins;
  $('#acct-idle').textContent = `For your safety, you are signed out after ${plural(mins, 'minute')} without any activity. Your progress is saved first, and the puzzle you were on opens again when you sign back in.`;
  const can = !!(user && bioOn() && await biometric.available());
  $('#acct-bio').hidden = !can;
  if (can) $('#acct-bio-on').checked = biometric.enrolledFor(user.uid);
}

async function turnOnBio(msg) {
  const user = account.current();
  try {
    await biometric.enroll(user);
    msg('Fingerprint or face sign-in is on for this device. When you are signed out, use it instead of typing your password.');
    return true;
  } catch (err) { msg(err.message); return false; }
}

// After a password sign-in, offer the device check once if it is not on yet.
async function offerBio() {
  const user = account.current();
  if (!user || !bioOn() || biometric.enrolledFor(user.uid) || !(await biometric.available())) return;
  ui.toast('Sign in faster next time with your fingerprint or face?', { label: 'Turn on', run: () => turnOnBio((t) => ui.toast(t)) }, { ms: 12000 });
}

function renderSignin() {
  const lockedAcc = account.lockedAccount();
  const bio = !!(lockedAcc && bioOn() && biometric.enrolledFor(lockedAcc.uid));
  $('#si-bio-box').hidden = !bio;
  $('#si-bio-error').hidden = true;
  $('#si-bio-who').textContent = bio ? `As ${lockedAcc.email}. Or sign in with your password below.` : '';
  const email = $('#si-email');
  const known = (lockedAcc && lockedAcc.email) || (store.getLocal(RESUME) || {}).email;
  if (known && !email.value) email.value = known;
}

// Called when the player comes back to the home screen: changes held back
// while a puzzle was open can now be applied.
export function onHome() { if (signedIn()) sync.schedule(0); }

export function openAccount({ note } = {}) {
  show(account.current() ? 'account' : 'signin');
  if (note && !account.current()) $('#si-idle').textContent = note;
  ui.openDialog(dlg(), null);
  focusView();
}

function when(at) {
  if (!at) return '';
  const mins = (Date.now() - at) / 60000;
  if (mins < 1) return 'just now';
  return `at ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(at))}`;
}

function statusWords(s) {
  const user = account.current();
  const waiting = s.pending ? ` ${s.pending} change${s.pending === 1 ? '' : 's'} waiting.` : '';
  switch (s.state) {
    case 'syncing': return { dot: '', text: 'Syncing your puzzles…' };
    case 'synced': return { dot: 'ok', text: `Synced to your account (${user ? user.email : ''}) ${when(s.at)}.` };
    case 'offline': return { dot: 'warn', text: `Offline. Your puzzles are saved on this device and will sync when you reconnect.${waiting}` };
    case 'error': return { dot: 'warn', text: `${s.message || 'Sync did not finish.'}${waiting}` };
    default: return { dot: '', text: s.message ? `${s.message} Your puzzles are saved on this device.` : 'Your puzzles save on this device. Sign in to keep them on all your devices.' };
  }
}

function renderStatus(s) {
  if (!account.enabled()) return;
  const user = account.current();
  const w = statusWords(user ? s : { state: 'signedout', message: s.message });
  const html = `<span class="dot ${w.dot}" aria-hidden="true"></span>${esc(w.text)}`;
  $('#sync-text').innerHTML = html;
  $('#sync-btn').textContent = user ? 'Account' : 'Sign in to sync';
  $('#acct-sync-text').innerHTML = html;
  $('#acct-sync-now').disabled = s.state === 'syncing';
}

// ------------------------------------------------------------------ dialog
function show(view) {
  $$('.acct-view', dlg()).forEach((v) => { v.hidden = v.dataset.view !== view; });
  $('#account-h').textContent = TITLES[view];
  $$('.error-box', dlg()).forEach((b) => { b.hidden = true; b.textContent = ''; });
  $$('.acct-done', dlg()).forEach((b) => { b.textContent = ''; });
  $$('[aria-invalid]', dlg()).forEach((i) => i.removeAttribute('aria-invalid'));
  if (view === 'account') {
    const user = account.current();
    $('#acct-email').textContent = user.email;
    $('#acct-verify').hidden = !!user.verified;
    $('#del-pass').value = '';
    $('.acct-danger').open = false;
    renderStatus(sync.status());
    renderBio();
  }
  if (view === 'signin') renderSignin();
  if (view === 'signout') $('#so-clear').checked = false;
  dlg().dataset.current = view;
}

function focusView() {
  const v = $(`.acct-view[data-view="${dlg().dataset.current}"]`);
  if (!$('#si-bio-box').hidden && v.dataset.view === 'signin') { $('#si-bio').focus(); return; }
  const first = $('input:not([type=checkbox])', v);
  (first && !first.value ? first : $('button[type=submit], button', v))?.focus();
}

function go(view, carryEmail) {
  const from = $(`.acct-view[data-view="${dlg().dataset.current}"] input[type=email]`);
  show(view);
  const to = $(`.acct-view[data-view="${view}"] input[type=email]`);
  if (carryEmail && from && to && from.value && !to.value) to.value = from.value;
  focusView();
}

function fail(form, message, field) {
  const box = $('.error-box', form);
  box.textContent = message;
  box.hidden = false;
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

async function busy(form, label, fn) {
  const btn = $('button[type=submit]', form);
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  $('.error-box', form).hidden = true;
  $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

function checkEmail(form) {
  const input = $('input[type=email]', form);
  input.value = input.value.trim();
  if (!EMAIL.test(input.value)) { fail(form, 'Enter your email address, like name@example.com.', input); return null; }
  return input.value;
}

function wireDialog() {
  const d = dlg();
  d.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.go) go(b.dataset.go, true);
    else if ('close' in b.dataset) d.close();
  });
  $$('[data-show-pass]', d).forEach((box) => {
    box.onchange = () => $$('input[type=password], input[data-pass]', box.closest('form')).forEach((i) => { i.dataset.pass = '1'; i.type = box.checked ? 'text' : 'password'; });
  });
  d.addEventListener('close', () => {
    $$('input[data-pass]', d).forEach((i) => { i.type = 'password'; });
    $$('[data-show-pass]', d).forEach((b) => { b.checked = false; });
    $$('input[type=password], input[data-pass]', d).forEach((i) => { i.value = ''; });
  });

  const signinForm = $('[data-view=signin]', d);
  signinForm.onsubmit = (e) => {
    e.preventDefault();
    // An email, or the player's screen name.
    const login = $('#si-email');
    login.value = login.value.trim();
    if (!login.value) { fail(signinForm, 'Enter your email or your screen name.', login); return; }
    if (account.isScreenName(login.value) ? login.value.length < 3 || login.value.length > 20 : !EMAIL.test(login.value)) {
      fail(signinForm, account.isScreenName(login.value) ? 'Screen names have 3 to 20 characters. Check it, or use your email.' : 'Enter your email address, like name@example.com.', login);
      return;
    }
    const email = login.value;
    const pass = $('#si-pass');
    if (!pass.value) { fail(signinForm, 'Enter your password.', pass); return; }
    busy(signinForm, 'Signing in…', async () => {
      try {
        await account.signIn(email, pass.value, { remember: $('[data-remember]', signinForm).checked });
        pass.value = '';
        if (dlg().open) { show('account'); focusView(); }
        ui.toast('Signed in. Your puzzles will now sync across your devices.');
        setTimeout(offerBio, 1500);
      } catch (err) { fail(signinForm, err.message, err.code === 'INVALID_EMAIL' || err.code === 'INVALID_LOGIN_CREDENTIALS' && account.isScreenName(email) ? $('#si-email') : pass); }
    });
  };

  $('#si-bio').onclick = async () => {
    const btn = $('#si-bio');
    const box = $('#si-bio-error');
    const lockedAcc = account.lockedAccount();
    if (!lockedAcc) { renderSignin(); return; }
    btn.disabled = true;
    box.hidden = true;
    try {
      await biometric.verify(lockedAcc.uid);
      await account.unlock();
      if (d.open) d.close();
      ui.toast('Signed in. Welcome back.');
    } catch (err) {
      box.textContent = err.message || 'That did not work. Use your password instead.';
      box.hidden = false;
      if (!account.lockedAccount()) { $('#si-bio').hidden = true; $('#si-bio-who').textContent = ''; } // the saved session ran out: password only
    } finally { btn.disabled = false; }
  };

  $('#acct-bio-on').onchange = async (e) => {
    const box = e.target;
    const msg = (t) => { $('#acct-bio-msg').textContent = t; };
    if (box.checked) box.checked = await turnOnBio(msg);
    else { biometric.forget(); msg('Turned off. Sign in with your password on this device.'); }
  };

  const signupForm = $('[data-view=signup]', d);
  signupForm.onsubmit = (e) => {
    e.preventDefault();
    const email = checkEmail(signupForm);
    if (!email) return;
    const pass = $('#su-pass');
    if (pass.value.length < 8) { fail(signupForm, 'Choose a password with at least 8 characters.', pass); return; }
    busy(signupForm, 'Creating your account…', async () => {
      try {
        await account.signUp(email, pass.value, { remember: $('[data-remember]', signupForm).checked });
        pass.value = '';
        show('account');
        focusView();
        ui.toast('Account created. Your puzzles on this device are being added to it.');
      } catch (err) { fail(signupForm, err.message, err.code === 'EMAIL_EXISTS' || err.code === 'INVALID_EMAIL' ? $('#su-email') : pass); }
    });
  };

  const resetForm = $('[data-view=reset]', d);
  resetForm.onsubmit = (e) => {
    e.preventDefault();
    const email = checkEmail(resetForm);
    if (!email) return;
    busy(resetForm, 'Sending…', async () => {
      try {
        await account.sendPasswordReset(email);
        $('.acct-done', resetForm).textContent = `If an account uses ${email}, a reset link is on its way. Check your inbox and spam folder. The link opens a page where you choose a new password; then come back and sign in.`;
      } catch (err) { fail(resetForm, err.message, $('#rs-email')); }
    });
  };

  $('#acct-sync-now').onclick = () => sync.syncNow();
  $('#acct-change-pass').onclick = async () => {
    const user = account.current();
    try {
      await account.sendPasswordReset(user.email);
      $('#acct-msg').textContent = `We sent a link to ${user.email}. Open it to choose a new password. Afterwards, sign in again on your other devices.`;
    } catch (err) { $('#acct-msg').textContent = err.message; }
  };

  const signoutForm = $('[data-view=signout]', d);
  signoutForm.onsubmit = (e) => {
    e.preventDefault();
    const clear = $('#so-clear').checked;
    busy(signoutForm, 'Signing out…', async () => {
      // Send any last changes first, without waiting long.
      await Promise.race([sync.syncNow(), new Promise((r) => setTimeout(r, 6000))]);
      if (clear && sync.pendingCount()) {
        fail(signoutForm, 'Some changes on this device have not reached your account yet. Connect to the internet and try again, or sign out without removing your puzzles.');
        return;
      }
      account.signOut();
      store.setLocal(RESUME, undefined);
      if (clear) {
        biometric.forget();
        await store.clearSavesOnDevice();
        await sync.forget();
      }
      d.close();
      ui.onSavesChanged();
      ui.toast(clear ? 'Signed out. Your puzzles were removed from this device and are safe in your account.' : 'Signed out. Your puzzles stay on this device.');
    });
  };

  const delForm = $('#acct-delete-form');
  delForm.onsubmit = (e) => {
    e.preventDefault();
    const pass = $('#del-pass');
    if (!pass.value) { fail(delForm, 'Enter your password to confirm.', pass); return; }
    busy(delForm, 'Deleting…', async () => {
      try {
        await account.deleteAccount(pass.value, (token) => sync.deleteRemote(token));
        biometric.forget();
        store.setLocal(RESUME, undefined);
        await sync.forget();
        d.close();
        ui.onSavesChanged();
        ui.toast('Your account and everything stored in it are deleted. Puzzles on this device are still here.', null, { ms: 10000 });
      } catch (err) {
        fail(delForm, err instanceof account.AccountError ? err.message : 'The account could not be deleted. Please check your connection and try again.', pass);
      }
    });
  };
}
