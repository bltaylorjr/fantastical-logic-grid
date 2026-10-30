// Films the gameplay clips for the promo video from the real game, as motion
// (Chrome's screencast, 1920 x 1080 JPEG frames with timestamps), into
// media/promo/out/clips/<name>/. Run from the repo root after `npm run build`
// and `npm --prefix server ci`:
//   node media/promo/tools/capture.cjs
// Races and the scoreboard run against the real Worker in Miniflare with a
// small stand-in for Firebase Auth, the same set-up as video/capture.cjs.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '../../..');
const OUT = path.join(__dirname, '..', 'out');
const CLIPS = path.join(OUT, 'clips');
const PROJECT = 'flg-promo';
const AUTH_PORT = 8161;
const API_PORT = 8162;
const APP_PORT = 8163;
const APP = `http://localhost:${APP_PORT}`;
// A 1920 x 1080 window with the page zoomed by 4/3, so the game lays out as it
// does at 1440 x 810 but the screencast frames are full HD.
const VIEW = { width: 1920, height: 1080 };
const ZOOM = 4 / 3;
const SEED = process.env.SEED || 'promo-town-7';

fs.rmSync(CLIPS, { recursive: true, force: true });
fs.mkdirSync(CLIPS, { recursive: true });

function startAuth(signer) {
  const refresh = new Map();
  const ok = (res, data) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(data)); };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const route = new URL(req.url, 'http://x').pathname;
      const body = (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
      if (route === '/v1/accounts:signUp') {
        const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 28);
        const rt = crypto.randomUUID();
        refresh.set(rt, { uid, email: body.email });
        return ok(res, { localId: uid, email: body.email, idToken: signer.token({ sub: uid, email: body.email }), refreshToken: rt, expiresIn: '3600' });
      }
      if (route === '/v1/token') {
        const u = refresh.get(body.refresh_token);
        return ok(res, { id_token: signer.token({ sub: u.uid, email: u.email }), refresh_token: body.refresh_token, expires_in: '3600', user_id: u.uid });
      }
      return ok(res, {});
    });
  });
  server.listen(AUTH_PORT);
  return server;
}

// A pointer that glides between targets and ripples on each click, plus no
// toasts (the voice download can't reach the internet here).
const CSS = `
  html{zoom:${ZOOM}}
  .toast{display:none!important}
  #__cur{position:fixed;pointer-events:none;z-index:2147483647;width:32px;height:32px;left:-80px;top:-80px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35))}
  .__rip{position:fixed;pointer-events:none;z-index:2147483646;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:4px solid #f5a524;animation:__rip .5s ease-out forwards}
  @keyframes __rip{to{transform:scale(4.5);opacity:0}}`;
const INIT = (Z) => {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32"><path d="M4 2l15 11-7 1 4 8-3 1-4-8-5 5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(c);
  };
  addEventListener('mousemove', (e) => { add(); const c = document.getElementById('__cur'); (document.querySelector('dialog[open]') || document.body).append(c); c.style.left = `${(e.clientX - 6) / Z}px`; c.style.top = `${(e.clientY - 4) / Z}px`; }, true);
  addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = `${e.clientX / Z}px`; r.style.top = `${e.clientY / Z}px`; (document.querySelector('dialog[open]') || document.body).append(r); setTimeout(() => r.remove(), 600); }, true);
};

