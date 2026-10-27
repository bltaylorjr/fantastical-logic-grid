// End-to-end check of the Educators page (dist/site/educators/) against the
// real Worker (Miniflare, local D1): the For educators link in the game's top
// corner on the website only, a request with the code typed in, a request
// with the teacher's own theme confirmed through the email link, the
// page's own checks, and the package builder making the approved puzzles.
// Needs `npm install` in server/ first (npm run test:educators does that).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const API_PORT = 8197;
const SITE_PORT = 8198;
const SITE = `http://localhost:${SITE_PORT}`;
const API = `http://localhost:${API_PORT}`;
const TOKEN = 'e2e-educators-token';

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
    bindings: { FIREBASE_PROJECT_ID: 'flg-e2e', ALLOWED_ORIGINS: SITE, ADMIN_TOKEN: TOKEN },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await mf.ready;
  const site = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(ROOT, 'dist', 'site'), String(SITE_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const admin = async (p, body) => (await fetch(`${API}/admin/v1/${p}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  const browser = await chromium.launch();
  const errors = [];
  try {
    // ---- The link in the game's top corner: the website has it, the desktop build does not.
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    // The test copy of the site has no cloud URL built in, so point the page at the local Worker.
    const useApi = (c) => c.addInitScript((api) => { window.FLG_EDUCATORS_API = api; }, API);
    await useApi(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${SITE}/`);
    const link = page.locator('#educators-link');
    assert(await link.isVisible(), 'the website game page shows For educators');
    const box = await link.boundingBox();
    assert(box.y < 80, 'it sits in the top bar');
    assert(fs.readFileSync(path.join(ROOT, 'dist/web/index.html'), 'utf8').includes('id="educators-link" href="educators/" hidden'), 'the app build keeps it hidden (desktop app)');
    assert(new URL(await link.getAttribute('href'), `${SITE}/`).pathname === '/educators/', 'and opens the Educators page');
    await page.goto(`${SITE}/educators/`);
    await page.waitForSelector('#edu-form');

    // ---- The page's own checks, before anything is sent.
    await page.click('#edu-send');
    assert(await page.locator('#edu-errors').isVisible(), 'an empty form lists what is missing');
    assert(await page.locator('#edu-errors li').count() >= 5, 'with each missing field');

    // ---- A request from our themes, confirmed by typing the code.
    await page.fill('[name=name]', 'Ms Rivera');
    await page.fill('[name=email]', 'rivera@lincoln.k12.ca.us');
    await page.fill('[name=school]', 'Lincoln Elementary');
    await page.selectOption('[name=role]', 'Classroom teacher');
    await page.selectOption('[name=grade]', '2');
    assert(/Kindergarten to Grade 2/.test(await page.textContent('#grade-help')), 'choosing a grade explains what suits it');
    assert(await page.isChecked('[name=largePrint]'), 'large print is ticked for young grades');
    await page.fill('[name=count]', '3');
    await page.check('input[name=theme][value=pets]');
    await page.selectOption('[name=topic-mystery]', { index: 1 });
    assert(await page.isChecked('input[name=theme][value=mystery]'), 'picking a topic ticks its theme');
    await page.check('[name=agree]');
    await page.click('#edu-send');
    await page.waitForSelector('#edu-verify:not([hidden])');
    assert((await page.textContent('#verify-email')) === 'rivera@lincoln.k12.ca.us', 'the page asks for the code sent to the school address');
    let work = await admin('educators/claim', {});
    const first = work.mails[0];
    assert(first && first.kind === 'verify' && /^\d{6}$/.test(first.code), 'a code email waits for the sender');
    await admin('educators/done', { mails: { sent: [first.id] } });
    await page.fill('#verify-form [name=code]', first.code === '000000' ? '111111' : '000000');
    await page.click('#verify-form button[type=submit]');
    await page.waitForSelector('#verify-error:not([hidden])');
    assert(/not right/.test(await page.textContent('#verify-error')), 'a wrong code is refused');
    await page.fill('#verify-form [name=code]', first.code);
    await page.click('#verify-form button[type=submit]');
    await page.waitForSelector('#edu-done:not([hidden])');
    assert(/Waiting for review/.test(await page.textContent('#done-status')), 'once confirmed, the request waits for the team');
    const row = (await admin('educators?status=pending')).requests[0];
    assert(row.grade === '2' && row.count === 3 && row.request.themes.length === 2 && row.request.themes.includes('pets/any') && row.request.themes.some((t) => t.startsWith('mystery/') && t !== 'mystery/any'), 'the team sees the grade, count and themes');
    assert(row.request.largePrint === true, 'and the print choices');

    // ---- A teacher's own theme, confirmed with the link in the email.
    const ctx2 = await browser.newContext({ serviceWorkers: 'block' });
    await useApi(ctx2);
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(`${SITE}/educators/`);
    await p2.fill('[name=name]', 'Mr Okafor');
    await p2.fill('[name=email]', 'okafor@hillside.edu');
    await p2.fill('[name=school]', 'Hillside Middle School');
    await p2.selectOption('[name=role]', 'Gifted and talented coordinator');
    await p2.selectOption('[name=grade]', '7');
    await p2.check('input[name=source][value=custom]');
    assert(await p2.locator('#custom-panel').isVisible(), 'Create my own theme opens the custom theme fields');
    await p2.selectOption('[name=starter]', 'book-club');
    assert((await p2.inputValue('[name=cat-name-0]')) === 'Book', 'an example fills in the fields');
    await p2.fill('[name=cat-items-1]', 'Beanbag');
    await p2.check('[name=agree]');
    await p2.click('#edu-send');
    assert(/at least 3/.test(await p2.textContent('#edu-errors')), 'a category with too few items is caught on the page');
    await p2.fill('[name=cat-items-1]', 'Beanbag, Window Seat, Rug, Big Chair, Corner Table');
    await p2.fill('[name=c-theme]', 'Our book club');
    await p2.selectOption('[name=keys]', 'after');
    await p2.check('[name=solutions]');
    await p2.click('#edu-send');
    await p2.waitForSelector('#edu-verify:not([hidden])');
    work = await admin('educators/claim', {});
    const second = work.mails.find((m) => m.email === 'okafor@hillside.edu');
    await admin('educators/done', { mails: { sent: [second.id] } });
    await p2.goto(`${SITE}/educators/?ref=${second.ref}&code=${second.code}`);
    await p2.waitForSelector('#edu-done:not([hidden])');
    assert(true, 'the link in the email confirms the address in one click');
    assert(!p2.url().includes('code='), 'and the code is taken out of the address bar');

    // ---- The team approves; the builder makes the package from the claim.
    const custom = (await admin('educators?status=pending')).requests.find((r) => r.ref === second.ref);
    assert(custom.request.custom.theme === 'Our book club' && custom.request.custom.categories.length === 3, 'the team sees the teacher\'s own theme');
    await admin(`educators/${custom.id}/approve`, {});
    work = await admin('educators/claim', {});
    const job = work.builds.find((b) => b.ref === second.ref);
    assert(job, 'the approved package is handed to the builder');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flg-edu-'));
    execFileSync('node', [path.join(ROOT, 'scripts/educator-package.mjs'), '-', path.join(tmp, 'out')], { input: JSON.stringify({ ...job, usedStories: work.usedStories }), stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, FLG_PDF_HTML_ONLY: '1' } });
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'manifest.json'), 'utf8'));
    const html = fs.readFileSync(path.join(tmp, 'out', 'puzzles.html'), 'utf8');
    assert(manifest.puzzles === job.count && manifest.files.length === 1, 'answer keys after each puzzle: one file');
    assert((html.match(/class="page key"/g) || []).length === job.count && html.includes('Worked solution'), 'each puzzle has its key and worked solution');
    assert(html.includes('The class book club met in the library'), 'the puzzles tell the teacher\'s own story');
    const pdf = await (await browser.newContext()).newPage();
    await pdf.setContent(html);
    await pdf.pdf({ path: path.join(tmp, 'check.pdf'), format: 'Letter' });
    assert(fs.statSync(path.join(tmp, 'check.pdf')).size > 20000, 'Chromium prints the package to PDF');
    await admin('educators/done', { builds: [{ id: job.id, ok: true, puzzles: manifest.puzzles, storyIds: manifest.storyIds }] });
    assert((await admin('educators?status=sent')).requests.length === 1, 'the package is marked sent');

    // ---- After the package: the private ideas, problems and feedback section and survey.
    assert(!fs.existsSync(path.join(ROOT, 'dist/web/educators')), 'the app build (desktop, Android, iOS) has no Educators pages');
    const fbCtx = await browser.newContext({ serviceWorkers: 'block' });
    await useApi(fbCtx);
    const fb = await fbCtx.newPage();
    fb.on('pageerror', (e) => errors.push(e.message));
    await fb.goto(`${SITE}/educators/feedback/`);
    assert(await fb.locator('#fb-locked').isVisible() && await fb.locator('#fb-open').isHidden(), 'without the email link the section stays locked');
    assert((await fb.getAttribute('meta[name=robots]', 'content')) === 'noindex', 'and it is kept out of search');
    await fb.goto(`${SITE}/educators/feedback/?ref=${job.ref}&key=${job.feedbackKey}`);
    await fb.waitForSelector('#fb-open:not([hidden])');
    assert(/Mr Okafor/.test(await fb.textContent('#fb-hello')), 'the link in the package email opens it');
    assert(!fb.url().includes('key='), 'and the key is taken out of the address bar');
    await fb.click('#survey-send');
    assert(await fb.locator('#survey-errors').isVisible() && (await fb.locator('#survey-errors li').count()) === 3, 'the survey asks for the needed answers');
    await fb.check('[name=q-use][value="0"]');
    await fb.check('[name=q-use][value="4"]');
    await fb.check('[name=q-fit][value="2"]');
    await fb.check('[name=q-engage][value="3"]');
    await fb.check('[name=q-again][value="3"]');
    await fb.check('[name=q-wants][value="1"]');
    await fb.fill('[name=q-comment]', 'The book club theme was a hit.');
    await fb.click('#survey-send');
    await fb.waitForFunction(() => /saved/.test(document.querySelector('#survey-done').textContent));
    assert(true, 'the survey answers are saved');
    await fb.check('#note-form input[name=kind][value=problem]');
    await fb.fill('#note-form [name=text]', 'Page 3 printed a little small on A4.');
    await fb.click('#note-send');
    await fb.waitForSelector('.fb-item');
    assert(/Our team will read this soon/.test(await fb.textContent('#fb-items')), 'a problem report shows in their list');
    const fbList = await admin('educators/feedback?status=new');
    const note = fbList.items.find((x) => x.ref === job.ref);
    assert(note && note.kind === 'problem' && fbList.surveys === 1, 'the team sees it apart from players\' notes');
    await admin(`educators/feedback/${note.id}/address`, { note: 'We made the print bigger on A4 paper.' });
    const results = await admin('educators/survey');
    assert(results.responses === 1 && results.questions.find((q) => q.id === 'use').counts[4] === 1 && results.comments[0].text === 'The book club theme was a hit.', 'the survey results add up');
    await fb.reload();
    await fb.waitForSelector('#fb-open:not([hidden])');
    assert(/We made the print bigger on A4 paper/.test(await fb.textContent('#fb-items')), 'the team\'s answer shows in their section');
    assert(await fb.isChecked('[name=q-fit][value="2"]'), 'and their survey answers are kept');
    assert(!errors.length, `no page errors or blocked requests${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log('\nEducators page: all checks passed.');
  } finally {
    await browser.close();
    site.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
