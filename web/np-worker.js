// NINETIMESNINE puzzles are built here so a Master puzzle never freezes the page.
import { generateNumberPlace, getNumberPlaceHint } from './engine/number-place.js';
import { nextPlacement, planTide, ebbTide } from './engine/number-place-styles.js';

const OPS = {
  generate: (a) => generateNumberPlace(a),
  hint: (a) => getNumberPlaceHint(a.puzzle, a.entries),
  // The game styles: the rival's next move, and the Tidewater pools and ebb.
  move: (a) => nextPlacement(a.puzzle, a.grid, a.options),
  tide: (a) => planTide(a.puzzle, a.options),
  ebb: (a) => ebbTide(a.puzzle, a.grid, a.water),
};

self.onmessage = (e) => {
  // A worker only hears its own page; a message from anywhere else is ignored.
  if (e.origin && e.origin !== self.location.origin) return;
  const { id, op, args } = e.data;
  try {
    if (!Object.hasOwn(OPS, op)) throw new Error(`Unknown request "${op}".`);
    self.postMessage({ id, ok: true, result: OPS[op](args) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
