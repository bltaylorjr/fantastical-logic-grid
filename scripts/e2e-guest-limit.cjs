// Guest puzzles (web/js/guest-limit.js): with accounts on, a guest can start 3
// new puzzles a day across every game; the next one asks them to sign in or
// create a free account. Saved puzzles stay free, and a new day starts fresh.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const PORT = 8193;

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  // Accounts switched on, pointing at nothing (no sign-in happens here).
  const config = "export const CLOUD = { firebaseApiKey: 'test-key', syncUrl: 'http://localhost:59999', authUrl: 'http://localhost:59999/v1', tokenUrl: 'http://localhost:59999/v1', learnUrl: '', siteUrl: 'https://thelogicgrid.com' };\nexport const cloudEnabled = () => true;\nexport const CLOUD_URL = '';\n";
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })); } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const setUsed = (n, day) => page.evaluate(([n, day]) => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('flg.guestPlays', JSON.stringify({ day: day || today, n }));
  }, [n, day]);
  const used = () => page.evaluate(() => JSON.parse(localStorage.getItem('flg.guestPlays') || '{"n":0}').n);
  const toHome = async () => {
    if (await page.locator('#screen-games:not([hidden])').count()) await page.click('#game-cards [data-game=logic-grid]');
    await page.waitForSelector('#screen-home:not([hidden]) #tier-choices input');
  };
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await toHome();
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    assert(/3 of 3 new puzzles left today/.test(await page.textContent('#guest-note')) && await page.isVisible('#guest-note'), 'a guest sees 3 of 3 new puzzles left today');

    await page.click('#quick-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await used() === 1, 'a quick puzzle counts as one guest puzzle');
    await page.click('#back-btn');
    await page.waitForSelector('#screen-home:not([hidden])');
    assert(/2 of 3/.test(await page.textContent('#guest-note')), 'the home screen shows 2 left');

    // Used up: the next new puzzle asks for an account, and nothing starts.
    await setUsed(3);
    await page.reload();
    await toHome();
    assert(/played today's 3 guest puzzles/.test(await page.textContent('#guest-note')), 'the home screen says today\'s guest puzzles are used');
    const saves0 = await page.evaluate(async () => (await (await import('./js/store.js')).listSaves()).length);
    await page.click('#quick-btn');
    await page.waitForSelector('#dlg-confirm[open]');
    assert(/free account/i.test(await page.textContent('#confirm-h')), 'the 4th puzzle asks the guest to create a free account');
    await page.click('#confirm-no');
    await page.waitForTimeout(300);
    const saves1 = await page.evaluate(async () => (await (await import('./js/store.js')).listSaves()).length);
    assert(saves1 === saves0 && await page.isVisible('#screen-home'), 'Not now starts no puzzle');
    await page.click('#gen-btn');
    await page.waitForSelector('#dlg-confirm[open]');
    assert(true, 'Start a new case is limited too');
    await page.click('#confirm-yes');
    await page.waitForSelector('#dlg-account[open]');
    assert(true, 'the ask opens sign-in, where a free account can be made');
    await page.keyboard.press('Escape');

    // Saved puzzles stay free.
    await page.click('#continue-btn');
    await page.waitForSelector('#screen-play:not([hidden])');
    assert(await used() === 3, 'continuing a saved puzzle is free');
    await page.click('#back-btn');
    await page.waitForSelector('#screen-home:not([hidden])');

    // One count for every game: NINETIMESNINE and a grid-kit game are limited too.
    await page.click('#home-btn');
    await page.waitForSelector('#screen-games:not([hidden])');
    await page.click('#game-cards [data-game=ninetimesnine]');
    await page.waitForSelector('#screen-np:not([hidden]) #np-gen');
    assert(/played today's 3/.test(await page.textContent('#np-guest')), 'NINETIMESNINE shows the guest line');
    await page.click('#np-gen');
    await page.waitForSelector('#dlg-confirm[open]');
    assert(true, 'NINETIMESNINE asks for an account after the shared 3');
    await page.click('#confirm-no');
    await page.click('#np-back');
    await page.waitForSelector('#screen-games:not([hidden])');
    await page.click('#game-cards [data-game=cage-math]');
    await page.waitForSelector('#cm-gen:visible', { timeout: 20000 });
    await page.click('#cm-gen');
    await page.waitForSelector('#dlg-confirm[open]');
    assert(true, 'Cage Math asks for an account after the shared 3');
    await page.click('#confirm-no');

    // A new day starts fresh, and the count is shared: a Cage Math puzzle uses one.
    await setUsed(3, '2000-01-01');
    await page.click('#cm-gen');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('flg.guestPlays') || '{"n":0}').n === 1, null, { timeout: 30000 });
    assert(true, 'a new day gives 3 new guest puzzles again, shared with every game');

    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
    console.log('Guest limit checks passed.');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
