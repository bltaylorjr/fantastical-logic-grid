// Solve celebration with canvas-confetti (ISC). Never shown in silent mode or
// when the device asks for reduced motion. Loaded on the first solve, not at start.
export async function celebrate() {
  if (document.documentElement.classList.contains('silent') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { default: confetti } = await import('../vendor/confetti/confetti.module.js');
  const fire = (ratio, opts) => confetti({ origin: { y: 0.6 }, particleCount: Math.floor(180 * ratio), disableForReducedMotion: true, zIndex: 50, ...opts });
  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}
