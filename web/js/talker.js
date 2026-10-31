// The talking face on the play screen: whoever is speaking (the narrator or a
// witness reading their clue) appears in the corner, with their lips moving in
// time with their voice (talking-face.js). It only shows pictures: what they
// say is already on the screen, so screen readers skip it, and it never takes
// clicks or taps.
//
// When their lifelike photo can't be made (switched off, the day's pictures
// used up, offline, an animal cast), their usual portrait shows instead and
// glows while they speak.
import * as ai from './ai.js';
import { findFace, createTalker, loudnessOf, rhythm } from './talking-face.js';

const HIDE_AFTER = 1400;

// box: the #talker element. on(): whether faces should show now. game():
// { puzzle, fallback(who) } for the puzzle on screen, or null.
export function initTalker(box, { on, game }) {
  const canvas = box.querySelector('canvas');
  const still = box.querySelector('.talker-still');
  const name = box.querySelector('.talker-name');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let talker = null;
  let showing = null; // who is in the frame
  let speaking = null;
  let hideTimer = 0;
  let turn = 0;
  const loudness = new WeakMap();

  function hide() {
    box.classList.remove('speaking');
    box.hidden = true;
    showing = null;
    if (talker) talker.pause();
  }

  // Shows `who`. Their photo comes once it is ready; until then (or if it never
  // comes) their usual portrait.
  async function present(who, g) {
    const mine = ++turn;
    showing = who;
    name.textContent = who === 'narrator' ? 'Narrator' : who;
    still.innerHTML = g.fallback(who) || '';
    still.hidden = false;
    canvas.hidden = true;
    box.hidden = false;
    try {
      const blob = await ai.faceImage(g.puzzle, who);
      if (mine !== turn) return;
      const face = await findFace(`${blob.size}|${who}`, blob);
      if (mine !== turn || !face) return;
      talker ||= createTalker(canvas, { reducedMotion: reduced });
      if (!(await talker.show(blob, face)) || mine !== turn) return;
      canvas.hidden = false;
      still.hidden = true;
      if (speaking) talker.speak(speaking.level);
    } catch (e) {
      // Their usual portrait stays.
      console.warn('Talking face not shown:', e.message);
    }
  }

  ai.listenToSpeech((e) => {
    if (!on()) { if (!box.hidden) hide(); return; }
    const g = game();
    if (e.done) {
      speaking = null;
      if (talker) talker.quiet();
      box.classList.remove('speaking');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HIDE_AFTER);
      return;
    }
    if (!g || !e.who) return;
    clearTimeout(hideTimer);
    let level;
    if (e.audio) {
      // The clip's loudness, measured once; quiet until it is ready.
      const { audio, blob } = e;
      let env = loudness.get(blob);
      if (!env) loudnessOf(blob).then((v) => { if (v) { loudness.set(blob, v); env = v; } }).catch(() => {});
      level = () => (env && !audio.paused ? env[Math.min(env.length - 1, Math.floor(audio.currentTime * 60))] : null);
    } else {
      level = rhythm();
    }
    speaking = { who: e.who, level };
    box.classList.add('speaking');
    if (showing !== e.who) present(e.who, g);
    else { box.hidden = false; if (talker && !canvas.hidden) { talker.resume(); talker.speak(level); } }
  });

  return { hide: () => { turn++; hide(); } };
}
