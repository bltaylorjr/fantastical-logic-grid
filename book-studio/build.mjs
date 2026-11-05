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
const ORDER = ['specs.js', 'core.js', 'editor.js', 'puzzles.js', 'import.js', 'cover.js', 'publish.js', 'main.js'];
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
const pageTop = `<header class="studio-bar"><a class="studio-home" id="backToAdmin" href="/admin/">← Grid Admin</a><span class="studio-who" id="whoEmail"></span><button class="btn ghost" id="pkSetUp" type="button" hidden>Set up Face ID or fingerprint</button><button class="btn ghost" id="signOutBtn" type="button">Sign out</button></header>`;
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
</div></div>`;
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
writeFileSync(join(out, 'studio.css'), `/* Book Studio. Built from book-studio/src/shell.html by book-studio/build.mjs: do not edit here. */\n${style.trim()}\n${extraCss}`);
writeFileSync(join(out, 'studio.js'), `// Book Studio. Built from book-studio/src by book-studio/build.mjs: do not edit here.\n'use strict';\n${js}\n${src('auth.js')}`);
const require = createRequire(join(here, 'package.json'));
for (const [, [pkg, path, file]] of Object.entries(VENDOR)) {
  const from = join(dirname(require.resolve(`${pkg}/package.json`)), path);
  if (!existsSync(from)) throw new Error(`missing ${from}: run npm --prefix book-studio install`);
  copyFileSync(from, join(out, 'vendor', file));
}
console.log('wrote admin/book-studio/');
