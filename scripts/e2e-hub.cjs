// The website's layout (scripts/hub.mjs), against the website build (dist/site):
// - the front page lists the games and links to each one,
// - old game links (?play=now, ?challenge=...) and the installed app go on to
//   fantastical/, while campaign tags alone stay on the front page,
// - NINETIMESNINE plays on its own page, and the game's menu link opens it,
// - the front page's Look menu is the game's own color setting,
// - Suggest a storyline goes back to the game, and the offline helper covers every page.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const site = path.join(__dirname, '..', 'dist', 'site');
const PORT = 8157;
const BASE = `http://localhost:${PORT}`;
// Fonts come from npm packages; a build without them is still a fair test of everything else.
const ignorable = (t) => /fonts\/|Failed to decode downloaded font|OTS parsing/.test(t);

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), site, String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text() + (m.location().url || ''))) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !ignorable(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    watch(page);

    // ---- The front page
    await page.goto(`${BASE}/`);
    assert(new URL(page.url()).pathname === '/', 'the front page stays put');
    assert(await page.locator('h1').count() === 1 && /Pick your puzzle/.test(await page.locator('h1').textContent()), 'the front page has one heading');
    const play = await page.locator('a.play').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    assert(JSON.stringify(play) === JSON.stringify(['fantastical/', 'ninetimesnine/']), 'it links to both games');
    await page.goto(`${BASE}/?utm_source=facebook&utm_campaign=launch`);
    assert(new URL(page.url()).pathname === '/', 'campaign tags alone stay on the front page');

    // ---- Look: the game's own color setting
    await page.selectOption('#theme-pick', 'dark');
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Look changes the front page');
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('flg.settings')).introOffered === true), 'and keeps the game\'s other settings');
    await page.click('a.play[href="fantastical/"]');
    await page.waitForSelector('#tier-choices input');
    assert(new URL(page.url()).pathname === '/fantastical/', 'Play opens The Fantastical Logic Grid at fantastical/');
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'the game uses the same Look');
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('flg.settings')); s.colorTheme = 'system'; localStorage.setItem('flg.settings', JSON.stringify(s)); });

    // ---- Old links go on to the game
    await page.goto(`${BASE}/?play=now&utm_source=email`);
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const forwarded = new URL(page.url());
    assert(forwarded.pathname === '/fantastical/', 'an old ?play=now link goes on to the game');
    assert(!forwarded.searchParams.has('play') || forwarded.searchParams.get('play') === 'now', 'and the game opens a puzzle from it');
    await page.goto(`${BASE}/?learn`);
    await page.waitForURL(/\/fantastical\/\?learn/);
    assert(true, 'an old ?learn link goes on to How to play');

    // ---- The installed app used to start at /
    const app = await ctx.newPage();
    watch(app);
    await app.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
    });
    await app.goto(`${BASE}/`);
    await app.waitForURL(`${BASE}/fantastical/`);
    await app.waitForSelector('#tier-choices input');
    assert(true, 'the installed app, opened at its old start address, goes to the game');
    await app.click('#menu-btn');
    await app.click('a[role=menuitem][href="./"]');
    await app.waitForURL(`${BASE}/`);
    await app.waitForSelector('a.play');
    assert(true, 'the game menu\'s The Logic Grid home opens the front page, even in the installed app');
    await app.close();
    const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    assert(manifest.id === './' && manifest.start_url === 'fantastical/', 'the app keeps its identity and now starts at the game');
    const front = await (await fetch(`${BASE}/`)).text();
    assert(/<link rel="manifest" href="manifest.webmanifest">/.test(front), 'the front page links the app manifest (Microsoft Store packaging reads it)');

    // ---- NINETIMESNINE on its own page, from the game's menu
    await page.goto(`${BASE}/fantastical/`);
    await page.waitForSelector('#tier-choices input');
    await page.click('#menu-btn');
    const link = page.locator('[data-cmd=numberplace]');
    assert(await link.isVisible(), 'the game menu still has Play NINETIMESNINE');
    await link.click();
    await page.waitForURL(`${BASE}/ninetimesnine/`);
    await page.waitForSelector('#np-setup-view:not([hidden]) #np-levels .choice', { timeout: 20000 });
    assert(true, 'it opens NINETIMESNINE on its own page');
    assert(await page.locator('.np-top a[href="../"]').count() >= 1 && await page.locator('.np-top a[href="../fantastical/"]').count() === 1, 'the page links back to all games and to the other game');
    await page.goto(`${BASE}/ninetimesnine/?style=rival`);
    await page.waitForSelector('#np-setup-view:not([hidden]) #np-levels .choice', { timeout: 20000 });
    assert(true, 'a ?style= link opens it too');

    // ---- Website pages around the game
    await page.goto(`${BASE}/storyline/`);
    assert(await page.locator('#sl-back').getAttribute('href') === '../fantastical/', 'Suggest a storyline goes back to the game');
    const sw = await (await fetch(`${BASE}/sw.js`)).text();
    assert(/"fantastical\/"/.test(sw) && /"ninetimesnine\/"/.test(sw) && /"\.\/"/.test(sw), 'the offline helper keeps all three pages');
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    assert(/\/fantastical\/<\/loc>/.test(sitemap) && /\/ninetimesnine\/<\/loc>/.test(sitemap), 'the sitemap lists both games');

    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
