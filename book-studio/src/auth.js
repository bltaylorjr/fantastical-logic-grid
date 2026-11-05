/* ---------- Grid Admin sign-in for Book Studio ----------
   Book Studio uses the dashboard's own session (admin/admin.js keeps it under
   flg-admin-session, in sessionStorage or, with "Keep me signed in", in
   localStorage). Nothing new is stored. The server decides who may publish:
   GET /admin/v1/me says canPublish, and every export checks in with
   POST /admin/v1/publishing/export first (logged in the audit log). */
const GA_SESSION_KEY = 'flg-admin-session';
const GA_IDLE_MS = 60 * 60_000;
const GA_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
let gaSession = null, gaMe = null, gaLastActive = Date.now(), gaFirebaseKey = null;

function gaLoad() { try { return JSON.parse(sessionStorage.getItem(GA_SESSION_KEY) || localStorage.getItem(GA_SESSION_KEY) || 'null'); } catch (e) { return null; } }
function gaSave() {
  if (!gaSession) return;
  try {
    gaSession.seen = gaLastActive; const keep = !!gaSession.keep;
    (keep ? localStorage : sessionStorage).setItem(GA_SESSION_KEY, JSON.stringify(gaSession));
  } catch (e) { /* private window */ }
}
function gaClear() { try { sessionStorage.removeItem(GA_SESSION_KEY); localStorage.removeItem(GA_SESSION_KEY); } catch (e) { /* ignore */ } }

async function gaBearer() {
  if (!gaSession) throw Object.assign(new Error('Please sign in.'), { code: 'sign_in' });
  if (gaSession.mode === 'token' || gaSession.mode === 'passkey') return gaSession.key;
  if (gaSession.idToken && Date.now() < gaSession.exp - 60_000) return gaSession.idToken;
  if (!gaFirebaseKey) gaFirebaseKey = (await fetch('/admin/v1/client-config').then(r => r.json())).firebaseApiKey;
  const res = await fetch(`${GA_TOKEN_URL}?key=${encodeURIComponent(gaFirebaseKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: gaSession.refreshToken }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error('Please sign in again.'), { code: 'sign_in', status: 401 });
  gaSession.idToken = d.id_token; gaSession.refreshToken = d.refresh_token || gaSession.refreshToken;
  gaSession.exp = Date.now() + Number(d.expires_in || 3600) * 1000; gaSave();
  return gaSession.idToken;
}
async function adminApi(path, { method = 'GET', body } = {}) {
  if (gaSession && Date.now() - gaLastActive > GA_IDLE_MS) { gaLock('Locked after 1 hour without use. Sign in again to keep working.'); throw Object.assign(new Error('Signed out.'), { code: 'sign_in', status: 401 }); }
  const res = await fetch(`/admin/v1/${path}`, { method, headers: { Authorization: `Bearer ${await gaBearer()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = Object.assign(new Error(data.message || `Request failed (${res.status}).`), { code: data.error || `http_${res.status}`, status: res.status });
    if (res.status === 401) gaLock(data.message || 'Please sign in again.');
    throw err;
  }
  return data;
}

function gaShowGate(kind, message) {
  const g = $('#gate'); g.hidden = false; $('#app').hidden = true;
  $('#gateTitle').textContent = kind === 'denied' ? 'No publishing access' : 'Sign in to Grid Admin';
  $('#gateText').textContent = message || (kind === 'denied'
    ? 'Your account is signed in but cannot publish books. Ask the owner to switch on publishing for you under Admins.'
    : 'Book Studio uses your Grid Admin account. Sign in there, then come back to this page.');
  $('#gateSignIn').hidden = kind === 'denied' && !!gaMe && gaMe.role !== 'publisher';
  $('#gateBack').hidden = !(gaMe && gaMe.role !== 'publisher');
}
function gaLock(message) { gaShowGate('sign_in', message); }

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
  gaSession = null; gaMe = null; gaClear(); location.href = '/admin/';
}

async function gaStart() {
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { const was = gaLastActive; gaLastActive = Date.now(); if (gaSession && gaLastActive - was > 30_000) gaSave(); }, { passive: true });
  setInterval(() => { if (gaSession && Date.now() - gaLastActive > GA_IDLE_MS) gaLock('Locked after 1 hour without use. Sign in again to keep working.'); }, 60_000);
  $('#gateSignIn').href = '/admin/#book-studio';
  $('#signOutBtn').onclick = gaSignOut;
  gaSession = gaLoad();
  if (gaSession?.seen) gaLastActive = gaSession.seen;
  if (!gaSession || Date.now() - gaLastActive > GA_IDLE_MS) { gaShowGate('sign_in'); return; }
  try { gaMe = await adminApi('me'); } catch (e) {
    if (e.status === 403 && e.code === 'verify_email') { gaShowGate('sign_in', 'Confirm your email address in Grid Admin first.'); return; }
    if (e.status === 403) { gaShowGate('denied', e.message); return; }
    gaShowGate('sign_in', e.code === 'sign_in' ? undefined : e.message); return;
  }
  if (!gaMe.canPublish) { gaShowGate('denied'); return; }
  $('#gate').hidden = true; $('#app').hidden = false;
  $('#whoEmail').textContent = gaMe.email; $('#backToAdmin').hidden = gaMe.role === 'publisher';
  init();
}
gaStart();
