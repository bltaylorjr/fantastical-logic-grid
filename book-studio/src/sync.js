/* ---------- Sync and the Book Studio app (Grid Admin build only) ----------
   Every book is kept on the signed-in account (server/src/studio-sync.js), so
   it opens on any computer, phone or the Book Studio app with the same email:
   - a change is saved in this browser first (core.js markDirty), then sent to
     the account a few seconds later (syChanged → syPush);
   - each book has an id (S.syncId) and the account counts its saves (rev).
     A save says which rev it started from, so if another device saved first
     nothing is overwritten: this device's version becomes a copy;
   - when Book Studio opens or comes back into view it asks for the list and
     opens a newer version from another device, unless this one has changes
     of its own still to send;
   - with no connection the book keeps saving here and syncs when it is back.
   It also installs Book Studio as an app (manifest.webmanifest, sw.js, the
   Windows app in desktop-book-studio/) and opens offline once installed. */
const SY_REVS = 'bs-sync-revs', SY_SIGS = 'bs-sync-sigs', SY_ME = 'bs-me', SY_OWNER = 'bs-owner';
const SY_WAIT_MS = 6000, SY_CHECK_GAP_MS = 45_000;
const SY_WINDOWS = 'https://github.com/bltaylorjr/fantastical-logic-grid/releases/download/book-studio-desktop/Book-Studio-Setup.exe';
let syTimer = null, syBusy = false, syAgain = false, syList = [], syListAt = 0, syStopped = '', syReady = false, syOffline = false;

const syRead = (key) => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; } };
const syWrite = (key, id, v) => { try { const m = syRead(key); if (v == null) delete m[id]; else m[id] = v; localStorage.setItem(key, JSON.stringify(m)); } catch (e) { /* private window */ } };
const syRev = (id) => Number(syRead(SY_REVS)[id]) || 0;
const sySig = (id) => syRead(SY_SIGS)[id] || '';
// A short fingerprint of a book's saved JSON, to tell whether it changed since it was last synced.
function sySign(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return text.length + ':' + (h >>> 0).toString(36);
}
const syNewId = () => 'bs-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : uid() + uid());
function syEnsureId() { if (!/^bs-[\w-]{6,40}$/.test(S.syncId || '')) S.syncId = syNewId(); return S.syncId; }
const syInApp = () => !!window.__FLG_BOOK_STUDIO_DESKTOP__ || matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
function syDevice() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Browser';
  return window.__FLG_BOOK_STUDIO_DESKTOP__ ? `${os} app` : os;
}
const syNetDown = (e) => e instanceof TypeError || e?.code === 'offline' || !navigator.onLine;
const syTime = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function syShow(text, kind = '') {
  const el = $('#sbSync'); el.hidden = !text; el.textContent = text; el.dataset.kind = kind;
  $('#syStatus').textContent = text;
}
function syCurrent() { syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState(); return JSON.stringify(S); }
const syPending = (snap) => !!S.syncId && sySign(snap) !== sySig(S.syncId);

/* core.js calls this after every save in this browser, with the saved JSON. */
function syChanged(snap) {
  if (!syReady) return;
  if (!S.syncId) { syEnsureId(); markDirty(); return; } // saved again with its id
  if (!syPending(snap)) return;
  if (syStopped === sySign(snap)) return; // refused as it is (too big): wait for a change
  syShow(syOffline ? 'Offline: saved here, syncs when you are back online' : 'Changes not synced yet', 'wait');
  clearTimeout(syTimer); syTimer = setTimeout(syPush, SY_WAIT_MS);
}

async function syPush() {
  clearTimeout(syTimer);
  if (!syReady || !gaMe) return;
  if (syBusy) { syAgain = true; return; }
  syEnsureId();
  const snap = syCurrent();
  if (!syPending(snap)) { syShowSynced(); return; }
  const id = S.syncId, sig = sySign(snap);
  syBusy = true; syShow('Syncing…', 'wait');
  try {
    const r = await adminApi(`studio/books/${id}`, { method: 'POST', body: { project: JSON.parse(snap), baseRev: syRev(id), device: syDevice() } });
    syWrite(SY_REVS, id, r.book.rev); syWrite(SY_SIGS, id, sig);
    syOffline = false; syStopped = '';
    syRemember(r.book);
    syShowSynced();
  } catch (e) {
    if (e.code === 'changed') { syBusy = false; await syKeepAsCopy(); return; }
    if (syNetDown(e)) { syOffline = true; syShow('Offline: saved here, syncs when you are back online', 'off'); }
    else if (e.status === 413) { syStopped = sig; syShow(e.message, 'bad'); toast(e.message, 8000); }
    else if (e.status === 403) { syShow('Not synced: this account has no publishing access.', 'bad'); gaShowGate('denied', e.message); }
    else if (e.status !== 401) syShow('Not synced yet. Trying again soon.', 'bad');
    if (!syStopped && e.status !== 401 && e.status !== 403) syTimer = setTimeout(syPush, syOffline ? 60_000 : 30_000);
  } finally { syBusy = false; }
  if (syAgain) { syAgain = false; syPush(); }
}

