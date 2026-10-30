// Face ID and fingerprint sign-in (passkeys) for the dashboard. The phone or
// computer keeps a passkey that only opens with the admin's face, finger or
// device PIN; the Worker checks it (server/src/passkeys.js) and gives a
// session. This device remembers which passkey is its own (and for which
// email) in localStorage, so the sign-in page can offer it.
const $ = (s, el = document) => el.querySelector(s);

const MINE_KEY = 'flg-admin-passkey';
const SKIP_KEY = 'flg-admin-passkey-skip';
let h = null; // helpers from admin.js

export const passkeysSupported = () => !!(window.PublicKeyCredential && navigator.credentials?.create);
export async function platformReady() {
  if (!passkeysSupported()) return false;
  try { return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
}

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } };
export const rememberedPasskey = () => read(MINE_KEY);

const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// A name for this device in the list, e.g. "iPhone, Safari".
export function deviceLabel(ua = navigator.userAgent) {
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows computer' : /Mac OS X/.test(ua) ? 'Mac' : 'Device';
  const app = window.__FLG_ADMIN_DESKTOP__ ? 'Windows app'
    : matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'installed app'
      : /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return app ? `${kind}, ${app}` : kind;
}

class PasskeyError extends Error { constructor(code, message) { super(message); this.code = code; } }

// The browser's own errors, in plain words. Cancelling is not an error.
function words(e) {
  if (e instanceof PasskeyError) return e;
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return new PasskeyError('cancelled', 'Face ID or fingerprint was cancelled or timed out.');
  if (e?.name === 'InvalidStateError') return new PasskeyError('exists', 'This device is already set up.');
  if (e?.name === 'SecurityError') return new PasskeyError('security', 'This browser will not use passkeys on this page.');
  return new PasskeyError('failed', e?.message || 'Face ID or fingerprint did not work. Please try again.');
}

async function post(path, body) {
  const res = await fetch(`/admin/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PasskeyError(data.error || `http_${res.status}`, data.message || 'Sign-in did not work. Please try again.');
  return data;
}

// Signs in with this device's passkey. Returns { token, email, expiresAt }.
export async function passkeySignIn() {
  const mine = rememberedPasskey();
  try {
    const o = await post('passkeys/sign-in/options', {});
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: fromB64(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification,
        allowCredentials: mine ? [{ type: 'public-key', id: fromB64(mine.id) }] : [],
      },
    });
    const r = cred.response;
    const out = await post('passkeys/sign-in', {
      id: cred.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature),
    });
    if (!mine || mine.id !== cred.id) write(MINE_KEY, { id: cred.id, email: out.email });
    return out;
  } catch (e) {
    const err = words(e);
    // The Worker no longer knows this passkey: stop offering it here.
    if (err.code === 'unknown_passkey') write(MINE_KEY, null);
    throw err;
  }
}

// Sets up this device for the signed-in admin.
export async function setUpThisDevice() {
  try {
    const o = await h.api('passkeys/options', { method: 'POST', body: {} });
    const cred = await navigator.credentials.create({
      publicKey: {
        ...o,
        challenge: fromB64(o.challenge),
        user: { ...o.user, id: fromB64(o.user.id) },
        excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: fromB64(c.id) })),
      },
    });
    const added = await h.api('passkeys/register', {
      method: 'POST',
      body: { id: cred.id, clientDataJSON: toB64(cred.response.clientDataJSON), attestationObject: toB64(cred.response.attestationObject), device: deviceLabel() },
    });
    write(MINE_KEY, { id: added.id, email: h.me().email });
    write(SKIP_KEY, null);
    return added;
  } catch (e) {
    if (e.code === 'sign_in_again' || e.code === 'needs_account' || e.code === 'too_many') throw e;
    throw words(e);
  }
}

// After a password sign-in on a phone or computer that has Face ID, a
// fingerprint reader or Windows Hello: offer to use it next time.
export async function offerPasskey() {
  const box = $('#passkey-offer');
  box.hidden = true;
  const email = h.me()?.email;
  if (!email || !email.includes('@') || h.mode() !== 'firebase' || read(SKIP_KEY) === email) return;
  if (rememberedPasskey()?.email === email || !(await platformReady())) return;
  box.hidden = false;
}

export function forgetThisDevice() { write(MINE_KEY, null); }

// ------------------------------------------------------------- the section
export async function passkeysView() {
  const [d, ready] = await Promise.all([h.api('passkeys'), platformReady()]);
  const mine = rememberedPasskey();
  const email = h.me().email;
  const here = mine && mine.email === email && d.passkeys.some((p) => p.id === mine.id);
  // Removed from another device: this one no longer has it.
  if (mine && mine.email === email && !here) write(MINE_KEY, null);
  const glass = !email.includes('@');
  $('#pk-status').innerHTML = glass ? '<p class="note">The break-glass key cannot use Face ID or fingerprint. Sign in with an admin account.</p>'
    : here ? '<p><span class="badge ok">On</span> This device signs you in with Face ID, fingerprint or its PIN.</p>'
      : ready ? '<p>This device can sign you in with Face ID, fingerprint or Windows Hello instead of your password.</p>'
        : '<p class="muted">This device or browser has no Face ID, fingerprint reader or Windows Hello that the dashboard can use. You can still set it up on your phone.</p>';
  $('#pk-add').hidden = glass || here || !ready;
  $('#pk-rows').innerHTML = d.passkeys.length ? d.passkeys.map((p) => `<tr>
      <td>${h.esc(p.device)}${mine && p.id === mine.id ? ' <span class="badge">This device</span>' : ''}</td>
      <td>${h.when(p.createdAt)}</td><td>${p.lastUsedAt ? h.when(p.lastUsedAt) : 'Not yet'}</td>
      <td><div class="actions"><button class="btn small danger" type="button" data-pk-remove="${h.esc(p.id)}" data-pk-name="${h.esc(p.device)}">Remove</button></div></td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No devices set up yet.</td></tr>';
}

export function initPasskeys(helpers) {
  h = helpers;
  const setUp = async (button, after) => {
    if (await h.act(button, setUpThisDevice, 'Set up. Next time, sign in with Face ID or fingerprint.')) after();
  };
  $('#pk-add').onclick = (e) => setUp(e.currentTarget, () => h.show('signin', { keepFocus: true }));
  $('#passkey-offer-yes').onclick = (e) => setUp(e.currentTarget, () => { $('#passkey-offer').hidden = true; });
  $('#passkey-offer-no').onclick = () => { write(SKIP_KEY, h.me()?.email || ''); $('#passkey-offer').hidden = true; h.toast('You can turn it on later under Face ID and fingerprint.'); };
  $('#pk-rows').onclick = async (e) => {
    const b = e.target.closest('button[data-pk-remove]');
    if (!b) return;
    if (!(await h.ask({ title: `Remove ${b.dataset.pkName}?`, text: 'That device will need your password to sign in again, and any dashboard it has open is signed out.', ok: 'Remove', danger: true }))) return;
    const id = b.dataset.pkRemove;
    if (await h.act(b, () => h.api(`passkeys/${encodeURIComponent(id)}/remove`, { method: 'POST' }), 'Removed.')) {
      if (rememberedPasskey()?.id === id) write(MINE_KEY, null);
      h.show('signin', { keepFocus: true });
    }
  };
}
