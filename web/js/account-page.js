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
// ?game=np&race=CODE: a game sent the player here to sign in to race; once
// signed in they go back to that game's page (and the race). Only the games'
// own pages and a well-formed race code are ever used.
const next = (() => {
  const q = new URLSearchParams(location.search);
  const game = Object.keys(compete.GAME_PAGES).find((g) => g === q.get('game'));
  if (!game) return '';
  const code = compete.cleanCode(q.get('race'));
  return `../${compete.GAME_PAGES[game]}${compete.CODE.test(code) ? `?race=${code}` : ''}`;
})();

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
// Every account needs a screen name. A signed-in player without one (an older
// account, or one whose chosen name was taken) is asked here first, with a
// made-up name filled in, before going back to a game.
let named = null; // the player's screen name, once known
async function drawName() {
  const box = $('#ac-name');
  const me = account.current();
  box.hidden = !me || !compete.enabled();
  if (box.hidden) return null;
  const cached = compete.cachedName();
  $('#ac-name-now').textContent = cached ? `Your screen name: ${cached}` : 'Loading your screen name…';
  let name = cached;
  try {
    name = await compete.loadName();
    $('#ac-name-now').textContent = name ? `Your screen name: ${name}${compete.isNameApproved() ? '' : ' (waiting for approval: others see "New player" until then)'}` : '';
  } catch (e) {
    $('#ac-name-now').textContent = cached ? `Your screen name: ${cached}` : 'Your screen name could not be loaded. Check your connection.';
    named = cached;
    return cached;
  }
  named = name;
  const needed = !name && remote.feature('names');
  box.classList.toggle('needed', needed);
  $('#ac-name-h').textContent = needed ? 'Choose your screen name' : 'Screen name';
  $('#ac-name-needed').hidden = !needed;
  $('#ac-name-label').textContent = name ? 'New screen name' : 'Screen name';
  $('#ac-name-form button[type=submit]').textContent = needed ? 'Use this screen name' : 'Save screen name';
  const input = $('#ac-name-input');
  if (needed && !input.value) input.value = compete.suggestName();
  if (needed) {
    // Shown before the account window, so it is the first thing seen.
    $('#ac-account').before(box);
    if (!box.dataset.asked) { box.dataset.asked = '1'; box.scrollIntoView({ block: 'start' }); input.focus(); }
  }
  return name;
}
$('#ac-name-suggest').addEventListener('click', () => {
  const input = $('#ac-name-input');
  input.value = compete.suggestName();
  input.removeAttribute('aria-invalid');
  $('#ac-name-err').textContent = '';
  $('#ac-name-said').textContent = `Suggested screen name: ${input.value}.`;
});
$('#ac-name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#ac-name-input');
  const err = $('#ac-name-err');
  err.textContent = '';
  input.removeAttribute('aria-invalid');
  const name = input.value.trim();
  const problem = compete.nameProblem(name);
  if (problem) { err.textContent = problem; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const saved = await compete.setName(name);
    input.value = '';
    toast(compete.isNameApproved() ? `Saved. You are now ${saved}.` : `Saved. Others see "New player" until ${saved} is approved.`);
    if (next) { location.href = next; return; }
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
  // Back to the game once signed in with a screen name.
  const goOn = async () => { const name = await drawName(); if (next && account.current() && name) location.href = next; };
  account.onChange(goOn);
  // The name chosen in the Create an account form arrives after the sign-in.
  compete.onName((n) => { if (n && n !== named) goOn(); });
  goOn();
}
start();
