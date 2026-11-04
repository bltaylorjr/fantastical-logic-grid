// Runs the NINETIMESNINE engine off the page so building a Master puzzle never freezes it.
// The request handling is the shared engine host (engine/src/engine-host.js).
import { serveEngine } from '../../engine/src/engine-host.js';
import { generateNumberPlace, getNumberPlaceHint } from '../../engine/src/number-place.js';
import { nextPlacement, planTide, ebbTide } from '../../engine/src/number-place-styles.js';

serveEngine({
  generate: (a) => generateNumberPlace(a),
  hint: (a) => getNumberPlaceHint(a.puzzle, a.entries),
  // Game styles: the rival's next move, and the Tidewater pools and ebb.
  move: (a) => nextPlacement(a.puzzle, a.grid, a.options),
  tide: (a) => planTide(a.puzzle, a.options),
  ebb: (a) => ebbTide(a.puzzle, a.grid, a.water),
});
