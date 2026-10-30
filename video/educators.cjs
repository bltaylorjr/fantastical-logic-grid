// Records the Educators how-to video's pictures from the real website and
// Worker, and writes the narration for each one (video/out-educators/scenes.json):
// the For educators link, the request form, the school email code, the team's
// approval in the admin dashboard, and the emailed PDFs. Run from the repo
// root after `npm run build` and `npm --prefix server install`:
//   node video/educators.cjs
//   VIDEO=educators python3 video/build.py --install
// The website and the Worker run locally (Miniflare); the emails are drawn
// from the real email builder (scripts/educator-packages.py) and the PDF pages
// from the real package builder (scripts/educator-package.mjs).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out-educators');
const SHOTS = path.join(OUT, 'shots');
const API_PORT = 8162;
const SITE_PORT = 8163;
const SITE = `http://localhost:${SITE_PORT}`;
const API = `http://localhost:${API_PORT}`;
const TOKEN = 'video-educators-token';
const VIEW = { width: 1440, height: 810 };
const SCALE = 4 / 3;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const CSS = `
  #__hl{position:fixed;pointer-events:none;z-index:2147483646;border:4px solid #f5a524;border-radius:14px;box-shadow:0 0 0 9999px rgba(10,15,30,.38),0 0 0 8px rgba(245,165,36,.35)}
  #__cur{position:fixed;pointer-events:none;z-index:2147483647;width:34px;height:34px}`;

