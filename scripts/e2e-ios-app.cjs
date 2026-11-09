// The iPhone and iPad app (mobile/ios) follows App Review rules the website
// doesn't need: no Install menu (other platforms' downloads), no Support link
// or supporter extras (outside payments, Guideline 3.1.1), and no app key
// window. The website keeps all of them. docs/APP-STORE.md explains why.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };

const PORT = 8139;
(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), String(PORT)], { stdio: 'ignore' });
  await require('./wait-port.cjs')(PORT);
  const browser = await chromium.launch();
  const errors = [];
  async function open(ios) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    await ctx.addInitScript((native) => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device' }));
      if (native) window.FLGNative = { platform: 'ios' };
    }, ios);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('#tier-choices input');
    return { ctx, page };
  }
  try {
    const app = await open(true);
    const r = await app.page.evaluate(async () => {
      const rc = await import('./js/remote-config.js');
      const perks = await import('./js/perks.js');
      return {
        install: document.querySelector('[data-cmd=install]').hidden,
        iosApp: rc.iosApp(),
        support: rc.supportUrl(),
        extras: rc.extrasUrl(),
        premium: perks.isPremium(),
        keyWindow: !!document.querySelector('#dlg-license[open], #license-gate:not([hidden])'),
      };
    });
    assert(r.iosApp, 'the page knows it is inside the iPhone app');
    assert(r.install, 'Install the app is hidden in the iPhone app');
    assert(r.support === '' && r.extras === '', 'no Support or extras links in the iPhone app');
    assert(r.premium === false, 'supporter extras stay locked in the iPhone app');
    assert(!r.keyWindow, 'no app key window in the iPhone app');
    await app.ctx.close();

    const web = await open(false);
    const w = await web.page.evaluate(async () => ({ install: document.querySelector('[data-cmd=install]').hidden, iosApp: (await import('./js/remote-config.js')).iosApp() }));
    assert(!w.iosApp && !w.install, 'the website on an iPhone still offers Install the app');
    await web.ctx.close();
    assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
