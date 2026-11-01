// Talks to worker.js through the shared engine link (engine/engine-link.js).
// Falls back to running the engine on the page if module workers are not
// available (very old browsers).
import { report } from './errors.js';
import { engineLink } from '../engine/engine-link.js';

const engine = engineLink(new URL('../worker.js', import.meta.url), {
  fallback: async () => {
    const eng = await import('../engine/index.js');
    return { generate: (a) => eng.generatePuzzle(a), hint: (a) => eng.getHint(a.puzzle, a.marks) };
  },
  onError: (err) => report(err, 'engine'),
});

// Building ahead (the next puzzle, while the player plays) uses its own
// worker, so a hint is never stuck behind it. No page fallback: building
// ahead on the page would slow the game, so without workers it simply fails.
const ahead = engineLink(new URL('../worker.js', import.meta.url));

export const generate = (options) => engine.call('generate', options);
export const prepare = (options) => ahead.call('generate', options);
export const hint = (puzzle, marks) => engine.call('hint', { puzzle, marks });
