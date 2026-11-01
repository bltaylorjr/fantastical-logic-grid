// Hands what a report is about from the game or a website page to the Report
// a Problem page (web/report/, report-page.js), which opens in a new tab on the
// website so the player's puzzle stays open behind it, and in the same window
// in the Windows, Android and iPhone apps (they have no tabs; Back returns).
//
// The puzzle and its picture are too big for the address, so they go through
// this browser's own storage, are picked up once by the page and removed.
// Nothing leaves the device until the player presses Submit.
const KEY = 'flg.report.handoff';
const SESSION = 'flg.report.ctx';
const FRESH_MS = 10 * 60_000;

// ctx: { from: 'game'|'site', kind, puzzle, image, where, page, platform, version, screen }
export function handOff(ctx) {
  const tryPut = (c) => { try { localStorage.setItem(KEY, JSON.stringify({ ...c, at: Date.now() })); return true; } catch (e) { return false; } };
  // Storage full: drop the picture, then the puzzle (the page asks which one).
  return tryPut(ctx) || tryPut({ ...ctx, image: '' }) || tryPut({ ...ctx, image: '', puzzle: null });
}

// Opens the page. inTab: the website (new tab); otherwise the same window.
export function openReportPage(href, ctx, { inTab = true } = {}) {
  handOff(ctx);
  const url = new URL(href, location.href);
  if (inTab) {
    url.searchParams.set('tab', '1');
    const w = window.open(url.href, '_blank');
    if (w) return;
    url.searchParams.delete('tab'); // pop-ups blocked: this window instead
  }
  location.href = url.href;
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
  if (ctx.page && !/^\/[\w\-./]*$/.test(String(ctx.page))) ctx.page = '/';
  return ctx;
}
