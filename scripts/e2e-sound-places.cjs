// Settings > Sound: sound effects and voices switch on and off by where they
// play (while solving, at the finish, the story), on and off only. Voices
// start off while solving, so Read the clues aloud is hidden until they are
// on; the story and the finish keep their voices. All sound off greys out the
// rest. The grid games and NINETIMESNINE split their Sound effects switch the
// same way and keep an older "off" choice.
// Also the phone fixes for WS-85GS9WF5: small squares stay square, and the
// app bar on a puzzle is one slim row (#330).
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8163'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('flg.game')) localStorage.setItem('flg.game', 'logic-grid'); } catch (e) { /* no storage */ } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8163/');
    await page.waitForSelector('#tier-choices input');
    if (await page.locator('#dlg-welcome[open]').count()) await page.keyboard.press('Escape');
    await page.check('input[name=tier][value=easy]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden]) td.c', { timeout: 60000 });

    assert(await page.locator('#read-story').isVisible(), 'Read the story aloud shows: story voices start on');
    assert(await page.locator('#read-clues').isHidden(), 'Read the clues aloud is hidden: voices while solving start off');

    await page.click('#menu-btn');
    await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    const box = (n) => page.locator(`#settings-form input[name=${n}]`);
    const states = {};
    for (const n of ['sound', 'sfxPlay', 'sfxFinish', 'speechStory', 'speechPlay', 'speechFinish']) states[n] = await box(n).isChecked();
    assert(states.sound && states.sfxPlay && states.sfxFinish && states.speechStory && !states.speechPlay && states.speechFinish,
      `the switches start as: effects on, story and finish voices on, voices while solving off (${JSON.stringify(states)})`);
    assert(await page.locator('#sound-settings input[type=checkbox]').count() === 7, 'each place has one on/off switch (plus All sound and Theme music)');
    assert(await page.locator('#sound-settings select').count() === 0, 'no choosing of effects or voices, on and off only');

    await box('speechPlay').check();
    assert(await page.locator('#read-clues').isVisible(), 'voices while solving on: Read the clues aloud shows');
    await box('speechStory').uncheck();
    assert(await page.locator('#read-story').isHidden(), 'story voice off: Read the story aloud is hidden');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('flg.settings')));
    assert(saved.speechPlay === true && saved.speechStory === false, 'the choices are saved');

    await box('sound').uncheck();
    const grey = () => page.evaluate(() => [...document.querySelectorAll('#sound-places fieldset')].every((f) => f.disabled));
    assert(await grey() && await box('speechFinish').isDisabled(), 'All sound off greys out the place switches');
    await box('sound').check();
    assert(!(await grey()), 'All sound on brings them back');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector('#screen-play:not([hidden]) td.c, #tier-choices input', { timeout: 60000 });
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('flg.settings')));
    assert(after.speechPlay === true && after.speechStory === false, 'they stay after a reload');
    await ctx.close();

    // The grid games and NINETIMESNINE: two switches in their More options,
    // and an older single "Sound effects off" is kept for both.
    const fs = require('fs');
    for (const [name, dir] of [['the grid games', 'grid-kit'], ['NINETIMESNINE', 'number-place']]) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'modules', dir, 'markup.js'), 'utf8');
      const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', dir, dir === 'grid-kit' ? 'kit.js' : 'ui.js'), 'utf8');
      assert(/-sfxplay"/.test(html) && /-sfxfinish"/.test(html) && !/-sound"/.test(html), `${name}: sound effects while solving and at the finish are separate switches`);
      assert(/prefs\.sfxPlay \?\?= prefs\.sound !== false/.test(ui) && /prefs\.sfxFinish \?\?= prefs\.sound !== false/.test(ui), `${name}: an older "sound off" choice carries over to both`);
    }
    // Phone: square squares, and a bar that folds while scrolling down.
    const phone = await browser.newContext({ ...devices['iPhone 13'] });
    await phone.addInitScript(() => { try { localStorage.setItem('flg.game', 'logic-grid'); } catch (e) { /* no storage */ } });
    const m = await phone.newPage();
    m.on('pageerror', (e) => errors.push(String(e)));
    await m.goto('http://localhost:8163/');
    await m.waitForSelector('#tier-choices input');
    if (await m.locator('#dlg-welcome[open]').count()) await m.keyboard.press('Escape');
    await m.check('input[name=tier][value=hard]', { force: true });
    await m.click('#gen-btn');
    await m.waitForSelector('#screen-play:not([hidden]) td.c', { timeout: 60000 });
    await m.waitForTimeout(500);
    const sq = await m.evaluate(() => { const r = [...document.querySelectorAll('#gridframe td.c')].map((td) => td.getBoundingClientRect()); const spread = (xs) => Math.max(...xs) - Math.min(...xs); return { w: spread(r.map((x) => x.width)), h: spread(r.map((x) => x.height)), odd: r.filter((x) => Math.abs(x.width - x.height) > 1).length }; });
    assert(sq.w <= 1 && sq.h <= 1 && sq.odd === 0, `small squares on a phone are all the same size and square (${JSON.stringify(sq)})`);
    // The bar is one slim row while a puzzle is open (#330), with Grid / List in reach.
    const bar = await m.evaluate(() => { const s = document.querySelector('#view-seg').getBoundingClientRect(); return { h: document.querySelector('.appbar').getBoundingClientRect().height, segIn: s.width > 0 && s.top >= 0 && s.bottom <= innerHeight }; });
    assert(bar.h <= 70 && bar.segIn, `the app bar on a puzzle is one slim row with Grid / List in reach (${Math.round(bar.h)} px)`);
    await phone.close();

    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
