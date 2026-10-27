// End-to-end check of the Contributor badge: the "Count this toward my
// Contributor badge" tick box shows only for a signed-in player while the
// server has the badges on, My stats shows the badge and what is next, and
// the scoreboard badge words for each tier. The game's server is stood in for.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const API = 'http://localhost:8151';

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8150'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const open = async ({ signedIn, on }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true }));
      if (s) {
        localStorage.setItem('flg.auth', JSON.stringify({ uid: 'u-helper', email: 'h@example.com', refreshToken: 'x', verified: true, remember: true }));
        localStorage.setItem('flg.contributor', JSON.stringify({ uid: 'u-helper', enabled: true, count: 6, waiting: 1, tier: 2, nextAt: 10 }));
      }
    }, signedIn);
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', authUrl: '', tokenUrl: '', siteUrl: '', appVersion: 'test' };
export const cloudEnabled = () => false;
export const CLOUD_URL = CLOUD.learnUrl;` }));
    const cors = { 'Access-Control-Allow-Origin': '*' };
    await ctx.route(`${API}/**`, (r) => (new URL(r.request().url()).pathname === '/v1/config'
      ? r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ announcements: [], disabledThemes: [], features: { contributors: on }, game: {} }) })
      : r.fulfill({ status: 204, headers: cors, body: '' })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8150/');
    await page.waitForTimeout(2000);
    return { ctx, page, errors };
  };
  const menu = async (page, cmd) => {
    await page.click('#menu-btn');
    await page.click(`#app-menu [data-cmd="${cmd}"]`);
  };

  {
    const { ctx, page, errors } = await open({ signedIn: true, on: true });
    await menu(page, 'feedback');
    assert(await page.isVisible('#idea-form .fb-credit'), 'a signed-in player sees the Contributor badge tick box on the idea form');
    assert(await page.isChecked('#idea-form [data-credit]'), 'it starts ticked');
    assert(await page.isVisible('#problem-form .fb-credit'), 'and on the problem form');
    await page.click('#dlg-feedback [data-close]');
    await menu(page, 'stats');
    await page.waitForSelector('#stats-contributor h3');
    const text = await page.textContent('#stats-contributor');
    assert(/Silver contributor/.test(text), `My stats shows the Silver contributor badge (${text.trim()})`);
    assert(/6 of your ideas and suggestions have been used by the team\. 4 more for the Gold badge\. 1 more is waiting/.test(text), 'with the count, what is next and what is waiting');
    const pills = await page.evaluate(async () => {
      const m = await import('/js/compete-ui.js');
      return [1, 2, 3, 4].map((t) => { const d = document.createElement('div'); d.innerHTML = m.contributorPill(t); return [d.textContent.trim(), d.firstElementChild.className]; });
    });
    assert(JSON.stringify(pills) === JSON.stringify([['✎ Bronze contributor', 'pill contributor tier-1'], ['✎ Silver contributor', 'pill contributor tier-2'], ['✎ Gold contributor', 'pill contributor tier-3'], ['✎ Platinum contributor', 'pill contributor tier-4']]), `scoreboard badges by tier ${JSON.stringify(pills)}`);
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open({ signedIn: true, on: false });
    await menu(page, 'feedback');
    assert(await page.isHidden('#idea-form .fb-credit'), 'no tick box while the badges are switched off');
    await page.click('#dlg-feedback [data-close]');
    await menu(page, 'stats');
    await page.waitForSelector('#stats-body h3');
    assert(!(await page.textContent('#stats-contributor')).trim(), 'and nothing about it in My stats');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open({ signedIn: false, on: true });
    await menu(page, 'feedback');
    assert(await page.isHidden('#idea-form .fb-credit'), 'a guest sees no tick box');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  server.kill();
  console.log('contributor e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
