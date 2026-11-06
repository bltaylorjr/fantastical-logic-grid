// Passwords: the owner's password manager (server/src/vault.js).
//
// Everything is locked here, in the browser, before it is sent. A random
// AES-GCM vault key locks each login; a key made from the master password
// (PBKDF2-SHA-256, 600,000 rounds) locks the vault key. The master password and
// the open vault key live only in this page's memory: Lock now, signing out,
// closing the tab or the idle timer forgets them.
//
// Face ID, a fingerprint or Windows Hello can stand in for the master password
// on a device that was set up for it: a passkey made for Passwords gives a
// secret through the browser's PRF extension (only after the face or finger
// check), and that secret opens this device's own locked copy of the vault key.
//
// "Log in" opens the site's sign-in page and copies the username; the row then
// offers the password and the 2-step code to paste. A web page cannot type
// into another website (browsers forbid it), so true autofill would need a
// browser extension.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
import { deviceLabel, platformReady } from './passkeys.js';
import { makeDropKeys, importDropPrivate, openDrop } from './vault-drop.js';

const ITERATIONS = 600_000;
const ADD_CHUNK = 40;
const CLIP_CLEAR_MS = 30_000;
const IDLE_PREF = 'flg-vault-idle';
const KINDS = {
  login: 'Website logins', email: 'Email accounts', hosting: 'Hosting and domains', social: 'Social media',
  money: 'Payments and banking', api: 'API and app keys', device: 'Wi-Fi and devices', other: 'Other',
};

const KIND_ONE = { login: 'Website login', email: 'Email account', hosting: 'Hosting or domain', social: 'Social media', money: 'Payments or banking', api: 'API or app key', device: 'Wi-Fi or device', other: 'Other' };

let h = null; // helpers from admin.js
let meta = null;
let devices = []; // devices that can unlock with Face ID or fingerprint (no secrets in them)
let key = null; // the open vault key (CryptoKey), or null when locked
let items = []; // [{ id, d: {...}, updatedAt, deletedAt }]
let loaded = false;
let lastUse = Date.now();
let editing = null; // the item open in the dialog, or null when adding
let undo = null;
let clipTimer = null;
const shown = new Set(); // ids whose password is showing

// ------------------------------------------------------------- crypto
const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function masterKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function wrapVaultKey(password, vaultKey) {
  const salt = rand(16);
  const iv = rand(12);
  const mk = await masterKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.wrapKey('raw', vaultKey, mk, { name: 'AES-GCM', iv });
  return { salt: toB64(salt), iterations: ITERATIONS, keyIv: toB64(iv), keyCt: toB64(ct) };
}
async function unwrapVaultKey(password, m) {
  const mk = await masterKey(password, fromB64(m.salt), m.iterations);
  return crypto.subtle.unwrapKey('raw', fromB64(m.keyCt), mk, { name: 'AES-GCM', iv: fromB64(m.keyIv) }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
async function seal(d) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(d)));
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function unseal(row) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(row.iv) }, key, fromB64(row.ct));
  return JSON.parse(dec.decode(pt));
}

// ------------------------------------------------------------- Face ID and fingerprint
const DEVICE_KEY = 'flg-vault-device';
const BIO_SKIP = 'flg-vault-bio-skip';
const toB64u = (buf) => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
const stored = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const myDevice = () => { const m = stored(DEVICE_KEY); return m && devices.find((d) => d.credId === m.credId); };

