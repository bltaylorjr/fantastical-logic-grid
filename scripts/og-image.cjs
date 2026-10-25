// Renders seo/og-card.html to seo/og-image.jpg (1200 x 630), the picture
// search results and social sites show for a shared link.
// Run after npm run build (it needs web/fonts): node scripts/og-image.cjs
const { chromium } = require('playwright');
const { join } = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto('file://' + join(__dirname, '..', 'seo', 'og-card.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(__dirname, '..', 'seo', 'og-image.jpg'), type: 'jpeg', quality: 86 });
  await browser.close();
  console.log('Wrote seo/og-image.jpg');
})();
