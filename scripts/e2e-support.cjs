// End-to-end check of the gentle support asks (support.js): hidden while the
// Support asks switch is off; with it on, a thank-you on the solved panel at
// the 3rd solve, at most once a week, "Don't ask again" for good, the
// Supporters window from the menu, and the line on printed puzzles. The
// game's server is stood in for.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const API = 'http://localhost:8159';
const SUPPORT = 'https://example.com/support';

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8158'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const open = async (asks) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true })));
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', authUrl: '', tokenUrl: '', siteUrl: '', appVersion: 'test' };
export const cloudEnabled = () => false;
export const CLOUD_URL = CLOUD.learnUrl;` }));
    const cors = { 'Access-Control-Allow-Origin': '*' };
    await ctx.route(`${API}/**`, (r) => (new URL(r.request().url()).pathname === '/v1/config'
      ? r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ announcements: [], disabledThemes: [], features: {}, game: { supportUrl: SUPPORT, supportAsks: asks } }) })
      : r.fulfill({ status: 204, headers: cors, body: '' })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8158/');
    await page.waitForSelector('#support-link:not([hidden])', { state: 'attached', timeout: 15000 });
    // Two puzzles already solved, so the next one is the 3rd.
    await page.evaluate(async () => {
      const store = await import('/js/store.js');
      const at = Date.now() - 86400_000;
      await store.setMeta('solves', [{ at, tier: 'easy', theme: '', ms: 60000 }, { at: at + 1, tier: 'easy', theme: '', ms: 60000 }]);
    });
    return { ctx, page, errors };
  };
  const solve = async (page) => {
    await page.click('#quick-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await page.evaluate(() => {
      const S = window.__flg.state;
      for (const [k, td] of S.grid.cells) {
        const [a, b] = k.split('|');
        if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
      }
    });
    await page.waitForSelector('#solved:not([hidden])');
    await page.waitForTimeout(800);
  };

  {
    const { ctx, page, errors } = await open(false);
    await solve(page);
    assert(await page.isHidden('#support-ask'), 'no ask while Support asks is switched off');
    assert(await page.evaluate(async () => (await import('/js/support.js')).printLine()) === '', 'no support line on printed puzzles');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(true);
    await solve(page);
    assert(await page.isVisible('#support-ask'), 'the 3rd solve shows a thank-you ask');
    assert(/free, has no ads, and is made by one person/.test(await page.textContent('#support-ask-text')), 'it uses the approved words');
    assert((await page.getAttribute('#support-ask-go', 'href')) === SUPPORT, 'Support the game goes to the support page');
    assert(/support it at thelogicgrid\.com/.test(await page.evaluate(async () => (await import('/js/support.js')).printLine())), 'printed puzzles carry one support line');
    // The weekly limit: a 10th solve the same week asks nothing.
    const later = await page.evaluate(async () => (await import('/js/support.js')).pick({ solvedCount: 10 }));
    assert(later === null, 'at most one ask a week');
    const nextWeek = await page.evaluate(async () => (await import('/js/support.js')).pick({ solvedCount: 25 }, Date.now() + 8 * 86400_000));
    assert(nextWeek && nextWeek.kind === 'solve', 'a week later the next mark may ask');
    const race = await page.evaluate(async () => (await import('/js/support.js')).pick({ streak: 7, race: true }, Date.now() + 30 * 86400_000));
    assert(race === null, 'never in a race');
    await page.click('#support-ask-never');
    assert(await page.isHidden('#support-ask'), "Don't ask again closes it");
    const never = await page.evaluate(async () => (await import('/js/support.js')).pick({ streak: 30 }, Date.now() + 60 * 86400_000));
    assert(never === null, "Don't ask again means never");
    await page.click('#menu-btn');
    await page.click('#support-link');
    await page.waitForSelector('#dlg-supporters[open]');
    assert(/costs about \$100 a month/.test(await page.textContent('#supporters-text')), 'the menu opens the Supporters window with where the money goes');
    assert((await page.getAttribute('#supporters-go', 'href')) === SUPPORT, 'its button goes to the support page');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  server.kill();
  console.log('support e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
