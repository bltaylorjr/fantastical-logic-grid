// End-to-end check of Menu > Printable puzzle pack: signed out it asks for a
// sign-in; signed in it shows the allowance, writes brand-new puzzles, swaps a
// story the server says was already in a pack, prints a contents page, the
// puzzles and their answer keys, and adds them to Saved puzzles. With no packs
// left the button is off. The game's server and Firebase are stood in for.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const API = 'http://localhost:8159';

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8158'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const open = async ({ signedIn, left = 2 }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true }));
      if (s) localStorage.setItem('flg.auth', JSON.stringify({ uid: 'u-1', email: 'p@example.com', refreshToken: 'x', verified: true, remember: true }));
      window.print = () => { window.__printed = document.getElementById('print-root').innerHTML; };
    }, signedIn);
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CLOUD = { firebaseApiKey: 'k', syncUrl: '${API}', learnUrl: '${API}', authUrl: '${API}', tokenUrl: '${API}', siteUrl: '', appVersion: 'test' };
export const cloudEnabled = () => true;
export const CLOUD_URL = CLOUD.learnUrl;` }));
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    const posts = [];
    let state = { on: true, size: 5, perPeriod: 2, periodDays: 7, used: 2 - left, left, nextAt: left ? null : Date.now() + 3 * 86400_000 };
    await ctx.route(`${API}/**`, (r) => {
      const req = r.request();
      const p = new URL(req.url()).pathname;
      const reply = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors, body: '' });
      if (p === '/token') return reply({ id_token: 'id', expires_in: '3600' });
      if (p === '/v1/config') return reply({ announcements: [], disabledThemes: [], features: {}, game: {} });
      if (p === '/v1/print-packs' && req.method() === 'GET') return reply(state);
      if (p === '/v1/print-packs') {
        const body = JSON.parse(req.postData());
        posts.push(body.stories);
        // The first try: the server has already handed out the first story.
        if (posts.length === 1) return reply({ ...state, error: 'used', stories: [body.stories[0]] }, 409);
        state = { ...state, used: state.used + 1, left: state.left - 1 };
        return reply({ ok: true, ...state });
      }
      return reply({});
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8158/');
    await page.waitForTimeout(1500);
    return { ctx, page, errors, posts };
  };
  const openPack = async (page) => {
    // The pick-a-screen-name window opens for a new account; it is not part of this check.
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('#menu-btn');
    assert(await page.isVisible('[data-cmd=pack]'), 'the menu has Printable puzzle pack');
    await page.click('[data-cmd=pack]');
    await page.waitForSelector('#dlg-pack[open]');
  };

  {
    const { ctx, page, errors } = await open({ signedIn: false });
    await openPack(page);
    assert(await page.isVisible('#pack-signin') && await page.isHidden('#pack-form'), 'signed out, it asks the player to sign in');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors, posts } = await open({ signedIn: true });
    await openPack(page);
    await page.waitForFunction(() => /left right now/.test(document.querySelector('#pack-intro').textContent));
    assert(/2 packs every week, with up to 5 puzzles in each\. You have 2 left/.test(await page.textContent('#pack-intro')), 'it shows the allowance');
    assert((await page.$$eval('#pack-count option', (o) => o.length)) === 5, 'the player picks up to the pack size');
    await page.selectOption('#pack-count', '2');
    await page.selectOption('#pack-tier', 'basic');
    const savedBefore = await page.evaluate(async () => (await (await import('/js/store.js')).listSaves()).length);
    await page.click('#pack-go');
    await page.waitForFunction(() => window.__printed, null, { timeout: 60000 });
    const html = await page.evaluate(() => window.__printed);
    assert(posts.length === 2 && posts.every((s) => s.length === 2), 'the pack is counted once the swapped story is replaced');
    assert(!posts[1].includes(posts[0][0]) && new Set(posts[1]).size === 2, 'the story already handed out is swapped for a new one');
    assert(/In this pack/.test(html) && /Puzzle 1: /.test(html) && /Puzzle 2: /.test(html), 'it prints a contents page and both puzzles');
    assert((html.match(/Answer key<\/h1>/g) || []).length === 2 && html.indexOf('Puzzle 2: ') < html.indexOf('Answer key</h1>'), 'answer keys come together at the back');
    assert(/Basic/.test(html), 'the puzzles are the chosen difficulty');
    const savedAfter = await page.evaluate(async () => (await (await import('/js/store.js')).listSaves()).length);
    assert(savedAfter === savedBefore + 2, 'the puzzles are added to Saved puzzles');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open({ signedIn: true, left: 0 });
    await openPack(page);
    await page.waitForFunction(() => /used them all/.test(document.querySelector('#pack-intro').textContent));
    assert(/next pack is ready in 3 days/.test(await page.textContent('#pack-intro')), 'with none left, it says when the next one is ready');
    assert(await page.isDisabled('#pack-go'), 'and Make and print is off');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  server.kill();
  console.log('print pack e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
