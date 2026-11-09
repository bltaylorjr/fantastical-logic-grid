/* ---------- Sign-in for Book Studio ----------
   Book Studio has its own sign-in screen and shares the dashboard's session
   (admin/admin.js keeps it under flg-admin-session, in sessionStorage or,
   with "Keep me signed in", in localStorage), so signing in here also signs
   in to Grid Admin and the other way round.
   - Email and password: the game's Firebase accounts. Someone the owner has
     invited can create their password here; their email must be confirmed
     before the server says anything about their access.
   - Face ID, fingerprint or Windows Hello: passkeys, through the dashboard's
     own module (admin/passkeys.js) and server routes.
   The server decides who may publish: GET /admin/v1/me says canPublish, and
   every export checks in with POST /admin/v1/publishing/export first (logged
   in the audit log). */
const GA_SESSION_KEY = 'flg-admin-session';
const GA_SKIP_KEY = 'flg-admin-passkey-skip';
const GA_IDLE_MS = 60 * 60_000;
const GA_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const GA_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const GA_MIN_PASSWORD = 8;
let gaSession = null, gaMe = null, gaLastActive = Date.now(), gaFirebaseKey = null, gaPasskeys = null;

function gaLoad() { try { return JSON.parse(sessionStorage.getItem(GA_SESSION_KEY) || localStorage.getItem(GA_SESSION_KEY) || 'null'); } catch (e) { return null; } }
function gaSave() {
  if (!gaSession) return;
  try {
    gaSession.seen = gaLastActive; const keep = !!gaSession.keep;
    (keep ? localStorage : sessionStorage).setItem(GA_SESSION_KEY, JSON.stringify(gaSession));
    (keep ? sessionStorage : localStorage).removeItem(GA_SESSION_KEY);
  } catch (e) { /* private window */ }
}
function gaClear() { try { sessionStorage.removeItem(GA_SESSION_KEY); localStorage.removeItem(GA_SESSION_KEY); } catch (e) { /* ignore */ } }
const gaErr = (code, message, status) => Object.assign(new Error(message), { code, status });

