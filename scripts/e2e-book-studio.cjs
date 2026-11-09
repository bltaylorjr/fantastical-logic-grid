// End-to-end check of Book Studio (admin/book-studio/) against the real Worker
// (Miniflare, local D1, the admin/ files as Worker assets), under its real
// content security policy: the sign-in screen (password, creating a password
// with email confirmation, a reset link, Face ID or fingerprint through
// Chromium's virtual authenticator), a publisher who has access, a viewer who
// does not, the sample book, Apply specs, and a submission packet download
// that is written to the audit log, syncing a book between two devices (and
// keeping both when two change it at once), the app manifest, the offline
// service worker and Get the app.
// Grid books (the dashboard's Books and covers inside Book Studio) needs the
// built website in dist/site (npm run build); without it that part is skipped.
// Needs `npm install` in server/ and `node book-studio/build.mjs` first.
// SHOTS=<folder> saves screenshots there.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

const ROOT = path.join(__dirname, '..');
const PORT = 8172;
const SITE_PORT = 8173;
const SITE_DIR = path.join(__dirname, '..', 'dist', 'site');
const HAVE_SITE = fs.existsSync(path.join(SITE_DIR, 'book-maker', 'index.html'));
const BASE = `http://localhost:${PORT}`;
const PROJECT = 'flg-e2e-studio';
const TOKEN = 'break-glass-key-for-the-studio-test';
const OWNER = 'owner@example.com';
const SHOTS = process.env.SHOTS;

