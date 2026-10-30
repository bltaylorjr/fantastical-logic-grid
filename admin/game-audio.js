// Sound effects and optional theme music, synthesized with Web Audio so they
// work offline. Every cue has a visual equivalent in the app; sound is never
// the only signal. Nothing plays until the player has interacted with the page.

let ctx = null;
let sfxGain = null;
let musicGain = null;
let music = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    sfxGain = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain.connect(ctx.destination);
    musicGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolumes({ sfx = 0.6, music: m = 0.4 } = {}) {
  if (!audio()) return;
  sfxGain.gain.value = sfx * 0.35;
  musicGain.gain.setTargetAtTime(m * 0.12, ctx.currentTime, 0.3);
}

function tone(freq, start, dur, { type = 'sine', vol = 1, slideTo = null, out = sfxGain } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.05);
}

function noise(start, dur, { from = 400, to = 3000, vol = 0.5 } = {}) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, start);
  f.frequency.exponentialRampToValueAtTime(to, start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(sfxGain);
  src.start(start);
}

// A soft mallet note (marimba-like): a sine with a quickly fading overtone.
function mallet(freq, start, vol = 0.6, dur = 0.5) {
  tone(freq, start, dur, { vol });
  tone(freq * 4, start, dur * 0.25, { vol: vol * 0.25 });
}
// A pencil stroke: short bursts of high, filtered noise.
function pencil(start, strokes = 2) {
  for (let i = 0; i < strokes; i++) noise(start + i * 0.07, 0.06, { from: 3500, to: 5500, vol: 0.35 });
}

// kind: X, O, clear, tick, hint, whoosh, error, ok, section, solve, reveal
export function play(kind) {
  if (!audio()) return;
  const t = ctx.currentTime + 0.01;
  switch (kind) {
    case 'X': pencil(t, 2); break;
    case 'O': pencil(t, 1); mallet(784, t + 0.03, 0.45, 0.4); break;
    case 'clear': noise(t, 0.12, { from: 1500, to: 800, vol: 0.25 }); break;
    case 'tick': noise(t, 0.18, { from: 900, to: 2500, vol: 0.3 }); break;
    case 'hint': mallet(660, t, 0.4); mallet(990, t + 0.1, 0.35); break;
    case 'whoosh': noise(t, 0.4, { from: 250, to: 3200, vol: 0.55 }); break;
    case 'error': mallet(196, t, 0.5, 0.35); mallet(185, t + 0.12, 0.45, 0.4); break;
    case 'ok': mallet(698, t, 0.4); mallet(1047, t + 0.09, 0.35); break;
    case 'section': [523, 659, 784].forEach((f, i) => mallet(f, t + i * 0.08, 0.45, 0.6)); break;
    case 'solve': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => mallet(f, t + i * 0.12, 0.5, i === 5 ? 1.4 : 0.5)); break;
    case 'reveal': noise(t, 0.6, { from: 2000, to: 200, vol: 0.4 }); break;
    default: mallet(600, t, 0.3, 0.2);
  }
}