async function gaFirebase(path, body) {
  if (!gaFirebaseKey) {
    gaFirebaseKey = (await fetch('/admin/v1/client-config').then(r => r.json()).catch(() => ({}))).firebaseApiKey;
    if (!gaFirebaseKey) throw gaErr('not_set_up', 'Password sign-in is not set up yet. Ask the owner to add the FIREBASE_WEB_API_KEY secret.');
  }
  const res = await fetch(`${GA_AUTH_URL}/${path}?key=${encodeURIComponent(gaFirebaseKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.error?.message || `HTTP_${res.status}`).split(/[\s:]/)[0];
    const words = {
      INVALID_LOGIN_CREDENTIALS: 'That email and password do not match.', INVALID_PASSWORD: 'That email and password do not match.', EMAIL_NOT_FOUND: 'That email and password do not match.',
      EMAIL_EXISTS: 'This email already has a password. Sign in, or use "Forgot password?" to choose a new one.',
      WEAK_PASSWORD: `Choose a longer password (at least ${GA_MIN_PASSWORD} characters).`,
      OPERATION_NOT_ALLOWED: 'Creating a password is switched off for this sign-in system. Ask the owner.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes and try again.', USER_DISABLED: 'This account is switched off.', INVALID_EMAIL: 'Enter a valid email address.',
    };
    throw gaErr(code, words[code] || 'That did not work. Please try again.');
  }
  return data;
}
const gaFirebaseSession = (d, keep) => ({ mode: 'firebase', email: d.email, idToken: d.idToken, refreshToken: d.refreshToken, exp: Date.now() + Number(d.expiresIn || 3600) * 1000, keep });

async function gaBearer() {
  if (!gaSession) throw gaErr('sign_in', 'Please sign in.');
  if (gaSession.mode === 'token' || gaSession.mode === 'passkey') return gaSession.key;
  if (gaSession.idToken && Date.now() < gaSession.exp - 60_000) return gaSession.idToken;
  if (!gaFirebaseKey) gaFirebaseKey = (await fetch('/admin/v1/client-config').then(r => r.json())).firebaseApiKey;
  const res = await fetch(`${GA_TOKEN_URL}?key=${encodeURIComponent(gaFirebaseKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: gaSession.refreshToken }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw gaErr('sign_in', 'Please sign in again.', 401);
  gaSession.idToken = d.id_token; gaSession.refreshToken = d.refresh_token || gaSession.refreshToken;
  gaSession.exp = Date.now() + Number(d.expires_in || 3600) * 1000; gaSave();
  return gaSession.idToken;
}
async function adminApi(path, { method = 'GET', body } = {}) {
  if (gaSession && Date.now() - gaLastActive > GA_IDLE_MS) { gaLock('Locked after 1 hour without use. Sign in again to keep working.'); throw gaErr('sign_in', 'Signed out.', 401); }
  const res = await fetch(`/admin/v1/${path}`, { method, headers: { Authorization: `Bearer ${await gaBearer()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = gaErr(data.error || `http_${res.status}`, data.message || `Request failed (${res.status}).`, res.status);
    if (res.status === 401) gaLock(data.message || 'Please sign in again.');
    throw err;
  }
  return data;
}

/* ---------- Face ID and fingerprint (the dashboard's passkeys module) ---------- */
async function gaPk() {
  if (!gaPasskeys) {
    gaPasskeys = await import('/admin/passkeys.js');
    gaPasskeys.usePasskeyHelpers({ api: adminApi, me: () => gaMe });
  }
  return gaPasskeys;
}
const gaPkSupported = () => !!(window.PublicKeyCredential && navigator.credentials?.create);
async function gaPkReady() {
  if (!gaPkSupported()) return false;
  try { return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
}
function gaPkMine() { try { return JSON.parse(localStorage.getItem('flg-admin-passkey') || 'null'); } catch (e) { return null; } }
function gaPkSkipped(email) { try { return JSON.parse(localStorage.getItem(GA_SKIP_KEY) || 'null') === email; } catch (e) { return false; } }
function gaPkSkip(email) { try { localStorage.setItem(GA_SKIP_KEY, JSON.stringify(email)); } catch (e) { /* private window */ } }
const gaPkOnHere = () => !!gaMe && gaPkMine()?.email === gaMe.email;

async function gaSetUpPasskey() {
  const pk = await gaPk();
  await pk.setUpThisDevice();
}

/* ---------- The sign-in screen ---------- */
const GA_PANES = ['signInForm', 'createForm', 'forgotForm', 'verifyBox', 'offerBox', 'deniedBox'];
function gaPane(name, { title, text, focus } = {}) {
  $('#gate').hidden = false; $('#app').hidden = true;
  for (const id of GA_PANES) $('#' + id).hidden = id !== name;
  gaError('');
  const words = {
    signInForm: ['Sign in to Book Studio', 'Use the email the owner added for you in Grid Admin.'],
    createForm: ['Create your password', `Use the email the owner added for you. Choose at least ${GA_MIN_PASSWORD} characters.`],
    forgotForm: ['Choose a new password', 'Enter your email and we will send you a link to choose a new password.'],
    verifyBox: ['Confirm your email', ''],
    offerBox: ['Sign in faster next time?', 'This device can sign you in to Book Studio with Face ID, your fingerprint or Windows Hello instead of your password.'],
    deniedBox: ['No publishing access', 'Your account is signed in but cannot publish books. Ask the owner to switch on publishing for you under Admins.'],
  }[name];
  $('#gateTitle').textContent = title || words[0];
  $('#gateText').textContent = text ?? words[1];
  $('#gateText').hidden = !$('#gateText').textContent;
  if (name === 'signInForm') gaShowPasskeyButton();
  const f = focus && $(focus);
  if (f) setTimeout(() => f.focus(), 0);
}
function gaError(message) { const e = $('#gateError'); e.textContent = message || ''; e.hidden = !message; }
async function gaShowPasskeyButton() {
  const box = $('#pkSignInBox');
  box.hidden = !gaPkSupported() || !(gaPkMine() || (await gaPkReady()));
}
function gaShowGate(kind, message) {
  if (kind === 'denied') { gaPane('deniedBox', message ? { text: message } : {}); $('#gateBack').hidden = !(gaMe && gaMe.role !== 'publisher'); return; }
  gaPane('signInForm', { text: message, focus: '#siEmail' });
  if (gaSession?.email && gaSession.email.includes('@') && !$('#siEmail').value) $('#siEmail').value = gaSession.email;
}
function gaLock(message) { gaShowGate('sign_in', message); }

// Runs a form's work with its button busy, and shows any error in the card.
async function gaBusy(button, work) {
  const label = button.textContent; button.disabled = true; button.textContent = 'One moment…'; gaError('');
  try { return await work(); } catch (e) {
    if (e.code !== 'cancelled') gaError(e.message || 'That did not work. Please try again.');
    return undefined;
  } finally { button.disabled = false; button.textContent = label; }
}

// After any sign-in: ask the server who this is, then open the studio.
async function gaEnter({ fresh = false } = {}) {
  try { gaMe = await adminApi('me'); } catch (e) {
    // No connection: an installed Book Studio still opens for the account that
    // last signed in here (sync.js), and syncs once it is back online.
    const offline = typeof gaOfflineMe === 'function' && syNetDown(e) && gaOfflineMe();
    if (offline) { gaMe = offline; syOffline = true; gaOpen(); syShow('Offline: saved here, syncs when you are back online', 'off'); return; }
    if (e.code === 'verify_email') { gaVerifyPane(); return; }
    if (e.code === 'not_admin') { gaMe = null; gaShowGate('denied', `${gaSession?.email || 'This account'} has not been given Book Studio access. Ask the owner to add this email under Admins in Grid Admin.`); return; }
    if (e.status === 403) { gaShowGate('denied', e.message); return; }
    gaShowGate('sign_in', e.code === 'sign_in' ? undefined : e.message); return;
  }
  if (!gaMe.canPublish) { gaShowGate('denied'); return; }
  if (typeof gaRememberMe === 'function') gaRememberMe();
  // Just signed in with a password on a device with Face ID or a fingerprint reader.
  if (fresh && gaSession.mode === 'firebase' && !gaPkOnHere() && !gaPkSkipped(gaMe.email) && (await gaPkReady())) { gaPane('offerBox', { focus: '#pkOfferYes' }); return; }
  gaOpen();
}
let gaOpened = false, gaOpenedAs = '';
function gaOpen() {
  $('#gate').hidden = true; $('#app').hidden = false;
  $('#whoEmail').textContent = gaMe.email; $('#backToAdmin').hidden = gaMe.role === 'publisher';
  $('[data-tab=gridbooks]').hidden = false; $('[data-tab=players]').hidden = false;
  gaRefreshPkButton();
  // Someone else signed in on this page: start again, so their books load (sync.js).
  if (gaOpened && gaOpenedAs !== gaMe.email) { location.reload(); return; }
  if (!gaOpened) { gaOpened = true; gaOpenedAs = gaMe.email; init(); }
}
async function gaRefreshPkButton() {
  $('#pkSetUp').hidden = !gaMe || !gaMe.email.includes('@') || gaPkOnHere() || !(await gaPkReady());
}
function gaVerifyPane() {
  gaPane('verifyBox', { text: `We sent a link to ${gaSession?.email || 'your email'}. Open it to confirm your address, then come back here and press Continue.` , focus: '#verifyDone' });
}

/* ---------- Grid books: the dashboard's Books and covers, inside Book Studio ---------- */
const GA_ROLES = { publisher: 0.5, viewer: 1, moderator: 2, admin: 3, owner: 4 };
let gaBooks = null;
async function gaGridBooks() {
  try {
    if (!gaBooks) gaBooks = await import('/admin/books.js');
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    await gaBooks.booksView({
      api: adminApi, esc,
      // Anyone who may publish books makes, saves and publishes them here.
      can: (role) => (role === 'admin' && gaMe?.canPublish) || (GA_ROLES[gaMe?.role] || 0) >= (GA_ROLES[role] || 9),
      ask: async ({ title, text, fields }) => {
        if (!fields) return confirm(`${title}\n\n${text || ''}`.trim());
        const out = {};
        for (const f of fields) { const v = prompt(`${title}\n${f.label}`, f.value || ''); if (v === null) return null; out[f.name] = v; }
        return out;
      },
      toast: (m) => toast(m, 5000),
      when: (t) => new Date(t).toLocaleString(),
      openInStudio: (book) => importGridBook(book),
      // Make it from a topic: the publishers to choose from, and the whole path to a submission file.
      publishers: Object.entries(PUBLISHERS).map(([id, p]) => ({ id, name: p.name })),
      makeSubmission: (book, pub) => submitGridBook(book, pub),
    });
  } catch (e) {
    $('#books-body').textContent = e.message || 'Grid books did not load. Check your connection and try again.';
  }
}

/* Every export asks the server first. Returns false (and says why) when refused. */
async function checkInExport(kind) {
  try {
    await adminApi('publishing/export', { method: 'POST', body: { kind, title: S.meta.title || 'Untitled', platform: PUBLISHERS[S.pub].name, pages: pageCount() } });
    return true;
  } catch (e) {
    busy(false);
    if (e.status === 403) { gaShowGate('denied', e.message); return false; }
    if (e.status === 401 || e.code === 'sign_in') return false;
    toast(e.message || 'Could not reach Grid Admin. Check your connection and try again.', 6000); return false;
  }
}

function gaSignOut() {
  if (gaSession?.mode === 'passkey') fetch('/admin/v1/session/end', { method: 'POST', headers: { Authorization: `Bearer ${gaSession.key}` }, keepalive: true }).catch(() => {});
  const email = gaSession?.email;
  gaSession = null; gaMe = null; gaClear();
  $('#siPassword').value = '';
  if (email && email.includes('@')) $('#siEmail').value = email;
  gaShowGate('sign_in', 'You are signed out.');
}

function gaWire() {
  const keep = () => $('#siKeep').checked;
  $('#signInForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#siEmail').value.trim(), password = $('#siPassword').value;
    await gaBusy(e.submitter || $('#siSubmit'), async () => {
      const d = await gaFirebase('accounts:signInWithPassword', { email, password, returnSecureToken: true });
      gaSession = gaFirebaseSession(d, keep()); gaLastActive = Date.now(); gaSave();
      $('#siPassword').value = '';
      await gaEnter({ fresh: true });
    });
  };
  $('#pkSignIn').onclick = (e) => gaBusy(e.currentTarget, async () => {
    const d = await (await gaPk()).passkeySignIn();
    gaSession = { mode: 'passkey', key: d.token, email: d.email, exp: d.expiresAt, keep: keep() }; gaLastActive = Date.now(); gaSave();
    await gaEnter();
  }).finally(gaShowPasskeyButton);
  $('#toCreate').onclick = () => { $('#cfEmail').value = $('#siEmail').value; gaPane('createForm', { focus: $('#cfEmail').value ? '#cfPassword' : '#cfEmail' }); };
  $('#toForgot').onclick = () => { $('#fgEmail').value = $('#siEmail').value; gaPane('forgotForm', { focus: '#fgEmail' }); };
  // Cancel: back to the sign-in screen. An account still waiting for its
  // email to be confirmed is signed out, so nothing half-done is kept.
  for (const b of document.querySelectorAll('[data-gate-back]')) b.onclick = () => {
    if (gaSession && !gaMe) { gaSession = null; gaClear(); }
    gaPane('signInForm', { focus: '#siEmail' });
  };

  $('#createForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#cfEmail').value.trim(), password = $('#cfPassword').value;
    if (password.length < GA_MIN_PASSWORD) { gaError(`Choose a longer password (at least ${GA_MIN_PASSWORD} characters).`); $('#cfPassword').focus(); return; }
    if (password !== $('#cfConfirm').value) { gaError('The two passwords are not the same.'); $('#cfConfirm').focus(); return; }
    await gaBusy(e.submitter || $('#cfSubmit'), async () => {
      const d = await gaFirebase('accounts:signUp', { email, password, returnSecureToken: true });
      gaSession = gaFirebaseSession(d, keep()); gaLastActive = Date.now(); gaSave();
      await gaFirebase('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: d.idToken });
      $('#cfPassword').value = ''; $('#cfConfirm').value = ''; $('#siEmail').value = email;
      gaVerifyPane();
    });
  };
  $('#forgotForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#fgEmail').value.trim();
    await gaBusy(e.submitter || $('#fgSubmit'), async () => {
      // Said the same way whether or not the email has an account.
      try { await gaFirebase('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); } catch (err) { if (err.code === 'not_set_up' || err.code === 'INVALID_EMAIL' || err.code === 'TOO_MANY_ATTEMPTS_TRY_LATER') throw err; }
      $('#siEmail').value = email;
      gaPane('signInForm', { text: `If ${email} has an account, a link to choose a new password is on its way. Then sign in here.`, focus: '#siPassword' });
    });
  };
  $('#verifyResend').onclick = (e) => gaBusy(e.currentTarget, async () => {
    await gaFirebase('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: await gaBearer() });
    toast('Link sent. Check your email.');
  });
  // The token only says the email is confirmed once it is refreshed.
  $('#verifyDone').onclick = (e) => gaBusy(e.currentTarget, async () => {
    if (!gaSession) { gaShowGate('sign_in'); return; }
    gaSession.exp = 0; await gaBearer();
    await gaEnter({ fresh: true });
    if (!$('#verifyBox').hidden) gaError('Your email is not confirmed yet. Open the link in the email, then press Continue.');
  });
  $('#pkOfferYes').onclick = (e) => gaBusy(e.currentTarget, async () => {
    await gaSetUpPasskey();
    toast('Set up. Next time, sign in with Face ID or fingerprint.');
    gaOpen();
  });
  $('#pkOfferNo').onclick = () => { gaPkSkip(gaMe?.email || ''); toast('You can turn it on later with the Face ID button at the top.'); gaOpen(); };
  $('#pkSetUp').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await gaSetUpPasskey(); toast('Set up. Next time, sign in with Face ID or fingerprint.'); } catch (err) {
      if (err.code !== 'cancelled') toast(err.message || 'Face ID or fingerprint did not work. Please try again.', 7000);
    } finally { b.disabled = false; gaRefreshPkButton(); }
  };
  $('#gateOther').onclick = () => gaSignOut();
  $('#signOutBtn').onclick = gaSignOut;
}

async function gaStart() {
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { const was = gaLastActive; gaLastActive = Date.now(); if (gaSession && gaLastActive - was > 30_000) gaSave(); }, { passive: true });
  setInterval(() => { if (gaSession && Date.now() - gaLastActive > GA_IDLE_MS) gaLock('Locked after 1 hour without use. Sign in again to keep working.'); }, 60_000);
  gaWire();
  gaSession = gaLoad();
  if (gaSession?.seen) gaLastActive = gaSession.seen;
  $('#siKeep').checked = !!gaSession?.keep;
  if (!gaSession || Date.now() - gaLastActive > GA_IDLE_MS) { gaShowGate('sign_in'); return; }
  await gaEnter();
}
gaStart();
