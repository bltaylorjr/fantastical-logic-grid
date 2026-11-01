// The Fantastical Logic Grid's engine for the page: puzzles and hints, through
// the shared link (engine-links.js) to a background worker, or to the puzzle
// server in server mode.
import { gameLink } from './engine-links.js';

const flg = gameLink('flg');

export const generate = (options) => flg.call('generate', options);
export const hint = (puzzle, marks) => flg.call('hint', { puzzle, marks });
