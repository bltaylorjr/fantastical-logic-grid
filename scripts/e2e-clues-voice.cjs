// Every clue is read aloud, in order, with nothing skipped. Real (tiny) audio
// clips play here, because browsers fire 'pause' just before 'ended' at the
// end of each clip, which once made the reader stop after the first sentence.
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8133'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => {
    // Stand-in for the Kokoro worker: a quick "download", then 50 ms WAV clips
    // that carry the number of the text they were made from.
    window.__texts = []; window.__played = []; window.__device = []; window.__failOn = null;
    const wavFor = (id) => {
      const n = 400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      v.setUint32(44, id, true);
      return buf;
    };
    const Real = Worker;
    window.Worker = function (url, o) {
      if (!String(url).includes('kokoro-worker')) return new Real(url, o);
      const w = { postMessage(m) {
        if (m.type === 'load') setTimeout(() => w.onmessage({ data: { id: m.id, ok: true } }), 50);
        if (m.type === 'speak') {
          if (window.__failOn && m.text.includes(window.__failOn)) { setTimeout(() => w.onmessage({ data: { id: m.id, ok: false, error: 'test failure' } }), 10); return; }
          window.__texts.push(m.text);
          setTimeout(() => w.onmessage({ data: { id: m.id, ok: true, wav: wavFor(window.__texts.length - 1) } }), 10);
        }
      } };
      return w;
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const el = this;
      // Read the clip's number now: the app frees the clip once it ends.
      const id = fetch(el.src).then((r) => r.arrayBuffer()).then((a) => new DataView(a).getUint32(44, true));
      el.addEventListener('ended', async () => { window.__played.push(window.__texts[await id]); }, { once: true });
      return play.call(el);
    };
    speechSynthesis.speak = (u) => { window.__device.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
  });
  await page.goto('http://localhost:8133/');
  await page.waitForSelector('#dlg-welcome[open]'); await page.keyboard.press('Escape');
  await page.waitForFunction(async () => (await (await import('./js/store.js')).loadSettings()).kokoroReady === true, null, { timeout: 15000 });
  await page.check('input[name=tier][value=medium]', { force: true });
  await page.check('input[name=theme][value=mystery]', { force: true });
  await page.click('#gen-btn'); await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
  const clues = await page.$$eval('#clue-list li', (ls) => ls.map((li) => li.querySelector('.txt').textContent));
  const words = (t) => (t.match(/[A-Za-z]{4,}/g) || []).filter((w) => !/^(Mister|Missus|Miz)$/.test(w));
  const heard = (list) => list.join(' ');

  // 1. When the natural voice fails partway, the rest is still read (by the device voice).
  await page.evaluate(() => { window.__played = []; window.__device = []; window.__failOn = 'Clue 2.'; });
  await page.click('#read-clues');
  await page.waitForFunction(() => document.querySelector('#read-clues').getAttribute('aria-pressed') === 'false', null, { timeout: 60000 });
  await page.waitForTimeout(200);
  const mixed = heard([...(await page.evaluate(() => window.__played)), ...(await page.evaluate(() => window.__device))]);
  assert(clues.every((_, i) => mixed.includes(`Clue ${i + 1}`)), 'after a voice failure every clue is still read');
  assert((await page.evaluate(() => window.__device)).some((t) => t.includes('Clue 2')), 'the failed clue is read by the device voice instead');

  // 2. Read the clues aloud: every clue, in order, with nothing skipped.
  await page.evaluate(() => { window.__played = []; window.__failOn = null; });
  await page.click('#read-clues');
  assert(await page.getAttribute('#read-clues', 'aria-pressed') === 'true', 'the button shows it is reading');
  await page.waitForFunction(() => document.querySelector('#read-clues').getAttribute('aria-pressed') === 'false', null, { timeout: 60000 });
  await page.waitForTimeout(200);
  const all = heard(await page.evaluate(() => window.__played));
  let at = -1, inOrder = true;
  clues.forEach((_, i) => { const k = all.indexOf(`Clue ${i + 1}.`, at + 1); if (k < at) inOrder = false; at = k; });
  assert(clues.every((_, i) => all.includes(`Clue ${i + 1}.`)) && inOrder, `all ${clues.length} clues were read, in order`);
  const missing = clues.flatMap(words).filter((w) => !all.includes(w));
  assert(!missing.length, `every word of every clue was played${missing.length ? ` (missing: ${missing.slice(0, 5).join(', ')})` : ''}`);
  assert(!(await page.$('#clue-list li.reading')), 'the highlight clears when reading ends');

  // 3. A character with several clues says all of them, not just the first.
  const who = await page.$$eval('.cast-btn', (bs) => {
    const best = bs.map((x) => [x.dataset.who, parseInt(x.querySelector('small').textContent, 10)]).sort((a, z) => z[1] - a[1])[0];
    return best[0];
  });
  const mine = await page.$$eval('#clue-list li', (ls, w) => ls.filter((li) => li.querySelector('.from').textContent === `From ${w}`).map((li) => li.querySelector('.txt').textContent), who);
  await page.evaluate(() => { window.__played = []; });
  await page.click(`.cast-btn[data-who="${who}"]`);
  // Wait until nothing new has played for a second.
  for (let last = -1, n = 0; n !== last; ) { last = n; await page.waitForTimeout(1000); n = await page.evaluate(() => window.__played.length); }
  const said = heard(await page.evaluate(() => window.__played));
  const lost = mine.flatMap(words).filter((w) => !said.includes(w));
  assert(mine.length > 1 && !lost.length, `${who} says all ${mine.length} of their clues${lost.length ? ` (missing: ${lost.slice(0, 5).join(', ')})` : ''}`);

  // 4. Pressing the button again stops the reading.
  await page.click('#read-clues');
  await page.waitForTimeout(150);
  await page.click('#read-clues');
  await page.waitForTimeout(300);
  assert(await page.getAttribute('#read-clues', 'aria-pressed') === 'false', 'pressing again stops the reading');

  assert(!errs.length, `no page errors${errs.length ? `: ${errs[0]}` : ''}`);
  await b.close(); server.kill();
})();