// ---------------------------------------------------------------------------
// Ambient music, made to help players relax and concentrate: long, soft chord
// pads that fade slowly from one chord to the next, a quiet low drone, and an
// occasional gentle chime that echoes away. No beat, no sharp attacks and no
// busy melody, so it can loop for hours without getting tiring. Each theme
// has its own key, mode and pace. As the grid fills (setMood 0..1) the pads
// open up a little and the chimes come slightly more often; it never speeds up.
// ---------------------------------------------------------------------------
// root: Hz of the pad's lowest chord note. scale: semitones of the mode.
// prog: scale degrees of the chord roots, one per chord. chord: seconds each
// chord is held. chime: chance of a chime every few seconds. bright: Hz the
// pad's soft filter starts at.
export const MOODS = {
  mystery: { root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 5, 3], chord: 12, chime: 0.3, bright: 620 },
  action: { root: 110, scale: [0, 3, 5, 7, 10], prog: [0, 3, 1, 2], chord: 10, chime: 0.4, bright: 700 },
  adventure: { root: 130.81, scale: [0, 2, 4, 7, 9], prog: [0, 3, 4, 2], chord: 11, chime: 0.38, bright: 700 },
  holiday: { root: 174.61, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 3, 5, 4], chord: 11, chime: 0.4, bright: 680 },
  occasion: { root: 196, scale: [0, 2, 4, 7, 9], prog: [0, 3, 4, 1], chord: 11, chime: 0.38, bright: 650 },
  fantasy: { root: 146.83, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 1, 5, 4], chord: 13, chime: 0.35, bright: 640 },
  scifi: { root: 98, scale: [0, 2, 3, 7, 8], prog: [0, 2, 4, 3], chord: 14, chime: 0.3, bright: 600 },
  sports: { root: 130.81, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], chord: 10, chime: 0.4, bright: 700 },
  cooking: { root: 164.81, scale: [0, 2, 4, 7, 9], prog: [0, 2, 3, 4], chord: 11, chime: 0.38, bright: 680 },
  pets: { root: 196, scale: [0, 2, 4, 7, 9], prog: [0, 3, 1, 4], chord: 11, chime: 0.4, bright: 650 },
  town: { root: 174.61, scale: [0, 2, 4, 5, 7, 9], prog: [0, 3, 5, 4], chord: 11, chime: 0.36, bright: 660 },
  parks: { root: 130.81, scale: [0, 2, 4, 7, 9], prog: [0, 4, 3, 2], chord: 13, chime: 0.35, bright: 640 },
  travel: { root: 196, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 5, 3, 4], chord: 12, chime: 0.36, bright: 650 },
  wonders: { root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 6, 3, 4], chord: 14, chime: 0.3, bright: 620 },
  music: { root: 164.81, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 1, 4], chord: 11, chime: 0.4, bright: 660 },
  nautical: { root: 130.81, scale: [0, 2, 4, 5, 7, 9], prog: [0, 3, 4, 2], chord: 13, chime: 0.34, bright: 640 },
  farm: { root: 196, scale: [0, 2, 4, 7, 9], prog: [0, 3, 4, 1], chord: 11, chime: 0.38, bright: 650 },
  science: { root: 164.81, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 1, 4, 5], chord: 13, chime: 0.34, bright: 640 },
  math: { root: 146.83, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], chord: 11, chime: 0.38, bright: 660 },
  biology: { root: 196, scale: [0, 2, 4, 7, 9], prog: [0, 3, 4, 2], chord: 12, chime: 0.36, bright: 650 },
  chemistry: { root: 174.61, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 2, 4, 3], chord: 13, chime: 0.34, bright: 640 },
  astronomy: { root: 155.56, scale: [0, 2, 4, 7, 9, 11], prog: [0, 4, 5, 3], chord: 14, chime: 0.45, bright: 520 },
  paradox: { root: 130.81, scale: [0, 2, 4, 6, 8, 10], prog: [0, 1, 5, 2], chord: 14, chime: 0.3, bright: 600 },
};

// A soft swell: rises over `attack`, holds, then fades over `release`.
function swell(freq, start, hold, { attack = 3, release = 4, vol = 0.07, type = 'sine', detune = 0, out }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(vol, start + attack);
  g.gain.setValueAtTime(vol, start + Math.max(attack, hold));
  g.gain.linearRampToValueAtTime(0.0001, start + Math.max(attack, hold) + release);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + Math.max(attack, hold) + release + 0.1);
}

