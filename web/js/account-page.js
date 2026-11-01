// The Account page (web/account/): sign in, create an account, reset a
// password, sync, change password, fingerprint sign-in, idle sign-out, sign
// out, delete the account, and the screen name. One account works in every
// game of The Logic Grid. The Account and sync window is the game's own
// (account-ui.js, its markup copied in at build time), shown in the page.
import * as account from './account.js';
import { initAccounts, openAccount } from './account-ui.js';
import * as compete from './compete.js';
import * as remote from './remote-config.js';

const $ = (s) => document.querySelector(s);

// The player's color theme, as in the game; never inside another site's frame.
try { const s = JSON.parse(localStorage.getItem('flg.settings') || '{}'); if (s.colorTheme && s.colorTheme !== 'system') document.documentElement.dataset.theme = s.colorTheme; } catch (e) { /* default */ }
if (window.top !== window.self) { document.documentElement.hidden = true; try { window.top.location = window.location.href; } catch (e) { /* blocked */ } }

let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}
const announce = (text) => toast(text);

// ---------------------------------------------------------------- screen name
async function drawName() {
  const box = $('#ac-name');
  const me = account.current();
  box.hidden = !me || !compete.enabled();
  if (box.hidden) return;
  const cached = compete.cachedName();
  $('#ac-name-now').textContent = cached ? `Your screen name: ${cached}` : 'Loading your screen name…';
  try {
    const name = await compete.loadName();
    $('#ac-name-now').textContent = name ? `Your screen name: ${name}${compete.isNameApproved() ? '' : ' (waiting for approval: others see "New player" until then)'}` : 'You have not chosen a screen name yet.';
  } catch (e) {
    $('#ac-name-now').textContent = cached ? `Your screen name: ${cached}` : 'Your screen name could not be loaded. Check your connection.';
  }
}
$('#ac-name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#ac-name-input');
  const err = $('#ac-name-err');
  err.textContent = '';
  input.removeAttribute('aria-invalid');
  const name = input.value.trim();
  if (name.length < 3) { err.textContent = 'Use at least 3 characters.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const saved = await compete.setName(name);
    input.value = '';
    toast(compete.isNameApproved() ? `Saved. You are now ${saved}.` : `Saved. Others see "New player" until ${saved} is approved.`);
    drawName();
  } catch (er) {
    err.textContent = er.message || 'That name could not be saved. Try another.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  } finally { btn.disabled = false; }
});

// ---------------------------------------------------------------- start
async function start() {
  const dlg = $('#dlg-account');
  if (!account.enabled() || !dlg) { $('#ac-off').hidden = false; $('#ac-account').hidden = true; return; }
  remote.init({});
  await initAccounts({
    // The window is part of this page, never a pop-up over it.
    openDialog: (d) => { if (!d.open) d.show(); },
    toast, announce,
    isBusy: () => false,
    onSavesChanged: () => {},
    onSettingsChanged: () => {},
    leavePuzzle: async () => {},
  });
  openAccount();
  // Signing out or in keeps the window showing; it is the page.
  dlg.addEventListener('close', () => setTimeout(() => { openAccount(); drawName(); }, 0));
  account.onChange(() => drawName());
  drawName();
}
start();
