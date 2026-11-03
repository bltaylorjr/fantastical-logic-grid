// Hands what a report is about from the game or a website page to the Report
// a Problem page (web/report/, report-page.js), which opens in a new tab on the
// website so the player's puzzle stays open behind it, and in the same window
// in the Windows, Android and iPhone apps (they have no tabs; Back returns).
//
// The puzzle and its picture are too big for the address, so they go through
// this browser's own storage, are picked up once by the page and removed.
// Nothing leaves the device until the player presses Submit.
//
// Screenshot. The moment Report a Problem is pressed, the screen the player
// is on is drawn into a picture here (vendor/modern-screenshot, loaded only
// now). It is handed over the same way, under its own key, because a new tab
// has to open straight away (or pop-up blockers stop it) while the picture is
// still being made: the page waits a few seconds for it (takeScreenshot). The
// page shows it attached, and the player can remove it before sending.
const KEY = 'flg.report.handoff';
const SESSION = 'flg.report.ctx';
const SHOT = 'flg.report.shot';
const SHOT_SESSION = 'flg.report.shot.session';
const FRESH_MS = 10 * 60_000;
const SHOT_MS = 6000; // longest the screenshot may take
const SHOT_SIDE = 1600; // widest it is drawn, in pixels
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ctx: { from: 'game'|'site', kind, puzzle, image, where, page, platform, version, screen }
export function handOff(ctx) {
  const tryPut = (c) => { try { localStorage.setItem(KEY, JSON.stringify({ ...c, at: Date.now() })); return true; } catch (e) { return false; } };
  // Storage full: drop the picture, then the puzzle (the page asks which one).
  return tryPut(ctx) || tryPut({ ...ctx, image: '' }) || tryPut({ ...ctx, image: '', puzzle: null });
}

// The screen as the player sees it now (the visible part only), as a JPEG
// data address, or '' if it cannot be drawn in time. Never throws.
export async function captureScreen() {
  try {
    const { domToJpeg } = await import('../vendor/modern-screenshot/modern-screenshot.js');
    const root = document.documentElement;
    const w = innerWidth;
    const h = innerHeight;
    const bg = getComputedStyle(document.body).backgroundColor;
    const draw = domToJpeg(root, {
      width: w, height: h, quality: 0.85, timeout: 3000,
      scale: Math.min(Math.max(devicePixelRatio || 1, 1), SHOT_SIDE / w),
      backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : getComputedStyle(root).backgroundColor || '#ffffff',
      // Only what is on the screen: the page moved up by how far it is scrolled.
      style: { transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: '0 0', width: `${root.scrollWidth}px`, height: `${root.scrollHeight}px` },
      filter: (n) => {
        if (!(n instanceof Element)) return true;
        // Nothing private: what the player types in a password box is left out.
        if (n instanceof HTMLInputElement && n.type === 'password') return false;
        // Videos and frames are left out: the picture would wait on them.
        if (n instanceof HTMLMediaElement || n instanceof HTMLIFrameElement) return false;
        // Hidden screens and closed dialogs are skipped, which keeps it quick.
        return typeof n.checkVisibility !== 'function' || n === root || n === document.body || n.checkVisibility();
      },
    });
    const data = await Promise.race([draw, sleep(SHOT_MS).then(() => '')]);
    return typeof data === 'string' && data.startsWith('data:image/') ? data : '';
  } catch (e) { return ''; }
}

function putShot(data) {
  try { localStorage.setItem(SHOT, JSON.stringify({ data, at: Date.now() })); } catch (e) { /* too big for storage: sent without it */ }
}

// Opens the page. inTab: the website (new tab); otherwise the same window.
export async function openReportPage(href, ctx, { inTab = true } = {}) {
  try { localStorage.removeItem(SHOT); } catch (e) { /* none */ }
  handOff(ctx);
  const url = new URL(href, document.baseURI); // baseURI: the website's game page sits in fantastical/ with <base href="../">
  url.searchParams.set('shot', '1');
  if (inTab) {
    url.searchParams.set('tab', '1');
    const w = window.open(url.href, '_blank');
    if (w) { putShot(await captureScreen()); return; }
    url.searchParams.delete('tab'); // pop-ups blocked: this window instead
  }
  // Same window: the picture is made before this page goes.
  putShot(await captureScreen());
  location.href = url.href;
}

// For the page: the screenshot made when Report a Problem was pressed, as a
// File, or null. Waits up to a few seconds while it is still being made in
// the tab behind. Kept for this tab so a reload keeps it.
export async function takeScreenshot() {
  if (new URLSearchParams(location.search).get('shot') !== '1') return null;
  // null: not handed over (yet); '': handed over but none could be made.
  const read = () => {
    try {
      const raw = localStorage.getItem(SHOT);
      if (!raw) return null;
      localStorage.removeItem(SHOT);
      const s = JSON.parse(raw);
      return s && Date.now() - (s.at || 0) < FRESH_MS ? String(s.data || '') : '';
    } catch (e) { return ''; }
  };
  const kept = () => { try { return sessionStorage.getItem(SHOT_SESSION); } catch (e) { return null; } };
  let data = read();
  if (data === null && kept() !== null) data = kept(); // this tab reloaded
  for (let waited = 0; data === null && waited < SHOT_MS + 2000; waited += 200) {
    await sleep(200);
    data = read();
  }
  try { sessionStorage.setItem(SHOT_SESSION, data || ''); } catch (e) { /* this load only */ }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], `screenshot.${m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'}`, { type: m[1] });
  } catch (e) { return null; }
}

// The player removed the screenshot: a reload must not bring it back.
export function forgetScreenshot() {
  try { sessionStorage.setItem(SHOT_SESSION, ''); } catch (e) { /* none */ }
}

// For the page: what the report is about, kept for this tab so a reload keeps it.
export function takeHandoff() {
  let ctx = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      localStorage.removeItem(KEY);
      const c = JSON.parse(raw);
      if (c && Date.now() - (c.at || 0) < FRESH_MS) ctx = c;
    }
  } catch (e) { /* none */ }
  try {
    if (ctx) sessionStorage.setItem(SESSION, JSON.stringify(ctx));
    else ctx = JSON.parse(sessionStorage.getItem(SESSION) || 'null');
  } catch (e) { /* storage off: this load only */ }
  const q = new URLSearchParams(location.search);
  ctx = ctx || {};
  if (q.get('from') === 'site' || q.get('from') === 'game') ctx.from = ctx.from || q.get('from');
  if (q.get('kind') === 'page' || q.get('kind') === 'puzzle') ctx.kind = ctx.kind || q.get('kind');
  ctx.tab = q.get('tab') === '1';
  // A website page's own address only (never another site's).
  if (ctx.page && !/^\/(?!\/)[\w\-./]*$/.test(String(ctx.page))) ctx.page = '/';
  return ctx;
}
