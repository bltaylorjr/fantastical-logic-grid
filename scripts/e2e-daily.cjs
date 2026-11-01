// End-to-end check of the daily puzzle, streaks, My stats and badges, and
// Share my result, against the website build (dist/site has the daily files).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const SITE = path.join(__dirname, '..', 'dist', 'site');

(async () => {
  const latest = JSON.parse(fs.readFileSync(path.join(SITE, 'daily', 'latest.json'), 'utf8'));
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), SITE, '8131'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true })); } catch (e) { /* ignore */ } });
  // A share sheet that takes files, like a phone's.
  await ctx.addInitScript(() => { window.__shared = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = { text: d.text, files: (d.files || []).length }; }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const solveByHand = () => page.evaluate(() => {
    const S = window.__flg.state;
    for (const [k, td] of S.grid.cells) {
      const [a, b] = k.split('|');
      if (S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b))) td.click(), td.click();
    }
  });
  try {
    await page.goto('http://localhost:8131/fantastical/');
    await page.waitForSelector('#daily-today [data-daily]');
    assert((await page.textContent('#daily-today')).includes(latest.title), `the home screen shows today's daily puzzle ("${latest.title}")`);
    assert(await page.isHidden('#daily-streak'), 'no streak before the first daily solve');
    await page.click('#daily-today [data-daily]');
    await page.waitForSelector('#screen-play:not([hidden])');
    assert((await page.textContent('#p-title')) === latest.title, 'the daily puzzle opens');
    assert((await page.textContent('#p-meta')).includes('Daily puzzle'), 'it is marked as the daily puzzle');
    const daily = await page.evaluate(() => window.__flg.state.save.daily);
    assert(daily === latest.date, 'the save remembers its day');

    await solveByHand();
    await page.waitForSelector('#solved:not([hidden])');
    await page.waitForSelector('#solved-streak:not([hidden])');
    assert(/streak/i.test(await page.textContent('#solved-streak')), 'the solved panel shows the streak');
    await page.waitForSelector('#solved-badges:not([hidden])');
    const badges = await page.textContent('#solved-badges');
    assert(/First case closed/.test(badges) && /Daily detective/.test(badges), 'first solve and daily badges are earned');
    assert(!(await page.evaluate(() => window.__flg.state.save.scorePending)), 'the daily puzzle earns no scoreboard points');

    await page.click('#share-result');
    await page.waitForFunction(() => window.__shared);
    const shared = await page.evaluate(() => window.__shared);
    assert(shared.files === 1 && shared.text.includes(latest.title) && /daily\//.test(shared.text), 'Share my result sends a picture and a message with a link');
    const answers = await page.evaluate(() => window.__flg.state.puzzle.answerKey.questions.map((q) => q.answer));
    assert(!answers.some((a) => shared.text.includes(a)), 'the shared message gives no answers away');

    // Without a share sheet the message is shown to copy.
    await page.evaluate(() => { navigator.share = undefined; });
    await page.click('#share-result');
    await page.waitForSelector('#dlg-share[open]');
    assert((await page.inputValue('#share-text')).includes(latest.title), 'the share window shows the message');
    assert(await page.locator('#share-img').isVisible(), 'and the picture');
    await page.click('#share-close');

    await page.click('#home-btn');
    await page.waitForSelector('#daily-streak:not([hidden])');
    assert(/1/.test(await page.textContent('#daily-streak')), 'the home screen shows a 1 day streak');
    assert(/Solved today/.test(await page.textContent('#daily-today')), "today's puzzle shows as solved");

    // Stats page.
    await page.click('#menu-btn');
    await page.click('[data-cmd=stats]');
    await page.waitForSelector('#dlg-stats[open] .stats-table');
    const st = await page.textContent('#stats-body');
    assert(/Puzzles solved\s*1/.test(st), `stats count the solve (${st.slice(0, 200)})`);
    assert(/Badges\s*\d+ of \d+/.test(st), 'stats list the badges');
    assert(await page.locator('#stats-body .badge-item.locked').count() > 5, 'badges not yet earned are shown as locked');
    await page.click('#stats-close');

    // Streak maths: three days in a row, then a gap.
    const streak = await page.evaluate(async () => {
      const d = await import('./js/daily.js');
      const at = (day, h = 5) => Date.parse(`${day}T00:00:00Z`) + h * 3600000;
      const log = [{ daily: '2026-11-01', at: at('2026-11-01') }, { daily: '2026-11-02', at: at('2026-11-02') }, { daily: '2026-11-03', at: at('2026-11-03', 40) },
        { daily: '2026-11-05', at: at('2026-11-05', 60) }, { daily: '2026-11-06', at: at('2026-11-06'), revealed: true }];
      return [d.streak(log, '2026-11-03'), d.streak(log, '2026-11-04'), d.streak(log, '2026-11-06')].map((x) => [x.current, x.best]);
    });
    assert(JSON.stringify(streak) === '[[3,3],[3,3],[0,3]]', `streaks count days in a row, with a 48-hour grace (${JSON.stringify(streak)})`);

    // An earlier day opens too, and it doesn't count for the streak.
    const earlier = (latest.days || []).filter((x) => x < latest.date);
    if (earlier.length) {
      await page.click('#daily-earlier summary');
      await page.click(`#daily-list [data-daily="${earlier[0]}"]`);
      await page.waitForSelector('#screen-play:not([hidden])');
      assert(await page.evaluate((d) => window.__flg.state.save.daily === d, earlier[0]), 'an earlier daily puzzle opens');
      // Smarter hints on a fresh grid: the clue, the technique, then why and how it works.
      await page.click('[data-act=hint]');
      await page.waitForSelector('#hintbox:not([hidden]) .hint-tech .pill');
      const first = await page.textContent('#hintbox');
      const clueNo = await page.evaluate(() => window.__flg.state.hint.res.clue);
      assert(!clueNo || await page.locator('#hintbox q.hint-clue').count() === 1, `the first hint step names the technique${clueNo ? ' and quotes the clue' : ''} (${first.slice(0, 90)})`);
      await page.click('#hint-more');
      await page.click('#hint-more');
      const last = await page.textContent('#hintbox');
      assert(/Why:/.test(last) && /How this works:/.test(last), 'the last hint step explains why and how the technique works');
      await page.click('#home-btn');
    }
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
