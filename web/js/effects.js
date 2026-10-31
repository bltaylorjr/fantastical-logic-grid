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
export const THEME_EMOJI = {
  mystery: ['🔍', '🕵️', '🗝️'], action: ['💥', '⚡', '🏁'], adventure: ['🧭', '🗺️', '⛰️'], holiday: ['🎁', '🎄', '❄️'],
  occasion: ['🎂', '🎉', '🥳'], fantasy: ['🐉', '🪄', '🏰'], scifi: ['🚀', '🪐', '👽'], sports: ['🏆', '⚽', '🏅'],
  cooking: ['🍰', '🍕', '🧁'], pets: ['🐾', '🐶', '🐱'], town: ['🏘️', '🌳', '🚲'], parks: ['🌲', '🦋', '🌻'],
  travel: ['✈️', '🧳', '🌍'], wonders: ['🗿', '🏛️', '🌋'], music: ['🎵', '🎸', '🎤'], nautical: ['⛵', '⚓', '🌊'],
  farm: ['🚜', '🐄', '🌽'], science: ['🔬', '🧪', '⚛️'],
  math: ['➗', '📐', '🧮'], biology: ['🦋', '🐸', '🌿'], chemistry: ['⚗️', '🧪', '💥'], astronomy: ['🔭', '🪐', '🌠'], paradox: ['🌀', '🪞', '⏳'],
  seasons: ['🍁', '☃️', '🌷', '☀️'],
};
// What falls for Falling snow, leaves or petals: by theme, else by season.
export const FALLING = {
  holiday: ['❄️', '❄️', '⛄'], parks: ['🍂', '🍁', '🍃'], adventure: ['🍃', '🍂', '🍁'], fantasy: ['🌸', '✨', '🌸'],
  pets: ['🌸', '🍃', '🐾'], cooking: ['🌸', '🍃', '🍓'], wonders: ['🍂', '🍃', '🌸'], music: ['🎵', '🎶', '✨'],
  nautical: ['🫧', '🐚', '🫧'],
  farm: ['🍂', '🌾', '🍎'], science: ['✨', '🫧', '✨'],
  math: ['✨', '➕', '✨'], biology: ['🍃', '🌸', '🍃'], chemistry: ['🫧', '✨', '🫧'], astronomy: ['✨', '⭐', '🌙'], paradox: ['🌀', '✨', '🪐'],
  // Seasons falls by topic ('theme/topic'); with no topic, by today's season.
  'seasons/fall': ['🍂', '🍁', '🍂'], 'seasons/winter': ['❄️', '❄️', '❅'], 'seasons/spring': ['🌸', '🌷', '🍃'], 'seasons/summer': ['🌼', '☀️', '🫧'],
};
const seasonal = () => {
  const m = new Date().getMonth();
  return m === 11 || m <= 1 ? ['❄️', '❄️', '❅'] : m <= 4 ? ['🌸', '🌸', '🍃'] : m <= 7 ? ['🍃', '🌼', '🍃'] : ['🍂', '🍁', '🍂'];
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
  bubbles() {
    for (let i = 0; i < 5; i += 1) {
      later(i * 450, () => fire({
        particleCount: 10, shapes: ['circle'], colors: ['#B3E5FC', '#E1F5FE', '#B2EBF2', '#D1C4E9'], scalar: between(1.6, 2.6), flat: true,
        angle: 90, spread: 50, startVelocity: 6, gravity: -0.25, drift: between(-0.5, 0.5), decay: 0.99, ticks: 380,
        origin: { x: between(0.1, 0.9), y: 1.05 },
      }));
    }
  },
  falling({ theme, topic } = {}) {
    const list = (FALLING[`${theme}/${topic}`] || FALLING[theme] || seasonal()).map((t) => textShape(t, 2));
    for (let i = 0; i < 5; i += 1) {
      later(i * 450, () => fire({
        particleCount: 8, shapes: list, scalar: 2, angle: 270, spread: 120, startVelocity: 4, gravity: 0.3, decay: 0.98,
        drift: between(-0.6, 0.6), ticks: 360, origin: { x: between(0.05, 0.95), y: -0.05 },
      }));
    }
  },
  shooting_stars() {
    // Each star leads a straight trail of tiny dots fired along the same line.
    for (let i = 0; i < 4; i += 1) {
      later(i * 500, () => {
        const fromLeft = i % 2 === 0;
        const line = { spread: 0, angle: fromLeft ? -20 : 200, gravity: 0.05, decay: 0.985, ticks: 110, flat: true, origin: { x: fromLeft ? -0.02 : 1.02, y: between(0.05, 0.35) } };
        fire({ ...line, particleCount: 1, shapes: ['star'], colors: ['#FFC107'], scalar: 2.4, startVelocity: 30 });
        fire({ ...line, particleCount: 16, shapes: ['circle'], colors: ['#FFD54F', '#FFE082', '#FFCA28'], scalar: 0.8, startVelocity: 22 });
      });
    }
  },
  ribbons() {
    const ribbon = confetti.shapeFromPath({ path: 'M0 0Q5 6 10 0T20 0T30 0L30 3Q25 9 20 3T10 3T0 3Z' });
    const opts = { particleCount: 18, shapes: [ribbon], scalar: 4, spread: 55, startVelocity: 50, ticks: 220, gravity: 0.7, decay: 0.93, colors: ['#E53935', '#1E88E5', '#FDD835', '#43A047', '#8E24AA'] };
    fire({ ...opts, angle: 60, origin: { x: 0, y: 0.9 } });
    fire({ ...opts, angle: 120, origin: { x: 1, y: 0.9 } });
    later(500, () => { fire({ ...opts, particleCount: 10, angle: 70, origin: { x: 0.1, y: 1 } }); fire({ ...opts, particleCount: 10, angle: 110, origin: { x: 0.9, y: 1 } }); });
  },
  light_rays() {
    // A soft golden glow with slowly turning rays: fades in over a second,
    // never brighter than 35%, then fades out. No flashing.
    const el = document.createElement('div');
    el.className = 'fx-rays';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed', inset: '-50vmax', zIndex: '49', pointerEvents: 'none', opacity: '0',
      background: 'repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,214,79,.55) 0deg 8deg, rgba(255,214,79,0) 8deg 24deg)',
      maskImage: 'radial-gradient(circle at 50% 50%, #000 0, transparent 45vmax)', WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 0, transparent 45vmax)',
    });
    document.body.append(el);
    const a = el.animate([
      { opacity: 0, transform: 'rotate(0deg)' }, { opacity: 0.35, transform: 'rotate(12deg)', offset: 0.3 },
      { opacity: 0.35, transform: 'rotate(26deg)', offset: 0.65 }, { opacity: 0, transform: 'rotate(40deg)' },
    ], { duration: 3600, easing: 'ease-in-out' });
    a.onfinish = a.oncancel = () => el.remove();
  },
  emoji_burst() {
    const list = ['🎉', '🥳', '🎊', '⭐', '🏆'].map((t) => textShape(t, 2.4));
    const opts = { particleCount: 16, shapes: list, scalar: 2.4, flat: true, spread: 60, startVelocity: 45, ticks: 200, gravity: 0.9 };
    fire({ ...opts, angle: 60, origin: { x: 0, y: 0.75 } });
    fire({ ...opts, angle: 120, origin: { x: 1, y: 0.75 } });
    later(450, () => fire({ ...opts, particleCount: 20, angle: 90, spread: 120, origin: { x: 0.5, y: 0.7 } }));
  },
};

// list: names of the effects that are on. random: play one of them, picked
// at random, instead of all of them together. theme, topic: the puzzle's
// theme and topic ids.
export function celebrate(list = ['confetti'], { random = false, theme, topic } = {}) {
  if (document.documentElement.classList.contains('silent') || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const on = (Array.isArray(list) ? list : []).filter((k) => EFFECTS[k]);
  if (!on.length) return null;
  const play = random ? [on[Math.floor(Math.random() * on.length)]] : on;
  for (const k of play) {
    try { EFFECTS[k]({ theme, topic }); } catch (e) { /* an emoji the device cannot draw: skip it */ }
  }
  return play;
}
