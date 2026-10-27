// Makes the pictures and the printable flyer for the educator campaign
// (server/src/marketing-seed.js, campaign educators-2026) from the real
// thing: a sample classroom package printed by scripts/educator-package.mjs
// and the website's Educators page. Lays them out on the game's colours at
// each channel's size, writes a .jpg twin of each picture (Instagram and the
// automatic poster need JPEG), the one-page US Letter flyer as a PDF whose QR
// code is the flyer ad's tracked link, and the small previews the admin
// Marketing section shows (admin/marketing-educators-*.png).
// Run from the repo root after `npm ci && npm run build` and
// `pip install segno` (free QR code maker, BSD licence):
//   node media/marketing/tools/make-educator-images.cjs
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '../../..');
const OUT = path.join(__dirname, '..');
const SHOTS = path.join(OUT, 'out');
const PORT = 8172;
const SITE = `http://localhost:${PORT}`;
fs.mkdirSync(SHOTS, { recursive: true });

const b64 = (file) => fs.readFileSync(file).toString('base64');
const FONTS = `@font-face { font-family: Cinzel; src: url(data:font/woff2;base64,${b64(path.join(ROOT, 'web/fonts/cinzel-700.woff2'))}) format('woff2'); font-weight: 700; }
@font-face { font-family: Atkinson; src: url(data:font/woff2;base64,${b64(path.join(ROOT, 'web/fonts/atkinson-400.woff2'))}) format('woff2'); font-weight: 400; }
@font-face { font-family: Atkinson; src: url(data:font/woff2;base64,${b64(path.join(ROOT, 'web/fonts/atkinson-700.woff2'))}) format('woff2'); font-weight: 700; }`;
const ICON = `data:image/svg+xml;base64,${b64(path.join(ROOT, 'web/icons/icon.svg'))}`;
const shot = (n) => `data:image/png;base64,${b64(path.join(SHOTS, `${n}.png`))}`;

// The flyer ad's tracked link, exactly as the dashboard shows it.
async function flyerLink() {
  const { SEEDS } = await import(path.join(ROOT, 'server/src/marketing-seed.js'));
  const { trackedLink } = await import(path.join(ROOT, 'server/src/marketing.js'));
  const seed = SEEDS.find((s) => s.id === 'educators-2026');
  const ad = seed.ads.find((a) => a.content === 'staff-room');
  return trackedLink('https://thelogicgrid.com', ad, seed.campaign.code);
}

function qrSvg(url) {
  return execFileSync('python3', ['-c', 'import segno,sys; sys.stdout.write(segno.make(sys.argv[1], error="m").svg_inline(scale=10, border=2, omitsize=True, dark="#1d1450", light="#ffffff"))', url], { encoding: 'utf8' });
}

// A sample Grade 4 package, printed the way teachers receive it. The request
// goes through the same checks as the Educators page form.
async function samplePackage() {
  const { checkRequest } = await import(path.join(ROOT, 'engine/src/classroom.js'));
  const checked = checkRequest({
    educator: { name: 'Ms Rivera', email: 'rivera@lincoln.k12.ca.us', school: 'Lincoln Elementary', role: 'Classroom teacher' },
    grade: '4', count: 2, difficulty: 'progressive', themes: ['pets/any'], agree: true,
  });
  if (checked.errors) throw new Error(checked.errors.join(' '));
  const { educator, ...request } = checked.value;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flg-edu-ad-'));
  const job = { id: 1, ref: 'ADSAMPLE01', email: educator.email, name: educator.name, school: educator.school, grade: request.grade, count: request.count, request, usedStories: [] };
  execFileSync('node', [path.join(ROOT, 'scripts/educator-package.mjs'), '-', tmp], { input: JSON.stringify(job), stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, FLG_PDF_HTML_ONLY: '1' } });
  return { puzzles: path.join(tmp, 'puzzles.html'), keys: path.join(tmp, 'answer-keys.html') };
}

async function capture(browser) {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
  // The first puzzle page of the package (after the cover).
  const pkg = await samplePackage();
  await page.goto(`file://${pkg.puzzles}`);
  const pages = page.locator('.page:not(.cover):not(.key)');
  await pages.first().screenshot({ path: path.join(SHOTS, 'edu-puzzle.png') });
  // Its answer key.
  await page.goto(`file://${pkg.keys}`);
  await page.locator('.page.key').first().screenshot({ path: path.join(SHOTS, 'edu-key.png') });
  await page.close();
}

