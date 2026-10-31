// Runs the Number Place engine off the page so building a Master puzzle never freezes it.
import { generateNumberPlace, getNumberPlaceHint } from '../../engine/src/number-place.js';

self.onmessage = (e) => {
  const { id, op, args } = e.data;
  try {
    const result = op === 'generate' ? generateNumberPlace(args) : getNumberPlaceHint(args.puzzle, args.entries);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
