// Copies the game's sound, picture and celebration code into admin/ so the
// dashboard's Media library plays and draws exactly what players get. The
// admin app is served flat from the Worker (admin/*.js), so the only change in
// each copy is the import path. Run after changing any of these game files:
//   node scripts/admin-media.mjs
// server/test/admin.test.mjs fails when a copy is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// [copy in admin/, game file, [from, to] import paths]
export const MEDIA_COPIES = [
  ['admin/game-audio.js', 'web/js/audio.js', []],
  ['admin/game-gender.js', 'web/js/gender.js', []],
  ['admin/game-art.js', 'web/js/art.js', [["'./gender.js'", "'./game-gender.js'"]]],
  ['admin/game-effects.js', 'web/js/effects.js', [["'../vendor/confetti/confetti.module.js'", "'./confetti.js'"]]],
  ['admin/confetti.js', 'web/vendor/confetti/confetti.module.js', []],
];

export function mediaCopy(game, swaps) {
  let text = readFileSync(join(root, game), 'utf8');
  for (const [from, to] of swaps) {
    if (!text.includes(from)) throw new Error(`${game} no longer imports ${from}; update scripts/admin-media.mjs`);
    text = text.split(from).join(to);
  }
  return text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [copy, game, swaps] of MEDIA_COPIES) {
    writeFileSync(join(root, copy), mediaCopy(game, swaps));
    console.log(`${game} -> ${copy}`);
  }
}
