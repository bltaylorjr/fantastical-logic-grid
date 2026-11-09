// Builds Book Studio into admin/book-studio/, where the Worker serves it at
// /admin/book-studio/ (server/src/admin.js, STUDIO_FILE). Run after changing
// anything in book-studio/src:  node book-studio/build.mjs
//
// The same sources also make the stand-alone copy (no sign-in, libraries from
// a CDN) with:  node book-studio/build.mjs --standalone  (writes dist/book-studio.html)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = (f) => readFileSync(join(here, 'src', f), 'utf8');
const ORDER = ['specs.js', 'core.js', 'editor.js', 'puzzles.js', 'import.js', 'cover.js', 'publish.js', 'gridbooks.js', 'writing.js', 'main.js'];
const standalone = process.argv.includes('--standalone');

// Libraries, vendored from npm (versions pinned in book-studio/package.json).
const VENDOR = {
  fabric: ['fabric', 'dist/fabric.min.js', 'fabric.min.js'],
  jspdf: ['jspdf', 'dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  html2canvas: ['html2canvas', 'dist/html2canvas.min.js', 'html2canvas.min.js'],
  jszip: ['jszip', 'dist/jszip.min.js', 'jszip.min.js'],
  mammoth: ['mammoth', 'mammoth.browser.min.js', 'mammoth.browser.min.js'],
  pdfjs: ['pdfjs-dist', 'build/pdf.min.js', 'pdf.min.js'],
  pdfworker: ['pdfjs-dist', 'build/pdf.worker.min.js', 'pdf.worker.min.js'],
  pako: ['pako', 'dist/pako.min.js', 'pako.min.js'],
  utif: ['utif', 'UTIF.js', 'UTIF.js'],
  marked: ['marked', 'marked.min.js', 'marked.min.js'],
};

let shell = src('shell.html');
const style = shell.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = shell.replace(/^[\s\S]*?<\/style>\s*/, '');
const fonts = shell.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/)[1];
let js = ORDER.map(src).join('\n');

