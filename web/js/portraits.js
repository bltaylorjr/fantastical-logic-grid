// Character portraits from DiceBear (code MIT; Notionists, Lorelei and Open
// Peeps artwork CC0). The same name in the same theme always gets the same
// face. Animal casts and the "Built-in" choice use the game's own art.
// Each face is drawn as a woman or a man to match the character's voice.
import { createAvatar, notionists, lorelei, openPeeps } from '../vendor/dicebear/dicebear.js';
import { portraitSvg } from './art.js';
import { genderOf } from './gender.js';
import { LOOKS, BACKGROUNDS } from './looks.js';
import { characterOf } from './cast.js';

const STYLES = { notionists, lorelei, openPeeps };
export { LOOKS };

// One of the game's own characters (cast.js): the face chosen in the admin
// dashboard, the same in every theme. An AI-painted one shows this drawn face
// until its picture arrives (app.js), and whenever it can't load.
export function characterFace(c, { size = 72 } = {}) {
  const style = STYLES[c.style] ? c.style : 'notionists';
  try {
    return createAvatar(STYLES[style], {
      seed: c.seed, size, radius: 50, randomizeIds: true, backgroundColor: BACKGROUNDS, backgroundType: ['solid'], ...LOOKS[style][c.gender === 'f' ? 'f' : 'm'],
    }).toString().replace('<svg ', `<svg class="portrait-svg" data-gender="${c.gender === 'f' ? 'f' : 'm'}" aria-hidden="true" focusable="false" `);
  } catch (e) { return ''; }
}

export function portrait(puzzle, name, { size = 72, style = 'notionists' } = {}) {
  const own = characterOf(puzzle, name);
  if (own) { const face = characterFace(own, { size }); if (face) return face; }
  const isPet = puzzle.theme.id === 'pets' && /pet|animal|dog|cat/i.test(`${puzzle.cast && puzzle.cast.many}`);
  const st = STYLES[style];
  if (!st || isPet) return portraitSvg(puzzle, name, { size });
  const g = genderOf(name);
  try {
    return createAvatar(st, {
      seed: `${puzzle.theme.id}:${name}`, size, radius: 50, randomizeIds: true,
      backgroundColor: BACKGROUNDS, backgroundType: ['solid'], ...LOOKS[style][g],
    }).toString().replace('<svg ', `<svg class="portrait-svg" data-gender="${g}" aria-hidden="true" focusable="false" `);
  } catch (e) {
    return portraitSvg(puzzle, name, { size });
  }
}
