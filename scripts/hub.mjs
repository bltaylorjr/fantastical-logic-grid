// The Logic Grid's website layout (website build only, called by seo.mjs):
//   /               The Logic Grid's front page: a card for each game, and
//                   everything shared by the games (account, messages, ideas,
//                   problems, installing, support, news, social links)
//   /fantastical/   The Fantastical Logic Grid (the game page, moved here)
//   /ninetimesnine/ NINETIMESNINE on a page of its own
// Every other file and page stays where it was, so links in emails, the
// desktop app, the admin dashboard and game sites keep working.
//
// The game page gets <base href="../">, so every relative address in the
// game's HTML and code still resolves from the site root exactly as before.
// All the pages share one address (origin), so saves, settings and sign-in
// carry over between them.
//
// Old links: the front page sends any address with a query or hash
// (?play=now, ?challenge=CODE, ?race=CODE, ?learn, ?preview=...) and the
// installed app (its start address used to be /) on to fantastical/.
// Campaign tags alone (utm_*) stay on the front page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const SITE_NAME = 'The Logic Grid';

export function writeGamePage(site, html) {
  // Built already (the build ran on this folder before, as test-picks does):
  // the game is in fantastical/ and index.html is the front page, rewritten below.
  if (html.includes('js/hub.js') && readFileSync(join(site, 'fantastical', 'index.html'), 'utf8').includes('<base href="../">')) return;
  let page = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="../">');
  if (page === html) throw new Error('hub.mjs: the game page has no <meta charset> to put <base> after');
  // In-page links (#grid-region, placeholders) must stay on this page, not the base.
  page = page.replace(/href="#/g, 'href="fantastical/#');
  // The Menu's way back to The Logic Grid's front page (every game), next to Play NINETIMESNINE.
  const menuLink = '<a role="menuitem" class="menu-small" href="./">The Logic Grid home</a>\n    <button role="menuitem" type="button" data-cmd="numberplace"';
  const withLink = page.replace('<button role="menuitem" type="button" data-cmd="numberplace"', menuLink);
  if (withLink === page) throw new Error('hub.mjs: the game menu has no Play NINETIMESNINE item to put The Logic Grid home beside');
  page = withLink;
  mkdirSync(join(site, 'fantastical'), { recursive: true });
  writeFileSync(join(site, 'fantastical', 'index.html'), page);
  // Suggest a storyline and Report a Problem: "Back to the game" goes to the game.
  for (const dir of ['storyline', 'report']) {
    const f = join(site, dir, 'index.html');
    const before = readFileSync(f, 'utf8');
    const after = before.replace(/href="\.\.\/"/g, 'href="../fantastical/"');
    if (after === before) throw new Error(`hub.mjs: ${dir}/index.html has no link back to the game`);
    writeFileSync(f, after);
  }
}

// The Logic Grid's mark (web/icons/icon.svg).
const LOGO = '<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><rect width="512" height="512" rx="96" fill="#1F5FAD"/><g fill="none" stroke="#FFF" stroke-width="14"><rect x="96" y="96" width="320" height="320" rx="20"/><path d="M202.7 96v320M309.3 96v320M96 202.7h320M96 309.3h320"/></g><circle cx="256" cy="256" r="34" fill="#FFD400" stroke="#FFF" stroke-width="10"/><g stroke="#FFF" stroke-width="16" stroke-linecap="round"><path d="M128 128l42 42M170 128l-42 42M342 342l42 42M384 342l-42 42M342 128l42 42M384 128l-42 42"/></g><path d="M256 22l9 22 22 9-22 9-9 22-9-22-22-9 22-9z" fill="#FFD400"/></svg>';

const ART_GRID = `<svg viewBox="0 0 240 150" aria-hidden="true" focusable="false">
<g fill="none" stroke="rgb(255 255 255 / .9)" stroke-width="2.5"><rect x="60" y="15" width="120" height="120" rx="8"/><path d="M100 15v120M140 15v120M60 55h120M60 95h120"/></g>
<g stroke="#FFF" stroke-width="5" stroke-linecap="round"><path d="M70 25l20 20M90 25l-20 20"/><path class="mk" d="M150 65l20 20M170 65l-20 20"/><path class="mk" d="M70 105l20 20M90 105l-20 20"/><path class="mk" d="M110 105l20 20M130 105l-20 20"/></g>
<circle class="mk" cx="120" cy="75" r="11" fill="#FFD400" stroke="#FFF" stroke-width="3"/><circle class="mk" cx="160" cy="35" r="11" fill="#FFD400" stroke="#FFF" stroke-width="3"/>
<path d="M28 40l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill="#FFD400"/><path d="M212 96l3.5 8 8 3.5-8 3.5-3.5 8-3.5-8-8-3.5 8-3.5z" fill="#FFF" opacity=".8"/></svg>`;

const ART_NINE = (() => {
  const given = [[0, 0, 5], [0, 2, 3], [0, 5, 7], [1, 1, 6], [1, 4, 1], [1, 7, 9], [2, 3, 9], [2, 8, 8], [3, 0, 8], [3, 6, 6], [4, 2, 4], [4, 8, 3],
    [5, 5, 2], [5, 7, 5], [6, 1, 7], [6, 4, 8], [7, 3, 1], [7, 8, 2], [8, 0, 3], [8, 6, 4]];
  const thin = [1, 2, 4, 5, 7, 8].map((i) => `M${i * 14} 0v126M0 ${i * 14}h126`).join('');
  return `<svg viewBox="0 0 240 150" aria-hidden="true" focusable="false"><g transform="translate(57 12)">
<rect width="126" height="126" rx="8" fill="rgb(255 255 255 / .08)" stroke="rgb(255 255 255 / .9)" stroke-width="2.5"/>
<path d="${thin}" stroke="rgb(255 255 255 / .35)" stroke-width="1"/><path d="M42 0v126M84 0v126M0 42h126M0 84h126" stroke="rgb(255 255 255 / .9)" stroke-width="2.5"/>
<g fill="#FFF" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="10" text-anchor="middle">${given.map(([r, c, n]) => `<text x="${c * 14 + 7}" y="${r * 14 + 11}">${n}</text>`).join('')}</g>
<g class="mk"><rect x="56" y="56" width="14" height="14" fill="#FFD400"/><text x="63" y="67" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="10" text-anchor="middle">9</text></g></g></svg>`;
})();

const CHEVRON = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The same color tokens as the game (web/app.css).
const TOKENS = `
:root { --bg: #FFFFFF; --page: #E9EDF7; --text: #121626; --muted: #4A5168; --accent: #5B3CC4; --accent-hi: #7656E0; --on-accent: #FFFFFF;
  --edge: rgb(18 22 38 / .10); --edge-hi: rgb(18 22 38 / .24); --surface: rgb(255 255 255 / .86); --shadow: 0 22px 50px -30px rgb(30 25 80 / .45);
  --focus: #5B3CC4; --grid-line: rgb(18 22 38 / .05); --glow-a: .22; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]):not([data-theme="contrast"]) { --bg: #121729; --page: #080B16; --text: #EEF0F8; --muted: #AEB5CB; --accent: #F5C451; --accent-hi: #FFE08A; --on-accent: #1B1400;
  --edge: rgb(255 255 255 / .10); --edge-hi: rgb(255 255 255 / .24); --surface: rgb(19 24 43 / .80); --shadow: 0 24px 60px -28px rgb(0 0 0 / .85); --focus: #FFD66B; --grid-line: rgb(255 255 255 / .045); --glow-a: .34; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #121729; --page: #080B16; --text: #EEF0F8; --muted: #AEB5CB; --accent: #F5C451; --accent-hi: #FFE08A; --on-accent: #1B1400;
  --edge: rgb(255 255 255 / .10); --edge-hi: rgb(255 255 255 / .24); --surface: rgb(19 24 43 / .80); --shadow: 0 24px 60px -28px rgb(0 0 0 / .85); --focus: #FFD66B; --grid-line: rgb(255 255 255 / .045); --glow-a: .34; color-scheme: dark; }
:root[data-theme="contrast"] { --bg: #000; --page: #000; --text: #FFF; --muted: #E6E6E6; --accent: #FFD400; --accent-hi: #FFD400; --on-accent: #000;
  --edge: #FFF; --edge-hi: #FFF; --surface: #000; --shadow: none; --focus: #FFD400; --grid-line: transparent; --glow-a: 0; color-scheme: dark; }`;

const HUB_CSS = `
@font-face { font-family: "Atkinson Hyperlegible"; font-weight: 400; font-display: swap; src: url(fonts/atkinson-400.woff2) format("woff2"); }
@font-face { font-family: "Atkinson Hyperlegible"; font-weight: 700; font-display: swap; src: url(fonts/atkinson-700.woff2) format("woff2"); }
@font-face { font-family: "Cinzel"; font-weight: 700; font-display: swap; src: url(fonts/cinzel-700.woff2) format("woff2"); }
${TOKENS}
:root { --font: "Atkinson Hyperlegible", "Segoe UI", system-ui, -apple-system, sans-serif; --display: "Cinzel", "Iowan Old Style", "Palatino Linotype", Georgia, serif; --radius: 18px; --ease: cubic-bezier(.2,.7,.3,1); }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; min-height: 100vh; color: var(--text); font: 17px/1.55 var(--font);
  background: radial-gradient(900px 500px at 12% -10%, rgb(124 92 255 / var(--glow-a)), transparent 60%), radial-gradient(800px 520px at 100% 10%, rgb(34 184 207 / var(--glow-a)), transparent 60%),
  linear-gradient(var(--grid-line) 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, var(--grid-line) 1px, transparent 1px) 0 0 / 32px 32px, var(--page); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 6px; }
.skip { position: absolute; left: 12px; top: -60px; background: var(--accent); color: var(--on-accent); padding: 10px 16px; border-radius: 10px; font-weight: 700; text-decoration: none; z-index: 10; }
.skip:focus { top: 12px; }
.wrap { width: min(1080px, 100% - 40px); margin-inline: auto; }
header.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; padding-block: 22px; }
.brand { display: flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; }
.brand svg { width: 40px; height: 40px; flex: none; }
.brand span { font: 700 1.15rem/1 var(--display); letter-spacing: .04em; }
.theme { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .9rem; }
.theme select { min-height: 44px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--edge-hi); background: var(--bg); color: var(--text); font: inherit; }
.hero { text-align: center; padding: clamp(28px, 7vw, 72px) 0 clamp(28px, 5vw, 48px); }
.eyebrow { display: inline-block; font-size: .8rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin-bottom: 14px; }
.hero h1 { font: 700 clamp(2.3rem, 6.4vw, 4.2rem)/1.05 var(--display); letter-spacing: .02em; margin: 0 0 18px; }
.hero p { max-width: 36rem; margin: 0 auto; color: var(--muted); font-size: 1.1rem; }
.games { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; padding-bottom: 56px; }
.games:focus { outline: none; }
.card { position: relative; display: flex; flex-direction: column; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--edge); box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); overflow: hidden; transition: transform .25s var(--ease), border-color .25s var(--ease); }
.card:hover { transform: translateY(-3px); border-color: var(--edge-hi); }
.art { aspect-ratio: 16 / 9; display: grid; place-items: center; border-bottom: 1px solid var(--edge); }
.art svg { width: min(62%, 240px); height: auto; }
.art.flg { background: linear-gradient(135deg, #2A1B6E, #5B3CC4 55%, #1F5FAD); }
.art.ntn { background: linear-gradient(135deg, #0B3B4A, #0E7490 55%, #1E40AF); }
:root[data-theme="contrast"] .art { background: #000; }
.body { display: flex; flex-direction: column; gap: 12px; padding: 24px 24px 26px; flex: 1; }
.tag { font-size: .78rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.card h2 { font: 700 1.55rem/1.15 var(--display); margin: 0; }
.card p, .card ul { margin: 0; color: var(--muted); }
.card ul { padding-left: 1.15em; }
.play { margin-top: auto; align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 22px; border-radius: 999px;
  background: var(--accent); color: var(--on-accent); font-weight: 700; text-decoration: none; transition: background .2s var(--ease); }
.play:hover { background: var(--accent-hi); }
.play svg { width: 18px; height: 18px; }
.play::after { content: ""; position: absolute; inset: 0; border-radius: var(--radius); }
footer { border-top: 1px solid var(--edge); padding: 26px 0 40px; color: var(--muted); font-size: .9rem; }
footer .wrap { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 24px; }
footer a { color: inherit; }
[data-hero-align="left"] .hero { text-align: left; } [data-hero-align="left"] .hero p { margin-inline: 0; }
[data-hero-eyebrow="hide"] .eyebrow, [data-theme-picker="hide"] .theme, [data-footer-links="hide"] .footer-links, [data-card-bullets="hide"] .points { display: none; }
[data-card-order="ntn"] .card[data-game="ntn"] { order: -1; }
[data-card-layout="stack"] .games { grid-template-columns: minmax(0, 1fr); max-width: 640px; margin-inline: auto; }
[data-card-style="solid"] .card { background: var(--bg); -webkit-backdrop-filter: none; backdrop-filter: none; }
[data-card-style="outline"] .card { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; border-color: var(--edge-hi); }
[data-shadows="none"] .card { box-shadow: none; } [data-shadows="strong"] .card { box-shadow: 0 30px 60px -24px rgb(20 16 60 / .55); }
.card { border-radius: var(--radius); } .play::after { border-radius: var(--radius); }
[data-fx-hover="none"] .card:hover, [data-fx-hover="tilt"] .card:hover { transform: none; }
[data-fx-hover="tilt"] .card { transform: perspective(700px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform .15s ease-out, border-color .25s var(--ease); }
[data-fx-hover="spotlight"] .card::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .2s; background: radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), rgb(255 212 0 / .28), transparent 60%); }
[data-fx-hover="spotlight"] .card:hover::after { opacity: 1; }
[data-fx-arrival="rise"] .hero, [data-fx-arrival="rise"] .card { animation: tlg-rise .7s var(--ease) both; }
[data-fx-arrival="rise"] .card:nth-child(2) { animation-delay: .15s; }
[data-fx-arrival="fade"] .hero, [data-fx-arrival="fade"] .games { animation: tlg-fade .8s ease-out both; }
@keyframes tlg-rise { from { opacity: 0; transform: translateY(18px); } }
@keyframes tlg-fade { from { opacity: 0; } }
.art .mk { transition: opacity .25s; }
[data-fx-art="solve"] .art .mk { opacity: 0; }
[data-fx-art="solve"] .card:hover .art .mk, [data-fx-art="solve"] .card:focus-within .art .mk { opacity: 1; }
[data-fx-art="solve"] .card .art .mk:nth-child(2) { transition-delay: .1s; } [data-fx-art="solve"] .card .art .mk:nth-child(3) { transition-delay: .2s; } [data-fx-art="solve"] .card .art .mk:nth-child(4) { transition-delay: .3s; }
[data-fx-backdrop="plain"] body { background: var(--page); }
[data-fx-backdrop="glow"] body { background: radial-gradient(900px 500px at 12% -10%, rgb(124 92 255 / var(--glow-a)), transparent 60%), radial-gradient(800px 520px at 100% 10%, rgb(34 184 207 / var(--glow-a)), transparent 60%), var(--page); }
[data-fx-backdrop="drift"] body { animation: tlg-drift 14s linear infinite; }
@keyframes tlg-drift { to { background-position: 0 0, 0 0, 32px 32px, 32px 32px, 0 0; } }
.sparkles { display: none; position: fixed; inset: 0; pointer-events: none; z-index: 0; }
.sparkles svg { position: absolute; width: 12px; height: 12px; opacity: 0; animation: tlg-twinkle 3.4s ease-in-out infinite; }
[data-fx-sparkles="on"] .sparkles { display: block; }
@keyframes tlg-twinkle { 0%, 100% { opacity: 0; transform: scale(.4); } 50% { opacity: .9; transform: scale(1); } }
.wrap, footer { position: relative; z-index: 1; }
.top-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.hdr-btn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--edge-hi); background: var(--bg); color: var(--text); font-weight: 700; text-decoration: none; }
.hdr-btn:hover { border-color: var(--accent); color: var(--accent); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.app { padding: 8px 0 56px; }
.app h2 { font: 700 clamp(1.5rem, 3.6vw, 2rem)/1.15 var(--display); margin: 0 0 8px; }
.app-lead { color: var(--muted); margin: 0 0 20px; max-width: 40rem; }
.app-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.app-item { display: flex; flex-direction: column; gap: 4px; min-height: 44px; padding: 16px 18px; border-radius: calc(var(--radius) * .7); background: var(--surface); border: 1px solid var(--edge); color: var(--text); text-decoration: none; font: inherit; text-align: left; cursor: pointer;
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); transition: border-color .2s var(--ease); }
.app-item:hover { border-color: var(--accent); }
.app-item b { font-size: 1.05rem; }
.app-item span { color: var(--muted); font-size: .92rem; }
.app-item[hidden] { display: none; }
.app-note { color: var(--muted); font-size: .9rem; margin: 14px 0 0; }
.news { margin-top: 28px; }
.news h3, .follow h3 { font-size: 1.05rem; margin: 0 0 10px; }
.news ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.news li { padding: 14px 18px; border-radius: calc(var(--radius) * .7); background: var(--surface); border: 1px solid var(--edge); }
.news li b { display: block; }
.news li p { margin: 4px 0 0; color: var(--muted); }
.follow { margin-top: 28px; }
.social { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.social-link { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 1px solid var(--edge-hi); border-radius: 50%; color: var(--text); background: var(--bg); text-decoration: none; }
.social-link:hover { border-color: var(--accent); color: var(--accent); }
[data-app-section="hide"] .app { display: none; }
.wiz-row { margin: 22px 0 0; }
[data-hero-align="left"] .wiz-row { text-align: left; }
.wiz-btn { display: inline-flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 22px; border-radius: 999px; border: 2px solid var(--accent); color: var(--text); background: var(--bg); font-weight: 700; text-decoration: none; }
.wiz-btn:hover { background: var(--accent); color: var(--on-accent); }
.wiz-btn svg { width: 20px; height: 20px; }
.wiz-pick { width: min(560px, calc(100% - 24px)); border: 1px solid var(--edge); border-radius: var(--radius); background: var(--bg); color: var(--text); padding: 22px; }
.wiz-pick::backdrop { background: rgb(0 0 0 / .55); }
.wiz-pick h2 { font: 700 1.4rem/1.2 var(--display); margin: 0 0 6px; }
.wiz-pick p { color: var(--muted); margin: 0 0 14px; }
.wiz-games { display: grid; gap: 12px; }
.wiz-game { display: flex; flex-direction: column; gap: 4px; padding: 16px; border: 2px solid var(--edge-hi); border-radius: 14px; color: var(--text); text-decoration: none; }
.wiz-game:hover, .wiz-game:focus-visible { border-color: var(--accent); }
.wiz-game span { color: var(--muted); }
.wiz-close { margin: 14px 0 0; text-align: right; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } .art .mk { opacity: 1 !important; } [data-fx-hover="tilt"] .card { transform: none; } .sparkles { display: none !important; } }`;

const card = ({ cls, art, tag, name, text, points, href, id }) => `<article class="card" data-game="${cls}" aria-labelledby="${id}">
<div class="art ${cls}">${art}</div>
<div class="body">
<span class="tag" data-design-text="${cls}Tag">${tag}</span>
<h2 id="${id}">${name}</h2>
<p data-design-text="${cls}Text">${text}</p>
<ul class="points">${points.map((p) => `<li>${p}</li>`).join('')}</ul>
<a class="play" href="${href}"><span data-design-text="${cls}Button">Play ${name}</span> ${CHEVRON}</a>
</div>
</article>`;

const themeSelect = `<label class="theme">Look <select id="theme-pick">
<option value="system">Match device</option><option value="light">Light</option><option value="dark">Dark</option><option value="contrast">High contrast</option>
</select></label>`;

// Things shared by every game. Account, Messages and Share an idea open in
// the game page, where those windows live (web/js/app.js, ?open=...); Report
// a Problem has its own page; Install and Support work right here (js/hub.js).
const APP_ITEMS = [
  ['a', 'fantastical/?open=account', 'Account and sync', 'Sign in or make a free account. Your saves, stats and settings follow you to every device and every game.'],
  ['a', 'fantastical/?open=messages', 'Messages and news', 'Notes from the team, and replies to what you sent.'],
  ['a', 'fantastical/?open=feedback', 'Share an idea', 'Tell us what would make the games better.'],
  ['a', 'report/', 'Report a Problem', 'Something not right? Tell us, with a screenshot if you like.'],
];

export function writeHubPages({ site, url, verification, tdmMeta, copyright, socialList = [], pages, updated, csp, cloud = '', socialHtml = null }) {
  const year = new Date().getUTCFullYear();
  const description = 'The Logic Grid: The Fantastical Logic Grid story logic puzzles and NINETIMESNINE number puzzles. Free to play in your browser.';
  const og = (title, desc, path) => `<link rel="canonical" href="${url(path)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url(path)}">
<meta property="og:image" content="${url('og-image.jpg')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`;
  const organization = { '@type': 'Organization', name: SITE_NAME, url: url(''), logo: { '@type': 'ImageObject', url: url('icons/icon-512.png') }, email: 'support@thelogicgrid.com', sameAs: socialList.map((s) => s.url) };
  const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: url(''), description, inLanguage: 'en', publisher: organization };
  const list = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'The Fantastical Logic Grid', url: url('fantastical/') },
    { '@type': 'ListItem', position: 2, name: 'NINETIMESNINE', url: url('ninetimesnine/') },
  ] };

  // ---------- the front page ----------
  const hub = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Logic Grid | Free logic and number puzzle games</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#1F5FAD">
