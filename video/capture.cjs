// Records the how-to-play video's pictures from the real game and writes the
// narration that goes with each one (video/out/scenes.json). Run from the repo
// root after `npm run build` and `npm --prefix server install`:
//   node video/capture.cjs
// The walkthrough narration comes from the game's own hints, so it always
// matches the puzzle on screen even after the engine changes. Accounts, races
// and the scoreboard run against the real Worker in Miniflare with a small
// stand-in for Firebase Auth, the same set-up as scripts/e2e-compete.cjs.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const SHOTS = path.join(OUT, 'shots');
const PROJECT = 'flg-video';
const AUTH_PORT = 8151;
const API_PORT = 8152;
const APP_PORT = 8153;
const APP = `http://localhost:${APP_PORT}`;
const VIEW = { width: 1440, height: 810 };
const SCALE = 4 / 3; // 1440 x 810 CSS px -> 1920 x 1080 pictures

fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

// ---- Pick a walkthrough puzzle: an Easy mystery whose first hint steps
// teach a confirmed match, an either/or clue and "the only one left".
async function pickSeed() {
  const { generatePuzzle, getHint } = await import(path.join(ROOT, 'engine/src/index.js'));
  for (let i = 1; i <= 200; i++) {
    const seed = `flgvideo-${i}`;
    const p = generatePuzzle({ difficulty: 'easy', theme: 'mystery', categories: 3, items: 4, seed, usedStories: [] });
    if (p.clues.length > 8) continue;
    let marks = [];
    const steps = [];
    for (let s = 0; s < 16; s++) {
      const h = getHint(p, marks);
      if (h.kind !== 'step') break;
      steps.push(h);
      marks = marks.concat(h.marks.map((m) => ({ a: m.a, b: m.b, mark: m.mark })));
    }
    const firstO = steps.findIndex((h) => h.marks.some((m) => m.mark === 'O'));
    const either = steps.findIndex((h) => /no other .* is possible/.test(h.levels[2]));
    const only = steps.findIndex((h) => /is the only .* left/.test(h.levels[2]));
    if (firstO >= 0 && firstO <= 3 && either >= 0 && either <= 6 && only >= 0 && only <= 11) return seed;
  }
  return 'flgvideo-1';
}

// ---- Just enough of Firebase Auth for signing up and renewing tokens.
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

const CSS = `
  #__hl{position:fixed;pointer-events:none;z-index:2147483646;border:4px solid #f5a524;border-radius:14px;box-shadow:0 0 0 9999px rgba(10,15,30,.38),0 0 0 8px rgba(245,165,36,.35)}
  #__cur{position:fixed;pointer-events:none;z-index:2147483647;width:34px;height:34px}
  .__ring{position:fixed;pointer-events:none;z-index:2147483646;border:4px solid #f5a524;border-radius:10px;box-shadow:0 0 0 6px rgba(245,165,36,.3)}`;

