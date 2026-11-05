// Runs fn every `ms` while the game is on screen. While it is hidden (another
// tab, minimised, the phone locked) nothing runs, so the device can sleep and
// no data is used; a run that came due meanwhile happens on coming back.
export function whileVisible(fn, ms) {
  let due = false;
  setInterval(() => { if (document.hidden) due = true; else fn(); }, ms);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && due) { due = false; fn(); } });
}
