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
// Ambient music: a slow chord pad and a soft arpeggio in a mode chosen per
// theme. The mood brightens as the grid fills (setMood 0..1).
// ---------------------------------------------------------------------------
const MOODS = {
  mystery: { root: 146.83, scale: [0, 2, 3, 5, 7, 8, 10], tempo: 0.62, wave: 'triangle' },
  action: { root: 110, scale: [0, 3, 5, 7, 10], tempo: 0.32, wave: 'sawtooth' },
  adventure: { root: 130.81, scale: [0, 2, 4, 7, 9], tempo: 0.45, wave: 'triangle' },
  holiday: { root: 174.61, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 0.5, wave: 'sine' },
  occasion: { root: 196, scale: [0, 2, 4, 7, 9], tempo: 0.4, wave: 'triangle' },
  fantasy: { root: 146.83, scale: [0, 2, 4, 6, 7, 9, 11], tempo: 0.55, wave: 'sine' },
  scifi: { root: 98, scale: [0, 2, 3, 7, 8], tempo: 0.5, wave: 'sawtooth' },
  sports: { root: 130.81, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 0.34, wave: 'square' },
  cooking: { root: 164.81, scale: [0, 2, 4, 7, 9], tempo: 0.46, wave: 'triangle' },
  pets: { root: 196, scale: [0, 2, 4, 7, 9], tempo: 0.42, wave: 'sine' },
  town: { root: 174.61, scale: [0, 2, 4, 5, 7, 9], tempo: 0.44, wave: 'triangle' },
  parks: { root: 130.81, scale: [0, 2, 4, 7, 9], tempo: 0.58, wave: 'sine' },
  travel: { root: 196, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 0.38, wave: 'triangle' },
  wonders: { root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], tempo: 0.6, wave: 'sine' },
  music: { root: 164.81, scale: [0, 3, 5, 6, 7, 10], tempo: 0.36, wave: 'square' },
  nautical: { root: 130.81, scale: [0, 2, 4, 5, 7, 9], tempo: 0.52, wave: 'triangle' },
};

export function startMusic(themeId) {
  if (!audio()) return;
  stopMusic();
  const m = MOODS[themeId] || MOODS.mystery;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.connect(musicGain);
  const state = { m, filter, step: 0, mood: 0, timer: null, next: ctx.currentTime + 0.1 };
  const note = (deg, oct = 0) => m.root * 2 ** ((m.scale[((deg % m.scale.length) + m.scale.length) % m.scale.length] + 12 * (oct + Math.floor(deg / m.scale.length))) / 12);
  const progression = [0, 5, 3, 4];
  const schedule = () => {
    while (state.next < ctx.currentTime + 0.6) {
      const t = state.next;
      const bar = Math.floor(state.step / 8) % progression.length;
      const chord = progression[bar];
      if (state.step % 8 === 0) {
        for (const d of [chord, chord + 2, chord + 4]) tone(note(d), t, m.tempo * 8, { type: 'sine', vol: 0.25, out: filter });
      }
      const arp = [0, 2, 4, 2, 4, 6, 4, 2][state.step % 8];
      if (state.mood > 0.15 || state.step % 2 === 0) tone(note(chord + arp, 1), t, m.tempo * 1.6, { type: m.wave, vol: 0.12 + state.mood * 0.1, out: filter });
      state.step++;
      state.next += m.tempo * (1 - state.mood * 0.25);
    }
  };
  state.timer = setInterval(schedule, 150);
  schedule();
  music = state;
}

export function setMood(x) {
  if (!music) return;
  music.mood = Math.max(0, Math.min(1, x));
  music.filter.frequency.setTargetAtTime(900 + music.mood * 2400, ctx.currentTime, 1);
}

export function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  const f = music.filter;
  setTimeout(() => f.disconnect(), 3000);
  music = null;
}

export const musicPlaying = () => !!music;