${tdmMeta}
${og('The Logic Grid', description, '')}
${verification}
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<link rel="preload" href="fonts/atkinson-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/cinzel-700.woff2" as="font" type="font/woff2" crossorigin>
<script src="js/hub.js" data-hub${cloud ? ` data-cloud="${esc(cloud)}"` : ''}></script>
<script type="module" src="js/page-visit.js"></script>
<script type="application/ld+json">${json(website)}</script>
<script type="application/ld+json">${json(list)}</script>
<style>${HUB_CSS}</style>
</head>
<body>
<a class="skip" href="#games">Skip to the games</a>
<div class="sparkles" aria-hidden="true">${[[8, 14], [88, 20], [52, 92], [22, 70], [76, 62]].map(([x, y], i) => `<svg style="left:${x}%;top:${y}%;animation-delay:${i * 0.7}s" viewBox="0 0 10 10"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="${['#F2B600', '#7C5CFF', '#22B8CF'][i % 3]}"/></svg>`).join('')}</div>
<div class="wrap">
<header class="top">
<a class="brand" href="./" aria-label="The Logic Grid home">${LOGO}<span>The Logic Grid</span></a>
<div class="top-actions">
<a class="hdr-btn" href="fantastical/?open=account">Account</a>
${themeSelect}
</div>
</header>
<section class="hero" aria-labelledby="hero-title">
<span class="eyebrow" data-design-text="heroEyebrow">Puzzle games</span>
<h1 id="hero-title" data-design-text="heroTitle">Pick your puzzle.</h1>
<p data-design-text="heroText">Two logic games, free to play in your browser. No guessing needed in either one — every puzzle can be solved by reasoning alone.</p>
<p class="wiz-row"><a class="wiz-btn" href="wizard/" id="wizard-open" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19 19 5M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM6 3l.7 1.3L8 5l-1.3.7L6 7l-.7-1.3L4 5l1.3-.7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> <span data-design-text="wizardButton">Puzzle Wizard: make your own puzzle</span></a></p>
</section>
<dialog class="wiz-pick" id="wizard-pick" aria-labelledby="wizard-pick-h">
<h2 id="wizard-pick-h">Which puzzle would you like to make?</h2>
<p>The wizard asks only what that puzzle needs, step by step, and checks it has exactly one answer.</p>
<div class="wiz-games">
<a class="wiz-game" href="wizard/?game=fantastical"><b>The Fantastical Logic Grid</b><span>A story logic puzzle: your characters, your lists, your answer.</span></a>
<a class="wiz-game" href="wizard/?game=ninetimesnine"><b>NINETIMESNINE</b><span>A number puzzle: your story and your own starting numbers.</span></a>
</div>
<p class="wiz-close"><button type="button" class="hdr-btn" id="wizard-cancel">Not now</button></p>
</dialog>
<main id="games" class="games" tabindex="-1" aria-label="Games">
${card({ cls: 'flg', art: ART_GRID, tag: 'Story logic puzzles', name: 'The Fantastical Logic Grid', id: 'g1', href: 'fantastical/',
    text: 'Read the clues, mark the grid, and work out who did what. Every puzzle tells a story.',
    points: ['Choose a difficulty, a theme and a grid size', 'Save, resume and print your puzzles', 'A new daily puzzle every day'] })}
