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

export const generate = (options) => engine.call('generate', options);
export const hint = (puzzle, marks) => engine.call('hint', { puzzle, marks });
