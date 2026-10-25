// Renders admin/icon.svg to the PNG icons the installable admin app needs.
// Run: node scripts/admin-icons.cjs admin
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const dir = process.argv[2];
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage();
  // [file, size, padding, solid background]
  for (const [name, size, pad, bg] of [['icon-192.png', 192, 0, 0], ['icon-512.png', 512, 0, 0], ['maskable-512.png', 512, 0.1, 1], ['apple-touch-icon.png', 180, 0.04, 1]]) {
    await p.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - pad * 2));
    await p.setContent(`<body style="margin:0;background:${bg ? '#5B3CC4' : 'transparent'};display:grid;place-items:center;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body>`);
    await p.screenshot({ path: path.join(dir, name), omitBackground: !bg });
  }
  await b.close();
})();