// An email, as the educator's mail program would show it.
function mailHtml(kind, data) {
  const py = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('ep', ${JSON.stringify(path.join(ROOT, 'scripts/educator-packages.py'))})
ep = importlib.util.module_from_spec(spec); spec.loader.exec_module(ep)
d = json.loads(sys.argv[1])
m = ep.verify_mail(d) if d['kind'] == 'verify' else ep.package_mail(d, d['manifest'])
print(json.dumps({'subject': m['subject'], 'html': ep.html_version(m)}))`;
  return JSON.parse(execFileSync('python3', ['-c', py, JSON.stringify({ kind, ...data })], { encoding: 'utf8' }));
}
function inbox({ subject, html, attachments = [] }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#e8eaf0}
.bar{background:#2b2f3a;color:#fff;padding:14px 24px;font-size:18px;font-weight:bold}
.wrap{max-width:900px;margin:22px auto;background:#fff;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.12);overflow:hidden}
.head{padding:18px 24px;border-bottom:1px solid #ddd}.head h1{font-size:22px;margin:0 0 8px}.head p{margin:2px 0;color:#555;font-size:14px}
.att{display:flex;gap:12px;padding:12px 24px;border-bottom:1px solid #eee}.att div{border:1px solid #ccc;border-radius:8px;padding:8px 14px;font-size:14px}.att b{color:#c62828}
.mail{transform:scale(.92);transform-origin:top center}</style></head><body>
<div class="bar">Inbox · Lincoln Elementary School Mail</div><div class="wrap"><div class="head"><h1>${esc(subject)}</h1>
<p><b>From:</b> The Fantastical Logic Grid &lt;noreply@thelogicgrid.com&gt;</p><p><b>To:</b> rivera@lincoln.k12.ca.us</p></div>
${attachments.length ? `<div class="att">${attachments.map((a) => `<div><b>PDF</b> ${esc(a)}</div>`).join('')}</div>` : ''}
<div class="mail"><iframe srcdoc="${esc(html)}" style="width:100%;height:900px;border:0"></iframe></div></div></body></html>`;
}

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const mf = new Miniflare({
    port: API_PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: 'flg-video', ALLOWED_ORIGINS: SITE, ADMIN_TOKEN: TOKEN },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const site = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), path.join(ROOT, 'dist', 'site'), String(SITE_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const admin = async (p, body) => (await fetch(`${API}/admin/v1/${p}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json();

  const browser = await chromium.launch();
  const scenes = [];
  let p;
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, welcomed: true, voiceProvider: 'device', silent: true })); });
  await ctx.addInitScript((api) => { window.FLG_EDUCATORS_API = api; }, API);
  p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('page error:', e.message));

  const prep = () => p.addStyleTag({ content: CSS });
  const clearFx = () => p.evaluate(() => document.querySelectorAll('#__hl,#__cur').forEach((e) => e.remove()));
  async function hl(sels, pad = 10) {
    await prep();
    await p.evaluate(({ sels, pad }) => {
      document.querySelectorAll('#__hl').forEach((e) => e.remove());
      const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width);
      if (!rs.length) return;
      const x = Math.min(...rs.map((r) => r.left)) - pad, y = Math.min(...rs.map((r) => r.top)) - pad;
      const w = Math.max(...rs.map((r) => r.right)) + pad - x, h = Math.max(...rs.map((r) => r.bottom)) + pad - y;
      const d = document.createElement('div'); d.id = '__hl';
      Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      document.body.append(d);
    }, { sels: [].concat(sels), pad });
  }
  async function view(sel, offset = -90) {
    await p.evaluate(({ sel, offset }) => { const e = document.querySelector(sel); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY + offset); }, { sel, offset });
    await p.waitForTimeout(250);
  }
  async function scene(name, sentences) {
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    scenes.push({ shot: `shots/${name}.png`, sentences });
    await clearFx();
  }
  const card = (name, sentences) => scenes.push({ shot: `shots/card-${name}.png`, sentences });

  try {
    card('edu', ['Teachers can get free packages of printable logic puzzles, made for their class.', 'This short video shows every step, from the request form to the PDFs in your inbox.']);

    await p.goto(`${SITE}/`);
    await p.waitForSelector('#educators-link');
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await hl('#educators-link', 8);
    await scene('link', ['On thelogicgrid.com, choose For educators, at the top of the game page.']);

    await p.goto(`${SITE}/educators/`);
    await p.waitForSelector('#edu-form');
    await hl(['main h1', '.how']);
    await scene('page', ['The Educators page explains the four steps.', 'Fill in the form, confirm your school email, our team reviews your request, and your puzzles arrive by email.']);

    await p.fill('[name=name]', 'Ms Rivera');
    await p.fill('[name=email]', 'rivera@lincoln.k12.ca.us');
    await p.fill('[name=school]', 'Lincoln Elementary');
    await p.selectOption('[name=role]', 'Classroom teacher');
    await view('#edu-form fieldset');
    await hl('#edu-form fieldset:nth-of-type(1)');
    await scene('about', ['Start with your name, your school email address, your school and your role.', 'Use your school address, not a personal one: we send a code there to confirm that you are an educator.']);

    await p.selectOption('[name=grade]', '4');
    await view('[name=grade]', -160);
    await hl(['[name=grade]', '#grade-help']);
    await scene('grade', ['Choose your students\' grade level.', 'The page shows what suits that grade: the difficulty, the size of the grid, how much story to read, and whether to use large print.']);

    await p.fill('[name=count]', '6');
    await p.check('input[name=difficulty][value=progressive]');
    await view('[name=count]', -140);
    await hl(['[name=count]', 'fieldset.choice', '[name=size]', '[name=questions]']);
    await scene('puzzles', ['Then say how many different puzzles you need, up to thirty.', 'Choose the difficulty: suited to the grade, building up from easier to harder, or one level for every puzzle.', 'You can also choose the grid size, how many questions go under each puzzle, and even the kinds of clues.']);

    await p.check('input[name=theme][value=pets]');
    await p.check('input[name=theme][value=sports]');
    await p.selectOption('[name=topic-mystery]', { index: 1 });
    await p.fill('[name=names]', 'Maya, Leo, Priya, Sam, Ava');
    await view('input[name=source]', -120);
    await hl(['input[name=source]', '.themes li:nth-child(-n+5)']);
    await scene('themes', ['Pick any of our themes, with a topic for each, or tick none for a mix of them all.', 'You can type your students\' first names, too, and they become the characters in the stories.']);

    await p.check('input[name=source][value=custom]');
    await p.selectOption('[name=starter]', 'science-fair');
    await view('#custom-panel', -120);
    await hl('#custom-panel', 6);
    await scene('custom', ['Or choose Create my own theme.', 'Start from an example, or write your own story, characters and up to four categories, each with its items.', 'We build the grid, the clues and the answer key from it, and check that every puzzle has exactly one answer.']);
    await p.check('input[name=source][value=themes]');

    await p.check('[name=solutions]');
    await p.fill('[name=title]', 'Room 12: Logic Fridays');
    await view('[name=paper]', -170);
    await hl(['[name=paper]', '[name=keys]', '[name=solutions]', '[name=largePrint]', '[name=title]'], 14);
    await scene('printing', ['Under Printing, choose the paper size, where the answer keys go, worked solutions, large print, and a title for your package.']);

    await p.check('[name=agree]');
    await view('.agree', -300);
    await hl(['.agree', '#edu-send']);
    await scene('send', ['Tick the box to agree to use the puzzles with your own students, then press Send my request.']);

    await p.click('#edu-send');
    await p.waitForSelector('#edu-verify:not([hidden])');
    await view('#edu-verify', -120);
    await scene('verify', ['The page now asks for a six-digit code. Check your school email.']);

    const work = await admin('educators/claim', {});
    const m = work.mails[0];
    await admin('educators/done', { mails: { sent: [m.id] } });
    const vm = mailHtml('verify', { ref: m.ref, code: m.code, name: m.name });
    const mailPage = await ctx.newPage();
    await mailPage.setContent(inbox(vm));
    await mailPage.waitForTimeout(400);
    await mailPage.screenshot({ path: path.join(SHOTS, 'mail-code.png') });
    scenes.push({ shot: 'shots/mail-code.png', sentences: ['The email has your code, and a button that confirms your address in one click.', 'The code works for two days. If it does not arrive, look in your spam folder, or ask for a new code.'] });

    await p.fill('#verify-form [name=code]', m.code);
    await hl('#edu-verify');
    await scene('code', ['Type the code and press Confirm.']);
    await p.click('#verify-form button[type=submit]');
    await p.waitForSelector('#edu-done:not([hidden])');
    await view('#edu-done', -120);
    await scene('done', ['That\'s it. Your request is now with our team, and the page gives you a request number.']);

    // The team's side: the admin dashboard.
    // (The dashboard's strict content policy would block the highlight, so this
    // filming browser skips it; the dashboard itself is unchanged.)
    p = await (await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, reducedMotion: 'reduce', serviceWorkers: 'block', bypassCSP: true })).newPage();
    await p.goto(`${API}/admin/`);
    await p.click('.break-glass summary');
    await p.fill('#token-input', TOKEN);
    await p.click('#token-form button[type=submit]');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${API}/admin/#educators`);
    await p.waitForSelector('.edu-card');
    await p.addStyleTag({ content: '#who{visibility:hidden}' });
    await hl('.edu-card', 8);
    await scene('review', ['A person on our team checks each request, usually within a day or two, and approves it.']);

    const req = (await admin('educators?status=pending')).requests[0];
    await admin(`educators/${req.id}/approve`, {});
    const w2 = await admin('educators/claim', {});
    const job = w2.builds[0];
    const tmp = path.join(OUT, 'package');
    execFileSync('node', [path.join(ROOT, 'scripts/educator-package.mjs'), '-', tmp], { input: JSON.stringify({ ...job, usedStories: [] }), stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, FLG_PDF_HTML_ONLY: '1' } });
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
    await admin('educators/done', { builds: [{ id: job.id, ok: true, puzzles: manifest.puzzles, storyIds: manifest.storyIds }] });
    const pm = mailHtml('package', { ...job, manifest });
    await mailPage.setContent(inbox({ ...pm, attachments: ['puzzles.pdf', 'answer-keys.pdf'] }));
    await mailPage.waitForTimeout(400);
    await mailPage.screenshot({ path: path.join(SHOTS, 'mail-package.png') });
    scenes.push({ shot: 'shots/mail-package.png', sentences: ['Once it is approved, your puzzles are made and emailed to you within minutes, as PDF files ready to print.'] });

    // The PDF pages, as they print.
    const sheet = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1 });
    const pageShot = async (file, n, name) => {
      await sheet.goto(`file://${path.join(tmp, file)}`);
      await sheet.emulateMedia({ media: 'print' });
      await sheet.addStyleTag({ content: 'body{background:#fff;padding:48px}.page{min-height:960px}' });
      const pages = sheet.locator('.page');
      await pages.nth(n).scrollIntoViewIfNeeded();
      const one = path.join(SHOTS, `${name}-paper.png`);
      await pages.nth(n).screenshot({ path: one });
      // On a desk: the page centered on a soft background.
      const desk = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
      await desk.setContent(`<body style="margin:0;height:810px;display:grid;place-items:center;background:linear-gradient(160deg,#121733,#22195a)"><img src="data:image/png;base64,${fs.readFileSync(one).toString('base64')}" style="max-height:770px;max-width:1300px;box-shadow:0 18px 60px rgba(0,0,0,.5);background:#fff"></body>`);
      await desk.screenshot({ path: path.join(SHOTS, `${name}.png`) });
      await desk.close();
    };
    await pageShot('puzzles.html', 0, 'pdf-cover');
    scenes.push({ shot: 'shots/pdf-cover.png', sentences: ['Each package starts with a cover page: how to use the puzzles, and a list of them all.'] });
    await pageShot('puzzles.html', 1, 'pdf-puzzle');
    scenes.push({ shot: 'shots/pdf-puzzle.png', sentences: ['Every puzzle has a brand new story, written at the right level for the grade, with the clues, a blank grid and the questions.'] });
    await pageShot('answer-keys.html', 0, 'pdf-key');
    scenes.push({ shot: 'shots/pdf-key.png', sentences: ['The answer keys come in their own file, so you can keep them back, with a step by step solution if you asked for one.'] });

    // After the package: the private ideas, problems and feedback section.
    const adminPage = p;
    p = await ctx.newPage();
    await p.goto(`${SITE}/educators/feedback/?ref=${job.ref}&key=${job.feedbackKey}`);
    await p.waitForSelector('#fb-open:not([hidden])');
    for (const [q, v] of [['use', 0], ['use', 4], ['fit', 2], ['engage', 3]]) await p.check(`[name=q-${q}][value="${v}"]`);
    await view('#survey-h', -40);
    await hl('#survey-h', 10);
    await scene('feedback-survey', ['The email with your puzzles also has a private link to your own ideas, problems and feedback section.', 'It starts with a two-minute survey about how our tools can help your class.']);
    await p.check('#note-form input[name=kind][value=idea]');
    await p.fill('#note-form [name=text]', 'My class would love a space theme!');
    await p.click('#note-send');
    await p.waitForSelector('.fb-item');
    await view('#note-h', -40);
    await hl(['#note-form', '#fb-items'], 10);
    await scene('feedback-note', ['Send us an idea, a problem or feedback any time, and see our answers right there.']);
    p = adminPage;
    await p.goto(`${API}/admin/#edu-feedback`);
    await p.waitForSelector('#efb-list article');
    await p.addStyleTag({ content: '#who{visibility:hidden}' });
    await hl('#efb-list article', 8);
    await scene('feedback-team', ['Our team reads every note, answers in plain words, and emails you the answer.']);

    card('eduoutro', ['Fill in the form, confirm your email, and print. Happy puzzling!']);
    const cp = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
    for (const k of ['edu', 'eduoutro']) {
      await cp.goto(`file://${path.join(__dirname, 'card.html')}#${k}`); await cp.reload(); await cp.waitForTimeout(400);
      await cp.screenshot({ path: path.join(SHOTS, `card-${k}.png`) });
    }
    fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify({ scenes }, null, 1));
    console.log(`${scenes.length} scenes written`);
  } finally {
    await browser.close();
    site.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
