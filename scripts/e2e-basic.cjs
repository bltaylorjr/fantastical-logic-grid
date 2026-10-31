// Basic / Interactive switch: Interactive by default; Basic gives the first
// version's layout and colors (no glass, glow, banner art or theme glyphs),
// keeps the pictures, voices, races and badges, and stays chosen after a
// reload. Text contrast of the Basic colors in every look.
// SHOTS=<folder> saves screenshots.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const SHOTS = process.env.SHOTS;

function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8138'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:8138/');
    await page.waitForSelector('#tier-choices input');
    if (await page.locator('#dlg-welcome[open]').count()) await page.keyboard.press('Escape');

    // 1. Interactive by default.
    assert(await page.evaluate(() => !document.documentElement.dataset.look), 'Interactive is the default');
    assert(await page.getAttribute('#mode-switch [data-look=interactive]', 'aria-pressed') === 'true', 'the switch shows Interactive');
    assert(await page.evaluate(() => getComputedStyle(document.querySelector('.tile .glyph')).display !== 'none'), 'Interactive has the theme pictures on its tiles');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'interactive-home.png') });

    // 2. Basic: the first version's look.
    await page.click('#mode-switch [data-look=basic]');
    assert(await page.evaluate(() => document.documentElement.dataset.look) === 'basic', 'the switch turns Basic on');
    assert(await page.getAttribute('#mode-switch [data-look=basic]', 'aria-pressed') === 'true', 'the switch shows Basic');
    const look = await page.evaluate(() => {
      const cs = (sel, p = '') => getComputedStyle(document.querySelector(sel), p || null);
      return {
        page: cs('body').backgroundColor, accent: cs('html').getPropertyValue('--accent').trim(), backdrop: cs('body', '::before').display,
        font: cs('h1, .hero-title').fontFamily, card: cs('.card').backdropFilter, glyph: cs('.tile .glyph').display, art: cs('.hero-art').display,
      };
    });
    assert(look.page === 'rgb(243, 244, 246)' && look.accent === '#1F5FAD', 'Basic uses the first version\'s colors');
    assert(look.backdrop === 'none' && look.art === 'none' && look.glyph === 'none' && (look.card === 'none' || !look.card), 'Basic has no glow backdrop, banner art, theme glyphs or glass');
    assert(!/Cinzel/.test(look.font), 'Basic headings use the plain text font');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'basic-home.png') });

    // 3. It stays after a reload, and play keeps the pictures, voices, races and badges.
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    assert(await page.evaluate(() => document.documentElement.dataset.look) === 'basic', 'Basic is kept after a reload');
    for (const id of ['#read-story', '#read-clues', '#app-menu [data-cmd=board]', '#app-menu [data-cmd=stats]', '#scene']) {
      assert(await page.locator(id).count() >= 1, `Basic keeps ${id}`);
    }
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden]) td.c', { timeout: 60000 });
    assert(await page.locator('#scene svg, #scene img').count() >= 1, 'Basic shows the drawn scene');
    assert(await page.locator('#talker').isHidden(), 'no talking face in Basic');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'basic-play.png'), fullPage: true });

    // 4. Contrast of the Basic colors (AA: 4.5 for text, 3 for marks and lines).
    for (const theme of ['light', 'dark', 'contrast']) {
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      const t = await page.evaluate(() => Object.fromEntries(['--page', '--bg', '--text', '--muted', '--accent', '--on-accent', '--x', '--border', '--error', '--hint'].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])));
      for (const [fg, bg, min] of [['--text', '--bg', 4.5], ['--text', '--page', 4.5], ['--muted', '--bg', 4.5], ['--muted', '--page', 4.5], ['--on-accent', '--accent', 4.5], ['--accent', '--bg', 4.5], ['--x', '--bg', 3], ['--border', '--bg', 3], ['--error', '--bg', 3], ['--hint', '--bg', 3]]) {
        const c = contrast(t[fg], t[bg]);
        assert(c >= min, `Basic ${theme}: ${fg} on ${bg} is ${c.toFixed(2)}:1 (needs ${min})`);
      }
    }
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });

    // 5. Back to Interactive.
    await page.click('#mode-switch [data-look=interactive]');
    assert(await page.evaluate(() => !document.documentElement.dataset.look && localStorage.getItem('flg.look') === 'interactive'), 'the switch goes back to Interactive and remembers it');
    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