class BioError extends Error {}
function bioWords(e) {
  if (e instanceof BioError) return e;
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return new BioError('Face ID or fingerprint was cancelled or timed out.');
  if (e?.name === 'SecurityError') return new BioError('This browser will not use Face ID or fingerprint on this page.');
  return new BioError(e?.message || 'Face ID or fingerprint did not work. Please try again.');
}
async function deviceKey(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('flg-vault-device-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function prfSecret(credId, salt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: rand(32), rpId: location.hostname, timeout: 60_000, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: fromB64u(credId) }],
    extensions: { prf: { eval: { first: salt } } },
  } });
  const first = cred?.getClientExtensionResults?.().prf?.results?.first;
  if (!first) throw new BioError('This browser cannot unlock Passwords with Face ID or fingerprint. Use the master password.');
  return first;
}
// Makes a passkey for Passwords on this device and saves this device's copy of the vault key.
async function setUpBio() {
  const salt = rand(32);
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { id: location.hostname, name: 'The Logic Grid Passwords' },
      user: { id: rand(16), name: 'Passwords', displayName: 'Passwords (The Logic Grid admin)' },
      challenge: rand(32), timeout: 60_000,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      extensions: { prf: { eval: { first: salt } } },
    } });
  } catch (e) { throw bioWords(e); }
  const credId = toB64u(cred.rawId);
  const ext = cred.getClientExtensionResults?.().prf;
  if (!ext?.enabled) throw new BioError('This browser or device cannot unlock Passwords with Face ID or fingerprint yet (it needs passkey PRF support: recent Chrome, Edge or Safari). A passkey named "Passwords (The Logic Grid admin)" may have been saved; you can delete it in your device settings.');
  let secret = ext.results?.first;
  if (!secret) { try { secret = await prfSecret(credId, salt); } catch (e) { throw bioWords(e); } }
  const iv = rand(12);
  const keyCt = await crypto.subtle.wrapKey('raw', key, await deviceKey(secret), { name: 'AES-GCM', iv });
  const dev = { credId, label: deviceLabel(), prfSalt: toB64(salt), keyIv: toB64(iv), keyCt: toB64(keyCt) };
  const r = await h.api('vault/devices', { method: 'POST', body: dev });
  store(DEVICE_KEY, { credId });
  store(BIO_SKIP, null);
  devices = devices.filter((d) => d.credId !== credId).concat([{ ...dev, id: r.id, createdAt: Date.now() }]);
}
async function bioUnlock() {
  const d = myDevice();
  if (!d) throw new BioError('This device is not set up for Face ID or fingerprint any more. Use the master password.');
  let secret;
  try { secret = await prfSecret(d.credId, fromB64(d.prfSalt)); } catch (e) { throw bioWords(e); }
  try {
    key = await crypto.subtle.unwrapKey('raw', fromB64(d.keyCt), await deviceKey(secret), { name: 'AES-GCM', iv: fromB64(d.keyIv) }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch { throw new BioError('Face ID or fingerprint could not open Passwords on this device. Use the master password, then set it up again.'); }
  h.api(`vault/devices/${d.id}/used`, { method: 'POST', body: {} }).catch(() => {});
}
let bioReady = null;
const canBio = () => (bioReady ??= platformReady().catch(() => false));

async function paintBio() {
  const mine = myDevice();
  if (!mine && stored(DEVICE_KEY) && meta) store(DEVICE_KEY, null); // removed on another device
  const box = $('#vault-bio-box');
  box.hidden = !mine;
  $('#vault-unlock-btn').className = mine ? 'btn' : 'btn primary';
  const ready = await canBio();
  $('#vault-devices').innerHTML = devices.length
    ? devices.map((d) => `<li class="row"><span><b>${esc(d.label)}</b>${d.credId === stored(DEVICE_KEY)?.credId ? ' <span class="badge ok">This device</span>' : ''}<br><small class="muted">Set up ${h.when(d.createdAt)}${d.lastUsedAt ? `, last used ${h.when(d.lastUsedAt)}` : ''}</small></span><button class="btn small danger" type="button" data-v-dev="${d.id}" aria-label="Remove ${esc(d.label)}">Remove</button></li>`).join('')
    : '<li class="muted">No devices set up yet.</li>';
  $('#vault-bio-setup').hidden = !ready || !!mine;
  $('#vault-bio-why').hidden = ready || !!mine;
  $('#vault-bio-why').textContent = 'This device or browser has no Face ID, fingerprint or Windows Hello for websites.';
  $('#vault-bio-offer').hidden = !key || !ready || !!mine || !!stored(BIO_SKIP);
}

// ------------------------------------------------------------- 2-step codes (RFC 6238)
function parseTotp(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let secret = s;
  let digits = 6;
  let period = 30;
  let algo = 'SHA-1';
  if (/^otpauth:/i.test(s)) {
    try {
      const u = new URL(s);
      secret = u.searchParams.get('secret') || '';
      digits = Number(u.searchParams.get('digits')) || 6;
      period = Number(u.searchParams.get('period')) || 30;
      algo = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[String(u.searchParams.get('algorithm') || 'SHA1').toUpperCase()] || 'SHA-1';
    } catch { return null; }
  }
  const clean = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!/^[A-Z2-7]{8,}$/.test(clean)) return null;
  return { secret: clean, digits: Math.min(10, Math.max(6, digits)), period: Math.min(120, Math.max(10, period)), algo };
}
function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let val = 0; const out = [];
  for (const c of s) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
async function totp(t, now = Date.now()) {
  const counter = Math.floor(now / 1000 / t.period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const k = await crypto.subtle.importKey('raw', base32(t.secret), { name: 'HMAC', hash: t.algo }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const o = mac[mac.length - 1] & 15;
  const bin = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return { code: String(bin % 10 ** t.digits).padStart(t.digits, '0'), left: t.period - (Math.floor(now / 1000) % t.period) };
}

// ------------------------------------------------------------- passwords
const SETS = { lower: 'abcdefghijkmnopqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits: '23456789', symbols: '!#$%&*+-=?@^_~' };
function pick(set) {
  const lim = 256 - (256 % set.length);
  for (;;) { const [b] = rand(1); if (b < lim) return set[b % set.length]; }
}
export function makePassword({ length = 20, symbols = true } = {}) {
  const sets = [SETS.lower, SETS.upper, SETS.digits, ...(symbols ? [SETS.symbols] : [])];
  const all = sets.join('');
  for (;;) {
    const p = Array.from({ length }, () => pick(all)).join('');
    if (sets.every((s) => [...p].some((ch) => s.includes(ch)))) return p;
  }
}
const COMMON = ['password', 'passw0rd', 'pass', 'secret', 'qwerty', 'letmein', 'welcome', 'admin', 'login', 'iloveyou', 'love', 'monkey', 'dragon', 'football', 'baseball',
  'summer', 'winter', 'spring', 'autumn', 'sunshine', 'master', 'hello', 'test', 'shadow', 'princess', 'freedom', 'whatever', 'trustno1'];
const RUNS = /(?:0123|1234|2345|3456|4567|5678|6789|7890|012|123|234|345|456|567|678|789|890|abcd|abc|bcd|qwer|qwe|asdf|asd|zxcv|zxc|(.)\1+)/g;
// A rough guess at how hard a password is to guess: common words and runs
// such as 123 or aaaa count as a single character.
function strength(p) {
  if (!p) return { score: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 20;
  let rest = p.toLowerCase();
  for (const w of COMMON) rest = rest.split(w).join('#');
  rest = rest.replace(RUNS, '#');
  let bits = rest.length * Math.log2(pool || 1);
  if (/^(?:\d+|[a-z]+|[A-Z]+)$/.test(p)) bits *= 0.6;
  if (bits < 45) return { score: 1, label: 'Weak: easy to guess' };
  if (bits < 70) return { score: 2, label: 'OK' };
  return { score: 3, label: 'Strong' };
}

// ------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function siteUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  const full = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try { const x = new URL(full); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; }
}
const host = (u) => { try { return new URL(siteUrl(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
// Proper names for sites, so a login is titled "GitHub", not "github.com".
// Matched on the end of the address (dash.cloudflare.com is Cloudflare), most
// specific first; each also suggests the login's type.
const SITES = [
  ['developers.facebook.com', 'Meta for Developers', 'api'], ['business.facebook.com', 'Meta Business Suite', 'social'], ['facebook.com', 'Facebook', 'social'],
  ['instagram.com', 'Instagram', 'social'], ['threads.net', 'Threads', 'social'], ['threads.com', 'Threads', 'social'],
  ['developer.x.com', 'X Developer Portal', 'api'], ['x.com', 'X (Twitter)', 'social'], ['twitter.com', 'X (Twitter)', 'social'],
  ['bsky.app', 'Bluesky', 'social'], ['bsky.social', 'Bluesky', 'social'], ['mastodon.social', 'Mastodon', 'social'], ['mastodon.gamedev.place', 'Mastodon (gamedev.place)', 'social'],
  ['linkedin.com', 'LinkedIn', 'social'], ['studio.youtube.com', 'YouTube Studio', 'social'], ['youtube.com', 'YouTube', 'social'], ['developers.tiktok.com', 'TikTok for Developers', 'api'],
  ['tiktok.com', 'TikTok', 'social'], ['reddit.com', 'Reddit', 'social'], ['developers.pinterest.com', 'Pinterest Developers', 'api'], ['pinterest.com', 'Pinterest', 'social'],
  ['news.ycombinator.com', 'Hacker News', 'social'], ['producthunt.com', 'Product Hunt', 'social'], ['indiehackers.com', 'Indie Hackers', 'social'], ['discord.com', 'Discord', 'social'],
  ['alternativeto.net', 'AlternativeTo', 'other'], ['itch.io', 'itch.io', 'other'], ['oercommons.org', 'OER Commons', 'other'],
  ['github.com', 'GitHub', 'hosting'], ['dash.cloudflare.com', 'Cloudflare', 'hosting'], ['cloudflare.com', 'Cloudflare', 'hosting'], ['workers.dev', 'Cloudflare Workers', 'hosting'],
  ['namecheap.com', 'Namecheap', 'hosting'], ['godaddy.com', 'GoDaddy', 'hosting'], ['netlify.com', 'Netlify', 'hosting'], ['vercel.com', 'Vercel', 'hosting'],
  ['cloud.oracle.com', 'Oracle Cloud', 'hosting'], ['oraclecloud.com', 'Oracle Cloud', 'hosting'], ['oracle.com', 'Oracle', 'hosting'],
  ['console.firebase.google.com', 'Firebase', 'hosting'], ['firebase.google.com', 'Firebase', 'hosting'], ['console.cloud.google.com', 'Google Cloud', 'hosting'],
  ['aistudio.google.com', 'Google AI Studio (Gemini)', 'api'], ['search.google.com', 'Google Search Console', 'other'], ['mail.google.com', 'Gmail', 'email'], ['gmail.com', 'Gmail', 'email'],
  ['accounts.google.com', 'Google', 'other'], ['google.com', 'Google', 'other'], ['bing.com', 'Bing Webmaster Tools', 'other'],
  ['partner.microsoft.com', 'Microsoft Partner Center', 'api'], ['outlook.live.com', 'Outlook', 'email'], ['outlook.com', 'Outlook', 'email'], ['live.com', 'Microsoft account', 'other'], ['microsoft.com', 'Microsoft', 'other'],
  ['pwabuilder.com', 'PWABuilder', 'other'], ['play.google.com', 'Google Play Console', 'api'], ['appstoreconnect.apple.com', 'App Store Connect', 'api'], ['developer.apple.com', 'Apple Developer', 'api'], ['icloud.com', 'iCloud', 'other'], ['apple.com', 'Apple', 'other'],
  ['resend.com', 'Resend', 'api'], ['dashboard.stripe.com', 'Stripe', 'money'], ['stripe.com', 'Stripe', 'money'], ['paypal.com', 'PayPal', 'money'], ['venmo.com', 'Venmo', 'money'], ['cash.app', 'Cash App', 'money'],
  ['console.anthropic.com', 'Anthropic Console', 'api'], ['claude.ai', 'Claude', 'other'], ['platform.openai.com', 'OpenAI Platform', 'api'], ['openai.com', 'OpenAI', 'other'], ['huggingface.co', 'Hugging Face', 'api'],
  ['bitwarden.com', 'Bitwarden', 'other'], ['1password.com', '1Password', 'other'], ['dropbox.com', 'Dropbox', 'other'], ['canva.com', 'Canva', 'other'], ['adobe.com', 'Adobe', 'other'], ['figma.com', 'Figma', 'other'],
  ['amazon.com', 'Amazon', 'other'], ['etsy.com', 'Etsy', 'money'], ['shopify.com', 'Shopify', 'hosting'], ['squarespace.com', 'Squarespace', 'hosting'], ['wix.com', 'Wix', 'hosting'], ['wordpress.com', 'WordPress.com', 'hosting'],
  ['zoom.us', 'Zoom', 'other'], ['slack.com', 'Slack', 'other'], ['notion.so', 'Notion', 'other'], ['yahoo.com', 'Yahoo', 'email'], ['proton.me', 'Proton', 'email'],
  ['thelogicgrid.com', 'The Logic Grid', 'login'],
];
const SECOND_LEVEL = /^(co|com|net|org|gov|ac|edu)$/;
function siteInfo(u) {
  const hn = host(u);
  if (!hn) return null;
  const hit = SITES.find(([d]) => hn === d || hn.endsWith(`.${d}`));
  if (hit) return { name: hit[1], kind: hit[2] };
  const parts = hn.split('.');
  const label = parts.length > 2 && SECOND_LEVEL.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2] || parts[0];
  return { name: label.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), kind: '' };
}
const siteName = (u) => siteInfo(u)?.name || '';
// A title that is only an address ("github.com", "https://…") or a stand-in.
const plainTitle = (t, d) => !String(t || '').trim() || /^(imported login|untitled)$/i.test(String(t).trim()) || (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(String(t).trim().replace(/^https?:\/\//i, '')) && !/\s/.test(String(t).trim())) || [host(d.url), host(d.loginUrl)].includes(String(t).trim().toLowerCase());
// The proper name for a login, from its own title when that is a real name.
const properTitle = (d) => (plainTitle(d.title, d) ? siteName(d.loginUrl || d.url) || siteName(d.url) || String(d.title || '').trim() : String(d.title).trim());

function hue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 8; return x; }
const initial = (d) => esc((String(d.title || host(d.url) || '?').trim()[0] || '?').toUpperCase());
const active = () => items.filter((x) => !x.deletedAt);
function reuseCounts() {
  const n = new Map();
  for (const x of active()) if (x.d.password) n.set(x.d.password, (n.get(x.d.password) || 0) + 1);
  return n;
}

async function copy(text, what) {
  if (!text) { h.toast(`No ${what} saved.`); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    h.toast('This browser would not copy. Use Show and copy it by hand.');
    return;
  }
  h.toast(`${what[0].toUpperCase()}${what.slice(1)} copied. It clears from the clipboard in 30 seconds.`);
  h.announce(`${what} copied`);
  clearTimeout(clipTimer);
  clipTimer = setTimeout(() => { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}); }, CLIP_CLEAR_MS);
}

// ------------------------------------------------------------- ask first (Face ID or master password)
// Per device (Import, export and settings > Face ID and fingerprint): ask for
// Face ID, a fingerprint or Windows Hello (or the master password on a device
// without it) before showing, copying or logging in. One check covers a minute.
const ASK_PREF = 'flg-vault-ask';
const ASK_GRACE = 60_000;
let lastCheck = 0;
const asks = () => ({ show: false, copy: false, login: false, ...(stored(ASK_PREF) || {}) });
async function confirmIt(what) {
  if (!asks()[what] || Date.now() - lastCheck < ASK_GRACE) return true;
  const d = myDevice();
  if (d) {
    try {
      await navigator.credentials.get({ publicKey: { challenge: rand(32), rpId: location.hostname, timeout: 60_000, userVerification: 'required', allowCredentials: [{ type: 'public-key', id: fromB64u(d.credId) }] } });
      lastCheck = Date.now();
      return true;
    } catch { /* cancelled or not working: ask for the master password instead */ }
  }
  const v = await h.ask({ title: 'Confirm it is you', text: d ? 'Face ID or fingerprint did not work. Type the master password instead.' : 'Type the master password to go on.', fields: [{ name: 'p', label: 'Master password', type: 'password' }], ok: 'Go on' });
  if (!v) return false;
  try { await unwrapVaultKey(v.p, meta); } catch { h.toast('That is not the master password.'); return false; }
  lastCheck = Date.now();
  return true;
}

// ------------------------------------------------------------- Log in with autofill
// In the Windows admin app: a login window that fills in (desktop-admin autofill.rs).
// In Chrome or Edge with the extension (admin/extension): a new tab that fills in.
// Otherwise: open the site and copy the username.
export const EXTENSION_ID = 'bljdjkfhfdhehcfofbncddolbjnbkpdc';
let extension = null; // its version once it answers
function findExtension() {
  try {
    globalThis.chrome?.runtime?.sendMessage?.(EXTENSION_ID, { type: 'ping' }, (r) => { void globalThis.chrome.runtime.lastError; if (r?.version) { extension = r.version; if (loaded) paintAutofill(); } });
  } catch { /* not Chrome or Edge, or no extension */ }
}
const inApp = () => !!(window.__FLG_ADMIN_DESKTOP__ && window.__TAURI_INTERNALS__?.invoke);
async function logIn(x) {
  if (!(await confirmIt('login'))) return;
  const d = x.d;
  const title = properTitle(d) || 'the site';
  const login = { title, url: siteUrl(d.loginUrl || d.url), hosts: [host(d.url), host(d.loginUrl)].filter(Boolean), username: d.username || d.email || '', password: d.password || '', totp: parseTotp(d.totp) ? d.totp : '' };
  const parts = ['username', 'password', login.totp && '2-step code'].filter((p, i) => p && (i !== 0 || login.username) && (i !== 1 || login.password)).join(', ');
  if (inApp()) {
    try {
      await window.__TAURI_INTERNALS__.invoke('vault_login', { login });
      h.toast(`Opening ${title}. Your ${parts || 'login'} fill in by themselves; then press its Sign in button.`);
      return;
    } catch { /* an older app version: try the other ways */ }
  }
  if (extension) {
    const ok = await new Promise((done) => {
      try { globalThis.chrome.runtime.sendMessage(EXTENSION_ID, { type: 'fill', login }, (r) => { void globalThis.chrome.runtime.lastError; done(!!r?.ok); }); } catch { done(false); }
    });
    if (ok) { h.toast(`Opening ${title} in a new tab. Your ${parts || 'login'} fill in by themselves; then press its Sign in button.`); return; }
  }
  window.open(login.url, '_blank', 'noopener,noreferrer');
  await copy(login.username, 'username');
  if (!stored('flg-vault-autofill-tip')) { store('flg-vault-autofill-tip', 1); h.toast('Tip: get the browser extension (Import, export and settings) and Log in fills everything in for you.'); }
}

// Shows how Log in works here, and offers the extension.
function paintAutofill() {
  const el = $('#vault-autofill-state');
  if (!el) return;
  const how = inApp() ? ['ok', 'On: Log in opens the site in its own window and fills it in.']
    : extension ? ['ok', `On: the browser extension (version ${esc(extension)}) fills sign-in forms.`]
      : ['', 'Off in this browser: Log in opens the site and copies your username. Add the extension below to fill everything in.'];
  el.innerHTML = `<span class="badge ${how[0]}">${how[0] ? 'Autofill on' : 'Autofill off'}</span> ${how[1]}`;
  $('#vault-ext-box').hidden = inApp();
}

// Builds the extension's .zip in the browser from /admin/extension/ (stored, not compressed).
const EXT_FILES = ['manifest.json', 'background.js', 'fill.js', 'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];
function crc32(a) {
  let c; const t = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  let crc = 0xffffffff;
  for (const b of a) crc = t[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function extensionZip() {
  const parts = []; const dir = []; let at = 0;
  for (const f of EXT_FILES) {
    const r = await fetch(`extension/${f}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Could not get ${f}.`);
    const data = new Uint8Array(await r.arrayBuffer());
    const name = enc.encode(`logic-grid-passwords/${f}`);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [8, 0, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2]].forEach(([o, v, n]) => (n === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)));
    parts.push(new Uint8Array(head.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, at, 4]].forEach(([o, v, n]) => (n === 4 ? cd.setUint32(o, v, true) : cd.setUint16(o, v, true)));
    dir.push(new Uint8Array(cd.buffer), name);
    at += 30 + name.length + data.length;
  }
  const size = dir.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, EXT_FILES.length, 2], [10, EXT_FILES.length, 2], [12, size, 4], [16, at, 4]].forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...dir, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ------------------------------------------------------------- authenticator codes: QR in and out
const scripts = {};
function loadScript(src) {
  scripts[src] ??= new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { delete scripts[src]; no(new Error('Could not load the QR reader.')); }; document.head.append(s); });
  return scripts[src];
}
async function readQr(source) {
  await loadScript('vendor/jsqr.js');
  const c = document.createElement('canvas');
  const w = source.videoWidth || source.naturalWidth || source.width;
  const hh = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, 1600 / Math.max(w, hh));
  c.width = Math.round(w * scale); c.height = Math.round(hh * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  return globalThis.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || '';
}
async function qrFromImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('That is not a picture this browser can open.')); img.src = url; });
    return await readQr(img);
  } finally { URL.revokeObjectURL(url); }
}
// Puts what a QR code held into the editor: otpauth:// links fill the key (and the username/site when empty).
function useOtpText(text) {
  const t = String(text || '').trim();
  if (/^otpauth-migration:/i.test(t)) { h.toast('That is a Google Authenticator export code. Scan the QR code the website shows instead.'); return false; }
  if (!parseTotp(t)) { h.toast(t ? 'That QR code is not a 2-step code setup.' : 'No QR code found. Try a clearer or closer picture.'); return false; }
  $('#vf-totp').value = t;
  try {
    const u = new URL(t);
    const label = decodeURIComponent(u.pathname.replace(/^\/+totp\//i, ''));
    const issuer = u.searchParams.get('issuer') || (label.includes(':') ? label.split(':')[0] : '');
    const account = label.includes(':') ? label.split(':').slice(1).join(':').trim() : label.trim();
    if (account && !$('#vf-user').value.trim() && !$('#vf-email').value.trim()) $(account.includes('@') ? '#vf-email' : '#vf-user').value = account;
    if (issuer && !$('#vf-title').value.trim()) $('#vf-title').value = issuer;
  } catch { /* a plain key */ }
  totpPreview();
  h.toast('2-step code added. Type the code shown below into the site to finish turning it on.');
  return true;
}
let previewTimer = null;
async function totpPreview() {
  clearInterval(previewTimer);
  const el = $('#vf-totp-now');
  const t = parseTotp($('#vf-totp').value);
  $('#vf-totp-phone').hidden = !t;
  if (!t) { el.textContent = ''; return; }
  const tick = async () => { if (!$('#vault-dialog').open) { clearInterval(previewTimer); return; } const { code, left } = await totp(t); el.textContent = `Code now: ${code} (${left}s)`; };
  tick();
  previewTimer = setInterval(tick, 1000);
}
async function scanCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { h.toast('This browser has no camera access here. Use a screenshot instead.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { h.toast('The camera could not be opened. Allow it in the browser, or use a screenshot.'); return; }
  const dlg = $('#vault-scan');
  const video = $('#vault-scan-video');
  video.srcObject = stream;
  dlg.showModal();
  await video.play().catch(() => {});
  let stop = false;
  const end = () => { stop = true; stream.getTracks().forEach((tr) => tr.stop()); video.srcObject = null; if (dlg.open) dlg.close(); };
  $('#vault-scan-cancel').onclick = end;
  dlg.onclose = end;
  while (!stop) {
    await new Promise((r) => setTimeout(r, 250));
    if (stop || !video.videoWidth) continue;
    const text = await readQr(video).catch(() => '');
    if (text) { end(); useOtpText(text); }
  }
}
async function phoneQr() {
  const t = $('#vf-totp').value.trim();
  if (!parseTotp(t)) return;
  if (!(await confirmIt('show'))) return;
  await loadScript('vendor/qrcode.js');
  const title = $('#vf-title').value.trim() || 'Login';
  const account = $('#vf-email').value.trim() || $('#vf-user').value.trim() || title;
  const uri = /^otpauth:/i.test(t) ? t : `otpauth://totp/${encodeURIComponent(`${title}:${account}`)}?secret=${parseTotp(t).secret}&issuer=${encodeURIComponent(title)}`;
  const q = globalThis.qrcode(0, 'M');
  q.addData(uri); q.make();
  const n = q.getModuleCount();
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
  const svg = `<svg class="vault-qr" viewBox="0 0 ${n + 8} ${n + 8}" role="img" aria-label="QR code for ${esc(title)} 2-step codes"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  await h.ask({ title: 'Add to your phone', text: `${svg}<p>Scan this with Google Authenticator, Microsoft Authenticator, Authy or your phone's camera (iPhone Passwords) to get the same codes there too. <b>Anyone who sees it can make your codes</b>, so close it when you are done.</p>`, ok: 'Done' });
}

// ------------------------------------------------------------- lock and idle
function idleMs() { return (Number(localStorage.getItem(IDLE_PREF)) || 5) * 60_000; }
export function lockVault() {
  key = null;
  items = [];
  shown.clear();
  editing = null;
  undo = null;
  const dlg = $('#vault-dialog');
  if (dlg?.open) dlg.close();
  if (loaded) paint();
}
function touch() { lastUse = Date.now(); }
setInterval(() => { if (key && Date.now() - lastUse > idleMs()) { lockVault(); h?.announce('Passwords locked.'); } }, 10_000);
// Seen again after the tab was hidden for longer than the lock time: lock.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && key && Date.now() - lastUse > idleMs()) lockVault(); });

// ------------------------------------------------------------- drawing
function paint() {
  const state = !meta ? 'setup' : key ? 'open' : 'locked';
  $('#vault-setup').hidden = state !== 'setup';
  $('#vault-unlock').hidden = state !== 'locked';
  $('#vault-open').hidden = state !== 'open';
  $('#vault-top').hidden = state !== 'open';
  if (state === 'open') { renderTiles(); renderList(); }
  if (state !== 'setup') paintBio();
  if (state === 'open') paintAutofill();
}

function renderTiles() {
  const list = active();
  const reuse = reuseCounts();
  const weak = list.filter((x) => x.d.password && strength(x.d.password).score === 1).length;
  const reused = list.filter((x) => x.d.password && reuse.get(x.d.password) > 1).length;
  const codes = list.filter((x) => parseTotp(x.d.totp)).length;
  $('#vault-tiles').innerHTML = h.tile('Logins', h.fmt(list.length)) + h.tile('Weak passwords', h.fmt(weak), weak ? 'Show > Weak passwords' : 'None') +
    h.tile('Used more than once', h.fmt(reused), reused ? 'Show > Reused passwords' : 'None') + h.tile('With 2-step codes', h.fmt(codes));
  const sel = $('#vault-kind');
  const was = sel.value || 'all';
  const binN = items.length - list.length;
  sel.innerHTML = [['all', 'All logins'], ['fav', 'Favourites'], ...Object.entries(KINDS).map(([k, v]) => [k, v]), ['weak', 'Weak passwords'], ['reused', 'Reused passwords'], ['bin', `Bin (${binN})`]]
    .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === was) ? was : 'all';
}

function matches(x, q, kind, reuse) {
  if (kind === 'bin') { if (!x.deletedAt) return false; } else if (x.deletedAt) return false;
  if (kind === 'fav' && !x.d.fav) return false;
  if (KINDS[kind] && x.d.kind !== kind) return false;
  if (kind === 'weak' && !(x.d.password && strength(x.d.password).score === 1)) return false;
  if (kind === 'reused' && !(x.d.password && reuse.get(x.d.password) > 1)) return false;
  if (!q) return true;
  const hay = [x.d.title, x.d.url, x.d.loginUrl, x.d.username, x.d.email, x.d.notes, ...(x.d.fields || []).filter((f) => !f.secret).map((f) => `${f.label} ${f.value}`)].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function renderList() {
  const q = $('#vault-q').value.trim().toLowerCase();
  const kind = $('#vault-kind').value || 'all';
  const reuse = reuseCounts();
  const list = items.filter((x) => matches(x, q, kind, reuse))
    .sort((a, b) => (b.d.fav ? 1 : 0) - (a.d.fav ? 1 : 0) || String(a.d.title).localeCompare(String(b.d.title), undefined, { sensitivity: 'base' }));
  const el = $('#vault-list');
  if (!list.length) {
    el.innerHTML = `<li class="muted vault-empty">${items.length ? 'Nothing matches.' : 'No logins yet. Click <b>Add a login</b>, or import a CSV file under Import, export and settings.'}</li>`;
    return;
  }
  el.innerHTML = list.map((x) => {
    const d = x.d;
    const name = esc(properTitle(d) || 'Untitled');
    const addr = siteUrl(d.url || d.loginUrl);
    const addrText = addr.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const pw = d.password ? (shown.has(x.id) ? `<code class="vault-pw">${esc(d.password)}</code>` : '<span aria-label="hidden password">••••••••••</span>') : '<span class="muted">No password</span>';
    const flags = [d.password && strength(d.password).score === 1 && '<span class="badge warn">Weak</span>', d.password && reuse.get(d.password) > 1 && '<span class="badge warn">Reused</span>'].filter(Boolean).join(' ');
    const code = parseTotp(d.totp) ? `<span class="vault-code" data-totp="${x.id}" aria-live="off">······</span>` : '';
    if (x.deletedAt) {
      return `<li class="vault-item"><span class="vault-av" data-hue="${hue(d.title)}" aria-hidden="true">${initial(d)}</span>
        <div class="vault-main"><b>${name}</b><br><small class="muted">In the bin since ${h.when(x.deletedAt)}</small></div>
        <div class="row vault-acts"><button class="btn small" type="button" data-v-restore="${x.id}">Put back</button><button class="btn small danger" type="button" data-v-purge="${x.id}">Delete for good</button></div></li>`;
    }
    return `<li class="vault-item">
      <span class="vault-av" data-hue="${hue(d.title)}" aria-hidden="true">${initial(d)}</span>
      <div class="vault-main">
        <b>${d.fav ? '<span aria-label="Favourite">★</span> ' : ''}${name}</b> <span class="muted">${esc(KIND_ONE[d.kind] || '')}</span> ${flags}<br>
        ${addr ? `<a class="vault-addr" href="${esc(addr)}" target="_blank" rel="noopener noreferrer" aria-label="${name} website: ${esc(addrText)} (opens in a new tab)">${esc(addrText)}</a>` : '<span class="vault-addr muted">No website address</span>'}
        <span class="vault-line"><span class="muted">User</span> ${esc(d.username || d.email || '–')}</span>
        <span class="vault-line"><span class="muted">Password</span> ${pw}</span>
        ${code ? `<span class="vault-line"><span class="muted">2-step</span> ${code}</span>` : ''}
      </div>
      <div class="row vault-acts">
        ${siteUrl(d.loginUrl || d.url) ? `<button class="btn small primary" type="button" data-v-login="${x.id}" aria-label="Log in to ${name}">Log in</button>` : ''}
        <button class="btn small" type="button" data-v-user="${x.id}" aria-label="Copy username for ${name}">Copy user</button>
        <button class="btn small" type="button" data-v-pass="${x.id}" aria-label="Copy password for ${name}">Copy password</button>
        ${code ? `<button class="btn small" type="button" data-v-code="${x.id}" aria-label="Copy 2-step code for ${name}">Copy code</button>` : ''}
        <button class="btn small" type="button" data-v-show="${x.id}" aria-pressed="${shown.has(x.id)}" aria-label="${shown.has(x.id) ? 'Hide' : 'Show'} password for ${name}">${shown.has(x.id) ? 'Hide' : 'Show'}</button>
        <button class="btn small" type="button" data-v-edit="${x.id}" aria-label="Edit ${name}">Edit</button>
        <button class="btn small danger" type="button" data-v-bin="${x.id}" aria-label="Move ${name} to the bin">Bin</button>
      </div></li>`;
  }).join('');
  tickCodes();
}

async function tickCodes() {
  for (const el of $$('[data-totp]')) {
    const x = items.find((i) => i.id === Number(el.dataset.totp));
    const t = x && parseTotp(x.d.totp);
    if (!t) continue;
    const { code, left } = await totp(t);
    el.textContent = `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}`;
    el.title = `${left} seconds left`;
    el.dataset.left = left <= 5 ? 'low' : '';
  }
}
setInterval(() => { if (key && !$('#vault-open')?.hidden) tickCodes(); }, 1000);

// ------------------------------------------------------------- load
export async function vaultView(helpers) {
  h = helpers;
  loaded = true;
  if (!key) {
    const r = await h.api('vault');
    meta = r.meta;
    devices = r.devices || [];
    paint();
    $(!meta ? '#vault-new-1' : myDevice() ? '#vault-bio' : '#vault-pass')?.focus();
    return;
  }
  paint();
}

async function reload() {
  const r = await h.api('vault');
  meta = r.meta;
  devices = r.devices || [];
  if (!meta) { lockVault(); return; }
  const out = [];
  let bad = 0;
  for (const row of r.items) {
    try { out.push({ id: row.id, d: await unseal(row), updatedAt: row.updatedAt, deletedAt: row.deletedAt }); } catch { bad++; }
  }
  items = out;
  if (bad) h.toast(`${bad} login(s) could not be opened with this key and are hidden.`);
  try { await ensureDropKey(); await takeInbox(r.inbox || []); } catch (e) { if (e.code !== 'sign_in') h.toast(`The drop box could not be opened: ${e.message}`); }
  await nameLogins();
}

// ------------------------------------------------------------- the drop box
// Claude and the owner's automations lock logins they set up to the vault's
// public drop box key (admin/vault-drop.js, scripts/vault-drop.mjs). They can
// add, never read. On unlock the dashboard opens them and files them here.
async function ensureDropKey() {
  if (!meta || meta.dropPub) return;
  const { pub, privPkcs8 } = await makeDropKeys();
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, privPkcs8);
  const body = { pub, privIv: toB64(iv), privCt: toB64(ct) };
  await h.api('vault/drop-key', { method: 'POST', body });
  Object.assign(meta, { dropPub: body.pub, dropPrivIv: body.privIv, dropPrivCt: body.privCt });
}
const str = (v, n) => String(v ?? '').slice(0, n);
function fromDrop(x, row) {
  const d = {
    title: str(x.title || x.name, 120).trim(), url: str(x.url, 500).trim(), loginUrl: str(x.loginUrl, 500).trim(), username: str(x.username, 200).trim(),
    email: str(x.email, 200).trim(), password: str(x.password, 2000), totp: str(x.totp, 500).trim(), notes: str(x.notes, 8000), fav: false,
    fields: (Array.isArray(x.fields) ? x.fields : []).slice(0, 30).map((f) => ({ label: str(f.label, 60).trim(), value: str(f.value, 4000), secret: f.secret !== false })).filter((f) => f.label || f.value),
    history: [], createdAt: row.createdAt || Date.now(),
  };
  if (!siteUrl(d.url)) d.url = '';
  if (!siteUrl(d.loginUrl)) d.loginUrl = '';
  d.kind = KINDS[x.kind] ? x.kind : siteInfo(d.loginUrl || d.url)?.kind || 'login';
  d.title = properTitle(d) || 'Saved login';
  const when = new Date(d.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  d.notes = [d.notes, `Added by ${row.source} on ${when}.`].filter(Boolean).join('\n');
  return d;
}
async function takeInbox(rows) {
  if (!rows.length || !meta?.dropPrivCt) return;
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(meta.dropPrivIv) }, key, fromB64(meta.dropPrivCt));
  const priv = await importDropPrivate(new Uint8Array(pkcs8));
  let added = 0; let updated = 0; let bad = 0;
  const sources = new Set();
  for (const row of rows) {
    let d;
    try { d = fromDrop(await openDrop(priv, row), row); } catch { bad++; continue; }
    // The same site and username already saved: update it, keeping the old password.
    const same = d.username && active().find((x) => x.d.username === d.username && host(x.d.loginUrl || x.d.url) === host(d.loginUrl || d.url));
    if (same) {
      const o = same.d;
      const m = { ...o };
      for (const k of ['url', 'loginUrl', 'email', 'password', 'totp']) if (d[k]) m[k] = d[k];
      m.fields = [...(o.fields || []).filter((f) => !d.fields.some((n) => n.label === f.label)), ...d.fields];
      m.notes = [o.notes, d.notes].filter(Boolean).join('\n');
      m.history = o.password && d.password && o.password !== d.password ? [{ p: o.password, at: Date.now() }, ...(o.history || [])].slice(0, 5) : o.history || [];
      const r = await h.api(`vault/items/${same.id}`, { method: 'POST', body: await seal(m) });
      same.d = m; same.updatedAt = r.at; updated++;
    } else {
      const r = await h.api('vault/items', { method: 'POST', body: { items: [await seal(d)] } });
      items.push({ id: r.ids[0], d, updatedAt: r.at, deletedAt: null }); added++;
    }
    sources.add(row.source);
    await h.api(`vault/inbox/${row.id}/done`, { method: 'POST', body: {} });
  }
  const what = [added && `added ${added} login(s)`, updated && `updated ${updated}`].filter(Boolean).join(' and ');
  if (what) h.toast(`From the drop box (${[...sources].join(', ')}): ${what}.`);
  if (bad) h.toast(`${bad} login(s) in the drop box could not be opened and were left there.`);
}

// Logins titled with only an address ("github.com") or "Imported login" get
// the site's proper name, saved like any other change.
async function nameLogins() {
  const todo = items.filter((x) => { const t = properTitle(x.d); return t && t !== String(x.d.title || '').trim(); });
  let done = 0;
  for (const x of todo) {
    const d = { ...x.d, title: properTitle(x.d) };
    try {
      const r = await h.api(`vault/items/${x.id}`, { method: 'POST', body: await seal(d) });
      x.d = d;
      x.updatedAt = r.at;
      done++;
    } catch { /* left as it was; tried again next unlock */ }
  }
  if (done) h.toast(`Gave ${done} login(s) their proper site name.`);
}

// ------------------------------------------------------------- the editor
const KIND_OPTIONS = () => Object.entries(KIND_ONE).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');

function extraRow(f = {}) {
  const n = $$('#vf-extra .vault-extra').length;
  const div = document.createElement('div');
  div.className = 'row vault-extra';
  div.innerHTML = `<div class="field"><label for="vx-l-${n}">Label</label><input id="vx-l-${n}" data-x="label" maxlength="60" value="${esc(f.label || '')}" autocomplete="off" placeholder="PIN"></div>
    <div class="field grow"><label for="vx-v-${n}">Value</label><input id="vx-v-${n}" data-x="value" type="${f.secret ? 'password' : 'text'}" value="${esc(f.value || '')}" autocomplete="off" spellcheck="false"></div>
    <label class="check"><input type="checkbox" data-x="secret"${f.secret ? ' checked' : ''}> Hidden</label>
    <button class="btn small danger" type="button" data-x-del aria-label="Remove this field">Remove</button>`;
  $('#vf-extra').append(div);
}

function meter() {
  const s = strength($('#vf-pass').value);
  const reuse = reuseCounts();
  const p = $('#vf-pass').value;
  const dup = p && (reuse.get(p) || 0) - (editing && editing.d.password === p ? 1 : 0) > 0;
  $('#vf-meter').textContent = [s.label, dup ? 'Already used for another login.' : ''].filter(Boolean).join(' ');
}

function openEditor(x) {
  editing = x || null;
  const d = x ? x.d : { kind: 'login' };
  $('#vault-dlg-title').textContent = x ? `Edit ${d.title || 'login'}` : 'Add a login';
  $('#vf-kind').innerHTML = KIND_OPTIONS();
  $('#vf-title').value = d.title || '';
  $('#vf-kind').value = d.kind || 'login';
  $('#vf-url').value = d.url || '';
  $('#vf-login').value = d.loginUrl || '';
  $('#vf-user').value = d.username || '';
  $('#vf-email').value = d.email || '';
  $('#vf-pass').value = d.password || '';
  $('#vf-pass').type = 'password';
  $('#vf-show').textContent = 'Show';
  $('#vf-show').setAttribute('aria-pressed', 'false');
  $('#vf-totp').value = d.totp || '';
  setTimeout(totpPreview);
  $('#vf-notes').value = d.notes || '';
  $('#vf-fav').checked = !!d.fav;
  $('#vf-extra').innerHTML = '';
  (d.fields || []).forEach(extraRow);
  const hist = d.history || [];
  $('#vf-history').hidden = !hist.length;
  $('#vf-history-list').innerHTML = hist.map((p) => `<li><code>${esc(p.p)}</code> <small class="muted">until ${h.when(p.at)}</small></li>`).join('');
  $('#vault-dlg-error').hidden = true;
  meter();
  $('#vault-dialog').showModal();
  $('#vf-title').focus();
}

function readEditor() {
  const d = {
    title: $('#vf-title').value.trim(), kind: $('#vf-kind').value, url: $('#vf-url').value.trim(), loginUrl: $('#vf-login').value.trim(),
    username: $('#vf-user').value.trim(), email: $('#vf-email').value.trim(), password: $('#vf-pass').value, totp: $('#vf-totp').value.trim(),
    notes: $('#vf-notes').value, fav: $('#vf-fav').checked,
    fields: $$('#vf-extra .vault-extra').map((r) => ({ label: $('[data-x=label]', r).value.trim(), value: $('[data-x=value]', r).value, secret: $('[data-x=secret]', r).checked })).filter((f) => f.label || f.value),
  };
  d.title = properTitle(d);
  if (!d.title) return { error: 'Give the login a name or a website address.' };
  if (d.url && !siteUrl(d.url)) return { error: 'The website address does not look right.' };
  if (d.loginUrl && !siteUrl(d.loginUrl)) return { error: 'The sign-in page address does not look right.' };
  if (d.totp && !parseTotp(d.totp)) return { error: 'The 2-step code key should be letters A to Z and numbers 2 to 7, or an otpauth:// link.' };
  // Keep the last 5 passwords, so a change can be undone.
  const old = editing?.d;
  d.history = old?.history ? [...old.history] : [];
  if (old && old.password && old.password !== d.password) d.history.unshift({ p: old.password, at: Date.now() });
  d.history = d.history.slice(0, 5);
  d.createdAt = old?.createdAt || Date.now();
  return { d };
}

async function saveEditor(e) {
  e.preventDefault();
  touch();
  const { d, error } = readEditor();
  if (error) { $('#vault-dlg-error').textContent = error; $('#vault-dlg-error').hidden = false; return; }
  const ok = await h.act($('#vault-dlg-ok'), async () => {
    const sealed = await seal(d);
    if (editing) {
      const r = await h.api(`vault/items/${editing.id}`, { method: 'POST', body: sealed });
      editing.d = d;
      editing.updatedAt = r.at;
    } else {
      const r = await h.api('vault/items', { method: 'POST', body: { items: [sealed] } });
      items.push({ id: r.ids[0], d, updatedAt: r.at, deletedAt: null });
    }
  }, editing ? 'Saved.' : 'Login added.');
  if (ok) { $('#vault-dialog').close(); paint(); }
}

// ------------------------------------------------------------- import and export
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const COLS = {
  title: ['name', 'title'], url: ['url', 'login_uri', 'website', 'web site', 'uri'], username: ['username', 'login_username', 'login', 'user name'],
  password: ['password', 'login_password'], notes: ['note', 'notes', 'extra', 'comments'], totp: ['totp', 'login_totp', 'otpauth', 'otp'],
  email: ['email', 'e-mail'], fav: ['favorite', 'fav', 'favourite'],
};
function importRows(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) return [];
  const head = rows[0].map((x) => x.trim().toLowerCase());
  const at = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((x) => names.includes(x))]));
  if (at.password < 0 && at.username < 0 && at.url < 0) return null;
  const get = (r, k) => (at[k] >= 0 ? String(r[at[k]] ?? '').trim() : '');
  return rows.slice(1).map((r) => {
    const url = get(r, 'url');
    return {
      title: get(r, 'title'), kind: siteInfo(url)?.kind || 'login', url, loginUrl: '', username: get(r, 'username'), email: get(r, 'email'),
      password: at.password >= 0 ? String(r[at.password] ?? '') : '', totp: get(r, 'totp'), notes: get(r, 'notes'), fav: /^(1|true|yes)$/i.test(get(r, 'fav')), fields: [], history: [], createdAt: Date.now(),
    };
  }).filter((d) => d.password || d.username || d.url) // a site with no username yet is kept, to fill in later
    .map((d) => ({ ...d, title: properTitle(d) || 'Imported login' }));
}
async function importFile(file) {
  touch();
  const list = importRows(await file.text());
  $('#vault-import-file').value = '';
  if (list === null) { h.toast('That file has no website, username or password column.'); return; }
  if (!list.length) { h.toast('No logins found in that file.'); return; }
  const seen = new Set(active().map((x) => `${host(x.d.url)}|${x.d.username}|${x.d.password}`));
  const fresh = list.filter((d) => {
    const k = `${host(d.url)}|${d.username}|${d.password}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const skip = list.length - fresh.length;
  const yes = await h.ask({ title: 'Import logins', text: `Add <b>${fresh.length}</b> login(s)${skip ? ` (${skip} already saved will be skipped)` : ''}?`, ok: 'Import' });
  if (!yes || !fresh.length) return;
  await h.act(null, async () => {
    for (let i = 0; i < fresh.length; i += ADD_CHUNK) {
      const part = fresh.slice(i, i + ADD_CHUNK);
      const r = await h.api('vault/items', { method: 'POST', body: { items: await Promise.all(part.map(seal)) } });
      part.forEach((d, j) => items.push({ id: r.ids[j], d, updatedAt: r.at, deletedAt: null }));
    }
  }, `${fresh.length} login(s) imported. Now delete the CSV file you imported from.`);
  paint();
}
function exportCsv() {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['name', 'url', 'username', 'password', 'note', 'totp', 'email'].join(',')];
  for (const x of active()) {
    const d = x.d;
    const notes = [d.notes, ...(d.fields || []).map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join('\n');
    lines.push([d.title, siteUrl(d.loginUrl || d.url), d.username || d.email, d.password, notes, d.totp, d.email].map(cell).join(','));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  a.download = `passwords-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ------------------------------------------------------------- bin with undo
function showUndo(text, fn) {
  undo = fn;
  $('#vault-undo-text').textContent = text;
  $('#vault-undo').hidden = false;
  clearTimeout(showUndo.t);
  showUndo.t = setTimeout(() => { $('#vault-undo').hidden = true; undo = null; }, 10_000);
}

// ------------------------------------------------------------- events
export function initVault(helpers) {
  h = helpers;
  const sec = $('[data-view="vault"]');
  ['pointerdown', 'keydown', 'input'].forEach((t) => sec.addEventListener(t, touch, { passive: true }));
  $('#vault-dialog').addEventListener('keydown', touch, { passive: true });
  const idle = $('#vault-idle');
  idle.value = String(Number(localStorage.getItem(IDLE_PREF)) || 5);
  idle.onchange = () => { try { localStorage.setItem(IDLE_PREF, idle.value); } catch { /* private mode */ } h.toast(`Passwords will lock after ${idle.selectedOptions[0].text}.`); };

  const s1 = $('#vault-new-1');
  s1.oninput = () => { const s = strength(s1.value); $('#vault-new-meter').textContent = s1.value.length < 10 ? 'At least 10 characters.' : s.label; };
  $('#vault-new-show').onchange = (e) => { s1.type = $('#vault-new-2').type = e.target.checked ? 'text' : 'password'; };
  $('#vault-setup').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#vault-setup-error');
    const p = s1.value;
    const problem = p.length < 10 ? 'Use at least 10 characters.' : p !== $('#vault-new-2').value ? 'The two passwords are not the same.' : strength(p).score < 2 ? 'That is too easy to guess. Try a few random words.' : '';
    err.textContent = problem; err.hidden = !problem;
    if (problem) return;
    await h.act(e.submitter, async () => {
      const vk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const m = await wrapVaultKey(p, vk);
      await h.api('vault/setup', { method: 'POST', body: m });
      meta = m; key = vk; items = []; touch();
      await ensureDropKey();
      s1.value = ''; $('#vault-new-2').value = '';
    }, 'Passwords is set up and unlocked.');
    paint();
  };

  $('#vault-unlock').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#vault-unlock-error');
    err.hidden = true;
    const btn = e.submitter;
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    try {
      const r = await h.api('vault');
      meta = r.meta;
      devices = r.devices || [];
      if (!meta) { paint(); return; }
      try { key = await unwrapVaultKey($('#vault-pass').value, meta); } catch { err.textContent = 'That is not the master password.'; err.hidden = false; $('#vault-pass').select(); return; }
      $('#vault-pass').value = '';
      touch();
      await reload();
      paint();
      h.announce('Passwords unlocked.');
      $('#vault-q').focus();
    } catch (x) {
      if (x.code !== 'sign_in') { err.textContent = x.message; err.hidden = false; }
    } finally { btn.disabled = false; btn.textContent = 'Unlock'; }
  };


  // Face ID and fingerprint.
  $('#vault-bio').onclick = async (e) => {
    const err = $('#vault-unlock-error');
    err.hidden = true;
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await bioUnlock();
      touch();
      await reload();
      paint();
      h.announce('Passwords unlocked.');
      $('#vault-q').focus();
    } catch (x) {
      key = null;
      if (x.code !== 'sign_in') { err.textContent = x.message; err.hidden = false; }
    } finally { b.disabled = false; }
  };
  const setUp = async (b) => {
    touch();
    await h.act(b, async () => { try { await setUpBio(); } catch (e) { throw bioWords(e); } }, 'Done. Next time, unlock with Face ID or your fingerprint.');
    paintBio();
  };
  $('#vault-bio-setup').onclick = (e) => setUp(e.currentTarget);
  $('#vault-bio-offer-yes').onclick = (e) => setUp(e.currentTarget);
  $('#vault-bio-offer-no').onclick = () => { store(BIO_SKIP, Date.now()); paintBio(); };
  $('#vault-devices').onclick = async (e) => {
    const b = e.target.closest('[data-v-dev]');
    if (!b) return;
    const d = devices.find((x) => x.id === Number(b.dataset.vDev));
    if (!d) return;
    const yes = await h.ask({ title: 'Remove this device', text: `<b>${esc(d.label)}</b> will need the master password to open Passwords.`, ok: 'Remove', danger: true });
    if (!yes) return;
    await h.act(b, async () => {
      await h.api(`vault/devices/${d.id}/remove`, { method: 'POST', body: {} });
      devices = devices.filter((x) => x.id !== d.id);
      if (stored(DEVICE_KEY)?.credId === d.credId) store(DEVICE_KEY, null);
    }, 'Device removed.');
    paintBio();
  };

  $('#vault-reset').onclick = async () => {
    const v = await h.ask({ title: 'Wipe the vault', text: 'Every saved login is deleted for good. This cannot be undone. Type <b>DELETE</b> to go ahead.', fields: [{ name: 'confirm', label: 'Type DELETE' }], ok: 'Wipe the vault', danger: true, check: (x) => (x.confirm === 'DELETE' ? '' : 'Type DELETE in capitals.') });
    if (!v) return;
    await h.act(null, async () => { await h.api('vault/reset', { method: 'POST', body: { confirm: 'DELETE' } }); meta = null; devices = []; store(DEVICE_KEY, null); lockVault(); }, 'The vault was wiped. Choose a new master password.');
    paint();
  };

  $('#vault-lock').onclick = () => { lockVault(); h.announce('Passwords locked.'); $('#vault-pass').focus(); };
  $('#vault-q').oninput = renderList;
  $('#vault-kind').onchange = renderList;
  $('#vault-add').onclick = () => openEditor(null);
  $('#vault-gen').onclick = async () => {
    const p = makePassword();
    await copy(p, 'new password');
    h.ask({ title: 'A new password', text: `<code class="vault-pw">${esc(p)}</code><br>It is copied. Paste it into the site, then save it here with <b>Add a login</b>.`, ok: 'Done' });
  };

  $('#vault-list').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    touch();
    const id = Number(Object.values(b.dataset)[0]);
    const x = items.find((i) => i.id === id);
    if (!x) return;
    const d = x.d;
    if (b.dataset.vLogin) await logIn(x);
    else if (b.dataset.vUser) await copy(d.username || d.email, 'username');
    else if (b.dataset.vPass) { if (await confirmIt('copy')) await copy(d.password, 'password'); }
    else if (b.dataset.vCode) { const t = parseTotp(d.totp); if (t && await confirmIt('copy')) await copy((await totp(t)).code, '2-step code'); }
    else if (b.dataset.vShow) {
      if (!shown.has(id) && !(await confirmIt('show'))) return;
      if (shown.has(id)) shown.delete(id); else shown.add(id);
      renderList(); $(`[data-v-show="${id}"]`)?.focus();
    } else if (b.dataset.vEdit) { if (await confirmIt('show')) openEditor(x); }
    else if (b.dataset.vBin) {
      await h.act(b, async () => { const r = await h.api(`vault/items/${id}/bin`, { method: 'POST', body: {} }); x.deletedAt = r.at; });
      paint();
      showUndo(`Moved "${d.title}" to the bin.`, async () => { await h.api(`vault/items/${id}/restore`, { method: 'POST', body: {} }); x.deletedAt = null; });
    } else if (b.dataset.vRestore) {
      await h.act(b, async () => { await h.api(`vault/items/${id}/restore`, { method: 'POST', body: {} }); x.deletedAt = null; }, 'Put back.');
      paint();
    } else if (b.dataset.vPurge) {
      const yes = await h.ask({ title: 'Delete for good', text: `Delete <b>${esc(d.title)}</b> for good? This cannot be undone.`, ok: 'Delete', danger: true });
      if (!yes) return;
      await h.act(b, async () => { await h.api(`vault/items/${id}/purge`, { method: 'POST', body: {} }); items = items.filter((i) => i.id !== id); }, 'Deleted.');
      paint();
    }
  };
  $('#vault-undo-btn').onclick = async () => {
    const fn = undo;
    $('#vault-undo').hidden = true;
    undo = null;
    if (fn) await h.act(null, fn, 'Put back.');
    paint();
  };

  // The editor.
  $('#vault-dlg-form').onsubmit = saveEditor;
  const close = () => $('#vault-dialog').close();
  $('#vault-dialog').addEventListener('close', () => { editing = null; });
  $('#vault-dlg-cancel').onclick = close;
  $('#vault-dlg-x').onclick = close;
  $('#vf-pass').oninput = meter;
  $('#vf-show').onclick = (e) => { const on = $('#vf-pass').type === 'password'; $('#vf-pass').type = on ? 'text' : 'password'; e.target.textContent = on ? 'Hide' : 'Show'; e.target.setAttribute('aria-pressed', String(on)); };
  $('#vf-make').onclick = () => { $('#vf-pass').value = makePassword(); $('#vf-pass').type = 'text'; $('#vf-show').textContent = 'Hide'; $('#vf-show').setAttribute('aria-pressed', 'true'); meter(); };
  // Fills the proper site name (and type) from the address, unless a real name was typed.
  const nameFromAddress = () => {
    const d = { title: $('#vf-title').value, url: $('#vf-url').value, loginUrl: $('#vf-login').value };
    const info = siteInfo(d.loginUrl || d.url) || siteInfo(d.url);
    if (!info) return;
    if (plainTitle(d.title, d)) $('#vf-title').value = info.name;
    if (!editing && info.kind && $('#vf-kind').value === 'login') $('#vf-kind').value = info.kind;
  };
  $('#vf-url').onblur = nameFromAddress;
  $('#vf-login').onblur = nameFromAddress;
  $('#vf-extra-add').onclick = () => { extraRow(); $$('#vf-extra [data-x=label]').pop().focus(); };
  $('#vf-extra').onclick = (e) => { if (e.target.closest('[data-x-del]')) e.target.closest('.vault-extra').remove(); };
  $('#vf-extra').onchange = (e) => { if (e.target.dataset.x === 'secret') $('[data-x=value]', e.target.closest('.vault-extra')).type = e.target.checked ? 'password' : 'text'; };

  // Authenticator codes.
  $('#vf-totp').oninput = totpPreview;
  $('#vf-totp-scan').onclick = scanCamera;
  $('#vf-totp-file').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { useOtpText(await qrFromImage(f)); } catch (x) { h.toast(x.message); } } };
  $('#vf-totp-phone').onclick = phoneQr;
  // A screenshot pasted anywhere in the editor is read as a QR code.
  $('#vault-dialog').addEventListener('paste', async (e) => {
    const f = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (!f) return;
    e.preventDefault();
    try { useOtpText(await qrFromImage(f)); } catch (x) { h.toast(x.message); }
  });

  // Ask first, per device.
  for (const k of ['show', 'copy', 'login']) {
    const box = $(`#vault-ask-${k}`);
    box.checked = asks()[k];
    box.onchange = () => { store(ASK_PREF, { ...asks(), [k]: box.checked }); h.toast(box.checked ? 'Passwords will ask first on this device.' : 'Passwords will not ask first for that on this device.'); };
  }

  // Autofill.
  findExtension();
  $('#vault-ext-get').onclick = async (e) => {
    await h.act(e.currentTarget, async () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await extensionZip());
      a.download = 'logic-grid-passwords-extension.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, 'Downloaded. Follow the steps below to add it.');
  };
  $('#vault-ext-check').onclick = () => { findExtension(); setTimeout(() => { paintAutofill(); if (!extension) h.toast('The extension was not found in this browser yet.'); }, 600); };

  // Import, export and master password.
  $('#vault-import-file').onchange = (e) => { const f = e.target.files[0]; if (f) importFile(f); };
  $('#vault-export').onclick = async () => {
    const yes = await h.ask({ title: 'Download a plain CSV', text: 'Anyone who gets this file can read every password in it. Keep it safe and delete it when you are done.', ok: 'Download', danger: true });
    if (yes) { exportCsv(); h.toast('CSV downloaded.'); }
  };
  $('#vault-master').onclick = async () => {
    const v = await h.ask({
      title: 'Change the master password',
      fields: [{ name: 'old', label: 'Current master password', type: 'password' }, { name: 'p1', label: 'New master password', type: 'password', help: 'At least 10 characters. Nobody can recover it.' }, { name: 'p2', label: 'Type the new one again', type: 'password' }],
      ok: 'Change it',
      check: (x) => (x.p1.length < 10 ? 'Use at least 10 characters.' : x.p1 !== x.p2 ? 'The two new passwords are not the same.' : strength(x.p1).score < 2 ? 'That is too easy to guess.' : ''),
    });
    if (!v) return;
    await h.act(null, async () => {
      try { await unwrapVaultKey(v.old, meta); } catch { throw new Error('The current master password is not right.'); }
      const m = await wrapVaultKey(v.p1, key);
      await h.api('vault/master', { method: 'POST', body: m });
      meta = m;
    }, 'Master password changed.');
  };
}