(async () => {
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const signer = makeSigner(PROJECT);
  const auth = startAuth(signer);
  const mf = new Miniflare({
    port: API_PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: APP, TEST_JWKS: JSON.stringify(signer.jwks) },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const app = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), path.join(ROOT, 'dist', 'web'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));

  const config = `export const CLOUD = { firebaseApiKey: 'promo-key', syncUrl: 'http://localhost:${API_PORT}', authUrl: 'http://localhost:${AUTH_PORT}/v1', tokenUrl: 'http://localhost:${AUTH_PORT}/v1', learnUrl: 'http://localhost:${API_PORT}' };\nexport const cloudEnabled = () => true;\nexport const CLOUD_URL = 'http://localhost:${API_PORT}';\n`;
  const browser = await chromium.launch();
  const clips = [];
  let p;

  async function device({ silent = false, seed = SEED } = {}) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    await ctx.route('**/worker.js', async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, body: (await res.text()).replace('generatePuzzle(args)', `generatePuzzle({ ...args, seed: args.seed || '${seed}' })`) });
    });
    await ctx.addInitScript((s) => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: s, coach: false })); }, silent);
    await ctx.addInitScript(INIT, ZOOM);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.goto(`${APP}/`);
    await page.waitForSelector('#tier-choices input');
    await page.addStyleTag({ content: CSS });
    return page;
  }
  const prep = () => p.addStyleTag({ content: CSS });
  // Where the pointer is during a clip, so the editor's camera can follow it.
  let track = null; let trackT0 = 0; let clicks = [];

  // ---- Filming: everything inside fn() is recorded as one clip.
  async function film(name, fn) {
    const dir = path.join(CLIPS, name);
    fs.mkdirSync(dir, { recursive: true });
    const cdp = await p.context().newCDPSession(p);
    const frames = [];
    const t0 = Date.now() / 1000;
    track = []; clicks = []; trackT0 = t0;
    let writing = Promise.resolve();
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const f = `${String(frames.length).padStart(5, '0')}.jpg`;
      frames.push({ f, t: Math.max(0, metadata.timestamp - t0) });
      writing = writing.then(() => fs.promises.writeFile(path.join(dir, f), Buffer.from(data, 'base64')));
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    // A tiny repaint so the first frame arrives straight away.
    await p.evaluate(() => { document.body.style.outline = '0 solid transparent'; });
    await fn();
    await p.waitForTimeout(250);
    const end = Date.now() / 1000 - t0;
    await cdp.send('Page.stopScreencast');
    await writing;
    await cdp.detach();
    clips.push({ name, duration: end, frames, pointer: track, clicks });
    track = null;
    console.log(`clip ${name}: ${frames.length} frames, ${end.toFixed(1)} s`);
  }

  const wait = (ms) => p.waitForTimeout(ms);
  async function center(sel) { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded(); const bb = await l.boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; }
  let mouse = [960, 800];
  async function glide(x, y, ms = 450) {
    const steps = Math.max(8, Math.round(ms / 16));
    const [sx, sy] = mouse;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps; const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      await p.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      if (track) track.push([+(Date.now() / 1000 - trackT0).toFixed(3), Math.round(sx + (x - sx) * e), Math.round(sy + (y - sy) * e)]);
      await p.waitForTimeout(ms / steps / 2);
    }
    mouse = [x, y];
  }
  const press = async () => { if (track) clicks.push(+(Date.now() / 1000 - trackT0).toFixed(3)); await p.mouse.down(); await p.mouse.up(); };
  async function tap(sel, ms) {
    const [x, y] = await center(sel); await glide(x, y, ms);
    // The page can shift while the pointer travels; land on the target anyway.
    const [x2, y2] = await center(sel); if (Math.hypot(x2 - x, y2 - y) > 3) await glide(x2, y2, 150);
    await press();
  }
  // Smooth scroll so the page glides instead of jumping.
  async function scrollTo(sel, block = 'start', offset = -90, ms = 700) {
    await p.evaluate(async ({ sel, block, offset, ms }) => {
      const el = document.querySelector(sel); const r = el.getBoundingClientRect();
      const target = window.scrollY + (block === 'center' ? r.top - (innerHeight - r.height) / 2 : r.top) + offset;
      const from = window.scrollY; const t0 = performance.now();
      await new Promise((done) => { const step = (now) => { const k = Math.min(1, (now - t0) / ms); const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; window.scrollTo(0, from + (target - from) * e); if (k < 1) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
    }, { sel, block, offset, ms });
  }
  const jumpTo = (sel, offset = -90) => p.evaluate(({ sel, offset }) => { const r = document.querySelector(sel).getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top + offset); }, { sel, offset });
  const top = () => p.evaluate(() => window.scrollTo(0, 0));
  const cellXY = (k) => p.evaluate((k) => { const td = window.__flg.state.grid.cells.get(k); const r = td.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, k);
  async function setMark(k, want, ms = 260) {
    const order = ['', 'X', 'O'];
    const cur = await p.evaluate((k) => window.__flg.state.marks.get(k) || '', k);
    const n = (order.indexOf(want) - order.indexOf(cur === 'A' ? 'X' : cur) + 3) % 3;
    const [x, y] = await cellXY(k);
    await glide(x, y, ms);
    for (let i = 0; i < n; i++) { await press(); await wait(70); }
  }
  const nextHint = () => p.evaluate(async () => {
    const S = window.__flg.state;
    const { getHint } = await import('./engine/index.js');
    const marks = [...S.marks].filter(([, v]) => v).map(([k, v]) => { const [a, b] = k.split('|'); return { a, b, mark: v === 'O' ? 'O' : 'X' }; });
    const h = getHint(S.puzzle, marks);
    return { kind: h.kind, marks: (h.marks || []).map((m) => ({ k: S.ix.key(m.a, m.b), mark: m.mark })) };
  });
  const solutionMarks = () => p.evaluate(() => {
    const S = window.__flg.state;
    return [...S.grid.cells.keys()].map((k) => { const [a, b] = k.split('|'); const yes = S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b)); return { k, mark: yes ? 'O' : 'X', have: S.marks.get(k) || '' }; });
  });
  const fillInstant = (fraction = 1) => p.evaluate((fraction) => {
    const S = window.__flg.state; const cells = [...S.grid.cells]; const n = Math.round(cells.length * fraction);
    for (const [k, td] of cells.slice(0, n)) {
      const [a, b] = k.split('|'); const yes = S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b));
      const cur = S.marks.get(k) || '';
      if (yes && cur !== 'O') { if (cur === '') td.click(); td.click(); }
      if (!yes && cur === '') td.click();
    }
  }, fraction);

  try {
    p = await device();

    // ---------- Home
    await top(); await glide(930, 850, 10);
    await film('home', async () => { await wait(600); await tap('#hero-new', 900); await wait(1600); });
    await top();

    // ---------- Themes
    await jumpTo('#theme-choices', -150);
    const themes = ['mystery', 'fantasy', 'scifi', 'astronomy', 'music', 'parks', 'travel', 'science', 'math', 'nautical', 'cooking', 'pets', 'sports'];
    await film('themes', async () => {
      await wait(300);
      for (const t of themes) { await tap(`input[name=theme][value=${t}] + *`, 330); await wait(260); }
      await wait(400);
    });

    // ---------- Difficulty
    await jumpTo('#tier-choices', -170);
    await film('tiers', async () => {
      await wait(300);
      for (const t of ['basic', 'easy', 'medium', 'hard', 'expert', 'mensa', 'theorist']) { await tap(`input[name=tier][value=${t}] + *`, 380); await wait(330); }
      await wait(500);
    });

    // ---------- Generate and story
    await p.check('input[name=tier][value=easy]', { force: true });
    await p.check('input[name=theme][value=town]', { force: true });
    await p.check('input[name=size][value="3x4"]', { force: true }).catch(() => {});
    await jumpTo('#gen-btn', -500);
    await film('generate', async () => {
      await wait(300);
      await tap('#gen-btn', 700);
      await p.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
      await prep();
      await wait(1800);
      await scrollTo('#story', 'start', -40, 1600);
      await wait(1800);
    });
    const P = await p.evaluate(() => { const P = window.__flg.state.puzzle; return { title: P.title, theme: P.theme, story: P.story.id }; });
    console.log('puzzle:', P.title);

    // ---------- Characters
    await jumpTo('#cast-row', -330);
    await film('cast', async () => {
      await wait(300);
      const btns = await p.$$eval('.cast-btn', (bs) => bs.filter((b) => !/^0 /.test(b.querySelector('small').textContent)).map((b) => b.dataset.who));
      for (const who of btns.slice(0, 3)) { await tap(`.cast-btn[data-who="${who}"]`, 550); await wait(1300); }
      await p.evaluate(() => { document.querySelector('#bubble').hidden = true; });
      await tap('#read-clues', 700); await wait(1500);
    });
    await p.evaluate(() => { speechSynthesis.cancel(); document.querySelector('#bubble').hidden = true; });
    const stop = await p.$('#read-clues'); if (stop && /stop/i.test(await stop.textContent())) await stop.click();

    // ---------- Solving with the game's own hints
    await jumpTo('#grid-region', -20);
    await film('grid', async () => {
      await wait(300);
      for (let i = 0; i < 9; i++) {
        const h = await nextHint();
        if (h.kind !== 'step' || !h.marks.length) break;
        for (const m of h.marks) { await setMark(m.k, m.mark, 240); await wait(90); }
        await wait(160);
      }
      await wait(500);
    });

    // ---------- Hints
    await film('hint', async () => {
      await top(); await wait(200);
      await tap('[data-act=hint]', 600);
      await p.waitForSelector('#hintbox:not([hidden])');
      await wait(300);
      await scrollTo('#hintbox', 'center', 0, 700); await wait(900);
      await tap('#hint-more', 500); await wait(1000);
      await tap('#hint-more', 400); await wait(1500);
    });
    await p.click('#hint-close').catch(() => {});

    // ---------- Scene art revealing as sections finish, then the solve
    await top();
    await film('reveal', async () => {
      await wait(300);
      const all = (await solutionMarks()).filter((m) => m.have !== m.mark && !(m.mark === 'X' && m.have === 'A'));
      const half = all.slice(0, Math.ceil(all.length * 0.6));
      for (const m of half) await p.evaluate(({ k, mark }) => { const S = window.__flg.state; const td = S.grid.cells.get(k); const cur = S.marks.get(k) || ''; if (mark === 'O') { if (cur === '') td.click(); if ((S.marks.get(k) || '') !== 'O') td.click(); } else if (cur === '') td.click(); }, m);
      await wait(2200);
    });
    await jumpTo('#grid-region', -20);
    await film('solve', async () => {
      await wait(200);
      const rest = (await solutionMarks()).filter((m) => m.have !== m.mark && !(m.mark === 'X' && m.have === 'A'));
      for (const m of rest.slice(0, -1)) { await setMark(m.k, m.mark, 110); }
      const last = rest[rest.length - 1];
      if (last) await setMark(last.k, last.mark, 500);
      await p.waitForSelector('#solved:not([hidden])');
      await wait(3800);
    });
    await prep();

    // ---------- Light, dark, high contrast
    await jumpTo('#grid-region', -20);
    await film('looks', async () => {
      await wait(900);
      await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await wait(1300);
      await p.evaluate(() => { document.documentElement.dataset.theme = 'contrast'; }); await wait(1300);
      await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await wait(700);
    });

    // ---------- Stats and badges (the solve above counts)
    await top();
    await film('stats', async () => {
      await wait(200);
      await tap('#menu-btn', 500); await wait(350);
      await tap('[data-cmd=stats]', 500);
      await p.waitForSelector('#dlg-stats[open]');
      await p.waitForFunction(() => !/Loading/.test(document.querySelector('#stats-body').textContent), null, { timeout: 15000 }).catch(() => {});
      await wait(1600);
      await p.evaluate(() => { const b = document.querySelector('#stats-body'); b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); });
      await wait(1600);
    });
    // Close it for sure before printing (a dialog left open would block the next clip).
    await p.evaluate(() => { const d = document.querySelector('#dlg-stats'); if (d && d.open) d.close(); });
    await p.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 5000 }).catch(() => {});
    await prep(); await wait(300);

    // ---------- Print
    await top();
    await film('print', async () => {
      await wait(200);
      await tap('[data-act=print]', 600); await wait(1800);
    });
    await p.click('#print-cancel');

    // ---------- Saved puzzles
    await p.click('#home-btn'); await p.waitForSelector('.saved-item'); await prep(); await top();
    await film('saved', async () => {
      await wait(300); await scrollTo('#saved-section', 'center', 0, 800); await glide(...(await center('.saved-item')), 600); await wait(1400);
    });

    // ---------- Install
    await top();
    await film('install', async () => {
      await wait(200);
      await tap('#menu-btn', 500); await wait(400);
      await tap('[data-cmd=install]', 500);
      await p.waitForSelector('#dlg-install[open]'); await wait(2200);
    });
    await p.click('#install-close'); await wait(300);

    // ---------- Accounts and races (sign-up is not filmed)
    await p.evaluate(async () => (await import('./js/account.js')).signUp('detective@example.com', 'correct horse battery'));
    await p.waitForSelector('#dlg-name[open]', { timeout: 15000 });
    await p.fill('#name-input', 'Sky Fox');
    await p.click('#name-form button[type=submit]'); await p.waitForSelector('#dlg-name[open]', { state: 'detached' });
    await prep();
    // Some rivals, so the scoreboard has a race on it.
    const rivals = [];
    for (const [i, name] of ['Bold Badger', 'Quiet Owl', 'Clever Lynx'].entries()) {
      const r = await device({ silent: true, seed: `${SEED}-r${i}` });
      await r.evaluate(async (e) => (await import('./js/account.js')).signUp(e, 'correct horse battery'), `rival${i}@example.com`);
      await r.waitForSelector('#dlg-name[open]', { timeout: 15000 });
      await r.fill('#name-input', name);
      await r.click('#name-form button[type=submit]'); await r.waitForSelector('#dlg-name[open]', { state: 'detached' });
      rivals.push(r);
    }
    await p.check('input[name=tier][value=basic]', { force: true });
    await p.check('input[name=theme][value=parks]', { force: true });
    await p.check('input[name=size][value="3x3"]', { force: true }).catch(() => {});
    await jumpTo('#compete-section', -200);
    let code;
    await film('race-start', async () => {
      await wait(300);
      await tap('[data-compete=start]', 600);
      await p.waitForSelector('#dlg-race[open] [data-view=start]:not([hidden])'); await wait(700);
      await tap('[data-view=start] button[type=submit]', 500);
      await p.waitForSelector('[data-view=share]:not([hidden])', { timeout: 60000 });
      code = await p.textContent('#race-code-big');
      await wait(1800);
    });
    await p.click('[data-view=share] [data-close]'); await wait(300); await prep(); await top();
    for (const r of rivals) {
      await r.goto(`${APP}/?race=${code}`);
      await r.waitForSelector('#dlg-race[open] [data-view=join]:not([hidden])');
      await r.click('[data-view=join] button[type=submit]');
      await r.waitForSelector('#screen-play:not([hidden])');
    }
    // Two rivals finish first; our player then finishes with the grid filmed.
    for (const r of rivals.slice(0, 1)) {
      await r.evaluate(() => { const S = window.__flg.state; for (const [k, td] of S.grid.cells) { const [a, b] = k.split('|'); const yes = S.puzzle.solution.some((x) => Object.values(x).includes(a) && Object.values(x).includes(b)); td.click(); if (yes) td.click(); } });
      await r.waitForSelector('#solved:not([hidden])');
    }
    await film('race-play', async () => {
      await wait(400);
      await tap('#race-standings', 600); await wait(1800);
      await p.keyboard.press('Escape'); await wait(300);
      await jumpTo('#grid-region', -20); await wait(200);
      const all = await solutionMarks();
      for (const m of all) await setMark(m.k, m.mark, 90);
      await p.waitForSelector('#solved:not([hidden])');
      await p.waitForFunction(() => /place/i.test(document.querySelector('#compete-result').textContent), null, { timeout: 15000 });
      await wait(600);
      await scrollTo('#compete-result', 'center', 0, 700); await wait(1800);
    });
    for (const r of rivals.slice(1)) {
      await r.evaluate(() => { const S = window.__flg.state; for (const [k, td] of S.grid.cells) { const [a, b] = k.split('|'); const yes = S.puzzle.solution.some((x) => Object.values(x).includes(a) && Object.values(x).includes(b)); td.click(); if (yes) td.click(); } });
      await r.waitForSelector('#solved:not([hidden])');
    }
    await p.click('#home-btn'); await p.waitForSelector('#tier-choices input'); await prep();
    await jumpTo('#compete-section', -200);
    await film('board', async () => {
      await wait(200);
      await tap('#compete-section [data-compete=board]', 600);
      await p.waitForSelector('#dlg-board[open] table.board'); await wait(2400);
    });
    await p.keyboard.press('Escape');
    await p.evaluate(async () => (await import('./js/compete-ui.js')).refreshMiniBoard({ force: true })).catch(() => {});
    await jumpTo('#compete-section', -200);
    await film('challenge', async () => {
      await wait(200);
      await tap('[data-compete=challenge]', 600);
      await p.waitForSelector('#dlg-race[open] [data-view=challenge]:not([hidden])');
      await p.locator('#challenge-name').pressSequentially('Bold Badger', { delay: 70 });
      await wait(1200);
    });
    await p.keyboard.press('Escape');

    // ---------- Share a storyline idea (signed in, so the email box shows)
    await top();
    await film('idea', async () => {
      await wait(200);
      await tap('#menu-btn', 500); await wait(350);
      await tap('[data-cmd=feedback]', 500);
      await p.waitForSelector('#dlg-feedback[open]'); await wait(500);
      await tap('#idea-form input[name=idea-topic][value=story] + *, #idea-form input[name=idea-topic][value=story]', 450).catch(() => {});
      await p.selectOption('#idea-theme', 'nautical').catch(() => {});
      await wait(300);
      await tap('#idea-text', 500);
      await p.locator('#idea-text').pressSequentially('A lighthouse keeper finds the great lantern switched off on the stormiest night of the year...', { delay: 38 });
      await wait(1500);
    });
    await p.evaluate(() => { const d = document.querySelector('#dlg-feedback'); if (d && d.open) d.close(); });
    await top(); await wait(500);
    await film('home-signed-in', async () => { await wait(2200); });

    fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify({ seed: SEED, puzzle: P, clips }, null, 1));
    console.log(`${clips.length} clips written`);
  } catch (e) {
    await p.screenshot({ path: path.join(OUT, 'failed.png') }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
    app.kill(); auth.close(); await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