// Another device saved this book first: keep both. This device's version
// becomes its own book, named so the two are easy to tell apart.
async function syKeepAsCopy() {
  const was = S.meta.title || 'Untitled';
  S.syncId = syNewId();
  S.meta.title = `${was} (${syDevice()} copy)`.slice(0, 200);
  fillMetaForm();
  toast(`"${was}" was also changed on another device. Your changes here are kept as a separate book, "${S.meta.title}". Both are under Project.`, 10000);
  markDirty();
  await syPush();
}

function syShowSynced() { syShow(`Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'ok'); }
function syRemember(b) {
  const i = syList.findIndex(x => x.id === b.id);
  if (i >= 0) syList[i] = { ...syList[i], ...b }; else syList.unshift(b);
  syRenderList();
}

/* The account's books, and a newer version of this one from another device. */
async function syCheck({ force = false } = {}) {
  if (!syReady || !gaMe || syBusy) return;
  if (!force && Date.now() - syListAt < SY_CHECK_GAP_MS) return;
  syListAt = Date.now();
  let list;
  try { list = (await adminApi('studio/books')).books; } catch (e) {
    if (syNetDown(e)) { syOffline = true; syShow('Offline: saved here, syncs when you are back online', 'off'); }
    return;
  }
  if (syOffline) { syOffline = false; await gaRecheck(); }
  syList = list; syRenderList();
  const snap = syCurrent();
  const mine = S.syncId && list.find(b => b.id === S.syncId);
  const pending = syPending(snap);
  if (mine && mine.rev > syRev(S.syncId) && !pending) { await syOpen(mine.id, { why: `Updated with the changes from ${mine.device || 'another device'}` }); return; }
  if (S.syncId && !mine && syRev(S.syncId) > 0) {
    // Deleted from the account on another device: it stays here, and syncs again
    // as a new book only if it is changed.
    syWrite(SY_REVS, S.syncId, null); syWrite(SY_SIGS, S.syncId, sySign(snap));
    syShow('This book was removed from your account on another device. It is still here; edit it to sync it again.', 'wait');
    return;
  }
  if (pending) syPush(); else syShowSynced();
}

async function syOpen(id, { why } = {}) {
  if (syPending(syCurrent())) await syPush();
  busy('Opening the book from your account');
  try {
    const r = await adminApi(`studio/books/${id}`);
    const project = { ...r.project, syncId: id };
    syWrite(SY_REVS, id, r.book.rev);
    // Wait for the cover to load before taking the fingerprint: read too early,
    // the canvas still holds the old cover, so the book looks changed and is
    // sent straight back, and the other device's next save becomes a copy.
    await loadProject(project);
    syWrite(SY_SIGS, id, sySign(syCurrent()));
    syRemember(r.book);
    syShowSynced();
    toast(why || `Opened "${r.book.title}"`, 5000);
  } catch (e) {
    toast(syNetDown(e) ? 'You are offline. Books from your account open when you are back online.' : (e.message || 'That book did not open.'), 6000);
  } finally { busy(false); }
}

async function syDelete(id) {
  const b = syList.find(x => x.id === id);
  const here = id === S.syncId;
  if (!confirm(`Remove "${b?.title || 'this book'}" from your account? It disappears from your other devices.${here ? ' It stays open on this device.' : ''}`)) return;
  try {
    await adminApi(`studio/books/${id}/delete`, { method: 'POST', body: {} });
    syList = syList.filter(x => x.id !== id); syRenderList();
    syWrite(SY_REVS, id, null);
    if (here) { syWrite(SY_SIGS, id, sySign(syCurrent())); syShow('Removed from your account. Edit it to sync it again.', 'wait'); } else syWrite(SY_SIGS, id, null);
    toast('Removed from your account.');
  } catch (e) { toast(syNetDown(e) ? 'You are offline. Try again when you are back online.' : (e.message || 'That did not work.'), 6000); }
}

function syRenderList() {
  const ul = $('#syList'); if (!ul) return;
  if (!syList.length) { ul.innerHTML = '<li class="hint">No books on your account yet. This one is added as soon as you change it.</li>'; return; }
  ul.innerHTML = syList.map(b => `<li class="sy-item${b.id === S.syncId ? ' here' : ''}">
    <div class="sy-meta"><b>${esc(b.title)}</b><small class="hint">${b.id === S.syncId ? 'Open now · ' : ''}Saved ${esc(syTime(b.updatedAt))}${b.device ? ' on ' + esc(b.device) : ''} · ${(b.size / 1e6).toFixed(b.size < 1e6 ? 2 : 1)} MB</small></div>
    <span class="sy-acts">${b.id === S.syncId ? '' : `<button class="btn" type="button" data-sy-open="${esc(b.id)}">Open</button>`}<button class="btn ghost" type="button" data-sy-del="${esc(b.id)}">Remove</button></span>
  </li>`).join('');
  for (const el of ul.querySelectorAll('[data-sy-open]')) el.onclick = () => { closeDlg('#dlgProject'); syOpen(el.dataset.syOpen); };
  for (const el of ul.querySelectorAll('[data-sy-del]')) el.onclick = () => syDelete(el.dataset.syDel);
}

/* main.js calls this once the studio is open. */
async function syStart({ restored }) {
  $('#syBox').hidden = false;
  // One browser, two people: the book open here belongs to whoever last
  // signed in. It is set aside for them (and comes back when they sign in
  // again), so it is never synced to someone else's account.
  let owner = ''; try { owner = localStorage.getItem(SY_OWNER) || ''; } catch (e) { /* private window */ }
  if (restored && owner && owner !== gaMe.email) {
    await idbPut('current:' + owner, JSON.parse(syCurrent()));
    const theirs = await idbGet('current:' + gaMe.email);
    if (theirs && theirs.pages && theirs.pages.length) loadProject(theirs);
    else { loadProject(blankProject()); restored = false; }
  }
  try { localStorage.setItem(SY_OWNER, gaMe.email); } catch (e) { /* private window */ }
  $('#syNow').onclick = async () => { await syPush(); await syCheck({ force: true }); };
  $('#projMenuBtn').addEventListener('click', () => { syRenderList(); syCheck(); });
  addEventListener('online', () => { syOffline = false; syCheck({ force: true }); });
  addEventListener('offline', () => { syOffline = true; syShow('Offline: saved here, syncs when you are back online', 'off'); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (syPending(syCurrent())) syPush(); } else syCheck();
  });
  addEventListener('focus', () => syCheck());
  // A book from before sync gets its id now, kept in this browser too.
  const fresh = !S.syncId;
  syEnsureId();
  if (fresh) await idbPut('current', JSON.parse(JSON.stringify(S)));
  syReady = true;
  if (!restored) {
    // A first visit on this device: the sample book is not synced unless it is
    // changed, and the newest book on the account opens instead.
    syWrite(SY_SIGS, S.syncId, sySign(syCurrent()));
    await syCheck({ force: true });
    if (syList.length) await syOpen(syList[0].id, { why: `Opened "${syList[0].title}" from your account` });
    return;
  }
  await syCheck({ force: true });
}

/* ---------- Signing in with no connection ---------- */
// After a normal sign-in the account's access is remembered on this device,
// so an installed Book Studio opens offline (for someone who ticked "Keep me
// signed in"). The server still checks every sync and export.
function gaRememberMe() { try { localStorage.setItem(SY_ME, JSON.stringify({ email: gaMe.email, role: gaMe.role, canPublish: !!gaMe.canPublish })); } catch (e) { /* private window */ } }
function gaOfflineMe() {
  try { const me = JSON.parse(localStorage.getItem(SY_ME) || 'null'); return me && me.canPublish && gaSession?.email && me.email === gaSession.email ? me : null; } catch (e) { return null; }
}
// Back online after opening offline: ask the server again.
async function gaRecheck() {
  try {
    const me = await adminApi('me');
    gaMe = me; gaRememberMe();
    if (!me.canPublish) gaShowGate('denied');
  } catch (e) { if (e.status === 403 || e.code === 'not_admin') gaShowGate('denied', e.message); }
}

/* ---------- Get the app ---------- */
let syInstallPrompt = null;
function syAppWire() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); syInstallPrompt = e; $('#appInstall').hidden = false; $('#appInstallNote').hidden = true; });
  addEventListener('appinstalled', () => { syInstallPrompt = null; $('#appInstall').hidden = true; toast('Book Studio is installed. Open it from your apps.', 6000); });
  $('#getApp').hidden = syInApp();
  $('#getApp').onclick = () => {
    const ua = navigator.userAgent, ios = /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    $('#appWin').hidden = !/Windows/.test(ua);
    $('#appIos').hidden = !ios;
    $('#appSafari').hidden = ios || !(/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Edg|Firefox/.test(ua));
    $('#appInstall').hidden = !syInstallPrompt;
    $('#appInstallNote').hidden = !!syInstallPrompt || ios || !$('#appSafari').hidden;
    openDlg('#dlgApp');
  };
  $('#appInstall').onclick = async () => {
    if (!syInstallPrompt) return;
    syInstallPrompt.prompt();
    await syInstallPrompt.userChoice.catch(() => null);
    syInstallPrompt = null; $('#appInstall').hidden = true; closeDlg('#dlgApp');
  };
  $('#appWinLink').href = SY_WINDOWS;
  for (const b of $$('#dlgApp [data-close]')) b.onclick = () => closeDlg('#dlgApp');
}
syAppWire();
