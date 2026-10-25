// Pull down to refresh on touch screens. It matters most in the home-screen
// app, which has no browser reload button. The pull only starts from the very
// top of the page, never inside the areas passed in `ignore` (the puzzle grid)
// or a form field, menu or open dialog. Before reloading it awaits
// `beforeReload` (the game saves progress there; returning false cancels the
// refresh); `reload` replaces the plain
// page reload (the game uses it to apply a waiting update).
//
// The admin dashboard has its own copy in admin/pull-refresh.js; keep the two
// the same (scripts/e2e-pull-refresh.cjs checks they match).

const THRESHOLD = 72; // px of finger travel that triggers a refresh
const MAX = 110;

export function initPullRefresh({ ignore = [], beforeReload = async () => {}, reload = () => location.reload() } = {}) {
  if (typeof window === 'undefined' || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) return null;
  // The browser's own pull-to-refresh would fight this one (and would reload
  // without saving), so it is switched off while ours is on.
  document.documentElement.style.overscrollBehaviorY = 'contain';

  const el = document.createElement('div');
  el.className = 'ptr';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';
  const live = document.createElement('div');
  live.className = 'ptr-live';
  live.setAttribute('role', 'status');
  document.body.append(el, live);

  const blocked = (target) => {
    if (!(target instanceof Element)) return true;
    if (document.querySelector('dialog[open]')) return true;
    if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role=menu], [role=grid], .ptr-ignore')) return true;
    if (ignore.some((sel) => target.closest(sel))) return true;
    // Inside a box that has its own scroll, only pull when that box is at its top.
    for (let n = target; n && n !== document.body; n = n.parentElement) if (n.scrollTop > 0) return true;
    return false;
  };
  const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

  let startY = 0;
  let startX = 0;
  let pull = 0;
  let tracking = false; // a touch started where a pull may begin
  let pulling = false; // the touch is moving down and the indicator shows
  let busy = false;

  const show = (d) => {
    const y = Math.min(d, MAX);
    el.style.transform = `translate(-50%, ${y - 48}px) rotate(${Math.round(y * 3)}deg)`;
    el.style.opacity = String(Math.min(1, y / THRESHOLD));
    el.classList.toggle('ready', d >= THRESHOLD);
  };
  const hide = () => { el.classList.remove('ready', 'spin'); el.style.transform = ''; el.style.opacity = ''; };

  document.addEventListener('touchstart', (e) => {
    tracking = false;
    pulling = false;
    if (busy || e.touches.length !== 1 || !atTop() || blocked(e.target)) return;
    tracking = true;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    pull = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    if (e.touches.length !== 1) { tracking = false; pulling = false; hide(); return; }
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    if (!pulling) {
      // Upward or sideways swipes are ordinary scrolling, not a pull.
      if (dy < 0 || Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 8 || dy < -8) tracking = false; return; }
      if (dy < 8 || !atTop()) return;
      pulling = true;
    }
    if (e.cancelable) e.preventDefault();
    pull = Math.max(0, dy * 0.6);
    show(pull);
  }, { passive: false });

  const end = async () => {
    if (!tracking) return;
    tracking = false;
    if (!pulling) return;
    pulling = false;
    if (pull < THRESHOLD) { hide(); return; }
    busy = true;
    el.classList.add('spin');
    el.style.transform = 'translate(-50%, 24px)';
    live.textContent = 'Refreshing…';
    let go = true;
    try { go = (await beforeReload()) !== false; } catch (err) { /* reload anyway: saving is best effort */ }
    if (!go) { busy = false; live.textContent = ''; hide(); return; }
    reload();
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { tracking = false; pulling = false; hide(); });
  return { element: el };
}
