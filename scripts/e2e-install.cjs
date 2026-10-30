// Install the app: the menu offers the Windows desktop download (the newest
// installer from GitHub Releases) and an icon on the phone's home screen
// (the browser's install prompt, or Share > Add to Home Screen on iPhone).
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };

const PORT = 8134;
const RELEASE = {
  tag_name: 'v9.9.9',
  assets: [
    { name: 'latest.json', size: 1000, browser_download_url: 'https://example.com/latest.json' },
    { name: 'The.Fantastical.Logic.Grid_9.9.9_x64-setup.exe', size: 25 * 1048576, browser_download_url: 'https://example.com/setup.exe' },
  ],
};

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  async function open(options, { release = true, standalone = false } = {}) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', ...options });
    await ctx.route('https://api.github.com/**', (r) => (release ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(RELEASE) }) : r.fulfill({ status: 403, body: '{}' })));
    await ctx.addInitScript((sa) => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device' }));
      if (sa) { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q)); }
    }, standalone);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('#tier-choices input');
    return { ctx, page };
  }
  async function openInstall(page) {
    await page.click('#menu-btn');
    await page.click('[data-cmd=install]');
    await page.waitForSelector('#dlg-install[open]');
  }
  const order = (page) => page.$$eval('#dlg-install .install-opt', (els) => els.filter((e) => !e.hidden).map((e) => e.id));
  try {
    // ---- A Windows computer.
    let { ctx, page } = await open({ viewport: { width: 1280, height: 900 } });
    assert(await page.locator('[data-cmd=install]').count() === 1, 'the menu has Install the app');
    await openInstall(page);
    await page.waitForFunction(() => /setup\.exe$/.test(document.querySelector('#install-desktop-btn').href));
    assert(true, 'Download for Windows points at the newest installer');
    assert(/Version 9\.9\.9, 25 MB/.test(await page.textContent('#install-desktop-size')), 'shows the version and size');
    assert((await order(page))[0] === 'install-desktop', 'on a computer the desktop app comes first');
    assert(await page.isVisible('#install-other'), 'tells computer players how to get the icon on their phone');
    assert(await page.isHidden('#install-ios') && await page.isHidden('#install-android'), 'no phone steps on a computer');
    await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
    assert(await page.isVisible('#install-phone-btn'), 'the browser install prompt is offered when the browser allows it');
    assert(/Install in this browser/.test(await page.textContent('#install-phone-btn')), 'labelled for a computer');
    const small = await page.$$eval('#dlg-install .btn', (els) => els.filter((b) => b.offsetParent && b.offsetHeight < 44).map((b) => b.textContent));
    assert(!small.length, `buttons are at least 44 px tall ${small.join(', ')}`);
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'install-desktop.png') });
    await page.keyboard.press('Escape');
    await ctx.close();

    // ---- GitHub not answering: the button still opens the release page.
    ({ ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, { release: false }));
    await openInstall(page);
    await page.waitForTimeout(500);
    assert(/\/releases\/latest$/.test(await page.getAttribute('#install-desktop-btn', 'href')), 'falls back to the release page');
    await ctx.close();

    // ---- An Android phone.
    ({ ctx, page } = await open({ ...devices['Pixel 7'] }));
    await openInstall(page);
    assert((await order(page))[0] === 'install-phone', 'on a phone the home screen icon comes first');
    assert(await page.isVisible('#install-android'), 'Android steps shown before the browser offers its prompt');
    let prompted = false;
    await page.exposeFunction('flgPrompted', () => { prompted = true; });
    await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => window.flgPrompted(); e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    assert(await page.isVisible('#install-phone-btn') && await page.isHidden('#install-android'), 'one button replaces the steps once the browser can install');
    assert(/Add to home screen/.test(await page.textContent('#install-phone-btn')), 'labelled Add to home screen');
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'install-android.png') });
    await page.click('#install-phone-btn');
    await page.waitForSelector('#dlg-install[open]', { state: 'detached' });
    assert(prompted, 'the button opens the browser install prompt');
    await ctx.close();

    // ---- An iPhone.
    ({ ctx, page } = await open({ ...devices['iPhone 14'], defaultBrowserType: undefined }));
    await openInstall(page);
    assert(await page.isVisible('#install-ios'), 'iPhone players get Share > Add to Home Screen steps');
    assert(/Add to Home Screen/.test(await page.textContent('#install-ios')), 'steps name Add to Home Screen');
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'install-ios.png') });
    await ctx.close();

    // ---- Already opened from the home screen icon.
    ({ ctx, page } = await open({ ...devices['Pixel 7'] }, { standalone: true }));
    await openInstall(page);
    assert(await page.isVisible('#install-phone-done') && await page.isHidden('#install-android'), 'says the icon is already installed');
    await ctx.close();

    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})();
