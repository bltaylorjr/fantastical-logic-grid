// The Kokoro sound fixes (web/js/kokoro-words.js), checked against what
// eSpeak actually writes for these words, and the video's copy of the list.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixPhonemes } from '../web/js/kokoro-words.js';

const cases = [
  ['stˈoːɹi', 'stˈɔɹi'], // story (game, browser eSpeak)
  ['stˈɔːɹi', 'stˈɔɹi'], // story (video, kokoro-onnx)
  ['stˈoːɹiz', 'stˈɔɹiz'], // stories
  ['kˈæɾɪɡɚɹiz', 'kˈæɾəɡˌɔɹiz'], // categories
  ['kˈæɾɪɡɚɹi', 'kˈæɾəɡˌɔɹi'], // category
  ['fˈoːɹ mˈoːɹ dˈoːɹz', 'fˈɔɹ mˈɔɹ dˈɔɹz'], // four more doors
  ['hˈɪstɚɹi', 'hˈɪstəɹi'], // history
  ['ɹˈiːd ðə stˈoːɹi fˈɜːst.', 'ɹˈiːd ðə stˈɔɹi fˈɜːst.'],
  ['ðə ɡɹˈɪd', 'ðə ɡɹˈɪd'], // untouched
];
for (const [from, to] of cases) assert.equal(fixPhonemes(from), to, from);

const worker = readFileSync(new URL('../web/kokoro-worker.js', import.meta.url), 'utf8');
assert.match(worker, /fixPhonemes\(phonemes\)/, 'the Kokoro worker runs the sound fixes');
const video = readFileSync(new URL('../video/build.py', import.meta.url), 'utf8');
for (const re of ['kˈæɾɪɡɚɹ', '[oɔ]ːɹ', 'ɚɹ']) assert.ok(video.includes(`(r'${re}'`), `video/build.py has the ${re} fix`);
console.log('kokoro words ok');
