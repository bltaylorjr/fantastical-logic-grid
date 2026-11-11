// The hushed story moment (Bobby, 2026-11-11): "Only one part of the puzzle
// is left, and everyone goes quiet." ends in a whisper. Checks that the beat
// carries the words to whisper, and that whisper.js really removes the
// voice's pitch (a whisper has no buzz) while keeping the clip's length.
import assert from 'node:assert/strict';
import { BEATS, whisperPart, storyBeats } from '../engine/src/beats.js';
import { whisperSamples, wavBytes } from '../web/js/whisper.js';

const line = BEATS.default.late.find((t) => /everyone goes quiet/.test(t));
assert.equal(line, 'Only one part of the puzzle is left, and everyone goes quiet.');
assert.equal(whisperPart(line), 'and everyone goes quiet.');
assert.equal(whisperPart('The first pieces fall into place.'), null);

// A puzzle whose late beat is the hushed line carries `whisper`.
const fake = (id) => ({ grid: { blocks: [1, 2, 3, 4] }, theme: { id: 'nowhere' }, story: { id }, categories: [{ items: [{ label: 'Ann' }, { label: 'Bo' }] }], cast: { one: 'guest', many: 'guests' } });
let found = false;
for (let i = 0; i < 200 && !found; i++) {
  const late = storyBeats(fake(`s${i}`)).find((b) => b.stage === 'late');
  if (late.text === line) { assert.equal(late.whisper, 'and everyone goes quiet.'); found = true; }
  else assert.equal(late.whisper, undefined);
}
assert.ok(found, 'some puzzle gets the hushed line');

// A buzzy 150 Hz voice-like tone: strong pitch peak before, none after.
const rate = 24000, n = rate;
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const voice = new Float32Array(n);
for (let i = 0; i < n; i++) for (let h = 1; h <= 20; h++) voice[i] += (0.3 / h) * Math.sin((2 * Math.PI * 150 * h * i) / rate);
const out = whisperSamples(voice, rate, rand);
assert.equal(out.length, n);
assert.ok(out.every(Number.isFinite));
const power = (x, hz) => { let re = 0, im = 0; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos((2 * Math.PI * hz * i) / rate); im += x[i] * Math.sin((2 * Math.PI * hz * i) / rate); } return re * re + im * im; };
const ratio = (x) => power(x, 450) / power(x, 525); // 3rd harmonic vs the gap between harmonics
assert.ok(ratio(voice) > 1000, `input has pitch (${ratio(voice)})`);
assert.ok(ratio(out) < 20, `whisper has no pitch (${ratio(out)})`);
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
assert.ok(rms(out) > 0.3 * rms(voice) && rms(out) < 1.5 * rms(voice), 'about as loud');
const wav = wavBytes(out, rate);
assert.equal(wav.length, 44 + n * 2);
assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
console.log('whisper tests passed');
