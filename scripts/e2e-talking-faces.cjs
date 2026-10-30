// Talking faces (web/js/talker.js, talking-face.js): while the clues are read
// aloud, the witness reading appears in the corner with their name, their
// photo comes from the game's server (kind 'face'), and their mouth opens and
// closes with the loudness of the real voice clip. Turning Talking faces off
// in Settings hides it. Also checks that the face finder (face-worker.js,
// MediaPipe) loads from the built app and answers.
//
// The game's server and the Kokoro voice are stand-ins. The face's points are
// stood in too (window.__talkingFaceStub), because the test picture is a plain
// drawing that has no real face to find.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const SHOTS = process.env.SHOTS;
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const API = 'http://localhost:8152';

// A 256 x 256 light, skin-coloured picture (BMP: simple to write here).
function facePicture() {
  const w = 256, h = 256, row = w * 3, size = 54 + row * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 54 + (h - 1 - y) * row + x * 3;
    const lips = Math.abs(y - 159) < 5 && Math.abs(x - 128) < 26;
    b[o] = lips ? 120 : 170 + (x % 40); b[o + 1] = lips ? 110 : 190 + (y % 30); b[o + 2] = lips ? 200 : 225;
  }
  return b;
}
const POINTS = {
  mouthL: [0.4, 0.62], mouthR: [0.6, 0.62], lipTop: [0.5, 0.6], lipUpIn: [0.5, 0.62], lipLowIn: [0.5, 0.621], lipBottom: [0.5, 0.65], chin: [0.5, 0.8],
  noseTip: [0.5, 0.52], browMid: [0.5, 0.36],
  eyeLOut: [0.32, 0.42], eyeLIn: [0.44, 0.42], eyeLTop: [0.38, 0.4], eyeLBot: [0.38, 0.44],
  eyeROut: [0.68, 0.42], eyeRIn: [0.56, 0.42], eyeRTop: [0.62, 0.4], eyeRBot: [0.62, 0.44],
  jawL: [0.36, 0.72], jawR: [0.64, 0.72],
};

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8151'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const faces = [];
  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', siteUrl: '', appVersion: 'test' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = '${API}';\n`;
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  const picture = facePicture();
  await ctx.route(`${API}/**`, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/v1/config') return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ features: { pictures: true, talkingFaces: true, voices: false, learning: false, translate: false }, game: { aiPictures: 'scene' } }) });
    if (url.pathname === '/v1/picture') {
      const body = JSON.parse(req.postData());
      if (body.kind === 'face') { faces.push(body.prompt); return r.fulfill({ headers: cors, contentType: 'image/bmp', body: picture }); }
    }
    return r.fulfill({ status: 503, headers: cors, contentType: 'application/json', body: '{"error":"not_set_up"}' });
  });
  const page = await ctx.newPage();
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (process.env.DEBUG) page.on('console', (m) => console.log('console:', m.text()));
  try {
    await page.addInitScript((points) => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, kokoroReady: true }));
      window.__talkingFaceStub = () => points;
      // Stand-in Kokoro voice: each clip is 0.9 s of a voice-like tone whose
      // loudness rises and falls four times a second, like syllables.
      const wav = () => {
        const rate = 8000, n = Math.round(rate * 0.9), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
        const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
        v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
        v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) { const t = i / rate; v.setInt16(44 + i * 2, Math.round(12000 * Math.max(0, Math.sin(t * Math.PI * 8)) * Math.sin(t * 2 * Math.PI * 160)), true); }
        return buf;
      };
      const Real = Worker;
      window.Worker = function (url, o) {
        if (!String(url).includes('kokoro-worker')) return new Real(url, o);
        const k = { postMessage(m) {
          if (m.type === 'load') setTimeout(() => k.onmessage({ data: { id: m.id, ok: true } }), 50);
          if (m.type === 'speak') setTimeout(() => k.onmessage({ data: { id: m.id, ok: true, wav: wav() } }), 10);
        } };
        return k;
      };
    }, POINTS);
    await page.goto('http://localhost:8151/');
    await page.waitForSelector('#tier-choices input');
    await page.check('input[name=tier][value=medium]', { force: true });
    await page.check('input[name=theme][value=mystery]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await page.isHidden('#talker'), 'no face shows before anyone speaks');

    // How many pixels of the face are the dark inside of an open mouth.
    const darkPixels = () => page.evaluate(() => {
      const c = document.querySelector('#talker canvas');
      if (!c || c.hidden) return -1;
      const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
      const g = t.getContext('2d'); g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, t.width, t.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 50 && d[i + 2] < 50) n++;
      return n;
    });

    await page.click('#read-clues');
    await page.waitForSelector('#talker:not([hidden])', { timeout: 10000 });
    const first = await page.evaluate(() => window.__flg.state.witness[window.__flg.state.puzzle.clues[0].number] || 'narrator');
    const shown = (await page.textContent('#talker .talker-name')).trim();
    assert(shown === (first === 'narrator' ? 'Narrator' : first), `the first clue's reader appears with their name (${shown})`);
    await page.waitForSelector('#talker canvas:not([hidden])', { timeout: 15000 });
    assert(faces.length >= 1 && /closed-mouth/.test(faces[0]), 'their lifelike photo is asked of the game\'s server');
    let most = 0;
    for (let i = 0; i < 40 && most < 30; i++) { most = Math.max(most, await darkPixels()); await page.waitForTimeout(40); }
    await shot('talking-face-open');
    assert(most >= 30, `the mouth opens with the voice (${most} dark pixels at its widest)`);

    // Stop reading: the mouth closes and the face leaves.
    await page.click('#read-clues');
    await page.waitForTimeout(400);
    assert(await darkPixels() <= 0, 'the mouth closes when the voice stops');
    await page.waitForSelector('#talker', { state: 'hidden', timeout: 5000 });
    assert(true, 'the face leaves soon after');

    // Off in Settings: nobody appears.
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('flg.settings')); s.talkingFaces = false; localStorage.setItem('flg.settings', JSON.stringify(s)); });
    await page.evaluate(() => { window.__flg.settings().talkingFaces = false; });
    await page.click('#read-clues');
    await page.waitForTimeout(1500);
    assert(await page.isHidden('#talker'), 'with Talking faces off, no face appears');
    await page.click('#read-clues');

    // The real face finder loads from the app and answers (no face in a blank picture).
    const found = await page.evaluate(async () => {
      delete window.__talkingFaceStub;
      const m = await import('/js/talking-face.js');
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      c.getContext('2d').fillStyle = '#ccc'; c.getContext('2d').fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => c.toBlob(r));
      try { return { face: await m.findFace(`blank-${Date.now()}`, blob) }; } catch (e) { return { error: e.message }; }
    });
    assert(!found.error && found.face === null, `the face finder runs and finds no face in a blank picture${found.error ? ` (${found.error})` : ''}`);
    assert(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
