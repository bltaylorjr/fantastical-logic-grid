// Renders web/icons/icon.svg to the PNG sizes the PWA and desktop builds need.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const dir = path.join(__dirname, '..', 'web', 'icons');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 0.12], ['icon-1024.png', 1024, 0]]) {
    await p.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - pad * 2));
    await p.setContent(`<body style="margin:0;background:${pad ? '#1F5FAD' : 'transparent'};display:grid;place-items:center;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body>`);
    await p.screenshot({ path: path.join(dir, name), omitBackground: !pad });
  }
  await b.close();
})();
