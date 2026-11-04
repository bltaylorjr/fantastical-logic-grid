// Renders the pictures search results and social sites show for a shared link
// (1200 x 630): seo/og-card.html to seo/og-image.jpg (The Logic Grid) and
// seo/og-card-fantastical.html to seo/og-fantastical.jpg (The Fantastical Logic
// Grid's own pages). Run after npm run build (it needs web/fonts): node scripts/og-image.cjs
const { chromium } = require('playwright');
const { join } = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const [card, out] of [['og-card.html', 'og-image.jpg'], ['og-card-fantastical.html', 'og-fantastical.jpg']]) {
    await page.goto('file://' + join(__dirname, '..', 'seo', card));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(__dirname, '..', 'seo', out), type: 'jpeg', quality: 86 });
    console.log(`Wrote seo/${out}`);
  }
  await browser.close();
})();
