// Which DiceBear hair and features read clearly as a woman's or a man's, so a
// face always matches its voice (see gender.js). The game's portraits.js and
// the admin dashboard's Characters section both use it; admin/looks.js is a
// copy (server/test/characters.test.mjs checks they match).
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
export const BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f0d8'];