if (standalone) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${shell}<script>${js}\ninit();</script></body></html>`;
  writeFileSync(join(root, 'dist', 'book-studio.html'), page);
  console.log('wrote dist/book-studio.html');
  process.exit(0);
}

// Grid Admin build: local libraries, sign-in gate, no inline script.
js = js.replace(/url: 'https:\/\/cdn\.jsdelivr\.net\/npm\/[^']+'/g, (m) => m); // replaced below per library
for (const [name, [, , file]] of Object.entries(VENDOR)) {
  js = js.replace(new RegExp(`(${name}: \\{ url: )'https://cdn\\.jsdelivr\\.net/npm/[^']+'`), `$1'vendor/${file}'`);
}
js = js.replace(/\s*heic2any: \{[^\n]*\n/, '\n');
const pageTop = `<header class="studio-bar"><a class="studio-home" id="backToAdmin" href="/admin/">← Grid Admin</a><span class="studio-who" id="whoEmail"></span><button class="btn ghost" id="getApp" type="button" hidden>Get the app</button><button class="btn ghost" id="pkSetUp" type="button" hidden>Set up Face ID or fingerprint</button><button class="btn ghost" id="signOutBtn" type="button">Sign out</button></header>`;
// The sign-in screen (book-studio/src/auth.js drives it): password, creating a
// password, a reset link, confirming the email, and Face ID or fingerprint.
const gate = `<div id="gate" class="gate" hidden><div class="gate-card">
  <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>Book Studio</div>
  <h1 id="gateTitle">Sign in to Book Studio</h1>
  <p id="gateText"></p>
  <p id="gateError" class="gate-error" role="alert" hidden></p>
  <form id="signInForm" class="gate-form" hidden>
    <div id="pkSignInBox" class="gate-form" hidden><button class="btn primary big" id="pkSignIn" type="button">Sign in with Face ID or fingerprint</button><div class="gate-or">or use your password</div></div>
    <label class="lab">Email <input type="email" id="siEmail" autocomplete="username" required></label>
    <label class="lab">Password <input type="password" id="siPassword" autocomplete="current-password" required></label>
    <label class="check"><input type="checkbox" id="siKeep"> Keep me signed in on this device</label>
    <button class="btn primary big" id="siSubmit" type="submit">Sign in</button>
    <div class="gate-links"><button type="button" class="linkbtn" id="toForgot">Forgot password?</button><button type="button" class="linkbtn" id="toCreate">First time? Create your password</button></div>
  </form>
  <form id="createForm" class="gate-form" hidden>
    <label class="lab">Email <input type="email" id="cfEmail" autocomplete="username" required></label>
    <label class="lab">New password <input type="password" id="cfPassword" autocomplete="new-password" required></label>
    <label class="lab">New password again <input type="password" id="cfConfirm" autocomplete="new-password" required></label>
    <button class="btn primary big" id="cfSubmit" type="submit">Create password</button>
    <button class="btn big" type="button" data-gate-back>Cancel</button>
  </form>
  <form id="forgotForm" class="gate-form" hidden>
    <label class="lab">Email <input type="email" id="fgEmail" autocomplete="username" required></label>
    <button class="btn primary big" id="fgSubmit" type="submit">Send the link</button>
    <button class="btn big" type="button" data-gate-back>Cancel</button>
  </form>
  <div id="verifyBox" class="gate-form" hidden>
    <button class="btn primary big" id="verifyDone" type="button">Continue</button>
    <button class="btn big" type="button" data-gate-back>Cancel</button>
    <div class="gate-links"><button type="button" class="linkbtn" id="verifyResend">Send the link again</button></div>
  </div>
  <div id="offerBox" class="gate-form" hidden>
    <button class="btn primary big" id="pkOfferYes" type="button">Use Face ID or fingerprint</button>
    <button class="btn big" id="pkOfferNo" type="button">Not now</button>
  </div>
  <div id="deniedBox" class="gate-form" hidden>
    <button class="btn big" id="gateOther" type="button">Cancel and sign in with another account</button>
    <a class="btn big" id="gateBack" href="/admin/" hidden>Back to Grid Admin</a>
  </div>
</div></div>
<dialog id="dlgApp"><div class="dlg">
  <header><h3>Get the Book Studio app</h3><button class="btn ghost" data-close>Close</button></header>
  <div class="body">
    <p class="hint">The app opens Book Studio in its own window, works without a connection once you have signed in (tick "Keep me signed in"), and syncs your books with your account. Sign in with the same email everywhere and your books follow you.</p>
    <div id="appWin" class="app-way"><b>Windows</b>
      <a class="btn primary" id="appWinLink" href="#" rel="noopener">Download for Windows</a>
      <small class="hint">Open the file to install it; it updates itself. Windows may say "Windows protected your PC" because the app is not signed with a paid certificate: click More info, then Run anyway.</small></div>
    <div class="app-way"><b>This device</b>
      <button class="btn primary" id="appInstall" type="button" hidden>Install Book Studio</button>
      <small class="hint" id="appInstallNote">In Chrome or Edge (Windows, Mac, Chromebook, Android), open the browser menu and choose Install Book Studio (or Apps, then Install).</small>
      <small class="hint" id="appIos" hidden>On iPhone or iPad, in Safari: tap Share, then Add to Home Screen.</small>
      <small class="hint" id="appSafari" hidden>On a Mac in Safari: choose File, then Add to Dock.</small></div>
  </div>
</div></dialog>`;
let html = body
  .replace(/^<title>[\s\S]*?(?=<div id="app">)/, '')
  .replace('<div id="app">', `${gate}\n<div id="app" hidden>`)
  .replace('<div class="brand">', `${pageTop}\n    <div class="brand">`);
const extraCss = `
.studio-bar { display: none; }
.topbar .studio-bar { display: flex; flex-basis: 100%; align-items: center; gap: 10px; font-size: 12px; color: var(--ink-2); }
.studio-home { color: var(--ink-2); text-decoration: none; font-weight: 600; }
.studio-who { margin-left: auto; font-family: var(--f-mono); }
.gate { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg); padding: 16px; }
.gate-card { max-width: 440px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
.gate-card h1 { font-family: var(--f-display); font-size: 22px; margin: 0; }
.gate-card p { margin: 0; color: var(--ink-2); line-height: 1.5; }
.gate-card { width: 100%; }
.gate-form { display: flex; flex-direction: column; gap: 10px; }
.gate-form .lab { font-size: 13px; }
.gate-form .lab input { min-height: 44px; font-size: 16px; padding: 8px 10px; }
.gate-form .check { min-height: 44px; }
.gate-form .btn.big { min-height: 44px; justify-content: center; font-size: 15px; }
.gate-or { text-align: center; font-size: 12px; color: var(--ink-2); }
.gate-links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.linkbtn { background: none; border: 0; padding: 0; min-height: 44px; color: var(--accent); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.gate-error { color: var(--danger, #b42318) !important; font-weight: 600; }
/* Sync (sync.js) and Get the app */
#sbSync[data-kind="ok"]::before { content: "✓ "; color: var(--ok, #1a7f37); }
#sbSync[data-kind="off"], #sbSync[data-kind="bad"] { color: var(--bad, #b42318); font-weight: 600; }
.sy-box { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.sy-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sy-head h4 { margin: 0; font-size: 14px; }
.sy-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 40vh; overflow: auto; }
.sy-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
.sy-item.here { border-color: var(--accent); }
.sy-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sy-meta b { overflow-wrap: anywhere; }
.sy-acts { display: flex; gap: 6px; }
.app-way { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 0; border-top: 1px solid var(--line); }
`;
// the studio bar sits inside the top bar so it wraps above the controls
html = html.replace(`${pageTop}\n    <div class="brand">`, `<div class="brand">`).replace('<header class="topbar">', `<header class="topbar">\n    ${pageTop}`);
const out = join(root, 'admin', 'book-studio');
mkdirSync(join(out, 'vendor'), { recursive: true });
writeFileSync(join(out, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Book Studio · Grid Admin</title>
<link rel="icon" href="/admin/icon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="/admin/apple-touch-icon.png">
<meta name="theme-color" content="#5B3CC4">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Book Studio">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<link rel="stylesheet" href="studio.css">
<script src="studio.js" defer></script>
</head>
<body>
${html}
</body>
</html>
`);
// The Grid books tab runs the dashboard's own Books and covers (admin/books.js),
// so it gets the dashboard's styles, kept inside .grid-books.
function scopeCss(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  const block = (from) => { let depth = 0; for (let k = from; k < css.length; k++) { if (css[k] === '{') depth++; else if (css[k] === '}' && --depth === 0) return k; } return css.length; };
  const sel = (list, dark) => list.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    if (/^(:root|html|body)$/.test(x)) return dark || scope;
    if (/^(html|body)[.\[:]/.test(x)) return null; // the dashboard's own page states
    return `${scope} ${x.replace(/^(:root|html|body)\s+/, '')}`;
  }).filter(Boolean).join(', ');
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    const close = block(open);
    const body = css.slice(open + 1, close);
    i = close + 1;
    if (head.startsWith('@media')) {
      if (/print/.test(head)) continue;
      if (/prefers-color-scheme:\s*dark/.test(head)) {
        // Dark follows Book Studio's own theme switch as well as the system.
        out.push(`${head} { ${scopeCss(body, scope).replaceAll(`${scope} {`, `:root:not([data-theme="light"]) ${scope} {`)} }`);
        out.push(scopeCss(body, scope).replaceAll(`${scope} {`, `:root[data-theme="dark"] ${scope} {`));
        continue;
      }
      out.push(`${head} { ${scopeCss(body, scope)} }`);
      continue;
    }
    if (head.startsWith('@keyframes')) { out.push(`${head} {${body}}`); continue; }
    if (head.startsWith('@')) continue;
    const s2 = sel(head);
    if (s2) out.push(`${s2} {${body}}`);
  }
  return out.join('\n');
}
const gridBooksCss = `
/* Grid books (the dashboard's Books and covers) */
${scopeCss(readFileSync(join(root, 'admin', 'admin.css'), 'utf8'), '.grid-books')}
.grid-books { padding: 16px max(16px, env(safe-area-inset-left, 0px)) 24px; min-height: 100%; }
.grid-books h1 { margin-bottom: 4px; }
`;
writeFileSync(join(out, 'studio.css'), `/* Book Studio. Built from book-studio/src/shell.html by book-studio/build.mjs: do not edit here. */\n${style.trim()}\n${extraCss}\n${gridBooksCss}`);
writeFileSync(join(out, 'studio.js'), `// Book Studio. Built from book-studio/src by book-studio/build.mjs: do not edit here.\n'use strict';\n${js}\n${src('sync.js')}\n${src('auth.js')}`);
const require = createRequire(join(here, 'package.json'));
for (const [, [pkg, path, file]] of Object.entries(VENDOR)) {
  const from = join(dirname(require.resolve(`${pkg}/package.json`)), path);
  if (!existsSync(from)) throw new Error(`missing ${from}: run npm --prefix book-studio install`);
  copyFileSync(from, join(out, 'vendor', file));
}
console.log('wrote admin/book-studio/');

// Installing Book Studio as its own app (phone, Mac, Chromebook, and Chrome or
// Edge anywhere): the manifest, and a service worker that keeps the studio's
// files so an installed copy opens with no connection. The sign-in and the
// API (/admin/v1) always go to the network; books sync from sync.js.
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Book Studio',
  short_name: 'Book Studio',
  description: 'Make and publish puzzle books. Your books sync with your Grid Admin account.',
  id: '/admin/book-studio/',
  start_url: '/admin/book-studio/',
  scope: '/admin/book-studio/',
  display: 'standalone',
  background_color: '#5B3CC4',
  theme_color: '#5B3CC4',
  icons: [
    { src: '/admin/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/admin/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/admin/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/admin/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
}, null, 2) + '\n');
const shellFiles = ['./', 'studio.css', 'studio.js', 'manifest.webmanifest', ...Object.values(VENDOR).map(([, , f]) => `vendor/${f}`), '/admin/passkeys.js', '/admin/books.js', '/admin/icon.svg', '/admin/icon-192.png'];
const { createHash } = await import('node:crypto');
const version = createHash('sha256').update(['index.html', 'studio.css', 'studio.js'].map((f) => readFileSync(join(out, f))).join('\0')).digest('hex').slice(0, 12);
writeFileSync(join(out, 'sw.js'), `// Book Studio as an installed app. Built by book-studio/build.mjs: do not edit here.
// The studio's own files are kept so it opens offline; each visit fetches
// them fresh when there is a connection. The API and sign-in are never kept.
const CACHE = 'book-studio-${version}';
const SHELL = ${JSON.stringify(shellFiles)};
const HERE = new URL('./', self.location).pathname;
const KEEP = new Set(SHELL.map((f) => new URL(f, self.location).pathname));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('book-studio-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const page = e.request.mode === 'navigate' && url.pathname === HERE;
  if (!page && !KEEP.has(url.pathname)) return;
  const key = page ? HERE : url.pathname;
  // The libraries change only with a new version: from the cache first.
  if (url.pathname.startsWith(HERE + 'vendor/')) {
    e.respondWith(caches.match(key).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((hit) => hit || Response.error())));
});
`);
console.log('wrote the Book Studio app files (manifest.webmanifest, sw.js)');
