// The full cast in play: each character shows their personality, leads into
// their clues in their own way, offers a hint and cheers the solve, and
// speaks with their own voice. Run after `npm run build`.
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const { PERSONALITIES, profileOf } = await import('../web/js/castbook.js');
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8137'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const b = await chromium.launch();
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => {
    // Stand-in Kokoro worker that records which voice spoke, and can pretend a
    // downloadable voice is unavailable (offline) so its stand-in speaks.
    window.__k = []; window.__offline = false;
    const Real = Worker;
    window.Worker = function (url, o) {
      if (!String(url).includes('kokoro-worker')) return new Real(url, o);
      const w = { postMessage(m) {
        if (m.type === 'load') setTimeout(() => w.onmessage({ data: { id: m.id, ok: true } }), 20);
        if (m.type === 'speak') {
          const voice = window.__offline && m.standIn ? m.standIn : m.voice;
          window.__k.push({ voice, asked: m.voice, speed: m.speed, text: m.text });
          setTimeout(() => w.onmessage({ data: { id: m.id, ok: true, wav: new ArrayBuffer(44), voice } }), 10);
        }
      } };
      return w;
    };
    HTMLMediaElement.prototype.play = function () { setTimeout(() => this.dispatchEvent(new Event('ended')), 5); return Promise.resolve(); };
    speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5);
  });
  // Picture clues keep one clue locked; this test checks every witness's lines.
  await page.goto('http://localhost:8137/?pictures=0');
  await page.waitForSelector('#dlg-welcome[open]'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('flg.settings') || '{}')).kokoroReady === true, null, { timeout: 15000 });
  await page.waitForSelector('.toast', { state: 'detached', timeout: 15000 });
  await page.check('input[name=tier][value=basic]', { force: true });
  await page.check('input[name=theme][value=mystery]', { force: true });
  await page.click('#gen-btn'); await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });

  // 1. Every cast member shows their personality, and their face shows it too.
  const cast = await page.$$eval('.cast-btn', (bs) => bs.map((x) => ({ who: x.dataset.who, trait: x.querySelector('.trait') && x.querySelector('.trait').textContent, mood: x.querySelector('[data-personality]') && x.querySelector('[data-personality]').dataset.personality })));
  assert(cast.length >= 3 && cast.every((c) => c.trait === profileOf(c.who).label), `each character shows their personality (${cast.map((c) => `${c.who}: ${c.trait}`).join(', ')})`);
  assert(cast.every((c) => c.mood === profileOf(c.who).personality), 'each face is drawn for their personality');
  assert(new Set(cast.map((c) => c.trait)).size >= Math.min(cast.length, 3), 'the cast has different personalities');

  // 2. Offline, a voice that has not downloaded yet is read by its stand-in,
  // and that clip is not kept, so their own voice speaks once it can.
  const away = cast.find((c) => profileOf(c.who).voice.standIn !== profileOf(c.who).voice.kokoro);
  if (away) {
    await page.evaluate(() => { window.__offline = true; });
    const before = await page.evaluate(() => window.__k.length);
    await page.click(`.cast-btn[data-who="${away.who}"]`); await page.waitForTimeout(250);
    const said = (await page.evaluate((n) => window.__k.slice(n), before)).find((k) => k.asked === profileOf(away.who).voice.kokoro);
    assert(said && said.voice === profileOf(away.who).voice.standIn, `${away.who}'s stand-in voice reads while their own is not downloaded`);
    await page.evaluate(() => { window.__offline = false; });
  } else console.log('    (no downloadable voice in this cast)');

  // 3. Tapping a character: who they are, their clues in their own words, in their own voice.
  for (const c of cast) {
    const p = profileOf(c.who);
    const before = await page.evaluate(() => window.__k.length);
    await page.click(`.cast-btn[data-who="${c.who}"]`); await page.waitForTimeout(250);
    const bubble = await page.textContent('#bubble');
    const own = PERSONALITIES[p.personality];
    assert(bubble.includes(p.about), `${c.who}'s bubble tells who they are (${p.about})`);
    assert([...own.clue, ...own.nothing].some((l) => bubble.includes(l)), `${c.who} speaks like a ${p.label.toLowerCase()} character`);
    const said = (await page.evaluate((n) => window.__k.slice(n), before))[0];
    assert(said && said.asked === p.voice.kokoro && Math.abs(said.speed - p.voice.pace) < 1e-9, `${c.who} speaks with their own voice (${said && said.asked}@${said && said.speed})`);
  }

  // 4. A hint comes with a word from one of the cast.
  await page.click('[data-act=hint]'); await page.waitForSelector('#hintbox:not([hidden])');
  const line = await page.textContent('#hintbox .char-line').catch(() => '');
  const helper = cast.find((c) => line.startsWith(`${c.who}:`));
  assert(helper && PERSONALITIES[profileOf(helper.who).personality].hint.some((l) => line.includes(l)), `a character offers the hint in their own way (${line})`);
  await page.click('#hint-close');

  // 5. Solving: the winner cheers in their own words.
  await page.evaluate(() => {
    const S = window.__flg.state;
    for (const [k, td] of S.grid.cells) {
      const [a, b2] = k.split('|');
      if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b2))) td.click(), td.click();
    }
  });
  await page.waitForSelector('#solved:not([hidden])');
  const cheer = await page.textContent('#resolution .cheer').catch(() => '');
  const winner = cast.find((c) => cheer.startsWith(`${c.who}:`));
  assert(winner && PERSONALITIES[profileOf(winner.who).personality].solve.some((l) => cheer.includes(l)), `the winner cheers in their own words (${cheer})`);

  assert(errs.length === 0, `no page errors ${errs.join(' | ')}`);
  await b.close(); server.kill();
})().catch((e) => { console.error(e); process.exit(1); });
