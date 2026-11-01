// NINETIMESNINE puzzles are built here so a Master puzzle never freezes the page.
// The request handling is the shared engine host (engine/engine-host.js).
import { serveEngine } from './engine/engine-host.js';
import { generateNumberPlace, getNumberPlaceHint } from './engine/number-place.js';
import { nextPlacement, planTide, ebbTide } from './engine/number-place-styles.js';

serveEngine({
  generate: (a) => generateNumberPlace(a),
  hint: (a) => getNumberPlaceHint(a.puzzle, a.entries),
  // The game styles: the rival's next move, and the Tidewater pools and ebb.
  move: (a) => nextPlacement(a.puzzle, a.grid, a.options),
  tide: (a) => planTide(a.puzzle, a.options),
  ebb: (a) => ebbTide(a.puzzle, a.grid, a.water),
});
