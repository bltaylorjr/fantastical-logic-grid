// Story beat director.
//
// While the player solves, it shows short story moments (engine/src/beats.js)
// under the scene as grid sections are finished, and reads them aloud when
// read-aloud is on, with a picture beside it when the team has uploaded one
// for the theme (admin dashboard > Story beat pictures, server/src/story-images.js).
// Later it will also tell the scene animation what to do.
//
// On for every player unless the admin dashboard switches it off (Play >
// Story beats, server/src/settings.js story_beats_enabled). Silent mode
// always hides it. For testing, ?beats=0 in the address turns it off on this
// device and ?beats=1 turns it back on.
import { storyBeats } from '../engine/beats.js';
import { feature } from './remote-config.js';
import { CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';

const KEY = 'storyBeatsOff';

try {
  const flag = new URLSearchParams(location.search).get('beats');
  if (flag === '0') store.setLocal(KEY, true);
  else if (flag === '1') store.setLocal(KEY, undefined);
} catch (e) { /* no address or storage: stays on */ }

const offHere = () => { try { return store.getLocal(KEY) === true; } catch (e) { return false; } };
export const enabled = () => feature('storyBeats') && !offHere();

// Story beat pictures: the list is kept on this device so beats still find
// their pictures offline (the pictures themselves come from the browser cache).
const PICS_KEY = 'beatImages';
const PICS_EVERY = 10 * 60_000;
let pics = (() => { try { return store.getLocal(PICS_KEY) || null; } catch (e) { return null; } })();
let picsLoading = null;
const blobs = new Map(); // picture id -> object URL, for this page load

function loadPictures() {
  if (!CLOUD_URL || picsLoading || (pics && Date.now() - (pics.at || 0) < PICS_EVERY)) return picsLoading;
  picsLoading = fetch(`${CLOUD_URL}/v1/beat-images`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d && Array.isArray(d.images)) { pics = { at: Date.now(), images: d.images }; try { store.setLocal(PICS_KEY, pics); } catch (e) { /* storage full */ } }
  }).catch(() => { /* offline: keep the last list */ }).finally(() => { picsLoading = null; });
  return picsLoading;
}

// The picture for a beat: the theme's own for this stage, then the theme's
// for any stage, then the every-theme ones the same way. The same puzzle
// always gets the same picture.
export function pictureFor(images, puzzle, stage) {
  if (!images || !images.length || !puzzle) return null;
  const theme = puzzle.theme && puzzle.theme.id;
  const tiers = [[theme, stage], [theme, 'any'], ['default', stage], ['default', 'any']];
  for (const [t, s] of tiers) {
    const list = images.filter((i) => i.theme === t && i.stage === s);
    if (list.length) {
      let n = 0;
      for (const c of `${puzzle.story && puzzle.story.id}|${stage}`) n = (n * 31 + c.charCodeAt(0)) >>> 0;
      return list[n % list.length];
    }
  }
  return null;
}

async function pictureUrl(id) {
  if (blobs.has(id)) return blobs.get(id);
  const r = await fetch(`${CLOUD_URL}/v1/beat-images/${id}`);
  if (!r.ok) throw new Error('no picture');
  const url = URL.createObjectURL(await r.blob());
  blobs.set(id, url);
  return url;
}

let puzzleNow = null;
let beats = [];
let shown = -1;      // sections done when the last beat was checked (-1 = not yet)
let box = null;
let speakFn = null;

// A new or reopened puzzle. `speak(text)` reads a beat aloud (or does nothing).
export function start(puzzle, { silent = false, speak = null } = {}) {
  beats = [];
  shown = -1;
  speakFn = speak;
  puzzleNow = puzzle;
  if (box) { box.remove(); box = null; }
  if (!enabled() || silent) return;
  try { beats = storyBeats(puzzle); } catch (e) { console.warn('Story beats not made:', e.message); return; }
  loadPictures();
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
  box.textContent = '';
  box.classList.remove('has-pic');
  const text = document.createElement('p');
  text.className = 'story-beat-text';
  text.textContent = beat.text;
  box.append(text);
  box.dataset.stage = beat.stage;
  const pic = pictureFor(pics && pics.images, puzzleNow, beat.stage);
  if (pic) {
    const mine = box;
    pictureUrl(pic.id).then((url) => {
      if (box !== mine || box.dataset.stage !== beat.stage || box.querySelector('img')) return;
      const img = document.createElement('img');
      img.className = 'story-beat-pic';
      img.alt = pic.alt || '';
      img.src = url;
      if (pic.width && pic.height) { img.width = pic.width; img.height = pic.height; }
      box.prepend(img);
      box.classList.add('has-pic');
    }).catch(() => { /* offline or removed: text only */ });
  }
  if (isNew) {
    box.classList.remove('new');
    void box.offsetWidth;
    box.classList.add('new');
    if (speakFn) try { speakFn(beat.text); } catch (e) { /* no voice */ }
  }
}