export function startMusic(themeId) {
  if (!audio()) return;
  stopMusic();
  const m = MOODS[themeId] || MOODS.mystery;
  const now = ctx.currentTime;
  // out: fades the whole piece in and out, so starting and stopping never clicks.
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.linearRampToValueAtTime(1, now + 4);
  out.connect(musicGain);
  // space: two soft echoes that give the sound a calm, roomy feel.
  const space = ctx.createGain();
  space.gain.value = 0.32;
  space.connect(out);
  for (const [sec, pan] of [[0.83, -0.5], [1.27, 0.5]]) {
    const d = ctx.createDelay(2), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    d.delayTime.value = sec;
    fb.gain.value = 0.42;
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    space.connect(d);
    d.connect(lp).connect(fb).connect(d);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; lp.connect(p).connect(out); } else lp.connect(out);
  }
  // filter: a warm low-pass on the pads, with a very slow drift for movement.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = m.bright;
  filter.Q.value = 0.5;
  filter.connect(out);
  filter.connect(space);
  const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.05;
  lfoDepth.gain.value = 110;
  lfo.connect(lfoDepth).connect(filter.frequency);
  lfo.start(now);
  // chimes: brighter than the pads but still rounded off.
  const chimes = ctx.createBiquadFilter();
  chimes.type = 'lowpass';
  chimes.frequency.value = 1800;
  chimes.connect(out);
  chimes.connect(space);
  const drone = ctx.createOscillator(), droneGain = ctx.createGain();
  drone.frequency.value = m.root / 2;
  droneGain.gain.setValueAtTime(0.0001, now);
  droneGain.gain.linearRampToValueAtTime(0.035, now + 6);
  drone.connect(droneGain).connect(filter);
  drone.start(now);

  const n = m.scale.length;
  const note = (deg, oct = 0) => m.root * 2 ** ((m.scale[((deg % n) + n) % n] + 12 * (oct + Math.floor(deg / n))) / 12);
  const state = { m, filter, out, extras: [lfo, drone], chord: 0, mood: 0, timer: null, nextChord: now + 0.1, nextChime: now + 5, lastChime: -1 };
  const schedule = () => {
    const ahead = ctx.currentTime + 1.5;
    while (state.nextChord < ahead) {
      const t = state.nextChord;
      const c = m.prog[state.chord % m.prog.length];
      // An open voicing (root, fifth, the third an octave up) sounds calmer than
      // a close chord. Two slightly detuned sines per note give a gentle shimmer.
      for (const [deg, oct] of [[c, -1], [c + 4, -1], [c + 2, 0], [c + 4, 0]]) {
        const f = note(deg, oct);
        swell(f, t, m.chord, { vol: 0.03, detune: -4, out: filter });
        swell(f, t, m.chord, { vol: 0.03, detune: 4, out: filter });
      }
      state.chord++;
      state.nextChord += m.chord;
    }
    while (state.nextChime < ahead) {
      const t = state.nextChime;
      if (Math.random() < m.chime + state.mood * 0.2) {
        const c = m.prog[(state.chord - 1 + m.prog.length) % m.prog.length];
        // Chimes keep to the current chord and avoid repeating the last note.
        let deg;
        do deg = c + [0, 2, 4, 7][Math.floor(Math.random() * 4)]; while (deg === state.lastChime);
        state.lastChime = deg;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = note(deg, 1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.045, t + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        let dest = chimes;
        if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 0.8 - 0.4; p.connect(chimes); dest = p; }
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + 4.6);
      }
      state.nextChime += 2.5 + Math.random() * 3;
    }
  };
  state.timer = setInterval(schedule, 250);
  schedule();
  music = state;
}

export function setMood(x) {
  if (!music) return;
  music.mood = Math.max(0, Math.min(1, x));
  music.filter.frequency.setTargetAtTime(music.m.bright + music.mood * 500, ctx.currentTime, 3);
}

export function stopMusic() {
  if (!music) return;
  const { timer, out, extras } = music;
  clearInterval(timer);
  const t = ctx.currentTime;
  out.gain.cancelScheduledValues(t);
  out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
  out.gain.linearRampToValueAtTime(0.0001, t + 1.5);
  for (const o of extras) o.stop(t + 1.6);
  setTimeout(() => out.disconnect(), 2000);
  music = null;
}

export const musicPlaying = () => !!music;
