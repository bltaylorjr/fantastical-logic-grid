// NINETIMESNINE in the game: the small menu link opens its own screen, a puzzle
// can be played and solved there, the Logic Grid's keys and saves are left
// alone, and leaving and coming back keeps the puzzle. Only anonymous play
// data is shared, in the learning service's shape. Ideas and problem reports
// sent from its screen are marked as NINETIMESNINE's.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8136'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const np = () => page.evaluate(async () => {
    const G = (await import('./modules/number-place/ui.js')).state();
    return G && { v: G.v, givens: G.p.givens, solution: G.p.solution, size: G.p.size, solved: G.solved, ms: G.ms, name: G.name };
  });
  const openNp = async () => {
    await page.click('#menu-btn');
    await page.click('[data-cmd=numberplace]');
    await page.waitForSelector('#screen-np:not([hidden])');
  };
  try {
    await page.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })));
    await page.goto('http://localhost:8136/');
    await page.waitForSelector('#tier-choices input');
    assert(!(await page.locator('link#np-css').count()) && !(await page.evaluate(() => performance.getEntriesByType('resource').some((r) => /modules\/number-place/.test(r.name)))), 'NINETIMESNINE loads nothing until it is opened');

    await page.click('#menu-btn');
    const link = page.locator('[data-cmd=numberplace]');
    assert(await link.isVisible() && /NINETIMESNINE/.test(await link.textContent()), 'the menu has a NINETIMESNINE link');
    assert(await link.evaluate((b) => parseFloat(getComputedStyle(b).fontSize) < parseFloat(getComputedStyle(document.querySelector('[data-cmd=new]')).fontSize)), 'the link is small');
    await page.keyboard.press('Escape');

    await openNp();
    await page.waitForSelector('#np-setup-view:not([hidden]) #np-levels .choice', { timeout: 15000 });
    assert(await page.locator('#screen-home').isHidden() && await page.locator('#screen-play').isHidden(), 'NINETIMESNINE has its own screen');
    assert(/NINETIMESNINE/.test(await page.title()), 'the page title says NINETIMESNINE');
    assert(await page.locator('#np-root.np-app').count() === 1 && await page.evaluate(() => getComputedStyle(document.querySelector('#np-root .card')).borderRadius) !== '0px', 'it uses the game\'s cards and look');

    await page.check('input[name=np-level][value=basic]', { force: true });
    await page.click('#np-gen');
    await page.waitForSelector('#np-play-view:not([hidden])', { timeout: 30000 });
    let s = await np();
    assert(s && (s.size === 4 || s.size === 6), 'a Basic puzzle starts on its own screen');

    // Leave for the Logic Grid: number keys there never reach NINETIMESNINE.
    const first = s.givens.findIndex((d) => !d);
    await page.click('#np-back');
    await page.waitForSelector('#screen-games:not([hidden])');
    await page.click('#game-cards [data-game=logic-grid]');
    await page.waitForSelector('#screen-home:not([hidden])');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(String(s.solution[first]));
    s = await np();
    assert(s.v[first] === 0, 'number keys on the Logic Grid screen leave NINETIMESNINE alone');
    const ms = s.ms;
    await page.waitForTimeout(1200);
    assert((await np()).ms === ms, 'the clock stops while the player is away');

    // Coming back finds the same puzzle, and it can be solved.
    await openNp();
    assert(!(await page.locator('#np-play-view').isHidden()), 'coming back finds the puzzle in progress');
    for (let i = 0; i < s.givens.length; i++) {
      if (s.givens[i]) continue;
      await page.locator(`#np-board .np-cell[data-i="${i}"]`).click();
      await page.keyboard.press(String(s.solution[i]));
    }
    await page.waitForSelector('#np-solved:not([hidden])');
    assert((await np()).solved, 'the puzzle is solved');
    await page.click('#np-feel [data-feel=right]');

    // Its own saves, kept apart from the Logic Grid's.
    const keys = await page.evaluate(() => Object.keys(localStorage));
    assert(keys.includes('flg.np.games') && keys.includes('flg.np.learn'), 'NINETIMESNINE keeps its own saves and learning');
    const record = await page.evaluate(async () => {
      const learn = JSON.parse(localStorage.getItem('flg.np.learn'));
      const { toPlay } = await import('./js/np-share.js');
      return toPlay(learn.plays[learn.plays.length - 1]);
    });
    assert(record.outcome === 'solved' && record.level === 'basic' && record.feel === 'right' && /^[a-z0-9]{8,32}$/.test(record.pid), 'the play record is in the learning service\'s shape');
    assert(!Object.keys(record).some((k) => /name|story|title|account|user/i.test(k)), 'the record has nothing personal or story text');

    // Back on the Logic Grid, a puzzle still starts as before.
    await page.click('#np-back');
    await page.click('#game-cards [data-game=logic-grid]');
    await page.check('input[name=tier][value=basic]', { force: true });
    await page.click('#gen-btn');
    await page.waitForSelector('#screen-play:not([hidden])', { timeout: 30000 });
    assert(await page.locator('#screen-np').isHidden(), 'the Logic Grid plays on its own screen again');

    // Ideas and Report a Problem sent from the NINETIMESNINE screen say so,
    // so each game's are kept apart. (A second tab, with the game's service
    // pointed at a stand-in that records what is sent.)
    const sent = [];
    const FC = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const F = await FC.newPage();
    await FC.addInitScript(() => localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false })));
    FC.on('weberror', (e) => errors.push(String(e.error())));
    await FC.route('**/js/cloud-config.js', async (r) => {
      const body = (await (await r.fetch()).text()).replace(/learnUrl:\s*(""|'')/, 'learnUrl:"http://localhost:8139"');
      r.fulfill({ contentType: 'text/javascript', body });
    });
    // Reports go as a form (a 'report' part holding the JSON, plus any files);
    // ideas go as JSON.
    const bodyOf = (req) => {
      const raw = req.postDataBuffer()?.toString('utf8') || '';
      const part = /name="report"\r\n\r\n([\s\S]*?)\r\n--/.exec(raw);
      try { return JSON.parse(part ? part[1] : raw || '{}'); } catch (e) { return {}; }
    };
    await FC.route('http://localhost:8139/**', (r) => {
      const req = r.request();
      if (req.method() === 'POST') sent.push({ path: new URL(req.url()).pathname, body: bodyOf(req) });
      r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: JSON.stringify(/puzzle-report/.test(req.url()) ? { ok: true, tracking: 'PZ-TEST2345', category: 'puzzle', reply: 'none', files: 0 } : { ok: true }) });
    });
    // Report a Problem opens its own page in a new tab on the website.
    const report = async (words) => {
      const [rp] = await Promise.all([FC.waitForEvent('page'), F.click('#report-problem')]);
      await rp.waitForSelector('#rp-form');
      await rp.waitForFunction(() => document.querySelector('#rp-about').textContent.length > 0);
      const about = await rp.textContent('#rp-about');
      const puzzleKind = await rp.isChecked('input[name=kind][value=puzzle]');
      // The screenshot added for the player is not needed here.
      for (const b of await rp.locator('#rp-files button').all()) await b.click();
      await rp.fill('#rp-text', words);
      await rp.click('#rp-send');
      await rp.waitForFunction(() => /PZ-TEST2345/.test(document.querySelector('#rp-done-number').textContent));
      await rp.close();
      return { about, puzzleKind };
    };
    await F.goto('http://localhost:8136/');
    await F.waitForSelector('#tier-choices input');
    await F.click('#menu-btn');
    await F.click('[data-cmd=numberplace]');
    await F.waitForSelector('#screen-np:not([hidden])');
    const npSent = await report('The hard puzzle had two answers.');
    assert(npSent.puzzleKind && /NINETIMESNINE puzzle/.test(npSent.about), 'Report a Problem on NINETIMESNINE starts as a NINETIMESNINE puzzle problem');
    const sentReport = sent.find((x) => x.path === '/v1/puzzle-report');
    assert(sentReport && sentReport.body.game === 'number-place' && !sentReport.body.puzzle && sentReport.body.where === 'NINETIMESNINE screen', 'the report is marked as NINETIMESNINE\'s, with no Logic Grid puzzle');
    // (The Ideas box is hidden now that Submit Puzzle Ideas replaced it; the
    // server keeps an idea's game: server/test/feedback-games.test.mjs.)
    await F.click('#np-back');
    await report('The home screen looks squashed.');
    assert(sent.filter((x) => x.path === '/v1/puzzle-report')[1].body.game === 'logic-grid', 'back on the Logic Grid, reports are the Logic Grid\'s');
    await FC.close();

    assert(!errors.length, `no page errors (${errors.join(' | ')})`);
    console.log('NINETIMESNINE in the game: all checks passed');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
