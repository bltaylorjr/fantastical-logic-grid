// App keys: the Windows and Android apps ask for an app key the first time
// they open (the website never does). The key is activated once online with
// the game's server (server/src/licenses.js), which uses one of the key's
// installs (1, or 2 when the team allows it) and sends back a signed pass.
// The pass is checked here against the public key in cloud-config.js, so the
// app keeps working offline. About once a day when online the app asks the
// server whether the key still works; a cancelled key, or an install the team
// removed, asks for a key again.
//
// Kept on this device: a random install id (never anything about the player)
// and the pass. Sent: the key, the install id and the platform.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';

const PASS = 'licensePass';
const DEVICE = 'licenseDevice';
const CHECK_EVERY_MS = 20 * 3600_000;
const LOOK_AGAIN_MS = 6 * 3600_000;
const $ = (s) => document.querySelector(s);

export function appPlatform() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return 'desktop';
  const n = window.FLGNative && window.FLGNative.platform;
  return n === 'android' || n === 'ios' ? n : null;
}

const enc = new TextEncoder();
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function deviceId() {
  let id = store.getLocal(DEVICE);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const b = crypto.getRandomValues(new Uint8Array(18));
    id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.setLocal(DEVICE, id);
  }
  return id;
}

// The pass's contents when its signature is good and it is for this install
// and has not ended, otherwise null.
async function readPass(pass) {
  const m = typeof pass === 'string' && pass.match(/^([\w-]+)\.([\w-]+)$/);
  if (!m || !CLOUD.licenseKey || !crypto.subtle) return null;
  try {
    const key = await crypto.subtle.importKey('jwk', CLOUD.licenseKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64url(m[2]), enc.encode(m[1])))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(m[1])));
    if (p.d !== deviceId() || (p.e && p.e <= Date.now())) return null;
    return p;
  } catch (e) {
    return null;
  }
}

async function post(path, body) {
  const res = await fetch(`${CLOUD_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Whether the server says the apps need a key: true, false, or null offline
// (then the last answer kept by remote-config.js is used).
async function required() {
  try {
    const res = await fetch(`${CLOUD_URL}/v1/config`);
    if (res.ok) return (await res.json()).features?.licenseRequired === true;
  } catch (e) { /* offline */ }
  const last = store.getLocal('remoteConfig');
  return last && last.features ? last.features.licenseRequired === true : null;
}

const WHY = {
  unknown: 'That key was not found. Check it and try again. Keys look like FLG-ABCDE-FGHJK-LMNPQ-RSTUV.',
  revoked: 'This key has been cancelled. Ask the team for a new key.',
  expired: 'This key has ended. Ask the team for a new key.',
  full: 'This key is already installed on its computer or phone. Each key installs on one device. To use the game here too, ask the team to allow a second install, or get a new key.',
  removed: 'This install was removed from your key. Type your key again, or ask the team for a new one.',
  not_ready: 'Keys cannot be checked right now. Try again in a few minutes.',
  slow_down: 'Too many tries. Wait a minute, then try again.',
  offline: 'Connect to the internet to check your key. You only need to be online this once; after that the game works offline.',
};

let locked = false;
let unlock = null;
let announce = () => {};

function showGate(reason) {
  locked = true;
  const dlg = $('#dlg-license');
  $('#license-error').hidden = !reason;
  $('#license-error').textContent = reason ? WHY[reason] || WHY.unknown : '';
  if (!dlg.open) dlg.showModal();
  // Escape must not close it: the game stays locked until a key works.
  dlg.oncancel = (e) => e.preventDefault();
  dlg.onclose = () => { if (locked) dlg.showModal(); };
  setTimeout(() => $('#license-key').focus(), 50);
  return new Promise((resolve) => { unlock = resolve; });
}

function done(r) {
  locked = false;
  $('#dlg-license').close();
  announce('Your app key works. Enjoy the game.');
  if (unlock) { const u = unlock; unlock = null; u(r); }
}

async function activate(e) {
  e.preventDefault();
  const btn = $('#license-go');
  const err = $('#license-error');
  const key = $('#license-key').value.trim();
  if (!key) { err.textContent = 'Type or paste your app key.'; err.hidden = false; $('#license-key').focus(); return; }
  btn.disabled = true;
  err.hidden = true;
  $('#license-busy').hidden = false;
  try {
    const { status, data } = await post('/v1/license/activate', { key, device: deviceId(), platform: appPlatform() });
    if (status === 200 && data.pass && (await readPass(data.pass))) {
      store.setLocal(PASS, { pass: data.pass, key: data.key, checkedAt: Date.now() });
      done(data);
      return;
    }
    err.textContent = status === 429 ? WHY.slow_down : WHY[data.error] || WHY.unknown;
  } catch (ex) {
    err.textContent = WHY.offline;
  } finally {
    btn.disabled = false;
    $('#license-busy').hidden = true;
  }
  err.hidden = false;
  $('#license-key').focus();
}

// About once a day when online: does the key still work here?
async function recheck(saved) {
  if (Date.now() - (saved.checkedAt || 0) < CHECK_EVERY_MS) return;
  try {
    const { status, data } = await post('/v1/license/check', { pass: saved.pass });
    if (status !== 200) return;
    if (data.ok || data.required === false) { store.setLocal(PASS, { ...saved, checkedAt: Date.now() }); return; }
    if (['revoked', 'removed', 'expired', 'bad'].includes(data.reason)) {
      store.setLocal(PASS, undefined);
      showGate(data.reason === 'bad' ? 'removed' : data.reason);
    }
  } catch (e) { /* offline: the pass keeps working */ }
}

// The key this install uses, shown in Help (FLG-…-ABCDE), or ''.
export const shownKey = () => (store.getLocal(PASS) || {}).key || '';
export const isLocked = () => locked;

// Resolves once the game may be played: straight away on the website, with a
// good pass, or when the server does not ask for keys; otherwise after the
// player types a key that works.
export async function gate(opts = {}) {
  if (opts.announce) announce = opts.announce;
  const platform = appPlatform();
  if (!platform || !CLOUD_URL) return;
  $('#license-form').onsubmit = activate;
  const saved = store.getLocal(PASS);
  const keepChecking = () => setInterval(() => { const s = store.getLocal(PASS); if (s && !locked) recheck(s); }, LOOK_AGAIN_MS);
  if (saved && (await readPass(saved.pass))) {
    recheck(saved);
    keepChecking();
    return;
  }
  const need = await required();
  if (need === false) {
    // Keys may be switched on later: look again now and then.
    const look = async () => { if (!locked && !store.getLocal(PASS) && (await required()) === true) showGate(); };
    setInterval(look, LOOK_AGAIN_MS);
    window.addEventListener('online', look);
    return;
  }
  await showGate(need === null ? 'offline' : null);
  keepChecking();
}
