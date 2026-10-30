// Records the talking-face example clips (lines.json): each character's
// lifelike face from the game's server, brought to life by the game's own
// talking face (web/js/talking-face.js) in the mood of their line, with their
// Kokoro voice (voices.py). Frame by frame on the page's own clock, so a slow
// machine still gives smooth 30 fps video. Writes out/<id>.mp4 and
// out/talking-faces-examples.mp4 (all of them, one after another).
//
//   npm run build && python video/examples/voices.py && node video/examples/render.cjs
//
// FLG_CLOUD_URL is the game's server (faces are painted once and kept there,
// so the game shows the same people).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const API = process.env.FLG_CLOUD_URL || 'https://flg-api.btay74.workers.dev';
const PORT = 8161;
const FPS = 30;
const LEAD = 0.7;
const TAIL = 1.1;
const W = 720, FACE_H = 900, H = 1080;

async function face(ex) {
  const file = path.join(OUT, `${ex.id}.jpg`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const r = await fetch(`${API}/v1/picture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://thelogicgrid.com' },
    body: JSON.stringify({ kind: 'face', prompt: ex.face }),
  });
  if (!r.ok) throw new Error(`face for ${ex.name}: ${r.status} ${await r.text()}`);
  const b = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, b);
  return b;
}

(async () => {
  const lines = JSON.parse(fs.readFileSync(path.join(HERE, 'lines.json'), 'utf8'));
  const only = process.argv[2];
  const server = spawn('node', [path.join(ROOT, 'scripts', 'serve.mjs'), path.join(ROOT, 'dist', 'web'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const made = [];
  try {
    for (const ex of lines) {
      if (only && ex.id !== only) continue;
      const picture = await face(ex);
      const wav = fs.readFileSync(path.join(OUT, `${ex.id}.wav`));
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: 'block' });
      // For a local try-out without a real photo: FACE_STUB=1 stands in the face's points.
      if (process.env.FACE_STUB) await ctx.addInitScript(() => { window.__talkingFaceStub = () => ({ mouthL: [0.4, 0.62], mouthR: [0.6, 0.62], lipTop: [0.5, 0.6], lipUpIn: [0.5, 0.62], lipLowIn: [0.5, 0.621], lipBottom: [0.5, 0.65], chin: [0.5, 0.8], noseTip: [0.5, 0.52], browMid: [0.5, 0.36], eyeLOut: [0.32, 0.42], eyeLIn: [0.44, 0.42], eyeLTop: [0.38, 0.4], eyeLBot: [0.38, 0.44], eyeROut: [0.68, 0.42], eyeRIn: [0.56, 0.42], eyeRTop: [0.62, 0.4], eyeRBot: [0.62, 0.44], jawL: [0.36, 0.72], jawR: [0.64, 0.72] }); });
      await ctx.route(`http://localhost:${PORT}/examples.html`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0"></body>' }));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error('page:', String(e)));
      await page.goto(`http://localhost:${PORT}/examples.html`);
      // Find the face and measure the voice before the clock stops.
      const ready = await page.evaluate(async ({ pic, snd, ex, W, FACE_H, H }) => {
        const m = await import('/js/talking-face.js');
        const blob = new Blob([Uint8Array.from(atob(pic), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
        const points = await m.findFace(`example|${ex.id}|${pic.length}`, blob);
        if (!points) return { error: 'no face found in the picture' };
        const env = await m.loudnessOf(new Blob([Uint8Array.from(atob(snd), (c) => c.charCodeAt(0))], { type: 'audio/wav' }));
        const font = new FontFace('Atkinson', 'url(/fonts/atkinson-700.woff2)');
        await font.load(); document.fonts.add(font);
        const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = FACE_H;
        const out = document.createElement('canvas'); out.width = W; out.height = H;
        document.body.append(out);
        window.__ex = { m, blob, points, env, canvas, out };
        return { frames: env ? env.length : 0 };
      }, { pic: picture.toString('base64'), snd: wav.toString('base64'), ex, W, FACE_H, H });
      if (ready.error) throw new Error(`${ex.name}: ${ready.error}`);
      const speech = ready.frames / 60;
      const total = LEAD + speech + TAIL;
      await page.evaluate(async ({ ex, LEAD, speech }) => {
        const { m, blob, points, env, canvas } = window.__ex;
        // A clock that only moves when a frame is drawn.
        let now = 0;
        let queue = [];
        performance.now = () => now;
        window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
        window.cancelAnimationFrame = () => { queue = []; };
        window.__ex.tick = (ms) => { now += ms; const q = queue; queue = []; q.forEach((cb) => cb(now)); };
        const talker = m.createTalker(canvas);
        await talker.show(blob, points);
        talker.act(ex.mood);
        const t0 = performance.now() + LEAD * 1000;
        window.__ex.talker = talker;
        window.__ex.cues = [
          [t0, () => talker.speak(() => { const i = Math.floor((performance.now() - t0) / 1000 * 60); return i >= 0 && i < env.length ? env[i] : null; }, ex.mood)],
          [t0 + speech * 1000, () => talker.quiet()],
        ];
        if (ex.gesture) {
          const at = ex.gestureAt === 'end' ? t0 + (speech - 0.35) * 1000 : t0 + ex.gestureAt * speech * 1000;
          window.__ex.cues.push([at, () => talker.gesture(ex.gesture)]);
        }
      }, { ex, LEAD, speech });
      const frames = path.join(OUT, `frames-${ex.id}`);
      fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
      const n = Math.ceil(total * FPS);
      for (let i = 0; i < n; i++) {
        const data = await page.evaluate(({ ex, W, FACE_H, H, done, ms }) => {
          const { canvas, out, cues, tick } = window.__ex;
          for (const c of cues) if (!c.fired && performance.now() + ms >= c[0]) { c.fired = true; c[1](); }
          tick(ms);
          const g = out.getContext('2d');
          g.fillStyle = '#14161c'; g.fillRect(0, 0, W, H);
          g.drawImage(canvas, 0, 0);
          g.fillStyle = '#f4f1ea';
          g.font = '44px Atkinson'; g.fillText(ex.name, 36, FACE_H + 62);
          const nameW = g.measureText(ex.name).width;
          g.fillStyle = '#e8b04a'; g.font = '28px Atkinson'; g.fillText(`  ·  ${ex.label}`, 36 + nameW, FACE_H + 60);
          // The line, wrapped, revealed word by word as it is said.
          const words = ex.line.split(' ');
          const shown = Math.ceil(words.length * Math.min(1, Math.max(0, done)));
          g.font = '27px Atkinson';
          let x = 36, y = FACE_H + 110;
          words.forEach((w, k) => {
            const ww = g.measureText(`${w} `).width;
            if (x + ww > W - 30) { x = 36; y += 36; }
            g.fillStyle = k < shown ? '#f4f1ea' : 'rgba(244,241,234,0.28)';
            g.fillText(w, x, y);
            x += ww;
          });
          return out.toDataURL('image/jpeg', 0.92).split(',')[1];
        }, { ex, W, FACE_H, H, done: ((i + 1) / FPS - LEAD) / Math.max(0.1, speech - 0.2), ms: 1000 / FPS });
        fs.writeFileSync(path.join(frames, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
        if (process.env.DEBUG && i % 10 === 0) console.log(i, await page.evaluate(() => [performance.now(), window.__ex.talker.mouth, window.__ex.cues.map((c) => !!c.fired)]));
      }
      await ctx.close();
      const mp4 = path.join(OUT, `${ex.id}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
        '-i', path.join(OUT, `${ex.id}.wav`), '-filter_complex', `[1:a]adelay=${Math.round(LEAD * 1000)}:all=1,apad[a]`,
        '-map', '0:v', '-map', '[a]', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', mp4]);
      fs.rmSync(frames, { recursive: true, force: true });
      made.push(mp4);
      console.log(`${ex.id}: ${total.toFixed(1)}s`);
    }
    if (made.length > 1) {
      const list = path.join(OUT, 'list.txt');
      fs.writeFileSync(list, made.map((f) => `file '${f}'`).join('\n'));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(OUT, 'talking-faces-examples.mp4')]);
      fs.rmSync(list);
    }
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
