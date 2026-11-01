// Puzzle generation and hints run here so large puzzles never freeze the page.
// The request handling is the shared engine host (engine/engine-host.js).
import { serveEngine } from './engine/engine-host.js';
import { generatePuzzle, getHint } from './engine/index.js';

serveEngine({
  generate: (args) => generatePuzzle(args),
  hint: (args) => getHint(args.puzzle, args.marks),
});
