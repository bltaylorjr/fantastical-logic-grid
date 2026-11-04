// The dashboard's page editor (admin > Website > Edit on the page) inside the
// website preview: pick an element, change words in place, drag an element to
// a new place, move up, hide, and the visitor side applying published changes.
// A stand-in dashboard page frames the built site and plays the dashboard's part
// (it keeps the list of changes and sends the design back, as admin/website.js does).
// Run after npm run build: node scripts/e2e-site-editor.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const SITE = 8191;
const HOST = 8192;

(async () => {
  const dist = path.join(__dirname, '..', 'dist');
  const site = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(dist, 'site'), String(SITE)], { stdio: 'ignore' });
  const host = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Dashboard stand-in</title><body style="margin:0">
<iframe id="f" src="http://127.0.0.1:${SITE}/?design-preview" width="1200" height="860" style="border:0"></iframe>
<script>
window.msgs = []; window.design = { edits: [] }; window.edit = true;
const f = document.getElementById('f');
window.send = () => f.contentWindow.postMessage({ type: 'flg-design', design: window.design, look: 'light', edit: window.edit }, '*');
window.cmd = (c) => f.contentWindow.postMessage({ type: 'flg-design-cmd', ...c }, '*');
addEventListener('message', (e) => {
  window.msgs.push(e.data);
  if (e.data.type === 'flg-design-ready') window.send();
  if (e.data.type === 'flg-design-select') window.sel = e.data.sel;
  if (e.data.type === 'flg-design-op') {
    const op = e.data.op;
    if (op.op === 'text' && op.key) window.design[op.key] = op.v;
    else { const { key, ...step } = op; window.design.edits.push(step); }
    window.send();
  }
});
</script></body>`);
  }).listen(HOST);
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1220, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`http://localhost:${HOST}/`);
    const frame = await (await page.waitForSelector('#f')).contentFrame();
    await page.waitForFunction(() => window.msgs.some((m) => m.type === 'flg-design-ready'));
    await frame.waitForFunction(() => document.documentElement.classList.contains('design-edit'));
    assert(true, 'the preview turns on the page editor when the dashboard asks');

    // Clicking picks the element and tells the dashboard what it is.
    const box = async (sel) => (await frame.locator(sel).first().boundingBox());
    const at = (sel) => frame.locator(sel).first();
    const para = at('#games article.card[data-game="flg"] p[data-design-text="flgText"]');
    await para.click({ position: { x: 20, y: 8 } });
    await page.waitForFunction(() => window.sel && window.sel.name === 'Paragraph');
    const sel = await page.evaluate(() => window.sel);
    assert(sel.key === 'flgText' && /Read the clues/.test(sel.words) && sel.crumbs[1] === 'Box', 'a click picks the paragraph and reports its words and where it sits');
    assert(await frame.evaluate(() => getComputedStyle(document.querySelector('#dz-layer .dz-sel')).display === 'block'), 'the picked element is outlined');

    // Double-click changes words in place; option words go back as the option.
    await para.dblclick({ position: { x: 20, y: 8 } });
    await frame.waitForSelector('[contenteditable]');
    await page.keyboard.type('Solve a brand new story every day.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.design.flgText === 'Solve a brand new story every day.');
    assert(true, 'double-click, type and Enter changes the words (an option\'s words change that option)');

    // Words that are not an option become a page change.
    const item = at('#games article.card[data-game="flg"] ul.points li');
    await item.dblclick({ position: { x: 30, y: 6 } });
    await frame.waitForSelector('[contenteditable]');
    await page.keyboard.type('Pick any difficulty and theme');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.design.edits.some((e) => e.op === 'text'));
    let step = await page.evaluate(() => window.design.edits.find((e) => e.op === 'text'));
    assert(step.v === 'Pick any difficulty and theme' && step.g === 'Choose a difficulty, a theme and a grid size' && step.p === '' && step.n === 'List item', 'other words become a page change that names the element as built');
    assert(await frame.waitForFunction(() => document.querySelector('#games article.card[data-game="flg"] ul.points li').textContent === 'Pick any difficulty and theme', null, { timeout: 5000 }).then(() => true, () => false), 'the preview shows the new words');

    // Escape cancels an edit.
    await item.dblclick({ position: { x: 30, y: 6 } });
    await frame.waitForSelector('[contenteditable]');
    await page.keyboard.type('nope');
    await page.keyboard.press('Escape');
    assert(await frame.evaluate(() => !document.querySelector('[contenteditable]') && document.querySelector('#games article.card[data-game="flg"] ul.points li').textContent === 'Pick any difficulty and theme'), 'Esc puts the words back');

    // Drag the second game card in front of the first.
    await at('#games article.card[data-game="ntn"] h2').click({ position: { x: 10, y: 5 } });
    await page.waitForFunction(() => window.sel && window.sel.name === 'Heading');
    await window_cmd(page, { cmd: 'parent' });
    await window_cmd(page, { cmd: 'parent' });
    await page.waitForFunction(() => window.sel && window.sel.name === 'Card');
    const from = await box('#games article.card[data-game="ntn"]');
    const to = await box('#games article.card[data-game="flg"]');
    await page.mouse.move(from.x + from.width / 2, from.y + 40);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 - 30, from.y + 60, { steps: 4 });
    await page.mouse.move(to.x + 30, to.y + to.height / 2, { steps: 8 });
    assert(await frame.evaluate(() => getComputedStyle(document.querySelector('#dz-layer .dz-drop')).display === 'block'), 'a line shows where the card will land while dragging');
    await page.mouse.up();
    await page.waitForFunction(() => window.design.edits.some((e) => e.op === 'move'));
    step = await page.evaluate(() => window.design.edits.find((e) => e.op === 'move'));
    const recordedMove = step;
    assert(step.at === 'before' && step.n === 'Card' && /^#games>article:2$/.test(step.t) && /^#games>article:1$/.test(step.to), `dragging records a move (${step.t} before ${step.to})`);
    const order = (want) => frame.waitForFunction((w) => [...document.querySelectorAll('#games > article')].slice(0, 2).map((a) => a.dataset.game).join() === w, want, { timeout: 5000 }).then(() => true, () => false);
    assert(await order('ntn,flg'), 'the card moved in the preview');

    // Move down with the panel button puts it back after the first card.
    await window_cmd(page, { cmd: 'down' });
    await page.waitForFunction(() => window.design.edits.filter((e) => e.op === 'move').length === 2);
    assert(await order('flg,ntn'), 'Move down moves it one place later');

    // Hide.
    await at('#games article.card[data-game="flg"] .rules-link').click({ position: { x: 5, y: 5 } });
    await page.waitForFunction(() => window.sel && window.sel.name === 'Link');
    await window_cmd(page, { cmd: 'hide' });
    await page.waitForFunction(() => window.design.edits.some((e) => e.op === 'hide'));
    assert(await frame.waitForFunction(() => getComputedStyle(document.querySelector('#games article.card[data-game="flg"] .rules-link')).display === 'none', null, { timeout: 5000 }).then(() => true, () => false), 'Hide takes the element off the page');

    // Undo in the dashboard (a shorter list) puts things back.
    const all = await page.evaluate(() => window.design.edits.length);
    await page.evaluate(() => { window.design.edits = window.design.edits.filter((e) => e.op !== 'hide' && e.op !== 'move'); window.send(); });
    await frame.waitForFunction(() => getComputedStyle(document.querySelector('#games article.card[data-game="flg"] .rules-link')).display !== 'none');
    assert(all === 4 && await frame.evaluate(() => [...document.querySelectorAll('#games > article')].slice(0, 2).map((a) => a.dataset.game).join() === 'flg,ntn'), 'taking changes off the list puts the page back');

    // Links do not open while editing, and the dashboard's Preview mode turns the editor off.
    assert(page.frames()[1].url().includes('design-preview'), 'clicking links in the editor never leaves the page');
    await page.evaluate(() => { window.edit = false; window.send(); });
    await frame.waitForFunction(() => !document.documentElement.classList.contains('design-edit') && !document.getElementById('dz-layer'));
    assert(true, 'Preview mode turns the editor off');

    // Visitors: a published page change is applied by the page itself.
    // The steps exactly as the editor recorded them, plus one whose words no longer match the page.
    const steps = await page.evaluate(() => window.design.edits.filter((e) => e.op === 'text'));
    steps.push(recordedMove, { p: '', t: 'body>div:2>section:1>p:1', g: 'Words that are not on the page any more', op: 'hide' });
    const visitor = await browser.newPage();
    visitor.on('pageerror', (e) => errors.push(String(e)));
    await visitor.route(`http://127.0.0.1:${SITE}/`, async (route) => {
      const res = await route.fetch();
      let html = await res.text();
      html = html.replace('<html', '<html data-edits').replace('</head>', `<script type="application/json" id="site-edits">${JSON.stringify(steps)}</script></head>`);
      route.fulfill({ response: res, body: html });
    });
    await visitor.goto(`http://127.0.0.1:${SITE}/`);
    await visitor.waitForFunction(() => document.documentElement.classList.contains('edits-done'));
    assert(await visitor.evaluate(() => document.querySelector('#games article.card[data-game="flg"] ul.points li').textContent === 'Pick any difficulty and theme'), 'visitors see the changed words');
    assert(await visitor.evaluate(() => [...document.querySelectorAll('#games > article')].slice(0, 2).map((a) => a.dataset.game).join() === 'ntn,flg'), 'visitors see the moved card');
    assert(await visitor.evaluate(() => getComputedStyle(document.querySelector('.hero p')).display !== 'none'), 'a step whose words no longer match is skipped, never put on the wrong element');

    assert(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log('Site editor checks passed.');
  } finally {
    await browser.close();
    site.kill();
    host.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

// A button in the dashboard's editor panel, and the editor's answer.
async function window_cmd(page, c) {
  const n = await page.evaluate(() => window.msgs.length);
  await page.evaluate((x) => window.cmd(x), c);
  await page.waitForFunction((k) => window.msgs.length > k, n);
}
