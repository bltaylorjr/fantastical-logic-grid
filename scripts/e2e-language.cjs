// End-to-end check of playing in another language: US English by default, the
// Settings > Language picker, the page translating itself (menus, story,
// clues, messages), the English button, names and notes left alone,
// translations kept on the device, right-to-left languages and printing.
// The game's server is stood in for: it "translates" by adding a marker.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
// A localhost address: test builds' content policy allows localhost (scripts/build.mjs).
const API = 'http://localhost:8139';
const mark = (to, t) => `‹${to}› ${t}`;

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8138'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    try { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true })); } catch (e) { /* ignore */ }
    try { delete self.Translator; } catch (e) { /* not there */ }
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  });
  const asked = [];
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', authUrl: '', tokenUrl: '', siteUrl: '', appVersion: 'test' };
export const cloudEnabled = () => false;
export const CLOUD_URL = CLOUD.learnUrl;` }));
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  await ctx.route(`${API}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, GET' } });
    const url = new URL(req.url());
    if (url.pathname === '/v1/translate') {
      const body = JSON.parse(req.postData());
      asked.push(...body.texts.map((t) => `${body.to}|${t}`));
      return r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ texts: body.texts.map((t) => mark(body.to, t)) }) });
    }
    if (url.pathname === '/v1/config') return r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ announcements: [], disabledThemes: [], features: { translate: true } }) });
    return r.fulfill({ status: 204, headers: cors, body: '' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const lang = () => page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
  const choose = async (code) => {
    await page.click('#menu-btn');
    await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    await page.selectOption('#language', code);
    await page.click('#dlg-settings button[value=close]');
  };
  try {
    await page.goto('http://localhost:8138/');
    await page.waitForSelector('#tier-choices input');
    assert(JSON.stringify(await lang()) === '["en-US","ltr"]', 'the game starts in US English');
    assert(await page.isHidden('#lang-btn'), 'no English button in English');
    await page.waitForTimeout(300);
    assert(asked.length === 0, 'nothing is translated in English');

    // Choose Spanish.
    await page.click('#menu-btn');
    await page.click('[data-cmd=settings]');
    await page.waitForSelector('#dlg-settings[open]');
    assert(await page.inputValue('#language') === 'en-US', 'the picker shows US English');
    const count = await page.locator('#language option').count();
    assert(count === 100, `the picker lists 100 languages, US English first (${count})`);
    assert(/español/i.test(await page.textContent('#language option[value=es]')), 'languages are named in their own language');
    await page.selectOption('#language', 'es');
    await page.waitForFunction(() => document.documentElement.lang === 'es');
    await page.waitForFunction(() => /‹es› Language/.test(document.querySelector('#language-settings legend').textContent));
    assert(/‹es›/.test(await page.textContent('#language-note')), 'the settings window explains the translation, in Spanish');
    assert(!/‹es›/.test(await page.textContent('#language')), 'the language names are not translated');
    await page.click('#dlg-settings button[value=close]');
    await page.waitForFunction(() => document.querySelector('#menu-btn').textContent === '‹es› Menu');
    assert(true, 'the menu is in Spanish');
    assert(await page.isVisible('#lang-btn') && (await page.textContent('#lang-btn')) === 'English', 'the English button shows');
    assert(asked.every((a) => a.startsWith('es|')), 'translations are asked for in Spanish');

    // A puzzle: story, clues and labels are translated; marks and numbers are not sent.
    await page.check('input[name=tier][value=easy]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    await page.waitForFunction(() => /‹es›/.test(document.querySelector('#clue-list').textContent), null, { timeout: 10000 });
    const clue = await page.evaluate(() => window.__flg.state.puzzle.clues[0].text);
    await page.waitForFunction((c) => document.querySelector('#clue-list').textContent.includes(`‹es› ${c}`) || document.querySelector('#clue-list').textContent.includes('‹es›'), clue);
    assert(true, 'the clues are in Spanish');
    assert(!asked.some((a) => /^es\|(X|O|\d+(:\d+)?)$/.test(a)), 'marks and times are never sent for translation');
    const placeholder = await page.getAttribute('#my-notes', 'placeholder');
    assert(/‹es›/.test(placeholder), 'labels and placeholders are translated');
    await page.click('#notes-btn');
    await page.fill('#my-notes', 'Chef is not in the cellar.');
    await page.waitForTimeout(300);
    assert(await page.inputValue('#my-notes') === 'Chef is not in the cellar.' && !asked.includes('es|Chef is not in the cellar.'), 'my notes are never translated or sent');
    await page.keyboard.press('Escape');

    // Messages for the screen reader and the status line.
    await page.click('#sound-btn');
    await page.waitForFunction(() => /‹es› Sound (on|off)/.test(document.querySelector('#status').textContent));
    assert(true, 'status messages are in Spanish');

    // The English button shows the original and back.
    await page.click('#lang-btn');
    await page.waitForFunction(() => document.querySelector('#menu-btn').textContent === 'Menu');
    assert(!/‹es›/.test(await page.textContent('#clue-list')), 'the English button shows the original text');
    assert(await page.getAttribute('#lang-btn', 'aria-pressed') === 'true', 'and says it is pressed');
    assert(/español/i.test(await page.textContent('#lang-btn')), 'it offers the way back to Spanish');
    await page.click('#lang-btn');
    await page.waitForFunction(() => document.querySelector('#menu-btn').textContent === '‹es› Menu');
    assert(true, 'pressing it again goes back to Spanish');

    // Printing waits for the translation of the printed page.
    await page.evaluate(() => { window.__printed = 0; });
    await page.click('[data-act=print]');
    await page.waitForSelector('#dlg-print[open]');
    await page.click('#print-go');
    await page.waitForFunction(() => window.__printed === 1, null, { timeout: 10000 });
    assert(/‹es›/.test(await page.textContent('#print-root')), 'the printed puzzle is in Spanish');

    // Kept on the device: after a reload the menu needs no new translation.
    await page.waitForTimeout(1800);
    const before = asked.filter((a) => a === 'es|Menu').length;
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    await page.waitForFunction(() => document.querySelector('#menu-btn').textContent === '‹es› Menu');
    assert(asked.filter((a) => a === 'es|Menu').length === before && before === 1, 'the choice and its translations are kept on this device');

    // Right-to-left languages.
    await choose('ar');
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await page.waitForFunction(() => document.querySelector('#menu-btn').textContent === '‹ar› Menu');
    assert(JSON.stringify(await lang()) === '["ar","rtl"]', 'Arabic reads right to left');

    // Back to US English.
    await choose('en-US');
    await page.waitForFunction(() => document.querySelector('#menu-btn').textContent === 'Menu');
    assert(JSON.stringify(await lang()) === '["en-US","ltr"]', 'US English comes back');
    assert(!/‹(es|ar)›/.test(await page.textContent('body')), 'no translated text is left');
    assert(await page.isHidden('#lang-btn'), 'the English button goes away');
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
