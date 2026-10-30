// Small synthesized sounds, so nothing needs downloading: a soft tap when a
// number goes in, a chime when a row, column or box is finished, and a short
// fanfare on a solve. Sound starts only after the player has pressed a key or
// tapped (browsers require that), and silent mode turns it all off.
let ctx = null;
const audio = () => {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = false; } }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx || null;
};

function tone(freq, start, dur, { type = 'sine', gain = 0.08 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sounds = {
  place: () => tone(660, 0, 0.08, { type: 'triangle', gain: 0.05 }),
  note: () => tone(880, 0, 0.05, { type: 'sine', gain: 0.03 }),
  wrong: () => { tone(220, 0, 0.14, { type: 'square', gain: 0.03 }); },
  unit: () => { [784, 988, 1175].forEach((f, i) => tone(f, i * 0.07, 0.25, { gain: 0.05 })); },
  solved: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.5, { type: 'triangle', gain: 0.07 })); },
  hint: () => tone(523, 0, 0.18, { gain: 0.04 }),
};
