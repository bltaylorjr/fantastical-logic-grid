// The Fantastical Logic Grid's engine for the page: puzzles and hints, through
// the shared link (engine-links.js) to a background worker, or to the puzzle
// server in server mode.
import { gameLink } from './engine-links.js';

const flg = gameLink('flg');
// Building ahead (the next puzzle, while the player plays) has its own lane,
// so a hint is never stuck behind it. In server mode both reach the server.
const ahead = gameLink('flg', 'ahead');

export const generate = (options) => flg.call('generate', options);
export const prepare = (options) => ahead.call('generate', options);
export const hint = (puzzle, marks) => flg.call('hint', { puzzle, marks });
