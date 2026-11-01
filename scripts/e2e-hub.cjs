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
    // Shared things open over the front page; only the Play buttons open a game page.
    await page.click('.app-item[href="report/"]');
    await page.waitForSelector('dialog.ovl[open] iframe');
    await page.waitForFunction(() => /Close/.test(document.querySelector('dialog.ovl iframe')?.contentDocument?.querySelector('#rp-back-text')?.textContent || ''), null, { timeout: 15000 });
    assert(new URL(page.url()).pathname === '/', 'Report a Problem opens in a window over the front page, which stays put');
    await page.frameLocator('dialog.ovl iframe').locator('#rp-back').click();
    await page.waitForFunction(() => !document.querySelector('dialog.ovl'));
    assert(new URL(page.url()).pathname === '/', 'closing it leaves the player on the front page');
    await page.click('.app-item[href="account/"]');
    await page.waitForURL(`${BASE}/account/`);
    await page.waitForSelector('#ac-main h1');
    assert(/Your account/.test(await page.textContent('#ac-main h1')) && (await page.isVisible('#dlg-account') || await page.isVisible('#ac-off')), 'Account and sync opens its own Account page');
    assert(await page.locator('#ac-back').getAttribute('href') === '../', 'the Account page leads back home');
    await page.goto(`${BASE}/`);
    const frontHtml = await page.content();
    assert(!/support@thelogicgrid\.com/.test(frontHtml) && await page.locator('a.contact-link').count() === 1, 'the support address is not in the page; Contact us builds it when clicked');
    const [mail] = await Promise.all([page.waitForEvent('request', { predicate: (r) => r.url().startsWith('mailto:'), timeout: 3000 }).catch(() => null), page.click('a.contact-link')]);
    assert(!mail || mail.url() === 'mailto:support@thelogicgrid.com', 'Contact us opens an email to support');
    assert(await page.$$eval('a[target=_blank]', (as) => as.every((a) => /noreferrer/.test(a.rel) && /noopener/.test(a.rel))), 'links that open a new tab pass nothing back (noopener noreferrer)');
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
    const shown = await page.$$eval('#app-menu [role=menuitem]', (els) => els.filter((e) => e.offsetParent).map((e) => e.dataset.cmd || e.getAttribute('href')));
    assert(!shown.some((c) => ['account', 'messages', 'install', 'numberplace', 'games', 'site', 'feedback'].includes(c)), `the game menu holds only the game's own things (${shown.join(', ')})`);
    assert(shown.includes('./'), 'and a way back to The Logic Grid home');
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/`);
    await page.click('a.play[href="ninetimesnine/"]');
    await page.waitForURL(`${BASE}/ninetimesnine/`);
    await page.waitForSelector('#np-setup-view:not([hidden]) #np-levels .choice', { timeout: 20000 });
    assert(true, 'it opens NINETIMESNINE on its own page');
    assert(await page.locator('.np-top a[href="../"]').count() >= 1 && await page.locator('a[href="../fantastical/"], a[href*="open=account"]').count() === 0, 'the page links home, and holds only its own things');
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
