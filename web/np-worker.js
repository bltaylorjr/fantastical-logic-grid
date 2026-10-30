// Number Place puzzles are built here so a Master puzzle never freezes the page.
import { generateNumberPlace, getNumberPlaceHint } from './engine/number-place.js';

self.onmessage = (e) => {
  const { id, op, args } = e.data;
  try {
    const result = op === 'generate' ? generateNumberPlace(args) : getNumberPlaceHint(args.puzzle, args.entries);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
