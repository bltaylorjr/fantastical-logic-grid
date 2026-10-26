// End-to-end check of supporter extra themes: marked and closed for everyone
// else, with the Get the extras link; open for a premium supporter; and the
// Bronze to Platinum supporter badges on the scoreboard. The game's server is stood in for.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const API = 'http://localhost:8149';
const EXTRAS = 'https://example.com/extras';
const CHECKOUT = 'https://flg.lemonsqueezy.com/buy/abc-123';

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8148'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const open = async (premium, { extras = EXTRAS, signedIn = premium } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(([p, s]) => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true }));
      if (s) localStorage.setItem('flg.auth', JSON.stringify({ uid: 'u-premium', email: 'p@example.com', refreshToken: 'x', verified: true, remember: true }));
      if (p) localStorage.setItem('flg.perks', JSON.stringify({ uid: 'u-premium', supporter: true, premium: true, until: null }));
    }, [premium, signedIn]);
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', authUrl: '', tokenUrl: '', siteUrl: '', appVersion: 'test' };
export const cloudEnabled = () => false;
export const CLOUD_URL = CLOUD.learnUrl;` }));
    const cors = { 'Access-Control-Allow-Origin': '*' };
    await ctx.route(`${API}/**`, (r) => (new URL(r.request().url()).pathname === '/v1/config'
      ? r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ announcements: [], disabledThemes: [], features: {}, game: { premiumThemes: ['mystery'], extrasUrl: extras } }) })
      : r.fulfill({ status: 204, headers: cors, body: '' })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8148/');
    await page.waitForSelector('#extras-note:not([hidden])', { timeout: premium ? 3000 : 15000 }).catch(() => {});
    await page.waitForTimeout(premium ? 2500 : 0);
    return { ctx, page, errors };
  };

  {
    const { ctx, page, errors } = await open(false);
    const mystery = page.locator('input[name=theme][value=mystery]');
    assert(await mystery.isDisabled(), 'a supporter extra theme cannot be picked by a free player');
    assert(/Supporter extra/.test(await page.textContent('label.choice.locked')), 'it is marked "Supporter extra"');
    assert(await page.isVisible('#extras-note'), 'the note about extras shows');
    assert((await page.getAttribute('#extras-link', 'href')) === EXTRAS && await page.isVisible('#extras-link'), 'the Get the extras link goes to the extras page');
    assert(!(await page.locator('input[name=theme][value=fantasy]').isDisabled()), 'other themes stay open');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(true);
    assert(!(await page.locator('input[name=theme][value=mystery]').isDisabled()), 'a premium supporter can pick the extra theme');
    assert(await page.isHidden('#extras-note'), 'no extras note for a premium supporter');
    const pills = await page.evaluate(async () => {
      const m = await import('/js/compete-ui.js');
      return [1, 2, 3, 4, true].map((t) => { const d = document.createElement('div'); d.innerHTML = m.supporterPill(t); return [d.textContent.trim(), d.firstElementChild.className]; });
    });
    assert(JSON.stringify(pills) === JSON.stringify([['★ Bronze supporter', 'pill supporter tier-1'], ['★ Silver supporter', 'pill supporter tier-2'], ['★ Gold supporter', 'pill supporter tier-3'], ['★ Platinum supporter', 'pill supporter tier-4'], ['★ Bronze supporter', 'pill supporter tier-1']]), `scoreboard badges by tier ${JSON.stringify(pills)}`);
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(false, { extras: CHECKOUT, signedIn: true });
    const href = new URL(await page.getAttribute('#extras-link', 'href'));
    assert(href.searchParams.get('checkout[custom][uid]') === 'u-premium' && href.searchParams.get('checkout[email]') === 'p@example.com', 'a Lemon Squeezy checkout link carries the signed-in player');
    await ctx.close();
  }
  await browser.close();
  server.kill();
  console.log('perks e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