(async () => {
  const seed = process.env.SEED || await pickSeed();
  console.log(`walkthrough seed: ${seed}`);
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

  const config = `export const CLOUD = { firebaseApiKey: 'video-key', syncUrl: 'http://localhost:${API_PORT}', authUrl: 'http://localhost:${AUTH_PORT}/v1', tokenUrl: 'http://localhost:${AUTH_PORT}/v1', learnUrl: 'http://localhost:${API_PORT}' };\nexport const cloudEnabled = () => true;\nexport const CLOUD_URL = 'http://localhost:${API_PORT}';\n`;
  const browser = await chromium.launch();
  const scenes = [];
  let p; // the page being filmed

  async function device({ silent = false } = {}) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await ctx.route('**/js/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
    // Same game, fixed seed, so a run is repeatable.
    await ctx.route('**/worker.js', async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, body: (await res.text()).replace('generatePuzzle(args)', `generatePuzzle({ ...args, seed: args.seed || '${seed}' })`) });
    });
    // The daily puzzle, from the website build when there is one.
    const DAILY = path.join(ROOT, 'dist', 'site', 'daily');
    if (fs.existsSync(path.join(DAILY, 'latest.json'))) {
      // The page itself is left alone (a page Playwright serves may not reach
      // the local Worker); the site build's daily marker is added as it loads.
      await ctx.addInitScript(() => {
        new MutationObserver((_, o) => {
          if (!document.head) return;
          const m = document.createElement('meta'); m.name = 'flg-daily'; m.content = 'daily/';
          document.head.prepend(m); o.disconnect();
        }).observe(document, { childList: true, subtree: true });
      });
      await ctx.route('**/daily/**', (r) => {
        const f = path.join(DAILY, decodeURIComponent(new URL(r.request().url()).pathname.replace(/^\/daily\//, '')));
        return f.startsWith(DAILY) && fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'application/json' }) : r.fulfill({ status: 404, body: '' });
      });
    }
    await ctx.addInitScript((s) => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, voiceProvider: 'device', silent: s })); }, silent);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.goto(`${APP}/`);
    await page.waitForSelector('#tier-choices input');
    return page;
  }

  // ---- Filming helpers
  const prep = () => p.addStyleTag({ content: CSS });
  const clearFx = () => p.evaluate(() => document.querySelectorAll('#__hl,#__cur,.__ring').forEach((e) => e.remove()));
  // Dims everything except the given elements (inside an open dialog when there is one).
  async function hl(sels, pad = 10) {
    await p.evaluate(({ sels, pad }) => {
      document.querySelectorAll('#__hl').forEach((e) => e.remove());
      const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width);
      if (!rs.length) return;
      const x = Math.min(...rs.map((r) => r.left)) - pad, y = Math.min(...rs.map((r) => r.top)) - pad;
      const w = Math.max(...rs.map((r) => r.right)) + pad - x, h = Math.max(...rs.map((r) => r.bottom)) + pad - y;
      const d = document.createElement('div'); d.id = '__hl';
      Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      (document.querySelector('dialog[open]') || document.body).append(d);
    }, { sels: [].concat(sels), pad });
  }
  async function rings(keys) {
    await p.evaluate((keys) => {
      document.querySelectorAll('.__ring').forEach((e) => e.remove());
      for (const k of keys) {
        const td = window.__flg.state.grid.cells.get(k); if (!td) continue;
        const r = td.getBoundingClientRect(); const d = document.createElement('div'); d.className = '__ring';
        Object.assign(d.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
        document.body.append(d);
      }
    }, keys);
  }
  async function cursor(x, y) {
    await p.evaluate(({ x, y }) => {
      let c = document.getElementById('__cur');
      if (!c) { c = document.createElement('div'); c.id = '__cur'; c.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2l15 11-7 1 4 8-3 1-4-8-5 5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
      (document.querySelector('dialog[open]') || document.body).append(c);
      c.style.left = `${x + 8}px`; c.style.top = `${y + 8}px`;
    }, { x, y });
  }
  async function center(sel) { const bb = await p.locator(sel).first().boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; }
  async function point(sel) { const [x, y] = await center(sel); await cursor(x, y); }
  async function clickShown(sel) { await p.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await center(sel); await p.mouse.click(x, y); await cursor(x, y); }
  async function scrollTo(sel, block = 'center', offset = 0) {
    await p.evaluate(({ sel, block, offset }) => { document.querySelector(sel).scrollIntoView({ block }); if (offset) window.scrollBy(0, offset); }, { sel, block, offset });
    await p.waitForTimeout(200);
  }
  const top = () => p.evaluate(() => window.scrollTo(0, 0));
  const gridView = () => scrollTo('#grid-region', 'start', -76);
  // One scene: a picture and the sentences said over it. A sentence can be
  // [caption, spoken] when the voice needs a different spelling.
  async function scene(name, sentences) {
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    scenes.push({ shot: `shots/${name}.png`, sentences });
    console.log('scene', name);
  }
  function card(name, sentences) { scenes.push({ shot: `shots/card-${name}.png`, sentences }); }

  // Grid cells by item label.
  const keyOf = (a, b) => p.evaluate(({ a, b }) => {
    const S = window.__flg.state; const id = (l) => S.ix.cats.flatMap((c) => c.items).find((i) => i.label === l || i.id === l).id;
    return S.ix.key(id(a), id(b));
  }, { a, b });
  async function setMark(k, want) {
    const order = ['', 'X', 'O'];
    const cur = await p.evaluate((k) => window.__flg.state.marks.get(k) || '', k);
    const clicks = (order.indexOf(want) - order.indexOf(cur === 'A' ? 'X' : cur) + 3) % 3;
    const c = await p.evaluate((k) => { const td = window.__flg.state.grid.cells.get(k); td.scrollIntoView({ block: 'nearest' }); const r = td.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, k);
    for (let i = 0; i < clicks; i++) await p.mouse.click(c.x, c.y);
    await cursor(c.x, c.y);
  }
  const spotClues = (ns) => p.evaluate((ns) => document.querySelectorAll('#clue-list li').forEach((li) => li.classList.toggle('spot', ns.includes(+li.dataset.n))), ns);
  const nextHint = () => p.evaluate(async () => {
    const S = window.__flg.state;
    const { getHint } = await import('./engine/index.js');
    const marks = [...S.marks].filter(([, v]) => v).map(([k, v]) => { const [a, b] = k.split('|'); return { a, b, mark: v === 'O' ? 'O' : 'X' }; });
    const h = getHint(S.puzzle, marks);
    return { kind: h.kind, clue: h.clue, text: h.levels[2], marks: (h.marks || []).map((m) => ({ k: S.ix.key(m.a, m.b), mark: m.mark })) };
  });
  const fillFromSolution = (fraction = 1) => p.evaluate((fraction) => {
    const S = window.__flg.state;
    const cells = [...S.grid.cells];
    const n = Math.round(cells.length * fraction);
    for (const [k, td] of cells.slice(0, n)) {
      const [a, b] = k.split('|');
      const yes = S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b));
      const cur = S.marks.get(k) || '';
      if (yes && cur !== 'O') { if (cur === '') td.click(); td.click(); }
      if (!yes && cur === '') td.click();
    }
  }, fraction);

  try {
    // =================== Intro
    p = await device();
    await prep();
    card('title', ['Welcome to The Fantastical Logic Grid.', 'Every case is a brand new story, and you are the detective.']);
    await top();
    await scene('home', ['Each puzzle is a logic grid wrapped in a story.', 'The story sets up a mystery, the clues give you the facts, and the grid is where you work out the answer.']);
    await scene('home-2', ['Every story is written fresh for you and never repeated.', 'And every puzzle has exactly one answer you can reach without guessing.']);
    if (await p.isVisible('#daily-today [data-daily]')) {
      await scrollTo('#daily-section'); await hl('#daily-section');
      await scene('daily', ['Every day there is also a new Daily puzzle, the same one for everyone.', 'Solve it each day to build a streak.']);
      await clearFx(); await top();
    }
    card('howto', ["Here's how to play."]);

    // =================== Set up
    await p.check('input[name=tier][value=easy]', { force: true });
    await scrollTo('#tier-choices'); await hl('#tier-choices'); await point('input[name=tier][value=easy] + *');
    await scene('tiers', ['Start on the New puzzle screen and pick a difficulty.', 'Basic and Easy are perfect for beginners.', ['MENSA is for true masterminds.', 'Mensa is for true masterminds.']]);
    await clearFx();
    await scrollTo('#theme-choices'); await clickShown('input[name=theme][value=mystery] + *'); await hl('#theme-choices');
    await scene('themes', [['Next, choose a theme, like Mystery, Fantasy, Sci-Fi, Around Town, National Parks or Vacation Destinations.', 'Next, choose a theme, like Mystery, Fantasy, Sci Fi, Around Town, National Parks, or Vacation Destinations.'], 'Or pick Surprise me.']);
    await clearFx();
    if (await p.isVisible('#topic-field')) {
      await scrollTo('#topic-field'); await hl('#topic-field');
      await scene('topics', ['Most themes also have topics, like which holiday or which kind of mystery.', 'Pick one, or leave it on Any.']);
      await clearFx();
    }
    await scrollTo('#size-choices'); await hl('#size-choices');
    await scene('sizes', ['Then pick a size.', 'More categories and more items make a bigger, harder grid.']);
    await clearFx();
    await scrollTo('#gen-btn'); await hl(['label:has(> input[name=playstyle])']);
    await scene('playstyle', ['Full experience adds scenes, characters and sound.', 'Silent mode keeps only the story, the grid, the clues and the answer key.']);
    await clearFx();
    await hl('#gen-btn'); await point('#gen-btn');
    await scene('generate', ['Press Generate puzzle, and your story is written in a moment.']);
    await clearFx();
    await p.click('#gen-btn');
    await p.waitForSelector('#screen-play:not([hidden])', { timeout: 60000 });
    await prep(); await p.waitForTimeout(800);
    const P = await p.evaluate(() => { const P = window.__flg.state.puzzle; return { title: P.title, goal: P.story.goal, ending: P.story.ending, q: P.questions[0], cats: P.categories.map((c) => ({ name: c.name, noun: c.noun, items: c.items.map((i) => i.label) })) }; });
    console.log(`puzzle: ${P.title}`);

    // =================== Story and cast
    await top(); await hl(['#toolbar']);
    await scene('toolbar', [`Here's our case: ${P.title}.`, 'The buttons along the top help you as you play.']);
    await clearFx();
    await scrollTo('#story', 'start', -76); await hl(['#p-story', '#read-story']);
    await scene('story', ['Read the story first.', 'It tells you who is involved, and it ends with the question you need to answer.', `Here, it's: ${P.goal}`, 'You can also press Read the story aloud to hear it.']);
    await clearFx();
    await scrollTo('#cast-row');
    const who = await p.evaluate(() => [...document.querySelectorAll('.cast-btn')].find((b) => !/^0 /.test(b.querySelector('small:last-of-type').textContent)).dataset.who);
    await clickShown(`.cast-btn[data-who="${who}"]`); await p.waitForTimeout(200);
    await hl(['#cast-row', '#bubble']);
    await scene('cast', ['Every character has a personality, shown under their name, and a voice of their own.', "Select a character's portrait to hear the clues they remember, in their own words.", 'Every clue is also in the clue list.']);
    await clearFx(); await spotClues([]); await p.evaluate(() => { document.querySelector('#bubble').hidden = true; });
    await scrollTo('#read-clues'); await hl(['#read-clues']);
    await scene('read-clues', ['To hear every clue in order, press Read the clues aloud.', 'Each character tells their own clue, and the clue being read lights up.']);
    await clearFx();

    // =================== The grid
    await gridView();
    if (await p.isVisible('#coach')) {
      await hl('#coach');
      await scene('coach', ['On your first Easy puzzle, coach tips appear above the grid to guide your first moves.']);
      await clearFx();
      await p.click('#coach-skip'); await p.waitForTimeout(200); await gridView();
    }
    await hl('#gridframe');
    const [c0, c1] = [P.cats[0], P.cats[P.cats.length - 1]];
    const an = (w) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
    await scene('grid', ['Now the grid.', `Each square is where two things meet, like ${an(c0.noun)} and ${an(c1.noun)}.`, 'Your job is to decide whether they go together.']);
    await clearFx();
    const demo = await p.evaluate(() => [...window.__flg.state.grid.cells.keys()][0]);
    await setMark(demo, 'X'); await rings([demo]);
    await scene('cycle-x', [['Click or tap a square once to mark an X.', 'Click or tap a square once to mark an ex.'], ['X means ruled out: these two don\'t go together.', 'Ex means ruled out. These two don\'t go together.']]);
    await setMark(demo, 'O');
    await scene('cycle-o', [['Tap again for an O. O means confirmed: these two are a match.', 'Tap again for an oh. Oh means confirmed. These two are a match.'], 'Tap a third time to clear the square.']);
    await setMark(demo, ''); await clearFx();

    // =================== Walkthrough from the game's own hints
    const say = (t) => t.replace(/(\d+)-year-old/g, '$1 year old');
    let beats = 0; let simple = []; let sawOnly = false; let sawCross = false;
    const flushSimple = async () => {
      if (!simple.length) return;
      const nums = simple.map((h) => h.clue);
      await spotClues(nums); await rings(simple.flatMap((h) => h.marks.map((m) => m.k)));
      const list = nums.length === 1 ? `Clue ${nums[0]}` : `Clues ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
      const lines = simple.length === 1 ? [say(simple[0].text), 'Mark an X there.'] : [`${list} each rule out pairs directly.`, 'Mark an X for each one.'];
      if (beats === 0) lines.unshift("Let's solve it together, starting with the simplest clues.");
      await scene(`walk-${beats++}`, lines);
      await clearFx(); simple = [];
    };
    for (let i = 0; i < 30 && beats < 9; i++) {
      const h = await nextHint();
      if (h.kind !== 'step' || !h.marks.length) break;
      for (const m of h.marks) await setMark(m.k, m.mark);
      const isSimple = h.marks.every((m) => m.mark === 'X') && /^Clue \d+ says/.test(h.text) && !/, so /.test(h.text);
      if (isSimple) { simple.push(h); if (simple.length < 4) continue; await flushSimple(); continue; }
      await flushSimple();
      await spotClues(h.clue ? [h.clue] : []);
      await rings(h.marks.map((m) => m.k));
      const lines = [say(h.text)];
      if (beats === 0) lines.unshift("Let's solve it together, starting with the simplest clues.");
      if (h.marks.some((m) => m.mark === 'O') && !/so .* cannot go with/.test(h.text) && h.marks.length === 1) lines.push(['Mark an O there.', 'Mark an oh there.']);
      if (/cannot go with any other/.test(h.text) && !sawCross) { sawCross = true; lines.push('Each row and each column in a section has exactly one match, so everything else in that line is an X.'); }
      if (/is the only .* left/.test(h.text) && !sawOnly) { sawOnly = true; lines.push('When only one square is left in a row or column, it must be the answer.'); }
      await scene(`walk-${beats++}`, lines);
      await clearFx(); await spotClues([]);
      if (sawOnly && beats >= 6) break;
    }
    await flushSimple();
    await top(); await hl('#scene');
    await scene('scene-layer', ['In the full experience, each finished section also reveals more of the scene.']);
    await clearFx();

    // =================== Help while playing
    await clickShown('[data-act=hint]'); await p.waitForSelector('#hintbox:not([hidden])');
    await gridView(); await hl('#hintbox');
    await scene('hint1', ['Stuck? Press Hint.', 'The first hint shows you which clue to use, and names the trick that cracks it.']);
    await clearFx();
    await p.click('#hint-more'); await p.click('#hint-more'); await p.waitForTimeout(200); await hl('#hintbox');
    await scene('hint3', ['Press Which cell? for the exact square, then Explain why for the full reasoning.', 'It ends with a short lesson on how that trick works, so you can spot it yourself next time.', 'You can even let it mark the square for you.']);
    await clearFx(); await p.click('#hint-close');
    await top(); await clickShown('[data-act=check]'); await hl(['#toolbar', '#status']);
    await scene('check', ['Press Check at any time to see whether any of your marks are wrong.']);
    await clearFx(); await hl(['[data-act=undo]', '[data-act=redo]']);
    await scene('undo', ['Made a mistake? Undo and Redo take back any move, as many times as you like.']);
    await clearFx();
    await top(); await clickShown('[data-act=restart]'); await p.waitForSelector('#dlg-confirm[open]');
    await scene('start-over', ['Want a fresh start? Press Start over.', 'It clears your marks and resets the timer, hints and checks.', 'Your notes stay unless you choose to clear them, and Undo can bring everything back.']);
    await p.click('#confirm-no'); await p.waitForTimeout(200);
    await gridView(); await p.check('input[name=view][value=list]', { force: true }); await p.waitForTimeout(200); await hl('#grid-region');
    await scene('listview', ['Prefer words to grids? List view lets you choose each match from a menu.', 'The game also works fully by keyboard and with a screen reader.']);
    await clearFx(); await p.check('input[name=view][value=grid]', { force: true });
    await scrollTo('#q-list');
    const answer = await p.evaluate((q) => window.__flg.state.ix.label(q.answer), P.q);
    await p.locator('#q-list select').first().selectOption({ label: answer });
    await hl(['#q-h', '#q-list', '#check-answers']);
    await scene('questions', ['When you think you know, answer the questions under the clues, and press Check answers.']);
    await clearFx();
    await top(); await clickShown('#notes-btn'); await p.waitForSelector('#dlg-notes[open]');
    await p.keyboard.type(`Start with clue 1. Come back to the last two.`, { delay: 25 });
    await scene('notes', ['Want to jot something down? Press My notes and type.', 'Press Save to keep them, or Close to get back to the puzzle.', 'Only you can see your notes, even in a race.']);
    await p.click('#notes-save'); await p.waitForTimeout(200);
    await fillFromSolution(0.6); await gridView();
    await scene('keep-going', ['Keep going the same way, clue by clue, until the whole grid is filled in.']);
    await fillFromSolution(1);
    await p.waitForSelector('#solved:not([hidden])');
    await p.waitForTimeout(1500); await prep();
    await scrollTo('#solved', 'start', -76);
    await scene('solved', ['Case closed!', P.ending, 'You also see your time and a suggestion for your next puzzle.']);
    // The solve celebration (filming runs with reduced motion, which turns it off).
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    await p.evaluate(async () => (await import('./js/effects.js')).celebrate(['fireworks', 'ribbons', 'balloons'], { theme: window.__flg.state.puzzle.theme.id }));
    await p.waitForTimeout(1100);
    await scene('celebrate', ['Every solve ends with a celebration, like confetti, fireworks, ribbons, balloons or shooting stars.', 'Silent mode and your device\'s reduce motion setting turn it off.']);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.waitForTimeout(4000);
    if (await p.isVisible('#share-result')) {
      await scrollTo('#share-result'); await hl(['#solved-badges', '#share-result']);
      await scene('share', ['Solving puzzles earns badges, like First case closed.', 'Press Share my result to send friends a picture of your win. It never gives the answers away.']);
      await clearFx();
    }
    if (await p.isVisible('#feedback')) {
      await scrollTo('#feedback'); await p.locator('#feedback .stars label').nth(4).click();
      await p.locator('#feedback .feel label').nth(1).click().catch(() => {});
      await hl('#feedback');
      await scene('rating', ['If you like, rate the puzzle from 1 to 5 stars, where 5 is excellent, and say whether it felt too easy, just right or too hard.', 'It is optional. The game learns from your answers and tunes your next puzzle to suit you.']);
      await clearFx();
    }

    // =================== Saving, printing, settings
    await top(); await p.click('[data-act=print]'); await p.waitForTimeout(300);
    await scene('print', ['You can print any puzzle, blank or with your marks, with the answer key on its own page.']);
    await p.click('#print-cancel');
    await p.click('#home-btn'); await p.waitForSelector('.saved-item'); await p.waitForTimeout(400); await prep();
    await scrollTo('#saved-section'); await hl('#saved-section');
    await scene('saved', ['Your progress saves automatically.', 'Come back any time and pick up where you left off, from Saved puzzles.']);
    await clearFx();
    await p.click('#menu-btn'); await p.click('[data-cmd=stats]'); await p.waitForSelector('#dlg-stats[open]'); await p.waitForTimeout(300); await prep();
    await scene('stats', ['My stats and badges, in the Menu, shows your totals, best times, favorite themes, your daily streak and every badge to earn.']);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.click('#help-btn'); await p.waitForTimeout(300);
    await scene('help', ['Press Help to see every keyboard shortcut.']);
    await p.keyboard.press('Escape');
    await top(); await hl('#howto-btn');
    await scene('howto', ['And How to play, at the top of every page, plays this video again.']);
    await clearFx();
    await p.click('.saved-item [data-do=resume]'); await p.waitForSelector('#screen-play:not([hidden])'); await prep(); await top();
    await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.waitForTimeout(300);
    await scene('dark', ['Play in light or dark colors,']);
    await p.evaluate(() => { document.documentElement.dataset.theme = 'contrast'; }); await p.waitForTimeout(300);
    await scene('contrast', ['or in high contrast.']);
    await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.classList.add('silent'); }); await p.waitForTimeout(300);
    await scene('silent', ['And Silent mode is always there when you just want the puzzle.']);
    await p.evaluate(() => { document.documentElement.classList.remove('silent'); });
    await p.click('#home-btn'); await p.waitForSelector('#tier-choices input'); await prep();
    await p.click('#menu-btn'); await p.click('[data-cmd=install]'); await p.waitForSelector('#dlg-install[open]'); await prep();
    await scene('install', ['To play without opening a browser, choose Install the app from the Menu.', 'Download the Windows desktop app, which keeps itself up to date.', 'Or add the game\'s icon to your phone\'s home screen. On your phone, the same menu shows you how.', 'On a phone, pull down from the top of the page to refresh. Your progress is saved first.']);
    await p.click('#install-close'); await p.waitForTimeout(300);

    // =================== Accounts, screen names, races, scoreboard
    card('online', ['You can also play with other detectives.']);
    if (await p.isVisible('#sync-line')) {
      await scrollTo('#sync-line'); await hl('#sync-line');
      await scene('sync', ['You never need an account to play.', 'But a free account keeps your puzzles, progress and settings in step on the website, the desktop app and your phone.']);
      await clearFx();
      if (await p.isVisible('#player-chip')) {
        await hl('#player-chip');
        await scene('guest', ['The name at the top shows who you are playing as.', 'Until you sign in, you play as Guest.']);
        await clearFx();
      }
      await p.click('#sync-btn'); await p.waitForSelector('#dlg-account[open]');
      await p.click('[data-view=signin] [data-go=signup]');
      await p.fill('#su-email', 'detective@example.com'); await p.fill('#su-pass', 'correct horse battery');
      await scene('signup', ['Create one with your email and a password.', 'Keep me signed in is ticked, so you stay signed in on this device. Untick it on a shared computer.', 'If you ever forget your password, Forgot password sends you a reset link.']);
      await p.click('[data-view=signup] button[type=submit]');
      await p.waitForSelector('[data-view=account]:not([hidden])', { timeout: 15000 });
      await p.waitForTimeout(1500);
      await scene('account', ['Once you are signed in, your puzzles sync on their own.', 'Sign in on another device and they are waiting for you.']);
      await p.click('#dlg-account .dlg-actions:last-child [data-close]').catch(() => p.keyboard.press('Escape'));
      await p.waitForTimeout(300);
    }
    if (await p.isVisible('#compete-section')) {
      // Signed in, the game asks for a screen name straight away.
      await p.waitForSelector('#dlg-name[open]', { timeout: 15000 });
      await p.fill('#name-input', 'Sky Fox');
      await scene('screen-name', ['Once you are signed in, you pick a screen name.', 'Type your own, or press Suggest a name and the game makes one up for you.', 'It is the only thing other players see, and rude names are turned away.', 'Don\'t want one? Sign out instead, and you play as Guest.']);
      await p.click('#name-form button[type=submit]'); await p.waitForSelector('#dlg-name[open]', { state: 'detached' });
      await scrollTo('#compete-section'); await hl(['#compete-section', '#player-chip']);
      await scene('compete', ['Your screen name now shows at the top.', 'Play against others lets you race other players on the very same puzzle, and climb the scoreboard.']);
      await clearFx();
      // A second player gets ready on another device.
      const rival = await device({ silent: true });
      await rival.evaluate(async () => (await import('./js/account.js')).signUp('rival@example.com', 'correct horse battery'));
      await rival.waitForSelector('#dlg-name[open]', { timeout: 15000 });
      await rival.fill('#name-input', 'Bold Badger');
      await rival.click('#name-form button[type=submit]'); await rival.waitForSelector('#dlg-name[open]', { state: 'detached' });
      // Start a race with a quick Basic puzzle.
      await p.check('input[name=tier][value=basic]', { force: true });
      await p.check('input[name=theme][value=random]', { force: true });
      await p.check('input[name=size][value="3x3"]', { force: true }).catch(() => {});
      await scrollTo('#compete-section');
      await p.click('[data-compete=start]'); await p.waitForSelector('#dlg-race[open] [data-view=start]:not([hidden])');
      await scene('race-start', ['To race, press Start a race.', 'It uses the difficulty, theme and size you picked on the New puzzle screen.']);
      await p.click('[data-view=start] button[type=submit]');
      await p.waitForSelector('[data-view=share]:not([hidden])', { timeout: 60000 });
      const code = await p.textContent('#race-code-big');
      await scene('race-share', ['Share the race code or link with a friend.', 'Or anyone can press Find a race to join an open race.']);
      await p.click('[data-view=share] [data-close]'); await p.waitForTimeout(300); await prep(); await top();
      await rival.goto(`${APP}/?race=${code}`);
      await rival.waitForSelector('#dlg-race[open] [data-view=join]:not([hidden])');
      await rival.click('[data-view=join] button[type=submit]');
      await rival.waitForSelector('#screen-play:not([hidden])');
      await hl('#race-bar');
      await scene('race-bar', ['Everyone gets the very same puzzle.', 'The race bar shows the code, and Standings shows who is still solving.']);
      await clearFx();
      // The rival finishes first, then our player solves with a hint.
      await rival.evaluate(() => {
        const S = window.__flg.state;
        for (const [k, td] of S.grid.cells) { const [a, b] = k.split('|'); const yes = S.puzzle.solution.some((r) => Object.values(r).includes(a) && Object.values(r).includes(b)); td.click(); if (yes) td.click(); }
      });
      await rival.waitForSelector('#solved:not([hidden])');
      await p.click('[data-act=hint]'); await p.waitForTimeout(400);
      await fillFromSolution(1);
      await p.waitForSelector('#solved:not([hidden])');
      await p.waitForFunction(() => /place/i.test(document.querySelector('#compete-result').textContent), null, { timeout: 15000 });
      await p.waitForTimeout(800); await prep();
      await scrollTo('#compete-result'); await hl('#compete-result');
      await scene('race-result', ['When you finish, you see your place.', 'Fastest solve wins, and each hint adds time.']);
      await clearFx();
      await p.click('#home-btn'); await p.waitForSelector('#tier-choices input'); await prep();
      await scrollTo('#compete-section'); await p.click('#compete-section [data-compete=board]'); await p.waitForSelector('#dlg-board[open] table.board'); await p.waitForTimeout(400);
      await scene('board', ['The scoreboard ranks players this week and of all time.', 'Every solve earns points, even when you play on your own.', 'Press Scoring and race rules to see exactly how points are awarded.']);
      await p.keyboard.press('Escape');
      await p.evaluate(async () => (await import('./js/compete-ui.js')).refreshMiniBoard({ force: true }));
      await p.waitForSelector('#miniboard:not([hidden])'); await top(); await hl('#miniboard');
      await scene('miniboard', ["This week's leaders are always in view at the top of the page.", 'Select Scoreboard there to see the full board.']);
      // Challenge one player by screen name.
      await scrollTo('#compete-section');
      await p.click('[data-compete=challenge]'); await p.waitForSelector('#dlg-race[open] [data-view=challenge]:not([hidden])');
      await p.fill('#challenge-name', 'Bold Badger');
      await scene('challenge', ['To race one particular player, press Challenge a player and type their screen name.']);
      await p.click('[data-view=challenge] button[type=submit]');
      await p.waitForSelector('[data-view=share]:not([hidden])', { timeout: 60000 });
      await p.waitForFunction(() => /Challenge sent/.test(document.querySelector('#race-invite-msg').textContent), null, { timeout: 15000 });
      await p.click('[data-view=share] [data-close]'); await p.waitForTimeout(300);
      await p.click('#home-btn'); await p.waitForSelector('#tier-choices input');
      // The rival challenges back, so the invite shows on this screen.
      await rival.click('#home-btn').catch(() => {}); await rival.waitForSelector('#compete-section [data-compete=challenge]');
      await rival.click('[data-compete=challenge]'); await rival.fill('#challenge-name', 'Sky Fox');
      await rival.click('[data-view=challenge] button[type=submit]');
      await rival.waitForFunction(() => /Challenge sent/.test(document.querySelector('#race-invite-msg').textContent), null, { timeout: 60000 });
      await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await p.waitForSelector('#compete-invites li', { timeout: 15000 }); await prep();
      await scrollTo('#compete-invites'); await hl('#compete-invites');
      await scene('challenge-received', ['They see your challenge under Play against others, the next time they open the game.', 'Accept starts the race on the very same puzzle. No thanks turns it down.']);
      await clearFx();
      await rival.context().close();
    }

    // =================== Settings, ideas and problems
    card('more', ['Finally, make the game your own.']);
    await p.click('#menu-btn'); await p.click('[data-cmd=settings]'); await p.waitForTimeout(300); await prep();
    await p.evaluate(() => document.querySelector('#sound-settings').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    await scene('settings', ['In Settings, sound effects and theme music start on, and you can turn either one off.', 'Learn from how I play tunes your next puzzles to suit you.']);
    await p.evaluate(() => document.querySelector('#language-settings').scrollIntoView({ block: 'start' })); await p.waitForTimeout(200);
    await scene('language', ['And play in your own language.', 'US English is the default, and you can choose any of 100 languages under Language.', 'The game translates itself as you play, and the English button at the top shows the original at any time.']);
    await p.keyboard.press('Escape');
    if (!(await p.$eval('[data-cmd=feedback]', (b) => b.hidden))) {
      await p.click('#menu-btn'); await p.click('[data-cmd=feedback]'); await p.waitForSelector('#dlg-feedback[open]'); await prep();
      await p.fill('#idea-text', 'A pirate ship lost in the fog, where the crew mixed up the treasure maps.');
      const replyOffered = await p.isVisible('#idea-form .fb-reply');
      await scene('feedback', ['Have an idea for a story, or found a problem?', 'Ideas and problems, in the menu, has a separate box for each, and they go straight to the game\'s team.',
        ...(replyOffered ? ['Signed in with a confirmed email? Leave the box ticked, and the game emails you a short thank-you note.'] : [])]);
      await p.keyboard.press('Escape');
    }
    if (!(await p.$eval('[data-cmd=suggest]', (b) => b.hidden))) {
      await p.click('#menu-btn'); await p.click('[data-cmd=suggest]'); await p.waitForSelector('#dlg-suggest[open]'); await prep();
      await p.fill('#suggest-name', 'Captain Mo');
      await p.check('#suggest-form input[name=gender][value=m]');
      await p.fill('#suggest-look', 'A blue sea captain\'s coat and a white beard');
      await p.fill('#suggest-personality', 'Cheerful, a little forgetful, and loves a good riddle');
      await scene('suggest', ['Dream up a character of your own with Suggest a character, in the menu.', 'Answer a few questions about their name, look, personality and voice.', 'The game\'s team reviews every suggestion, and you might meet yours in a puzzle.']);
      await p.keyboard.press('Escape');
    }
    card('outro', [["That's all you need: read the story, follow the clues, and mark your X's and O's.", "That's all you need. Read the story, follow the clues, and mark your exes and ohs."], 'Welcome to The Fantastical Logic Grid. Happy sleuthing!']);

    // Title cards.
    const cp = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
    for (const k of ['title', 'howto', 'online', 'more', 'outro']) {
      await cp.goto(`file://${path.join(__dirname, 'card.html')}#${k}`); await cp.reload(); await cp.waitForTimeout(400);
      await cp.screenshot({ path: path.join(SHOTS, `card-${k}.png`) });
    }
    fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify({ seed, puzzle: P.title, scenes }, null, 1));
    console.log(`${scenes.length} scenes written`);
  } finally {
    await browser.close();
    app.kill(); auth.close(); await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
