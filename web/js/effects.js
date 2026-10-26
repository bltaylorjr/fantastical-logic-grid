// Solve celebrations with canvas-confetti (ISC). Never shown in silent mode or
// when the device asks for reduced motion. Every effect moves softly: no
// full-screen flashes, and bursts come at most twice a second (well under the
// three-a-second seizure guideline). The admin dashboard picks which effects
// are on (server/src/settings.js) and whether one is picked at random.
import confetti from '../vendor/confetti/confetti.module.js';

const BASE = { disableForReducedMotion: true, zIndex: 50 };
const fire = (opts) => confetti({ ...BASE, ...opts });
const later = (ms, fn) => setTimeout(fn, ms);
const between = (a, b) => a + Math.random() * (b - a);

// Pictures for each theme (engine/src/themes.js ids).
const THEME_EMOJI = {
  mystery: ['🔍', '🕵️', '🗝️'], action: ['💥', '⚡', '🏁'], adventure: ['🧭', '🗺️', '⛰️'], holiday: ['🎁', '🎄', '❄️'],
  occasion: ['🎂', '🎉', '🥳'], fantasy: ['🐉', '🪄', '🏰'], scifi: ['🚀', '🪐', '👽'], sports: ['🏆', '⚽', '🏅'],
  cooking: ['🍰', '🍕', '🧁'], pets: ['🐾', '🐶', '🐱'], town: ['🏘️', '🌳', '🚲'], parks: ['🌲', '🦋', '🌻'],
  travel: ['✈️', '🧳', '🌍'], wonders: ['🗿', '🏛️', '🌋'],
};
const shapes = new Map();
const textShape = (text, scalar) => {
  const key = `${text}@${scalar}`;
  if (!shapes.has(key)) shapes.set(key, confetti.shapeFromText({ text, scalar }));
  return shapes.get(key);
};

export const EFFECTS = {
  confetti() {
    const burst = (ratio, opts) => fire({ origin: { y: 0.6 }, particleCount: Math.floor(180 * ratio), ...opts });
    burst(0.25, { spread: 26, startVelocity: 55 });
    burst(0.2, { spread: 60 });
    burst(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    burst(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    burst(0.1, { spread: 120, startVelocity: 45 });
  },
  fireworks() {
    const colors = [['#FFD54F', '#FFB300'], ['#4FC3F7', '#0288D1'], ['#F06292', '#C2185B'], ['#81C784', '#388E3C'], ['#BA68C8', '#7B1FA2']];
    for (let i = 0; i < 5; i += 1) {
      later(i * 550, () => fire({
        particleCount: 80, spread: 360, startVelocity: 24, ticks: 90, gravity: 0.6, decay: 0.92, scalar: 1.1, shapes: ['circle'], flat: true,
        colors: colors[i % colors.length], origin: { x: between(0.2, 0.8), y: between(0.15, 0.45) },
      }));
    }
  },
  stars() {
    const opts = { particleCount: 22, spread: 70, startVelocity: 45, ticks: 120, gravity: 0.8, scalar: 1.4, shapes: ['star'], colors: ['#FFE082', '#FFC107', '#FFB300', '#FFF8E1'] };
    for (let i = 0; i < 3; i += 1) {
      later(i * 400, () => {
        fire({ ...opts, angle: 60, origin: { x: 0, y: 0.7 } });
        fire({ ...opts, angle: 120, origin: { x: 1, y: 0.7 } });
      });
    }
  },
  balloons() {
    const balloon = textShape('🎈', 4);
    for (let i = 0; i < 4; i += 1) {
      later(i * 450, () => fire({
        particleCount: 6, shapes: [balloon], scalar: 4, flat: true, angle: 90, spread: 40, startVelocity: 8,
        gravity: -0.35, drift: between(-0.4, 0.4), decay: 0.99, ticks: 420, origin: { x: between(0.15, 0.85), y: 1.05 },
      }));
    }
  },
  sparkles() {
    const sparkle = textShape('✨', 1.6);
    for (let i = 0; i < 4; i += 1) {
      later(i * 500, () => fire({
        particleCount: 14, shapes: [sparkle, 'star'], colors: ['#FFF59D', '#FFFFFF', '#FFE082'], scalar: 1.6, angle: 270, spread: 160,
        startVelocity: 6, gravity: 0.35, decay: 0.97, ticks: 260, drift: between(-0.3, 0.3), origin: { x: between(0.1, 0.9), y: -0.05 },
      }));
    }
  },
  theme_emoji({ theme } = {}) {
    const list = (THEME_EMOJI[theme] || ['🎉', '⭐', '🏆']).map((t) => textShape(t, 2.4));
    fire({ particleCount: 30, shapes: list, scalar: 2.4, flat: true, spread: 100, startVelocity: 40, ticks: 200, gravity: 0.9, origin: { y: 0.6 } });
    later(500, () => fire({ particleCount: 20, shapes: list, scalar: 2.4, flat: true, spread: 140, startVelocity: 30, ticks: 200, gravity: 0.9, origin: { y: 0.6 } }));
  },
};

// list: names of the effects that are on. random: play one of them, picked
// at random, instead of all of them together. theme: the puzzle's theme id.
export function celebrate(list = ['confetti'], { random = false, theme } = {}) {
  if (document.documentElement.classList.contains('silent') || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const on = (Array.isArray(list) ? list : []).filter((k) => EFFECTS[k]);
  if (!on.length) return null;
  const play = random ? [on[Math.floor(Math.random() * on.length)]] : on;
  for (const k of play) {
    try { EFFECTS[k]({ theme }); } catch (e) { /* an emoji the device cannot draw: skip it */ }
  }
  return play;
}
