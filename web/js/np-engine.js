// NINETIMESNINE's engine for the page, with the same abilities as the Logic
// Grid's (engine-client.js): the same shared link (engine-links.js), so it runs
// in a background worker, restarts after a crash, runs on the page where
// workers are missing, and uses the puzzle server in server mode.
// - npEngine(themes): the engine object the game screen expects (modules/number-place/ui.js).
// - npGenerate, npAnalyze: the Puzzle Wizard's grid maker and one-answer check
//   (wizard-build.js), now off the page too, so a big check never freezes it.
import { gameLink } from './engine-links.js';

const npLink = gameLink('np');

export async function npEngine(themes) {
  return {
    themes,
    generate: (options) => npLink.call('generate', options),
    hint: (puzzle, entries) => npLink.call('hint', { puzzle, entries }),
    move: (puzzle, grid, options) => npLink.call('move', { puzzle, grid, options }),
    tide: (puzzle, options) => npLink.call('tide', { puzzle, options }),
    ebb: (puzzle, grid, water) => npLink.call('ebb', { puzzle, grid, water }),
  };
}
export const npGenerate = (options) => npLink.call('generate', options);
export const npAnalyze = (args) => npLink.call('check', args);
