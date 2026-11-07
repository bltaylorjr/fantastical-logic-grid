// The scene picture prompt asks for whole people: "no faces in close-up"
// made the picture model paint people with no heads (run after npm run build).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ai = readFileSync('web/js/ai.js', 'utf8');
const fn = ai.slice(ai.indexOf('export function sceneImage'), ai.indexOf('export function portraitImage'));
const scene = fn.slice(fn.indexOf('const prompt ='), fn.indexOf('\n', fn.indexOf('const prompt =')));
assert.ok(!/no faces/i.test(scene), 'the scene prompt never says "no faces"');
assert.ok(/head to feet/.test(scene), 'the scene prompt asks for whole figures');
console.log('ok  scene pictures ask for whole people');
