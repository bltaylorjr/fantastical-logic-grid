// Character portraits from DiceBear (code MIT; Notionists, Lorelei and Open
// Peeps artwork CC0). The same name in the same theme always gets the same
// face. Animal casts and the "Built-in" choice use the game's own art.
import { createAvatar, notionists, lorelei, openPeeps } from '../vendor/dicebear/dicebear.js';
import { portraitSvg } from './art.js';

const STYLES = { notionists, lorelei, openPeeps };
const BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f0d8'];

export function portrait(puzzle, name, { size = 72, style = 'notionists' } = {}) {
  const isPet = puzzle.theme.id === 'pets' && /pet|animal|dog|cat/i.test(`${puzzle.cast && puzzle.cast.many}`);
  const st = STYLES[style];
  if (!st || isPet) return portraitSvg(puzzle, name, { size });
  try {
    return createAvatar(st, {
      seed: `${puzzle.theme.id}:${name}`, size, radius: 50, randomizeIds: true,
      backgroundColor: BACKGROUNDS, backgroundType: ['solid'],
    }).toString().replace('<svg ', '<svg class="portrait-svg" aria-hidden="true" focusable="false" ');
  } catch (e) {
    return portraitSvg(puzzle, name, { size });
  }
}