// One card. layout: wide | square | tall | flyer
function card({ w, h, layout, qr }) {
  const big = Math.round(Math.min(w, h) / 11);
  const css = `${FONTS}
  * { box-sizing: border-box; margin: 0; }
  body { width: ${w}px; height: ${h}px; overflow: hidden; font-family: Atkinson, sans-serif; color: #fff;
    background: radial-gradient(circle at 20% 15%, #7b5cf0 0%, #5b3cc4 35%, #2a1a6e 100%); }
  .wrap { position: absolute; inset: 0; padding: ${Math.round(Math.min(w, h) * 0.06)}px; display: flex; gap: ${Math.round(Math.min(w, h) * 0.05)}px; }
  .brand { display: flex; align-items: center; gap: ${Math.round(big * 0.3)}px; }
  .brand img { width: ${Math.round(big * 1.1)}px; height: ${Math.round(big * 1.1)}px; }
  .brand span { font-family: Cinzel, serif; font-weight: 700; font-size: ${Math.round(big * 0.42)}px; line-height: 1.1; color: #f5c451; letter-spacing: .02em; }
  .tag { display: inline-block; align-self: flex-start; white-space: nowrap; background: #fff; color: #2a1a6e; font-weight: 700; font-size: ${Math.round(big * 0.34)}px; padding: ${Math.round(big * 0.1)}px ${Math.round(big * 0.3)}px; border-radius: 999px; }
  h1 { font-family: Cinzel, serif; font-weight: 700; font-size: ${big}px; line-height: 1.08; color: #fff; }
  h1 em { font-style: normal; color: #f5c451; }
  p.sub { font-size: ${Math.round(big * 0.42)}px; line-height: 1.35; color: #e9e3ff; }
  ul { list-style: none; padding: 0; display: grid; gap: ${Math.round(big * 0.18)}px; font-size: ${Math.round(big * 0.36)}px; }
  li::before { content: '✔ '; color: #f5c451; font-weight: 700; }
  .cta { display: inline-block; background: #f5c451; color: #1d1450; font-weight: 700; font-size: ${Math.round(big * 0.42)}px; padding: ${Math.round(big * 0.22)}px ${Math.round(big * 0.5)}px; border-radius: 999px; }
  .url { font-weight: 700; font-size: ${Math.round(big * 0.4)}px; color: #fff; }
  .paper { background: #fff; border-radius: ${Math.round(big * 0.12)}px; box-shadow: 0 ${Math.round(big * 0.2)}px ${Math.round(big * 0.8)}px rgb(0 0 0 / .45); overflow: hidden; }
  .paper img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top center; }
  .col { display: flex; flex-direction: column; gap: ${Math.round(big * 0.45)}px; }
  .qr { background: #fff; border-radius: ${Math.round(big * 0.2)}px; padding: ${Math.round(big * 0.2)}px; display: grid; place-items: center; }
  .qr svg { width: 100%; height: auto; display: block; }
  `;
  const brand = `<div class="brand"><img src="${ICON}" alt=""><span>The Fantastical<br>Logic Grid</span></div>`;
  const paper = (img, style = '') => `<div class="paper" style="${style}"><img src="${img}" alt=""></div>`;
  let body;
  if (layout === 'wide') {
    body = `<div class="wrap" style="align-items:center">
      <div class="col" style="flex: 0 0 50%">${brand}<span class="tag">Free for teachers</span><h1>Printable logic puzzles <em>made for your class</em></h1>
        <ul><li>Your grade, level and themes</li><li>Up to 30 story puzzles</li><li>Answer keys in their own PDF</li><li>Emailed, ready to print</li></ul>
        <div><span class="cta">Request yours</span> &nbsp; <span class="url">thelogicgrid.com/educators</span></div></div>
      <div style="flex:1; position:relative; height: 100%">
        ${paper(shot('edu-key'), 'position:absolute; left:0; top:10%; width:70%; height:86%; transform: rotate(-4deg); opacity:.9')}
        ${paper(shot('edu-puzzle'), 'position:absolute; right:2%; top:3%; width:80%; height:94%; transform: rotate(2deg)')}</div></div>`;
  } else if (layout === 'square') {
    body = `<div class="wrap" style="flex-direction:column">
      <div style="display:flex; justify-content:space-between; align-items:center">${brand}<span class="tag">Free for teachers</span></div>
      <h1>Logic puzzles <em>made for your class</em></h1>
      <div style="flex:1; position:relative">${paper(shot('edu-puzzle'), 'position:absolute; left:12%; right:12%; top:0; bottom:0; transform: rotate(-1.5deg)')}</div>
      <div style="display:flex; justify-content:space-between; align-items:center"><span class="cta">Free for schools</span><span class="url">thelogicgrid.com/educators</span></div></div>`;
  } else if (layout === 'tall') {
    body = `<div class="wrap" style="flex-direction:column">
      ${brand}<span class="tag">Free for teachers · K to 12</span><h1>Free printable <em>logic puzzle packages</em> for your class</h1>
      <p class="sub">Choose the grade, level and themes, or write your own. Up to 30 story puzzles with answer keys, emailed to you.</p>
      <div style="flex:1; position:relative">${paper(shot('edu-puzzle'), 'position:absolute; left:6%; right:6%; top:0; bottom:0')}</div>
      <div style="display:flex; justify-content:space-between; align-items:center"><span class="cta">Request yours</span><span class="url">thelogicgrid.com/educators</span></div></div>`;
  } else {
    // The flyer: US Letter at 96 px per inch (816 x 1056), printed to PDF.
    body = `<div class="wrap" style="flex-direction:column; gap:${Math.round(big * 0.3)}px">
      <div style="display:flex; justify-content:space-between; align-items:center">${brand}<span class="tag">Free for schools</span></div>
      <h1 style="font-size:${Math.round(big * 0.82)}px">Logic puzzle packages <em>made for your class</em></h1>
      <p class="sub" style="font-size:${Math.round(big * 0.32)}px">Story logic grid puzzles that build careful reading and step-by-step reasoning. Every puzzle has exactly one answer.</p>
      <div style="display:flex; gap:${Math.round(big * 0.4)}px; flex:1; min-height:0">
        <ul style="flex: 1 1 50%; font-size:${Math.round(big * 0.3)}px; align-content:start"><li>Any grade, from Kindergarten to Grade 12</li><li>Pick the level and themes, or write your own theme</li><li>Up to 30 printable puzzles, each with a new story</li><li>Answer keys in their own PDF</li><li>Free, with no account: emailed to your school address</li></ul>
        <div style="flex: 1 1 50%; position:relative">${paper(shot('edu-puzzle'), 'position:absolute; inset:0')}</div>
      </div>
      <div style="display:flex; gap:${Math.round(big * 0.5)}px; align-items:center">
        <div class="qr" style="width:${Math.round(big * 2.6)}px; flex:none">${qr}</div>
        <div class="col" style="gap:${Math.round(big * 0.25)}px"><span class="cta" style="align-self:flex-start">Scan to ask for yours</span><span class="url">thelogicgrid.com/educators</span>
          <p class="sub" style="font-size:${Math.round(big * 0.26)}px">Packages are reviewed by our team and usually arrive within a day or two.</p></div>
      </div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

const CARDS = [
  { name: 'educators-wide-1600x900', w: 1600, h: 900, layout: 'wide', preview: 'marketing-educators-wide' },
  { name: 'educators-square-1080', w: 1080, h: 1080, layout: 'square', preview: 'marketing-educators-square' },
  { name: 'educators-pin-1000x1500', w: 1000, h: 1500, layout: 'tall', preview: 'marketing-educators-pin' },
];

(async () => {
  const server = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), path.join(ROOT, 'dist/site'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  try {
    await capture(browser);
    const page = await browser.newPage();
    const preview = async (html, w, h, name) => {
      const s = 480 / w;
      await page.setViewportSize({ width: 480, height: Math.round(h * s) });
      await page.setContent(html.replace('<body>', `<body style="transform: scale(${s}); transform-origin: 0 0">`));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(ROOT, 'admin', `${name}.png`) });
    };
    for (const c of CARDS) {
      await page.setViewportSize({ width: c.w, height: c.h });
      await page.setContent(card(c));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, `${c.name}.png`) });
      await page.screenshot({ path: path.join(OUT, `${c.name}.jpg`), type: 'jpeg', quality: 88 });
      await preview(card(c), c.w, c.h, c.preview);
      console.log(`Wrote ${c.name}.png and .jpg`);
    }
    // The flyer, with the QR code of its tracked link.
    const link = await flyerLink();
    const flyer = { w: 816, h: 1056, layout: 'flyer', qr: qrSvg(link) };
    await page.setViewportSize({ width: flyer.w, height: flyer.h });
    await page.setContent(card(flyer));
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: path.join(OUT, 'educators-flyer-letter.pdf'), width: '8.5in', height: '11in', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    await page.screenshot({ path: path.join(OUT, 'educators-flyer-letter.png') });
    await preview(card(flyer), flyer.w, flyer.h, 'marketing-educators-flyer');
    console.log(`Wrote educators-flyer-letter.pdf (QR: ${link})`);
    // The how-to video's poster as its preview.
    await page.setViewportSize({ width: 480, height: 270 });
    await page.setContent(`<body style="margin:0;background:#2a1a6e;display:grid;place-items:center;height:270px"><img src="data:image/jpeg;base64,${b64(path.join(ROOT, 'seo/media/educators-poster.jpg'))}" style="max-width:480px;max-height:270px"></body>`);
    await page.screenshot({ path: path.join(ROOT, 'admin', 'marketing-educators-video.png') });
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
