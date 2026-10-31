// Responsive layout check in headless Chromium: the home screen, a Hard
// puzzle and the Settings dialog at phone, tablet, laptop and monitor sizes,
// at 200% zoom and at the desktop app's smallest window. At every size the
// page must not scroll sideways (the grid may scroll inside its own frame),
// every button, field and grid cell must be at least 44 px, and on wide
// screens the scene sits beside the story so the grid comes up into view.
// The Menu (with every item shown) must fit below the app bar, scroll inside
// itself to its last item, and have a solid background.
// SHOTS=<folder> saves a screenshot of each (CI keeps them as an artifact).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const SHOTS = process.env.SHOTS;

const SIZES = [
  ['phone 320', 320, 640], ['phone 390', 390, 844], ['phone on its side', 844, 390],
  ['tablet portrait', 768, 1024], ['tablet landscape', 1024, 768], ['laptop', 1366, 768],
  ['monitor', 1920, 1080], ['large monitor', 2560, 1440],
  // 200% zoom on a 1280 x 800 laptop is a 640 x 400 CSS-pixel viewport.
  ['200% zoom', 640, 400], ['desktop app, smallest window', 360, 480],
];

// Problems on the page as it is now: sideways scrolling and small targets.
const inspect = () => {
  const vw = document.documentElement.clientWidth;
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, td.c')) {
    if (el.matches('table.lg.fit td.c')) continue; // a grid made to fit the screen (checked below)
    if (el.closest('[hidden], .sr-only, .skip')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (el.tagName === 'A' && cs.display === 'inline') continue; // links inside a sentence
    if (el.matches('input[type=radio], input[type=checkbox]') && el.closest('label')) r = el.closest('label').getBoundingClientRect();
    if (Math.round(Math.min(r.width, r.height)) < 44) small.push(`${el.id ? `#${el.id}` : el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { sideways: document.documentElement.scrollWidth - vw, small: [...new Set(small)] };
};

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8131'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const [name, width, height] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
      const file = (s) => SHOTS && path.join(SHOTS, `${name.replace(/[^a-z0-9]+/gi, '-')}-${s}.png`);
      await page.goto('http://localhost:8131/');
      await page.waitForSelector('#tier-choices input');
      if (await page.locator('#dlg-welcome[open]').count()) await page.keyboard.press('Escape');

      let p = await page.evaluate(inspect);
      assert(await page.evaluate(() => document.querySelector('#view-seg').hidden), `${name}: the Grid / List switch is hidden on the home screen`);
      if (SHOTS) await page.screenshot({ path: file('home'), fullPage: true });
      assert(p.sideways <= 0, `${name} (${width} x ${height}): the home screen does not scroll sideways`);
      assert(!p.small.length, `${name}: every target on the home screen is at least 44 px${p.small.length ? ` (${p.small.join(', ')})` : ''}`);

      // Menu with every item shown (as for a signed-in player on the website).
      await page.evaluate(() => document.querySelectorAll('#app-menu [hidden]').forEach((el) => { el.hidden = false; }));
      await page.click('#menu-btn');
      await page.waitForSelector('#app-menu:not([hidden])');
      const m = await page.evaluate(() => {
        const menu = document.querySelector('#app-menu'), last = menu.lastElementChild;
        menu.scrollTop = menu.scrollHeight;
        const r = menu.getBoundingClientRect(), l = last.getBoundingClientRect();
        const bg = getComputedStyle(menu).backgroundColor, a = bg.match(/[\d.]+/g);
        return { bottom: r.bottom, lastIn: l.top >= r.top - 1 && l.bottom <= r.bottom + 1, opaque: !(a && a.length === 4 && +a[3] < 1) && bg !== 'transparent' };
      });
      if (SHOTS) await page.screenshot({ path: file('menu') });
      assert(m.bottom <= height + 1, `${name}: the Menu fits on screen (bottom ${Math.round(m.bottom)} px)`);
      assert(m.lastIn, `${name}: the Menu scrolls to its last item`);
      assert(m.opaque, `${name}: the Menu has a solid background`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const menu = document.querySelector('#app-menu'); if (!menu.hidden) document.querySelector('#menu-btn').click(); });

      await page.check('input[name=tier][value=hard]', { force: true });
      await page.click('#gen-btn');
      await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
      await page.waitForSelector('td.c');
      p = await page.evaluate(inspect);
      if (SHOTS) await page.screenshot({ path: file('play'), fullPage: true });
      assert(p.sideways <= 0, `${name}: the puzzle screen does not scroll sideways`);
      assert(!p.small.length, `${name}: every target on the puzzle screen is at least 44 px${p.small.length ? ` (${p.small.join(', ')})` : ''}`);
      const frame = await page.evaluate(() => { const f = document.querySelector('#gridframe').getBoundingClientRect(); return { right: f.right, h: f.height }; });
      assert(frame.right <= width && frame.h <= height, `${name}: the grid's frame fits on screen`);
      // The grid never scrolls sideways: on a narrow screen it fits the frame's
      // width (Bobby, 2026-10-31); otherwise the squares stay 44 px.
      const g = await page.evaluate(() => { const f = document.querySelector('#gridframe'); return { over: f.scrollWidth - f.clientWidth, fit: !!f.querySelector('table.lg.fit'), cell: f.querySelector('td.c').getBoundingClientRect().width }; });
      assert(g.over <= 0, `${name}: the grid fits its frame's width, no sideways scrolling (${Math.round(g.cell)} px squares)`);
      if (!g.fit) assert(g.cell >= 44, `${name}: grid cells are ${Math.round(g.cell)} px`);
      if (width >= 1100) {
        const top = await page.evaluate(() => document.querySelector('#grid-region').getBoundingClientRect().top + scrollY);
        const scene = await page.evaluate(() => { const s = document.querySelector('#scene').getBoundingClientRect(), t = document.querySelector('#story').getBoundingClientRect(); return { beside: s.left >= t.right, top: Math.abs(s.top - t.top) }; });
        assert(scene.beside && scene.top < 2, `${name}: the scene sits beside the story, so the grid starts at ${Math.round(top)} px`);
      }
      // The Grid / List switch sits in the app bar, so it stays in reach after scrolling down.
      if (height > 560) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(100);
        const seg = await page.evaluate(() => { const r = document.querySelector('#view-seg').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width }; });
        assert(seg.w > 0 && seg.top >= 0 && seg.bottom <= height, `${name}: the Grid / List switch stays on screen after scrolling down`);
        await page.click('#view-seg label:nth-child(2)');
        assert(await page.evaluate(() => !document.querySelector('#listview').hidden && document.querySelector('#gridframe').hidden), `${name}: the switch in the app bar shows the list`);
        if (SHOTS) await page.screenshot({ path: file('play-scrolled') });
        await page.click('#view-seg label:nth-child(1)');
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (height <= 560) {
        assert(await page.evaluate(() => getComputedStyle(document.querySelector('.appbar')).position !== 'sticky'), `${name}: the app bar scrolls away on a short screen`);
      }

      await page.evaluate(() => document.querySelector('#dlg-settings').showModal());
      await page.waitForTimeout(100);
      p = await page.evaluate(() => { const d = document.querySelector('#dlg-settings').getBoundingClientRect(); return { fits: d.left >= 0 && d.right <= innerWidth && d.height <= innerHeight }; });
      const t = await page.evaluate(inspect);
      if (SHOTS) await page.screenshot({ path: file('settings') });
      assert(p.fits && t.sideways <= 0, `${name}: Settings fits on screen`);
      assert(!t.small.length, `${name}: every target in Settings is at least 44 px${t.small.length ? ` (${t.small.join(', ')})` : ''}`);
      await ctx.close();
    }
    assert(!errors.length, `no script errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
