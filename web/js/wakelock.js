// Keeps the screen on while a puzzle is being played (Screen Wake Lock API,
// which the desktop app's WebView2 also supports). After 30 minutes with no
// input the lock is let go so the display can sleep; any input takes it again.
const IDLE_MS = 30 * 60 * 1000;
let playing = false;
let lock = null;
let lastInput = Date.now();
let timer = null;

const supported = () => 'wakeLock' in navigator;
const wanted = () => playing && document.visibilityState === 'visible' && Date.now() - lastInput < IDLE_MS;

async function sync() {
  if (!supported()) return;
  if (wanted() && !lock) {
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch (e) { lock = null; /* denied, for example on low battery */ }
  } else if (!wanted() && lock) {
    const l = lock;
    lock = null;
    try { await l.release(); } catch (e) { /* already released */ }
  }
}

export function setPlaying(on) {
  playing = !!on;
  lastInput = Date.now();
  clearInterval(timer);
  timer = playing ? setInterval(sync, 60 * 1000) : null;
  sync();
}

const touch = () => { const idle = !lock; lastInput = Date.now(); if (playing && idle) sync(); };
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, touch, { passive: true, capture: true });
document.addEventListener('visibilitychange', sync);

// For tests.
export const _state = () => ({ playing, held: !!lock, lastInput });
export const _idle = (ms) => { lastInput = Date.now() - ms; return sync(); };
