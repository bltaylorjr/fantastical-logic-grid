// App keys on the website's Menu > Install the app (server/src/licenses.js).
// When the team switches app keys on, the Windows and Android downloads ask
// for a key first, and each key allows 2 downloads. Players the team allows
// (Settings > App keys) can ask for one free key of their own here once signed
// in with a confirmed email; it is shown here once the team approves it. The
// website itself never needs a key.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import * as store from './store.js';

const $ = (s) => document.querySelector(s);
const features = () => (store.getLocal('remoteConfig') || {}).features || {};
export const needsKey = () => !!CLOUD_URL && features().licenseDownload === true;

const WHY = {
  unknown: 'That key was not found. Check it and try again. Keys look like FLG-ABCDE-FGHJK-LMNPQ-RSTUV.',
  revoked: 'This key has been cancelled. Ask the team for a new key.',
  expired: 'This key has ended. Ask the team for a new key.',
  waiting: 'This key is waiting for the team to approve it. It shows here once it is approved.',
  downloads_used: 'This key has been used for its 2 downloads. Ask the team for a new key at fantasticallogicgrid@gmail.com.',
  slow_down: 'Too many tries. Wait a minute, then try again.',
  offline: 'The key could not be checked. Check your internet connection and try again.',
};

let mine = null;
let deps = { openAccount: () => {}, toast: () => {} };

const api = (path) => `${(CLOUD.syncUrl || CLOUD_URL).replace(/\/$/, '')}${path}`;

async function loadMine() {
  const who = account.current();
  if (!who || !account.enabled()) return null;
  try {
    const res = await fetch(api('/v1/license/mine'), { headers: { Authorization: `Bearer ${await account.getIdToken()}` } });
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

function showError(text) {
  const el = $('#install-key-error');
  el.textContent = text || '';
  el.hidden = !text;
}

function paint() {
  const own = features().licenseOwn || 'off';
  const who = account.current();
  const has = !!(mine && mine.key);
  $('#install-key-mine').hidden = !has;
  if (has) {
    $('#install-key-code').textContent = mine.key;
    $('#install-key-left').textContent = mine.works === false ? 'This key no longer works. Ask the team for a new one.'
      : `${mine.downloadsLeft ?? 0} of 2 downloads left. Installs on ${mine.maxDevices === 1 ? 'one computer or phone' : `${mine.maxDevices} computers or phones`}.`;
    if (!$('#install-key-input').value) $('#install-key-input').value = mine.key;
  }
  $('#install-key-waiting').hidden = !(mine && mine.waiting);
  $('#install-key-declined').hidden = !(mine && mine.declined);
  const canOwn = own !== 'off' && !has && !(mine && (mine.waiting || mine.declined));
  $('#install-key-get-row').hidden = !(canOwn && who && who.verified && (!mine || mine.allowed));
  $('#install-key-signin').hidden = !(canOwn && !who && account.enabled());
  $('#install-key-confirm').hidden = !(canOwn && who && !who.verified);
  $('#install-key-supporters').hidden = !(canOwn && who && who.verified && mine && !mine.allowed && own === 'supporters');
}

export async function render() {
  const on = needsKey();
  $('#install-key').hidden = !on;
  if (!on) return;
  showError('');
  paint();
  mine = await loadMine();
  paint();
}

// Checks the typed key (it counts as one of its downloads), then starts the download.
async function download(e) {
  const a = e.currentTarget;
  if (!needsKey()) return;
  e.preventDefault();
  const key = $('#install-key-input').value.trim();
  if (!key) { showError('Type your app key first, then choose the download again.'); $('#install-key-input').focus(); return; }
  showError('');
  a.setAttribute('aria-disabled', 'true');
  try {
    const res = await fetch(api('/v1/license/download'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key }) });
    const r = await res.json().catch(() => ({}));
    if (res.status === 429) { showError(WHY.slow_down); return; }
    if (!r.ok) { showError(WHY[r.reason] || WHY.unknown); return; }
    deps.toast(r.downloadsLeft ? 'Your download is starting. Keep your key: the app asks for it the first time it opens.' : 'Your download is starting. That was the last download for this key; keep it for the app.');
    if (mine && mine.key === key.toUpperCase()) mine.downloadsLeft = r.downloadsLeft;
    paint();
    window.location.href = a.href;
  } catch (ex) {
    showError(WHY.offline);
  } finally {
    a.removeAttribute('aria-disabled');
  }
}

export function init(opts) {
  deps = { ...deps, ...opts };
  for (const id of ['#install-desktop-btn', '#install-apk-btn']) $(id).addEventListener('click', download);
  $('#install-key-signin-btn').onclick = () => { $('#dlg-install').close(); deps.openAccount(); };
  $('#install-key-copy').onclick = () => navigator.clipboard?.writeText(mine?.key || '').then(() => deps.toast('Key copied.'), () => {});
  $('#install-key-get').onclick = async () => {
    const b = $('#install-key-get');
    b.disabled = true;
    try {
      const res = await fetch(api('/v1/license/mine'), { method: 'POST', headers: { Authorization: `Bearer ${await account.getIdToken()}`, 'Content-Type': 'text/plain' }, body: '{}' });
      const r = await res.json().catch(() => ({}));
      if (res.ok && r.waiting) { mine = r; paint(); deps.toast('Asked. The team approves free keys by hand; your key shows here once it is approved.'); return; }
      if (res.ok && r.key) { mine = r; $('#install-key-input').value = r.key; paint(); deps.toast('Here is your app key. It is saved with your account, so you can find it here again.'); return; }
      showError(r.error === 'confirm_email' ? 'Confirm your email first (Menu > Account), then try again.' : r.error === 'not_allowed' ? 'Free keys are for Supporters right now. Ask the team for a key.' : WHY.offline);
    } catch (e) {
      showError(WHY.offline);
    } finally {
      b.disabled = false;
    }
  };
}
