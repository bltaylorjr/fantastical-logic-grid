// Makes a book's puzzles off the page, so the dashboard stays responsive (the
// hardest levels can take a minute each). Uses the copy of the game's engine
// in admin/engine (node scripts/admin-engine.mjs).
import { generatePuzzle } from './engine/index.js';
import { makeBookPuzzles, examplePuzzle } from './book-layout.js';

self.onmessage = (e) => {
  const { settings, used } = e.data;
  try {
    const puzzles = makeBookPuzzles(generatePuzzle, settings, (i, n, p) => self.postMessage({ type: 'progress', i, n, title: p.title }), used);
    self.postMessage({ type: 'done', puzzles, example: examplePuzzle(generatePuzzle) });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
