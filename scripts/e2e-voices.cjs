// Natural voices: they download by themselves on first launch, speech waits for
// them instead of using robotic voices, and each character's voice suits their name.
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };
const { spawn } = require('child_process');
(async () => {
  const server = spawn('node', [require('path').join(__dirname,'serve.mjs'), require('path').join(__dirname,'..','dist','web'), '8131'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const b = await chromium.launch(); const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => {
    window.__k = []; const Real = Worker;
    // Stand-in for the Kokoro worker: a 2 s "download", then tiny WAV clips.
    window.Worker = function (url, o) {
      if (!String(url).includes('kokoro-worker')) return new Real(url, o);
      const w = { postMessage(m) {
        if (m.type === 'load') { let i = 0; const t = setInterval(() => { i++; w.onmessage({ data: { type: 'progress', file: 'model', loaded: i, total: 4 } }); if (i === 4) { clearInterval(t); w.onmessage({ data: { id: m.id, ok: true } }); } }, 500); }
        if (m.type === 'speak') { window.__k.push(m.voice + '@' + m.speed); const wav = new ArrayBuffer(44); setTimeout(() => w.onmessage({ data: { id: m.id, ok: true, wav } }), 20); }
      } };
      return w;
    };
    HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended && this.onended(), 10); return Promise.resolve(); };
    window.__dev = 0; speechSynthesis.speak = () => { window.__dev++; };
  });
  await page.goto('http://localhost:8131/');
  await page.waitForSelector('#dlg-welcome[open]'); await page.keyboard.press('Escape');
  await page.waitForTimeout(1700);
  assert(/natural voices ready/.test(await page.locator('#toasts').innerText()), 'natural voices start downloading on first launch');
  await page.check('input[name=tier][value=easy]', { force: true });
  await page.check('input[name=theme][value=mystery]', { force: true });
  await page.click('#gen-btn'); await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
  await page.click('#read-story');
  assert(/still getting ready/.test(await page.textContent('#status')), 'Read aloud waits for the natural voices');
  await page.waitForTimeout(2500);
  assert(/Natural voices are ready/.test(await page.locator('#toasts').innerText()), 'player is told when they are ready');
  assert(await page.evaluate(async () => (await (await import('./js/store.js')).loadSettings()).kokoroReady === true), 'ready state saved');
  const k = await page.evaluate(() => window.__k);
  assert(k.length && k[0].startsWith('am_michael'), 'the narrator is the American male voice');
  // Each character sounds like their portrait looks.
  const cast = await page.$$eval('.cast-btn', (bs) => bs.map((x) => [x.dataset.who, x.querySelector('[data-gender]') && x.querySelector('[data-gender]').dataset.gender]));
  for (const [who, g] of cast) {
    const before = (await page.evaluate(() => window.__k.length));
    await page.click(`.cast-btn[data-who="${who}"]`); await page.waitForTimeout(300);
    const v = (await page.evaluate((n) => window.__k.slice(n), before))[0] || '';
    assert(g && v.startsWith(g === 'f' ? 'af_' : 'am_'), `${who} looks ${g === 'f' ? 'like a woman' : 'like a man'} and speaks with a ${g === 'f' ? "woman's" : "man's"} voice (${v})`);
  }
  assert(await page.evaluate(() => window.__dev) === 0, 'no robotic computer voice was used');
  // Clock times are said as words, never "ten zero zero PM".
  const said = await page.evaluate(async () => (await import('./js/ai.js')).speechText('Ann arrived at 10:00 PM. Bo came at 9:45 p.m., Cy at 7:05 AM and Di at 12:30.'));
  assert(said === 'Ann arrived at ten PM. Bo came at nine forty-five PM, Cy at seven oh five AM and Di at twelve thirty.', `times are spoken as words (${said})`);
  assert(!errs.length, 'no page errors');
  await b.close(); server.kill();
})();
