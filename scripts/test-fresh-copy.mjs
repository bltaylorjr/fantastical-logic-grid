// 1. The stale-copy repair in app.js reads the file list out of sw.js with a
//    pattern. If the build ever wrote sw.js differently, the repair would
//    quietly fetch nothing and players would keep a broken copy
//    ("Cannot set properties of null (setting 'onclick')").
// 2. The scene picture prompt asks for whole people: "no faces in close-up"
// made the picture model paint people with no heads (run after npm run build).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const dir of ['dist/web', 'dist/site']) {
  const sw = readFileSync(`${dir}/sw.js`, 'utf8');
  const list = JSON.parse((sw.match(/const FILES = (\[[\s\S]*?\]);/) || [])[1] || '[]');
  assert.ok(list.includes('js/app.js'), `${dir}/sw.js: the file list the repair reads has js/app.js`);
  assert.ok(list.filter((f) => /\.(m?js|css|html)$/.test(f)).length > 50, `${dir}/sw.js: the repair finds the code files`);
}
const app = readFileSync('web/js/app.js', 'utf8');
assert.ok(app.includes("/const FILES = (\\[[\\s\\S]*?\\]);/"), 'app.js reads sw.js with the pattern tested here');


const ai = readFileSync('web/js/ai.js', 'utf8');
const fn = ai.slice(ai.indexOf('export function sceneImage'), ai.indexOf('export function portraitImage'));
const scene = fn.slice(fn.indexOf('const prompt ='), fn.indexOf('\n', fn.indexOf('const prompt =')));
assert.ok(!/no faces/i.test(scene), 'the scene prompt never says "no faces"');
assert.ok(/head to feet/.test(scene), 'the scene prompt asks for whole figures');
console.log('ok  fresh-copy repair reads sw.js, scene pictures ask for whole people');
