// Website security: the game and search pages carry a strict Content Security
// Policy that the game itself never trips, outside scripts are refused, the
// game will not run inside another site's frame, and security.txt is served.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exitCode = 1; } else console.log(`ok  ${m}`); };

const PORT = 8191;
const EVIL = 8192;
const SITE = `http://localhost:${PORT}`;

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'site'), String(PORT)], { stdio: 'ignore' });
  // Another site that frames the game, as a clickjacking page would.
  const evil = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><iframe id="f" src="${SITE}/" width="800" height="600"></iframe>`); }).listen(EVIL);
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device' }));
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${SITE}/fantastical/`);
    await page.waitForSelector('#home-btn');
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    assert(/script-src 'self' 'sha256-/.test(csp || ''), 'the game page has a script policy with the inline script hash');
    assert(/connect-src [^;]*https:\/\/thelogicgrid\.com/.test(csp), 'the desktop app may read the daily puzzle from the website');
    assert(/object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && !/unsafe-eval/.test(csp), 'no plugins, no base tag tricks, no eval');

    // Play a little so the grid, clues and dialogs all render under the policy.
    const start = page.locator('#start-btn, [data-cmd=new], button:has-text("New puzzle")').first();
    if (await start.count()) await start.click().catch(() => {});
    await page.waitForTimeout(1500);
    assert(await page.evaluate(() => document.documentElement.hidden === false), 'the game shows normally on its own site');

    // A script injected from elsewhere is refused.
    const ran = await page.evaluate(() => new Promise((res) => {
      window.__evil = false;
      const s = document.createElement('script');
      s.src = 'https://example.com/evil.js';
      s.onerror = () => res(window.__evil);
      s.onload = () => res(true);
      document.head.appendChild(s);
      setTimeout(() => res(window.__evil), 3000);
    }));
    assert(ran === false, 'a script from another site is blocked');
    const inline = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s); return window.__inline === 1; });
    assert(!inline, 'an injected inline script does not run');
    const violations = (await page.evaluate(() => window.__csp)).filter((v) => !/example\.com|inline/.test(v));
    assert(!violations.length, `the game itself never trips the policy ${violations.join(' | ')}`);
    assert(!errors.length, `no page errors ${errors.join(' | ')}`);

    // Search pages.
    for (const p of ['/how-to-play/', '/daily/']) {
      const sp = await ctx.newPage();
      await sp.goto(`${SITE}${p}`);
      const meta = await sp.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
      assert(/default-src 'self'/.test(meta || ''), `${p} has a security policy`);
      const v = await sp.evaluate(() => window.__csp);
      assert(!v.length, `${p} never trips it ${v.join(' | ')}`);
      await sp.close();
    }

    // Framed by another site: the game hides itself.
    const framed = await ctx.newPage();
    await framed.goto(`http://127.0.0.1:${EVIL}/`);
    await framed.waitForTimeout(1500);
    const frame = framed.frames().find((f) => f.url().startsWith(SITE));
    const hidden = frame ? await frame.evaluate(() => document.documentElement.hidden).catch(() => false) : false;
    // Either the game took over the whole tab or it stayed hidden in the frame.
    assert(framed.url().startsWith(SITE) || hidden, 'the game will not run inside another site\'s frame');

    const txt = await (await fetch(`${SITE}/.well-known/security.txt`)).text();
    const exp = new Date((txt.match(/^Expires: (.+)$/m) || [])[1]);
    assert(/^Contact: /m.test(txt) && exp > Date.now() + 300 * 24 * 3600_000, 'security.txt lists a contact and expires about a year ahead');

    // Copying protection: AI training crawlers are refused, search stays open,
    // text and data mining is reserved, and every page links the terms.
    const robots = await (await fetch(`${SITE}/robots.txt`)).text();
    const groups = robots.split(/\n\s*\n/);
    const trainGroup = groups.find((g) => /^User-agent: GPTBot$/m.test(g)) || '';
    assert(/^Disallow: \/$/m.test(trainGroup) && /^User-agent: ClaudeBot$/m.test(trainGroup) && /^User-agent: Google-Extended$/m.test(trainGroup), 'robots.txt refuses AI training crawlers');
    assert(/User-agent: \*\nAllow: \//.test(robots) && !/Googlebot|OAI-SearchBot|Claude-SearchBot|Bingbot/i.test(robots), 'search engines and AI search assistants may still crawl');
    const tdm = await (await fetch(`${SITE}/.well-known/tdmrep.json`)).json();
    assert(tdm[0]['tdm-reservation'] === 1 && /\/terms\/$/.test(tdm[0]['tdm-policy']), 'tdmrep.json reserves text and data mining');
    const terms = await (await fetch(`${SITE}/terms/`)).text();
    assert(/All rights reserved/.test(terms) && /train/.test(terms) && /classroom/.test(terms), 'the terms of use page is published');
    const howTo = await (await fetch(`${SITE}/how-to-play/`)).text();
    assert(/©.*All rights reserved/.test(howTo) && /href="\.\.\/terms\/"/.test(howTo) && /tdm-reservation" content="1"/.test(howTo), 'site pages carry the copyright, terms link and mining reservation');
  } finally {
    await browser.close();
    server.kill();
    evil.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
