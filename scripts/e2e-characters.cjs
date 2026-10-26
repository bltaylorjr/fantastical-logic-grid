// End-to-end check of the game's own characters (made in the admin
// dashboard): a published character joins the cast with their AI portrait and
// own clue lines, another tells the story, gives the hint line and cheers on
// the solve, Silent mode hides them, and Menu > Suggest a character sends
// the questionnaire. The game's server is a stand-in here.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const SHOTS = process.env.SHOTS;
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const API = 'https://api.flg.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CHARACTERS = {
  enabled: true, suggestions: true, castChance: 100, narratorChance: 100,
  characters: [
    { id: 'captain-mo', name: 'Captain Mo', gender: 'm', role: 'cast', themes: ['adventure'], style: 'ai', seed: 'Captain Mo:abc', version: 1,
      voice: { gemini: 'Fenrir', kokoro: 'am_puck', speed: 1.1 }, lines: { clue: ['Mark my words, matey:'], hint: [], solve: ['Hoist the colors, we did it!'] },
      portrait: '/v1/characters/captain-mo/portrait?v=1-5' },
    { id: 'zara', name: 'Zara', gender: 'f', role: 'narrator', themes: [], style: 'lorelei', seed: 'Zara:x1', version: 1,
      voice: { gemini: 'Zephyr', kokoro: 'af_bella', speed: 1 }, lines: { clue: [], hint: ['Let me nudge you along, friend.'], solve: ['Brilliant, simply brilliant!'] } },
  ],
};

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8141'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const suggestions = [];
  const config = `export const CLOUD = { firebaseApiKey: '', syncUrl: '', learnUrl: '${API}', siteUrl: '', appVersion: 'test' };\nexport const cloudEnabled = () => false;\nexport const CLOUD_URL = '${API}';\n`;
  await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  await ctx.route(`${API}/**`, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/v1/characters') return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(CHARACTERS) });
    if (url.pathname === '/v1/characters/captain-mo/portrait') return r.fulfill({ headers: cors, contentType: 'image/png', body: PNG });
    if (url.pathname === '/v1/characters/suggest') { suggestions.push(JSON.parse(req.postData())); return r.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: '{"ok":true}' }); }
    if (url.pathname === '/v1/config') return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ features: { pictures: false, voices: false, learning: false, translate: false }, game: { aiPictures: 'none' } }) });
    return r.fulfill({ status: 503, headers: cors, contentType: 'application/json', body: '{"error":"not_set_up"}' });
  });
  const page = await ctx.newPage();
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })));
    await page.goto('http://localhost:8141/');
    await page.waitForSelector('#tier-choices input');
    await page.waitForFunction(() => !!localStorage.getItem('flg.characters'));
    await page.reload();
    await page.waitForSelector('#tier-choices input');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.check('input[name=theme][value=adventure]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    const p = await page.evaluate(() => window.__flg.state.puzzle);
    const names = p.categories[0].items.map((i) => i.label);
    assert(names.includes('Captain Mo'), `Captain Mo joins the cast (${names.join(', ')})`);
    assert(p.narrator === 'zara' && p.characters.some((c) => c.id === 'zara' && !c.inCast), 'Zara tells the story');
    const told = p.story.paragraphs.join(' ');
    assert(told.split('Captain Mo').length === 2 && !told.includes('Zara'), 'the story names Captain Mo only in its cast list, and never the narrator');
    assert(/Told by\s+Zara/.test(await page.textContent('#told-by')), 'the story says who tells it');
    await page.waitForSelector('#cast-row .cast-btn[data-who="Captain Mo"] img.portrait-img');
    assert(true, 'Captain Mo shows his AI portrait');
    const moFace = await page.evaluate(() => {
      const b = document.querySelector('#cast-row .cast-btn[data-who="Captain Mo"]');
      return !!b && !!b.querySelector('img');
    });
    assert(moFace, 'the portrait replaced the drawn face');
    const zaraFace = await page.getAttribute('#told-by svg', 'data-gender');
    assert(zaraFace === 'f', 'Zara is drawn as a woman, to match her voice');
    await page.locator('#story').scrollIntoViewIfNeeded();
    await shot('game-characters');

    // Captain Mo tells his clues with his own line.
    const moClues = await page.evaluate(() => Object.values(window.__flg.state.witness).filter((w) => w === 'Captain Mo').length);
    await page.click('#cast-row .cast-btn[data-who="Captain Mo"]');
    const bubble = await page.textContent('#bubble');
    if (moClues) assert(bubble.includes('Mark my words, matey:'), 'Captain Mo says his own line before a clue');
    else assert(bubble.includes('Captain Mo'), 'Captain Mo speaks in the bubble');

    // The hint comes with the narrator's line.
    await page.click('[data-act=hint]');
    await page.waitForSelector('#hintbox:not([hidden])');
    assert((await page.textContent('#hintbox')).includes('Let me nudge you along, friend.'), 'Zara gives the hint in her own words');
    await page.click('#hint-close');

    // Solve: a character cheers.
    await page.evaluate(() => {
      const S = window.__flg.state;
      for (const [k, td] of S.grid.cells) {
        const [a, b] = k.split('|');
        if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
      }
    });
    await page.waitForSelector('#solved:not([hidden])');
    const cheer = await page.textContent('#resolution');
    assert(/Hoist the colors, we did it!|Brilliant, simply brilliant!/.test(cheer), 'a character cheers when the puzzle is solved');

    // Silent mode hides the storyteller line with the other media.
    await page.evaluate(() => document.documentElement.classList.add('silent'));
    assert(!(await page.isVisible('#told-by')), 'Silent mode hides the characters\' extras');
    await page.evaluate(() => document.documentElement.classList.remove('silent'));

    // Menu > Suggest a character.
    await page.click('#menu-btn');
    await page.click('[data-cmd=suggest]');
    await page.waitForSelector('#dlg-suggest[open]');
    await page.click('#suggest-form button[type=submit]');
    assert((await page.textContent('#suggest-form .error-box')).includes('name'), 'the questions ask for a name first');
    await page.fill('#suggest-name', 'Pip');
    await page.check('#suggest-form input[name=gender][value=m]');
    await page.fill('#suggest-look', 'a tall hat and a striped scarf');
    await page.fill('#suggest-personality', 'shy but very clever');
    await page.selectOption('#suggest-voice', 'calm');
    await page.check('#suggest-themes input[value=fantasy]');
    await shot('suggest');
    await page.click('#suggest-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#suggest-form .acct-done').textContent.includes('Thank you'));
    const s = suggestions[0] || {};
    assert(s.name === 'Pip' && s.gender === 'm' && s.voiceStyle === 'calm' && s.themes.join() === 'fantasy' && s.personality === 'shy but very clever', 'the answers are sent for review');
    assert(!errors.length, `no page errors (${errors.join(' | ')})`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