(async () => {
  const { Miniflare } = await import(path.join(ROOT, 'server/node_modules/miniflare/dist/src/index.js'));
  const { makeSigner } = await import(path.join(ROOT, 'server/test/signer.mjs'));
  const signer = makeSigner(PROJECT);
  const mf = new Miniflare({
    port: PORT,
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: ROOT,
    scriptPath: path.join(ROOT, 'server/src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    assets: { directory: path.join(ROOT, 'admin'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
    bindings: { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: BASE, ADMIN_TOKEN: TOKEN, OWNER_EMAIL: OWNER, FIREBASE_WEB_API_KEY: 'e2e-key', TEST_JWKS: JSON.stringify(signer.jwks), SITE_URL: `http://localhost:${SITE_PORT}` },
  });
  const db = await mf.getD1Database('DB');
  for (const f of fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(ROOT, 'server/migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  await db.prepare("INSERT INTO admins (email, role, added_by, added_at) VALUES ('pub@example.com', 'publisher', 'test', 0), ('view@example.com', 'viewer', 'test', 0), ('new@example.com', 'publisher', 'test', 0)").run();
  const session = (email, uid) => JSON.stringify({ mode: 'firebase', email, idToken: signer.token({ sub: uid, email, email_verified: true }), refreshToken: 'x', exp: Date.now() + 3_000_000, seen: Date.now() });

  const site = HAVE_SITE ? spawn('node', [path.join(__dirname, 'serve.mjs'), SITE_DIR, String(SITE_PORT)], { stdio: 'ignore' }) : null;
  const browser = await chromium.launch();
  const problems = [];
  // Firebase's REST API, answered with tokens the Worker trusts. A new
  // account's email is unconfirmed until its token is refreshed after the link.
  const sent = [];
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const tokenFor = (email, verified) => signer.token({ sub: `uid-${email}`, email, email_verified: verified });
  const firebase = async (ctx) => {
    await ctx.route('https://identitytoolkit.googleapis.com/**', (r) => {
      const url = r.request().url(); const body = JSON.parse(r.request().postData() || '{}');
      if (url.includes('signInWithPassword')) {
        if (body.password !== 'right-password') return json(r, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
        return json(r, { email: body.email, idToken: tokenFor(body.email, true), refreshToken: `r:${body.email}`, expiresIn: '3600' });
      }
      if (url.includes('signUp')) {
        if (body.email === 'pub@example.com') return json(r, { error: { message: 'EMAIL_EXISTS' } }, 400);
        return json(r, { email: body.email, idToken: tokenFor(body.email, false), refreshToken: `r:${body.email}`, expiresIn: '3600' });
      }
      if (url.includes('sendOobCode')) { sent.push(body.requestType); return json(r, {}); }
      return json(r, {});
    });
    await ctx.route('https://securetoken.googleapis.com/**', (r) => {
      const email = JSON.parse(r.request().postData() || '{}').refresh_token.slice(2);
      return json(r, { id_token: tokenFor(email, true), refresh_token: `r:${email}`, expires_in: '3600' });
    });
  };
  // A phone or laptop with Face ID: Chromium's virtual platform authenticator.
  const faceId = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  };
  const open = async (stored, { withFaceId = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    // The book fonts come from Google Fonts; the test runs offline.
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    await firebase(ctx);
    if (stored) await ctx.addInitScript((s) => { sessionStorage.setItem('flg-admin-session', s); }, stored);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    // Refused requests (a wrong password, an unconfirmed email) are expected.
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|^Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    if (withFaceId) await faceId(page);
    await page.goto(`${BASE}/admin/book-studio/`);
    return page;
  };
  const opened = (page, email) => page.waitForFunction((e) => !document.querySelector('#app').hidden && document.querySelector('#whoEmail').textContent === e, email, { timeout: 30000 });
  const error = async (page) => { await page.waitForSelector('#gateError:not([hidden])'); return page.textContent('#gateError'); };
  try {
    // Nobody signed in: the studio's own sign-in screen.
    let page = await open(null);
    await page.waitForSelector('#signInForm:not([hidden])');
    assert(await page.isHidden('#app'), 'signed out: the studio stays hidden behind its sign-in screen');
    assert(await page.isHidden('#pkSignInBox'), 'no Face ID button on a device without Face ID or a fingerprint reader');

    // An invited publisher creates a password and confirms the email.
    await page.click('#toCreate');
    await page.fill('#cfEmail', 'pub@example.com');
    await page.fill('#cfPassword', 'short');
    await page.fill('#cfConfirm', 'short');
    await page.click('#cfSubmit');
    assert(/at least 8/.test(await error(page)), 'create password: a short password is refused');
    await page.fill('#cfPassword', 'long-password-1');
    await page.fill('#cfConfirm', 'long-password-2');
    await page.click('#cfSubmit');
    assert(/not the same/.test(await error(page)), 'create password: the two passwords must match');
    await page.fill('#cfConfirm', 'long-password-1');
    await page.click('#cfSubmit');
    assert(/already has a password/.test(await error(page)), 'create password: an email that already has one is sent to sign in');
    await page.click('#createForm [data-gate-back]');
    await page.waitForSelector('#signInForm:not([hidden])');
    assert(true, 'Cancel on "Create your password" returns to sign-in');
    await page.click('#toCreate');
    await page.fill('#cfEmail', 'new@example.com');
    await page.fill('#cfPassword', 'long-password-1');
    await page.fill('#cfConfirm', 'long-password-1');
    await page.click('#cfSubmit');
    await page.waitForSelector('#verifyBox:not([hidden])');
    assert(sent.includes('VERIFY_EMAIL') && /new@example\.com/.test(await page.textContent('#gateText')), 'create password: a confirmation link is sent to the new email');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'book-studio-confirm.png') });
    await page.click('#verifyDone');
    await opened(page, 'new@example.com');
    assert(true, 'after confirming the email, the new publisher is in Book Studio');

    // Sign out, a wrong password, the reset link, then the right password.
    await page.click('#signOutBtn');
    await page.waitForSelector('#signInForm:not([hidden])');
    assert((await page.inputValue('#siEmail')) === 'new@example.com', 'signing out returns to the sign-in screen with the email filled in');
    await page.fill('#siPassword', 'wrong-password');
    await page.click('#siSubmit');
    assert(/do not match/.test(await error(page)), 'a wrong password is refused');
    await page.click('#toForgot');
    await page.click('#fgSubmit');
    await page.waitForSelector('#signInForm:not([hidden])');
    assert(sent.includes('PASSWORD_RESET') && /new password is on its way/.test(await page.textContent('#gateText')), 'Forgot password sends a reset link');
    await page.fill('#siPassword', 'right-password');
    await page.click('#siSubmit');
    await opened(page, 'new@example.com');
    assert(true, 'the right password opens Book Studio');
    await page.context().close();

    // A confirmed account that nobody added.
    page = await open(null);
    await page.waitForSelector('#signInForm:not([hidden])');
    await page.fill('#siEmail', 'stranger@example.com');
    await page.fill('#siPassword', 'right-password');
    await page.click('#siSubmit');
    await page.waitForSelector('#deniedBox:not([hidden])');
    assert(/stranger@example\.com has not been given Book Studio access/.test(await page.textContent('#gateText')), 'an account nobody added is told to ask the owner');
    await page.context().close();

    // Face ID or fingerprint: offered after a password sign-in, then used.
    page = await open(null, { withFaceId: true });
    await page.waitForSelector('#signInForm:not([hidden]) #pkSignInBox:not([hidden])');
    assert(true, 'a device with Face ID shows "Sign in with Face ID or fingerprint"');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'book-studio-sign-in.png') });
    await page.fill('#siEmail', 'pub@example.com');
    await page.fill('#siPassword', 'right-password');
    await page.click('#siSubmit');
    await page.waitForSelector('#offerBox:not([hidden])');
    await page.click('#pkOfferYes');
    await opened(page, 'pub@example.com');
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('flg-admin-passkey'))?.email === 'pub@example.com'), 'Face ID is set up for this device after the password sign-in');
    assert(await page.isHidden('#pkSetUp'), 'the set-up button hides once this device is set up');
    await page.click('#signOutBtn');
    await page.waitForSelector('#pkSignInBox:not([hidden])');
    await page.click('#pkSignIn');
    await opened(page, 'pub@example.com');
    const { results: pk } = await db.prepare("SELECT action FROM admin_audit WHERE actor = 'pub@example.com' AND action LIKE 'passkeys%'").all();
    assert(pk.length > 0, 'Face ID sign-in opens Book Studio with no password');
    await page.context().close();

    // A viewer without publishing access is refused.
    page = await open(session('view@example.com', 'view-uid'));
    await page.waitForSelector('#gate:not([hidden])');
    assert((await page.textContent('#gateTitle')) === 'No publishing access', 'a viewer without the switch sees "No publishing access"');
    await page.context().close();

    // A publisher gets the studio with the sample book, and can export.
    page = await open(session('pub@example.com', 'pub-uid'));
    await page.waitForSelector('#app:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#pages .page').length >= 8, null, { timeout: 30000 });
    assert(true, `publisher: the studio opens with the sample book (${await page.$$eval('#pages .page', (a) => a.length)} pages)`);
    assert(await page.isHidden('#backToAdmin'), 'publisher: no link back into the dashboard');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'book-studio.png') });
    assert((await page.textContent('#navNext')) === 'Next: Cover →' && await page.isHidden('#navBack'), 'the Interior step offers Next: Cover and no Back');
    await page.click('#navNext');
    await page.waitForSelector('#view-cover:not([hidden])');
    await page.click('[data-tab=publish]');
    assert((await page.textContent('#navBack')) === '← Back to Cover' && await page.isHidden('#navNext'), 'Check & export offers Back to Cover and no Next');
    await page.click('#navBack');
    await page.waitForSelector('#view-cover:not([hidden])');
    assert((await page.textContent('#navBack')) === '← Back to Interior', 'Back returns to the step you came from');
    await page.waitForFunction(() => document.querySelector('#cvSpecs')?.textContent.includes('Full cover'), null, { timeout: 15000 });
    assert(true, 'the cover designer loads its vendored library under the page policy');
    // Writing tools: copy text out to QuillBot or Scribbr and put the fixed text back.
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }; });
    await page.evaluate(() => { const o = cv.getObjects().find((x) => x.role === 'title'); cv.setActiveObject(o); cv.requestRenderAll(); });
    await page.click('#cvWrite');
    await page.waitForSelector('#dlgWrite[open]');
    const wt = await page.evaluate(() => ({ text: document.querySelector('#wtText').value, title: cv.getObjects().find((x) => x.role === 'title').text, quill: document.querySelectorAll('#wtQuill [data-wt]').length, scribbr: document.querySelectorAll('#wtScribbr [data-wt]').length }));
    assert(wt.text === wt.title && wt.quill === 5 && wt.scribbr === 5, `Writing tools on the cover takes the selected text box and offers QuillBot and Scribbr tools (${wt.quill} + ${wt.scribbr})`);
    await page.click('#wtQuill [data-wt] >> text=Paraphraser');
    await page.click('#wtScribbr [data-wt] >> text=AI Detector');
    const wtOpened = await page.evaluate(() => window.__opened);
    assert(wtOpened[0] === 'https://quillbot.com/paraphrasing-tool' && wtOpened[1] === 'https://www.scribbr.com/ai-detector/', 'a tool button opens that QuillBot or Scribbr tool in a new tab');
    await page.fill('#wtResult', 'A FRESHLY PARAPHRASED TITLE');
    await page.click('#wtApply');
    assert(await page.evaluate(() => !document.querySelector('#dlgWrite').open && cv.getObjects().find((x) => x.role === 'title').text === 'A FRESHLY PARAPHRASED TITLE'), 'Put it back replaces the cover text box');
    await page.click('[data-tab=details]');
    await page.focus('#m-blurb');
    await page.click('#writeMeta');
    assert(await page.inputValue('#wtText') === await page.inputValue('#m-blurb'), 'Writing tools on Book details takes the field you were in');
    await page.fill('#wtResult', 'A blurb fixed in Scribbr.');
    await page.click('#wtApply');
    assert(await page.evaluate(() => S.meta.blurb === 'A blurb fixed in Scribbr.'), 'Put it back fills the blurb and saves it with the book');
    await page.click('[data-tab=manuscript]');
    const para = await page.evaluate(() => { const p = [...document.querySelectorAll('#pages .content p')].find((x) => x.textContent.trim().split(/\s+/).length > 4); const r = document.createRange(); r.selectNodeContents(p); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); p.closest('.content').focus(); sel.removeAllRanges(); sel.addRange(r); return p.textContent.trim(); });
    await page.waitForTimeout(100);
    await page.click('#writeBtn');
    assert((await page.inputValue('#wtText')).trim() === para, 'Writing tools in the manuscript takes the selected text');
    await page.fill('#wtResult', 'This sentence came back from QuillBot.');
    await page.click('#wtApply');
    assert(await page.evaluate(() => { syncPagesFromDom(); return S.pages.some((p) => p.html.includes('This sentence came back from QuillBot.')); }), 'Put it back replaces the selected text in the page');
    await page.click('[data-tab=cover]');
    await page.waitForSelector('#view-cover:not([hidden])');
    // Grid books: make a small book from the game's puzzles and open it in the editor.
    if (HAVE_SITE) {
      assert(await page.isVisible('[data-tab=gridbooks]'), 'Grid books is a tab in Book Studio');
      await page.click('[data-tab=gridbooks]');
      await page.click('#bk-new', { timeout: 30000 });
      await page.waitForSelector('#bk-make', { timeout: 60000 });
      await page.fill('#bk-c-0', '2');
      await page.dispatchEvent('#bk-c-0', 'change');
      await page.click('#bk-make');
      await page.waitForSelector('#bk-studio:not([disabled])', { timeout: 120000 });
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'book-studio-grid-books.png') });
      await page.click('#bk-save');
      await page.waitForFunction(() => /Saved/.test(document.querySelector('#bk-state')?.textContent || ''), null, { timeout: 30000 });
      assert(true, 'a publisher makes and saves a Grid book');
      await page.click('#bk-studio');
      await page.waitForSelector('#view-manuscript:not([hidden]) #pages .grid-block', { timeout: 60000 });
      const g = await page.evaluate(() => ({ pages: S.pages.length, blocks: document.querySelectorAll('#pages .grid-block').length, title: S.meta.title, css: !!document.querySelector('#gridBookCss'), over: document.querySelectorAll('#pages .page.overflow').length }));
      assert(g.pages >= 24 && g.blocks >= 4 && g.css && g.over === 0, `Open in the editor brings the Grid book in (${g.pages} pages, ${g.blocks} puzzle blocks, nothing overflowing)`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'book-studio-grid-opened.png') });
      // A Grid book puzzle is a fixed block, but it still takes a theme.
      const room = await page.$('#pages .grid-room'); await room.scrollIntoViewIfNeeded(); await room.click();
      await page.selectOption('#pzTheme', 'Mystery and adventure'); await page.selectOption('#pzSub', 'Detectives');
      const gt = await page.evaluate(() => ({ tools: document.querySelector('#pzTools').hidden, saved: (syncPagesFromDom(), S.pages.some((p) => /data-pz-theme="Mystery and adventure" data-pz-sub="Detectives"/.test(p.html))) }));
      assert(gt.tools && gt.saved, 'a Grid book puzzle takes a theme and subcategory (and offers no resize or new puzzle)');
      assert((await page.textContent('#navBack')) === '← Back to Grid books', 'Back returns to Grid books');
    } else console.log('--  Grid books skipped: no dist/site (run npm run build)');
    await page.click('#applyPub');
    await page.waitForSelector('#view-publish:not([hidden]) #checkSummary .card', { timeout: 30000 });
    const pages = await page.$$eval('#pages .page', (a) => a.length);
    assert(pages >= 24, `Apply specs (KDP) brings the book to the 24-page minimum (${pages} pages)`);
    await page.selectOption('#dpi', '200');
    await page.click('#expPacket');
    await page.click('.busy .busy-cancel:not([hidden])', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.busy') && /Export cancelled/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 60000 });
    assert(true, 'Cancel on the progress card stops an export and saves nothing');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#expPacket')]);
    assert(/submission-packet\.zip$/.test(dl.suggestedFilename()), `the submission packet downloads (${dl.suggestedFilename()})`);
    const { results } = await db.prepare("SELECT actor, status FROM admin_audit WHERE action = 'publishing.export'").all();
    assert(results.some((r) => r.actor === 'pub@example.com' && r.status === 200), 'the export is written to the audit log');

    // Sync: the edited book goes to the account, and opens on a second device.
    const books = async () => (await db.prepare("SELECT id, title, rev FROM studio_books WHERE owner = 'pub@example.com' ORDER BY updated_at").all()).results;
    await page.waitForFunction(() => syRev(S.syncId) === 1 && /^Synced/.test(document.querySelector('#sbSync').textContent), null, { timeout: 40000 }).catch(async (e) => { console.log(await page.evaluate(() => [document.querySelector('#sbSync').textContent, syPending(syCurrent()), syRev(S.syncId), syReady])); throw e; });
    let mine = await books();
    const title = await page.evaluate(() => S.meta.title);
    assert(mine.length === 1 && mine[0].title === title && mine[0].id === await page.evaluate(() => S.syncId), `the book syncs to the publisher's account ("${title}")`);
    const other = await open(session('pub@example.com', 'pub-uid'));
    const bookId = await page.evaluate(() => S.syncId);
    await other.waitForFunction((id) => !document.querySelector('#app').hidden && S.syncId === id && /^Synced/.test(document.querySelector('#sbSync').textContent), bookId, { timeout: 60000 });
    assert((await other.evaluate(() => S.pages.length)) === (await page.evaluate(() => S.pages.length)), 'a new device opens the newest book from the account instead of the sample');
    // The second device also gives a puzzle a theme and adds a theme to the list.
    await other.evaluate(() => {
      S.meta.title = 'Changed on the second device'; fillMetaForm();
      applyThemeTo([document.querySelector('#pages .content .puzzle, #pages .content .grid-room')], 'Holidays', 'Christmas');
      S.puzzleThemes = cloneThemes([...puzzleThemes(), { name: 'Logic grids', subs: ['Easy', 'Expert'] }]);
      markDirty();
    });
    await other.waitForFunction(() => /^Synced/.test(document.querySelector('#sbSync').textContent) && syRev(S.syncId) === 2, null, { timeout: 40000 });
    await page.evaluate(() => syCheck({ force: true }));
    await page.waitForFunction(() => S.meta.title === 'Changed on the second device', null, { timeout: 30000 });
    assert(true, 'the first device picks up the change from the second');
    assert(await page.evaluate(() => document.querySelectorAll('#pages [data-pz-theme="Holidays"][data-pz-sub="Christmas"]').length >= 1 && puzzleThemes().some((t) => t.name === 'Logic grids')), 'a puzzle theme and an edited theme list sync to the other device');
    // Once it has opened (cover too), nothing is left to send: before, the cover was
    // read back while still loading, so the book was sent straight back as a new save.
    await page.waitForFunction(() => !syPending(syCurrent()), null, { timeout: 20000 });
    assert(await page.evaluate(() => syRev(S.syncId)) === 2, 'a book opened from the account is not sent straight back');
    // Both devices change the book before either has the other's changes: the
    // changes are merged into the same book, never a copy.
    const before = await page.evaluate(() => S.pages.length);
    await other.evaluate(() => { S.meta.title = 'Second device again'; addPageAfter(S.pages.length - 1, '<p>Added on the second device</p>'); });
    await other.waitForFunction((n) => syRev(S.syncId) >= 3 && S.pages.length === n + 1 && /^Synced/.test(document.querySelector('#sbSync').textContent), before, { timeout: 40000 });
    await page.evaluate(() => { S.meta.subtitle = 'Subtitle from the first device'; S.meta.title = 'First device, not synced yet'; fillMetaForm(); markDirty(); });
    await page.waitForFunction((n) => S.pages.length === n + 1 && S.meta.title === 'First device, not synced yet' && /^Synced/.test(document.querySelector('#sbSync').textContent) && !syPending(syCurrent()), before, { timeout: 60000 })
      .catch(async (e) => { console.log(await page.evaluate(() => [document.querySelector('#sbSync').textContent, S.meta.title, S.pages.length, syRev(S.syncId)])); throw e; });
    mine = await books();
    assert(mine.length === 1 && mine[0].id === bookId && mine[0].title === 'First device, not synced yet', `changes made on two devices at once go into the same book, not a copy (${mine.map((b) => b.title).join(' | ')})`);
    assert(await page.evaluate(() => S.pages.some((p) => /Added on the second device/.test(p.html)) && S.meta.subtitle === 'Subtitle from the first device'), 'the page added on one device and the subtitle set on the other are both in the book');
    await other.evaluate(() => syCheck({ force: true }));
    await other.waitForFunction(() => S.meta.title === 'First device, not synced yet' && S.meta.subtitle === 'Subtitle from the first device', null, { timeout: 30000 });
    assert(true, 'the second device opens the merged book');
    await page.click('#projMenuBtn');
    await page.waitForFunction(() => document.querySelectorAll('#syList .sy-item').length === 1);
    assert(true, 'Project lists the one book on the account');
    await page.click('#dlgProject [data-close]');
    await other.context().close();

    // Get the app: installable, with the Windows download.
    const mf2 = await page.evaluate(async () => { const r = await fetch('manifest.webmanifest'); return { type: r.headers.get('content-type'), body: await r.json() }; });
    assert(/manifest\+json/.test(mf2.type) && mf2.body.scope === '/admin/book-studio/', 'Book Studio has its own app manifest');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    assert(scope.endsWith('/admin/book-studio/'), 'the Book Studio service worker is installed for offline use');
    await page.click('#getApp');
    await page.waitForSelector('#dlgApp[open]');
    assert(/book-studio-desktop\/Book-Studio-Setup\.exe$/.test(await page.getAttribute('#appWinLink', 'href')), 'Get the app links the Windows app');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'book-studio-get-app.png') });
    await page.click('#dlgApp [data-close]');
    // Offline: the installed copy still opens for the account that signed in here.
    await page.waitForTimeout(1500);
    await page.context().setOffline(true);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#app').hidden && /^Offline/.test(document.querySelector('#sbSync').textContent), null, { timeout: 30000 });
    assert((await page.evaluate(() => S.meta.title)) === 'First device, not synced yet', 'with no connection Book Studio opens with the book from this device');
    await page.context().setOffline(false);
    await page.context().close();

    // Make it from a topic (Grid books): find puzzles to review, keep the ticked
    // ones; then make the whole book for a publisher, down to the submission file.
    if (HAVE_SITE) {
      page = await open(session('pub@example.com', 'pub-uid'));
      await page.waitForSelector('#app:not([hidden])');
      await page.click('[data-tab=gridbooks]');
      await page.click('#bk-new', { timeout: 30000 });
      await page.waitForSelector('#bk-tp-find', { timeout: 60000 });
      const tp = await page.evaluate(() => ({ topics: document.querySelectorAll('#bk-tp-theme option').length, types: document.querySelectorAll('[data-tp-game]').length, pubs: document.querySelectorAll('#bk-tp-pub option').length }));
      assert(tp.topics >= 20 && tp.types >= 11 && tp.pubs >= 5, `Make it from a topic offers every topic, every puzzle type and the publishers (${tp.topics} topics, ${tp.types} types, ${tp.pubs} publishers)`);
      await page.selectOption('#bk-tp-theme', 'mystery');
      await page.click('#bk-tp-none');
      for (const id of ['flg', 'np', 'cw']) await page.check(`[data-tp-game="${id}"]`);
      await page.fill('#bk-tp-count', '1'); await page.dispatchEvent('#bk-tp-count', 'change');
      await page.click('#bk-tp-find');
      await page.waitForSelector('#bk-found [data-pick]', { timeout: 180000 });
      const f = await page.evaluate(() => ({ all: document.querySelectorAll('#bk-found [data-pick]').length, ticked: document.querySelectorAll('#bk-found [data-pick]:checked').length, kinds: document.querySelectorAll('#bk-found h4').length }));
      assert(f.kinds === 3 && f.all >= 6 && f.ticked === 3, `Find puzzles to review lists more puzzles than needed for each type, one of each ticked (${f.all} found, ${f.ticked} ticked)`);
      await page.uncheck('#bk-found [data-pick]:checked >> nth=0');
      await page.click('#bk-tp-use');
      const bk = await page.evaluate(async () => { const b = (await import('/admin/books.js')).currentBook(); return { n: b.puzzles.length, secs: b.settings.sections.length, topic: b.settings.topic, title: b.title, themes: b.settings.sections.map((x) => x.theme) }; });
      assert(bk.n === 2 && bk.secs === 2 && bk.topic === 'mystery' && /Mystery/i.test(bk.title) && bk.themes.every(Boolean), `the ticked puzzles go in the book, one section a type, on the topic ("${bk.title}", ${bk.n} puzzles)`);
      await page.selectOption('#bk-tp-pub', 'kdp');
      // A page count past the old 24: the book is filled with more puzzles up to it.
      assert(await page.getAttribute('#bk-tp-pages', 'max') === '828', 'Pages goes up to the publisher\'s maximum (KDP, 6 x 9 in: 828)');
      await page.fill('#bk-tp-pages', '40'); await page.dispatchEvent('#bk-tp-pages', 'change');
      await page.evaluate(() => { document.querySelector('#dpi').value = '200'; }); // a smaller, quicker file
      page.once('dialog', (d) => d.accept()); // "Make the whole book again from this topic?"
      const [packet] = await Promise.all([page.waitForEvent('download', { timeout: 420000 }), page.click('#bk-tp-auto')]);
      assert(/kdp-submission-packet\.zip$/i.test(packet.suggestedFilename()), `Make the whole book for me checks it for the publisher and makes the submission file (${packet.suggestedFilename()})`);
      const done = await page.evaluate(async () => ({ pub: S.pub, errors: lastIssues.filter((i) => i.sev === 'error').length, pages: S.pages.length, title: S.meta.title, kw: S.meta.keywords, puzzles: (await import('/admin/books.js')).currentBook().puzzles.length }));
      assert(done.pub === 'kdp' && done.errors === 0 && done.pages === 40 && /Mystery/i.test(done.title) && /logic puzzles/.test(done.kw), `the book passes every publisher check (${done.pages} pages, no errors)`);
      assert(done.puzzles > 3, `the book was filled to 40 pages with more puzzles, not only Notes pages (${done.puzzles} puzzles)`);
      await page.context().close();
    }

    assert(problems.length === 0, `no script errors or blocked resources${problems.length ? `:\n${problems.join('\n')}` : ''}`);
    console.log('Book Studio e2e passed');
  } finally {
    await browser.close();
    if (site) site.kill();
    await mf.dispose();
  }
})().catch((e) => { console.error(e); process.exit(1); });
