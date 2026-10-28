// Story beat director (EXPERIMENTAL, off unless switched on on this device).
//
// While the player solves, it shows short story moments (engine/src/beats.js)
// under the scene as grid sections are finished, and reads them aloud when
// read-aloud is on. Later it will also tell the scene animation what to do.
//
// Switch on for this device: open the game with ?beats=1 in the address.
// Switch off again: ?beats=0. Players never see it unless they do this.
// Silent mode always hides it.
import { storyBeats } from '../engine/index.js';
import * as store from './store.js';

const KEY = 'storyBeats';

try {
  const flag = new URLSearchParams(location.search).get('beats');
  if (flag === '1') store.setLocal(KEY, true);
  else if (flag === '0') store.setLocal(KEY, undefined);
} catch (e) { /* no address or storage: stays off */ }

export const enabled = () => { try { return store.getLocal(KEY) === true; } catch (e) { return false; } };

let beats = [];
let shown = -1;      // sections done when the last beat was checked (-1 = not yet)
let box = null;
let speakFn = null;

// A new or reopened puzzle. `speak(text)` reads a beat aloud (or does nothing).
export function start(puzzle, { silent = false, speak = null } = {}) {
  beats = [];
  shown = -1;
  speakFn = speak;
  if (box) { box.remove(); box = null; }
  if (!enabled() || silent) return;
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