${card({ cls: 'ntn', art: ART_NINE, tag: 'Number puzzles', name: 'NINETIMESNINE', id: 'g2', href: 'ninetimesnine/',
    text: 'Fill the grid so every row, column and box holds each number once. Start small at 4×4 or go for the full 9×9.',
    points: ['Classic play plus Rival Grid, Chain Reaction, Tidewater and Glyph Quest', 'Notes, step-by-step hints, undo and redo', 'Rules and a worked example for every style'] })}
</main>
<section class="app" id="app" aria-labelledby="app-title">
<h2 id="app-title" data-design-text="appTitle">One account for every game</h2>
<p class="app-lead" data-design-text="appText">Sign in once and your saves, stats and settings stay in step in every game, on every device.</p>
<div class="app-grid">
${APP_ITEMS.map(([, href, name, text]) => `<a class="app-item" href="${href}"><b>${name}</b><span>${text}</span></a>`).join('\n')}
<button class="app-item" type="button" id="install-app" hidden><b>Install the app</b><span>Every game on your home screen or desktop, and they work offline.</span></button>
<a class="app-item" id="support-app" href="#" target="_blank" rel="noopener" hidden><b>Support The Logic Grid</b><span>Every game stays free. A tip helps make more. (Opens in a new tab.)</span></a>
</div>
<p class="app-note" id="install-ios" hidden>To install on iPhone or iPad: tap the Share button in Safari, then Add to Home Screen.</p>
<div class="news" id="hub-news" hidden><h3>News from The Logic Grid</h3><ul id="hub-news-list"></ul></div>
${socialList.length && socialHtml ? `<div class="follow"><h3>Follow The Logic Grid</h3>${socialHtml(socialList).replace('aria-label="Follow The Fantastical Logic Grid"', 'aria-label="Follow The Logic Grid"')}</div>` : ''}
</section>
</div>
<footer>
<div class="wrap">
<span>${esc(copyright)}</span>
<span><span class="footer-links"><a href="privacy/">Privacy</a> · <a href="terms/">Terms of use</a> · <a href="report/">Report a Problem</a> · </span><span data-design-text="footerNote">Questions? support@thelogicgrid.com</span></span>
</div>
</footer>
</body>
</html>
`;
  writeFileSync(join(site, 'index.html'), hub);
  pages.unshift({ path: '', lastmod: updated, priority: 1 });

  // ---------- NINETIMESNINE ----------
  // The game page's own security policy (it reaches the game's Worker for
  // settings and shared play data), with no inline scripts at all.
  const game = readFileSync(join(site, 'fantastical', 'index.html'), 'utf8');
  const gameCsp = (game.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
  if (!gameCsp) throw new Error('hub.mjs: the game page has no security policy to copy');
  const npCsp = gameCsp.replace(/script-src [^;]*/, "script-src 'self'");
  const npDescription = 'Free number puzzles: fill the grid so every row, column and box holds each number once. Classic, Rival Grid, Chain Reaction, Tidewater and Glyph Quest.';
  const npGame = { '@context': 'https://schema.org', '@type': ['VideoGame', 'WebApplication'], name: 'NINETIMESNINE', url: url('ninetimesnine/'), description: npDescription, image: url('icons/icon-512.png'),
    inLanguage: 'en', genre: ['Puzzle', 'Number puzzle'], gamePlatform: ['Web browser'], applicationCategory: 'GameApplication', operatingSystem: 'Any (web browser)',
    browserRequirements: 'Requires JavaScript', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: organization };
  const np = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${npCsp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>NINETIMESNINE | Free number puzzles | The Logic Grid</title>
<meta name="description" content="${esc(npDescription)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#1F5FAD">
${tdmMeta}
${og('NINETIMESNINE', npDescription, 'ninetimesnine/')}
<link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../icons/icon-192.png">
<link rel="preload" href="../fonts/atkinson-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../fonts/atkinson-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../app.css">
<link rel="stylesheet" href="../modules/number-place/ui.css">
<script src="../js/hub.js"></script>
<script type="module" src="../js/np-page.js"></script>
<script type="application/ld+json">${json(npGame)}</script>
<style>
.np-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 14px max(16px, env(safe-area-inset-right, 0px)) 14px max(16px, env(safe-area-inset-left, 0px)); border-bottom: 1px solid var(--hairline); background: var(--surface-2); }
.np-top .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font: 700 1.05rem/1 var(--display); letter-spacing: .03em; }
.np-top .brand svg { width: 34px; height: 34px; }
.np-top nav { display: flex; flex-wrap: wrap; gap: 8px; }
.np-top a { text-decoration: none; }
[data-np-header="accent"] .np-top { background: var(--accent); border-color: transparent; }
[data-np-header="accent"] .np-top .brand { color: var(--on-accent); }
[data-np-header="accent"] .np-top .btn { color: var(--on-accent); border-color: currentColor; background: transparent; }
[data-np-flg="hide"] .np-top a[href$="fantastical/"] { display: none; }
main.screen { padding-top: 24px; }
.np-foot { padding: 20px max(16px, env(safe-area-inset-left, 0px)) 32px; border-top: 1px solid var(--hairline); color: var(--muted); font-size: .9rem; text-align: center; }
.np-foot nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 6px; }
.np-foot a { color: inherit; display: inline-flex; align-items: center; min-height: 44px; }
.np-foot p { margin: 4px 0 0; }
</style>
</head>
<body>
<header class="np-top">
<a class="brand" href="../">${LOGO}<span>The Logic Grid</span></a>
<nav aria-label="Games"><a class="btn quiet small" href="../">‹ All games</a><a class="btn small" href="../wizard/?game=ninetimesnine">Make a puzzle</a><a class="btn small" href="../fantastical/">The Fantastical Logic Grid</a></nav>
</header>
<main id="screen-np" class="screen" tabindex="-1">
<h1 class="sr-only">NINETIMESNINE</h1>
<div id="np-root"><p class="muted" id="np-loading">Loading NINETIMESNINE…</p></div>
<noscript><div class="card"><p><strong>NINETIMESNINE</strong> is a free number puzzle game. Turn on JavaScript to play.</p></div></noscript>
</main>
<footer class="np-foot">
<nav aria-label="The Logic Grid"><a href="../fantastical/?open=account">Account and sync</a> · <a href="../fantastical/?open=feedback">Share an idea</a> · <a href="../report/">Report a Problem</a> · <a href="../privacy/">Privacy</a> · <a href="../terms/">Terms of use</a></nav>
<p>${esc(copyright)}</p>
</footer>
</body>
</html>
`;
  mkdirSync(join(site, 'ninetimesnine'), { recursive: true });
  writeFileSync(join(site, 'ninetimesnine', 'index.html'), np);
  pages.push({ path: 'ninetimesnine/', lastmod: updated, priority: 0.9 });
}
