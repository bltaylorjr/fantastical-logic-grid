// Puzzle generation and hints run here so large puzzles never freeze the page.
import { generatePuzzle, getHint } from './engine/index.js';

self.onmessage = (e) => {
  const { id, op, args } = e.data;
  try {
    let result;
    if (op === 'generate') result = generatePuzzle(args);
    else if (op === 'hint') result = getHint(args.puzzle, args.marks);
    else throw new Error(`Unknown operation ${op}`);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
