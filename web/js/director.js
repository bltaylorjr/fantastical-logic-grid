// Story beat director.
//
// While the player solves, it shows short story moments (engine/src/beats.js)
// under the scene as grid sections are finished, and reads them aloud when
// read-aloud is on.
//
// On for everyone; Settings > "Story moments" turns it off (settings.storyBeats).
// ?beats=0 or ?beats=1 in the address switches it for testing. Silent mode
// always hides it.
import { storyBeats } from '../engine/index.js';
import * as store from './store.js';

const KEY = 'storyBeats';

let override = null;
try {
  const flag = new URLSearchParams(location.search).get('beats');
  if (flag === '1' || flag === '0') store.setLocal(KEY, flag === '1');
  const v = store.getLocal(KEY);
  if (v === true || v === false) override = v;
} catch (e) { /* no address or storage */ }

export const enabled = (settings) => (override !== null ? override : !settings || settings.storyBeats !== false);

let beats = [];
let shown = -1;      // sections done when the last beat was checked (-1 = not yet)
let box = null;
let speakFn = null;

// A new or reopened puzzle. `speak(text)` reads a beat aloud (or does nothing).
export function start(puzzle, { on = true, speak = null } = {}) {
  beats = [];
  shown = -1;
  speakFn = speak;
  if (box) { box.remove(); box = null; }
  if (!on) return;
  try { beats = storyBeats(puzzle); } catch (e) { console.warn('Story beats not made:', e.message); return; }
  const scene = document.getElementById('scene');
  if (!scene || !beats.length) return;
  box = document.createElement('div');
  box.id = 'story-beat';
  box.className = 'story-beat';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.hidden = true;
  scene.after(box);
}

// Called each time the grid changes, with the number of finished sections.
// The first call after start() only notes where a resumed puzzle is, so beats
// the player already passed are not replayed.
export function progress(done) {
  if (!box) return;
  if (shown < 0) {
    shown = done;
    const last = beats.filter((b) => b.after <= done).at(-1);
    if (last) show(last, false);
    return;
  }
  if (done <= shown) return; // undoing never replays a beat
  const fresh = beats.filter((b) => b.after > shown && b.after <= done).at(-1);
  shown = done;
  if (fresh) show(fresh, true);
}

function show(beat, isNew) {
  box.hidden = false;
  box.textContent = beat.text;
  box.dataset.stage = beat.stage;
  if (isNew) {
    box.classList.remove('new');
    void box.offsetWidth;
    box.classList.add('new');
    if (speakFn) try { speakFn(beat.text); } catch (e) { /* no voice */ }
  }
}
