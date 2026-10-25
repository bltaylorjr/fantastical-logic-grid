// Character portraits from DiceBear (code MIT; Notionists, Lorelei and Open
// Peeps artwork CC0). The same name in the same theme always gets the same
// face. Animal casts and the "Built-in" choice use the game's own art.
// Each face is drawn as a woman or a man to match the character's voice.
import { createAvatar, notionists, lorelei, openPeeps } from '../vendor/dicebear/dicebear.js';
import { portraitSvg } from './art.js';
import { genderOf } from './gender.js';

const STYLES = { notionists, lorelei, openPeeps };
const v = (nums) => nums.map((n) => `variant${String(n).padStart(2, '0')}`);
// Hair and features that read clearly as a woman's or a man's in each set.
// Ones that could pass for either are left out.
export const LOOKS = {
  notionists: {
    f: { hair: v([2, 8, 10, 23, 28, 36, 37, 39, 41, 45, 46, 47, 48, 57, 58, 59, 61, 62, 63]), beardProbability: 0 },
    m: { hair: v([1, 3, 5, 6, 7, 13, 15, 16, 17, 18, 19, 21, 24, 25, 26, 27, 31, 32, 34, 35, 38, 42, 44, 49, 50, 51, 52, 53, 54, 55, 56, 60]), beardProbability: 35 },
  },
  lorelei: {
    f: { hair: v([14, 15, 16, 19, 21, 23, 24, 26, 29, 31, 32, 33, 35, 37, 40, 41, 42, 45]), beardProbability: 0, earringsProbability: 60 },
    m: { hair: v([1, 2, 3, 4, 5, 6, 7, 8, 9, 22, 25, 27, 28, 34, 36, 38, 39, 43, 44, 47]), beardProbability: 55, earringsProbability: 0, hairAccessoriesProbability: 0 },
  },
  openPeeps: {
    f: { head: ['bangs', 'bangs2', 'bantuKnots', 'bun', 'bun2', 'buns', 'cornrows', 'grayBun', 'grayMedium', 'hijab', 'long', 'longAfro', 'longBangs', 'longCurly', 'medium1', 'medium2', 'medium3', 'mediumBangs', 'mediumBangs2', 'mediumBangs3', 'mediumStraight'], facialHairProbability: 0 },
    m: { head: ['afro', 'dreads1', 'dreads2', 'flatTop', 'flatTopLong', 'grayShort', 'mohawk', 'noHair1', 'noHair2', 'noHair3', 'pomp', 'shaved1', 'shaved2', 'shaved3', 'short1', 'short2', 'short3', 'short4', 'short5', 'turban', 'twists', 'twists2'], facialHairProbability: 40 },
  },
};
const BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f0d8'];

export function portrait(puzzle, name, { size = 72, style = 'notionists' } = {}) {
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
