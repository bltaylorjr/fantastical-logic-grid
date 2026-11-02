// The Logic Grid's website layout (website build only, called by seo.mjs):
//   /               The Logic Grid's front page: a card for each game, and
//                   everything shared by the games (account, messages, ideas,
//                   problems, installing, support, news, social links)
//   /fantastical/   The Fantastical Logic Grid (the game page, moved here)
//   /ninetimesnine/ NINETIMESNINE on a page of its own
//   /cage-math/, /sum-cross/, /picture-grid/  the same for each of those games
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The support address, never written out in a page: js/hub.js or
// js/site-nav.js put it together into a mailto: link only when "Contact us"
// is clicked.
export const contactLink = (text = 'Contact us') => `<a class="contact-link" href="#contact" rel="nofollow">${text}</a>`;

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
  // On the website the home page has a card for everything shared by the games
  // (account, messages, install, support, the other games), so the game's menu
  // keeps only its own things. The apps (no home page) keep the full menu.
  const shared = ['data-cmd="account"', 'data-cmd="messages"', 'data-cmd="feedback"', 'data-cmd="install"', 'id="support-link"', 'data-cmd="site"', 'data-cmd="games"', 'data-cmd="numberplace"'];
  for (const attr of shared) {
    const next = page.replace(new RegExp(`(<(?:button|a) role="menuitem"[^>]*${attr})`), '$1 data-site-hidden');
    if (next === page) throw new Error(`hub.mjs: the game menu has no ${attr} item`);
    page = next;
  }
  page = page.replace(/\s*<!-- Shared by every game[^>]*-->\s*<div class="menu-group"[^>]*>[^<]*<\/div>/, '');
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

const ART_CAGE = `<svg viewBox="0 0 240 150" aria-hidden="true" focusable="false"><g transform="translate(64 19)">
<rect width="112" height="112" rx="8" fill="rgb(255 255 255 / .08)" stroke="rgb(255 255 255 / .9)" stroke-width="2.5"/>
<path d="M28 0v112M56 0v112M84 0v112M0 28h112M0 56h112M0 84h112" stroke="rgb(255 255 255 / .3)" stroke-width="1"/>
<path d="M56 0v56H0M56 28h56M84 28v84M28 56v56M28 84h56" fill="none" stroke="#FFF" stroke-width="3.5"/>
<g fill="#FFF" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="11"><text x="4" y="13">7+</text><text x="60" y="13">2÷</text><text x="4" y="69">12×</text><text x="60" y="41">3−</text><text x="88" y="41">9+</text><text x="32" y="69">4</text></g>
<g class="mk"><rect x="28.5" y="56.5" width="27" height="27" fill="#FFD400"/><text x="42" y="76" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="15" text-anchor="middle">4</text></g></g></svg>`;

const ART_CROSS = (() => {
  const B = 22;
  const black = [[0, 0], [0, 1], [0, 4], [1, 0], [2, 3], [3, 0], [4, 0], [4, 4]];
  const nums = [[1, 2, 9], [1, 3, 8], [2, 1, 6], [2, 2, 7], [3, 3, 6], [3, 2, 4]];
  const cells = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (black.some(([a, b]) => a === r && b === c)) cells.push(`<rect x="${c * B}" y="${r * B}" width="${B}" height="${B}" fill="rgb(255 255 255 / .28)"/>`);
  return `<svg viewBox="0 0 240 150" aria-hidden="true" focusable="false"><g transform="translate(65 20)">
<rect width="110" height="110" rx="6" fill="rgb(255 255 255 / .08)" stroke="rgb(255 255 255 / .9)" stroke-width="2.5"/>${cells.join('')}
<path d="${[1, 2, 3, 4].map((i) => `M${i * B} 0v110M0 ${i * B}h110`).join('')}" stroke="rgb(255 255 255 / .7)" stroke-width="1.2"/>
<path d="M0 0l22 22M22 0l22 22M0 22l22 22" stroke="rgb(255 255 255 / .7)" stroke-width="1"/>
<g fill="#FFF" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="7"><text x="28" y="18">16</text><text x="2" y="42">17</text><text x="2" y="64">15</text></g>
<g fill="#FFF" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="12" text-anchor="middle">${nums.map(([r, c, n]) => `<text x="${c * B + 11}" y="${r * B + 15}">${n}</text>`).join('')}</g>
<g class="mk"><rect x="66" y="44" width="22" height="22" fill="#FFD400"/><text x="77" y="59" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="12" text-anchor="middle">8</text></g></g></svg>`;
})();

const ART_PICTURE = (() => {
  // A small heart, shaded cell by cell, with its row counts.
  const rows = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  const S = 14;
  const fill = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') fill.push(`<rect${r > 2 ? ' class="mk"' : ''} x="${c * S + 1}" y="${r * S + 1}" width="${S - 2}" height="${S - 2}" rx="2" fill="#FFD400"/>`); }));
  const counts = rows.map((row) => row.split('.').filter(Boolean).map((x) => x.length).join(' '));
  return `<svg viewBox="0 0 240 150" aria-hidden="true" focusable="false"><g transform="translate(86 33)">
<rect width="${7 * S}" height="${6 * S}" rx="4" fill="rgb(255 255 255 / .08)" stroke="rgb(255 255 255 / .9)" stroke-width="2"/>
<path d="${[1, 2, 3, 4, 5, 6].map((i) => `M${i * S} 0v${6 * S}`).join('')}${[1, 2, 3, 4, 5].map((i) => `M0 ${i * S}h${7 * S}`).join('')}" stroke="rgb(255 255 255 / .3)" stroke-width="1"/>${fill.join('')}
<g fill="#FFF" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" font-size="8" text-anchor="end">${counts.map((t, r) => `<text x="-6" y="${r * S + 10}">${t}</text>`).join('')}</g></g></svg>`;
})();

// Every game on the website, in the order of the front page's cards. `page`
// is its folder; `video` its intro (web/media/games/<video>.mp4, .vtt, .jpg).
// The Fantastical Logic Grid's page is the game app itself (writeGamePage).
export const GAME_PAGES = [
  { id: 'fantastical', cls: 'flg', page: 'fantastical/', name: 'The Fantastical Logic Grid', tag: 'Story logic puzzles', art: ART_GRID, video: 'fantastical-logic-grid', howTo: 'how-to-play/',
    text: 'Read the clues, mark the grid, and work out who did what. Every puzzle tells a story.',
    points: ['Choose a difficulty, a theme and a grid size', 'Save, resume and print your puzzles', 'A new daily puzzle every day'] },
  { id: 'ninetimesnine', cls: 'ntn', page: 'ninetimesnine/', name: 'NINETIMESNINE', tag: 'Number puzzles', art: ART_NINE, video: 'ninetimesnine', wizard: true,
    text: 'Fill the grid so every row, column and box holds each number once. Start small at 4×4 or go for the full 9×9.',
    points: ['Classic play plus Rival Grid, Chain Reaction, Tidewater and Glyph Quest', 'Notes, step-by-step hints, undo and redo', 'Rules and a worked example for every style'],
    description: 'Free number puzzles: fill the grid so every row, column and box holds each number once. Classic, Rival Grid, Chain Reaction, Tidewater and Glyph Quest.',
    title: 'NINETIMESNINE | Free number puzzles | The Logic Grid', genre: 'Number puzzle', css: 'modules/number-place/ui.css', script: 'js/np-page.js', root: 'np' },
  { id: 'cage-math', cls: 'cm', page: 'cage-math/', name: 'Cage Math', tag: 'Number puzzles', art: ART_CAGE, video: 'cage-math',
    text: 'Fill each cage so its numbers make the target, with every number once in each row and column.',
    points: ['Add, subtract, multiply and divide, from 4×4 up to 9×9', 'Six levels, from Basic to Master', 'Hints that explain the next step'],
    description: 'Free Cage Math puzzles: fill each cage so its numbers make the target, with every number once in each row and column. Six levels, 4×4 to 9×9.',
    title: 'Cage Math | Free math logic puzzles | The Logic Grid', genre: 'Math puzzle', css: 'modules/grid-kit/kit.css', script: 'js/kit-page.js', root: 'cm' },
  { id: 'sum-cross', cls: 'sc', page: 'sum-cross/', name: 'Sum Cross', tag: 'Number puzzles', art: ART_CROSS, video: 'sum-cross',
    text: 'A crossword of numbers: every run adds up to its clue, with no number twice.',
    points: ['Grids from 5×5 up to 12×12', 'Six levels, from Basic to Master', 'Notes, hints, undo and redo'],
    description: 'Free Sum Cross puzzles: a crossword of numbers where every run across and down adds up to its clue, with no number twice. Six levels.',
    title: 'Sum Cross | Free number crossword puzzles | The Logic Grid', genre: 'Number puzzle', css: 'modules/grid-kit/kit.css', script: 'js/kit-page.js', root: 'sc' },
  { id: 'picture-grid', cls: 'pg', page: 'picture-grid/', name: 'Picture Grid', tag: 'Picture puzzles', art: ART_PICTURE, video: 'picture-grid',
    text: 'Shade the cells the row and column counts call for, and a hidden picture appears for your gallery.',
    points: ['Pictures from 5×5 up to 25×25', 'Every picture you uncover joins your gallery', 'Hints that show a line you can work on'],
    description: 'Free Picture Grid puzzles: shade the cells each row and column calls for and a hidden picture appears. Pictures from 5×5 to 25×25.',
    title: 'Picture Grid | Free picture logic puzzles | The Logic Grid', genre: 'Picture puzzle', css: 'modules/grid-kit/kit.css', script: 'js/kit-page.js', root: 'pg' },
];
// The games with a page of their own written here (every game but the app).
export const OWN_PAGES = GAME_PAGES.filter((g) => g.script);
export const howToPath = (g) => g.howTo || `${g.page}how-to-play/`;

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
.art.cm { background: linear-gradient(135deg, #4A1235, #B4235A 55%, #7C2D92); }
.art.sc { background: linear-gradient(135deg, #3B2A06, #B45309 55%, #9A3412); }
.art.pg { background: linear-gradient(135deg, #0F3D2A, #15803D 55%, #0E7490); }
:root[data-theme="contrast"] .art { background: #000; }
.body { display: flex; flex-direction: column; gap: 12px; padding: 24px 24px 26px; flex: 1; }
.tag { font-size: .78rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.card h2 { font: 700 1.55rem/1.15 var(--display); margin: 0; }
.card p, .card ul { margin: 0; color: var(--muted); }
.card ul { padding-left: 1.15em; }
.more { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; font-size: .95rem; }
.more a { color: var(--accent); font-weight: 700; position: relative; z-index: 1; display: inline-flex; align-items: center; min-height: 44px; }
.watch { padding: 0 0 56px; }
.watch h2 { font: 700 clamp(1.5rem, 3.6vw, 2rem)/1.15 var(--display); margin: 0 0 8px; }
.watch-lead { color: var(--muted); margin: 0 0 20px; max-width: 40rem; }
.watch video { display: block; width: 100%; height: auto; border-radius: calc(var(--radius) * .7); background: #000; }
.watch-main { margin: 0 0 22px; }
.watch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 18px; list-style: none; margin: 0; padding: 0; }
.watch-grid h3 { font-size: 1.05rem; margin: 10px 0 2px; }
.watch-grid p { margin: 0; color: var(--muted); font-size: .92rem; }
.watch-grid a { color: inherit; display: inline-flex; align-items: center; min-height: 44px; }
[data-watch-section="hide"] .watch { display: none; }
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
[data-fx-arrival="rise"] .card:nth-child(2) { animation-delay: .1s; } [data-fx-arrival="rise"] .card:nth-child(3) { animation-delay: .2s; } [data-fx-arrival="rise"] .card:nth-child(4) { animation-delay: .3s; } [data-fx-arrival="rise"] .card:nth-child(5) { animation-delay: .4s; }
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
dialog.ovl { position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden; }
dialog.ovl::backdrop { background: rgb(8 10 20 / .45); }
.ovl iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
.ovl-x { position: fixed; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); z-index: 2; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--edge-hi, #888); background: var(--bg, #fff); color: var(--text, #111); font: inherit; font-weight: 700; cursor: pointer; }
.ovl-wait { position: fixed; inset: 0; display: grid; place-items: center; margin: 0; color: #fff; font-weight: 700; pointer-events: none; }
.hub-note { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 5; max-width: min(90vw, 460px); padding: 12px 18px; border-radius: 12px; background: var(--text, #111); color: var(--bg, #fff); font-weight: 700; box-shadow: 0 10px 30px rgb(0 0 0 / .3); }
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

const card = ({ cls, art, tag, name, text, points, href, id, howTo }) => `<article class="card" data-game="${cls}" aria-labelledby="${id}">
<div class="art ${cls}">${art}</div>
<div class="body">
<span class="tag" data-design-text="${cls}Tag">${tag}</span>
<h2 id="${id}">${name}</h2>
<p data-design-text="${cls}Text">${text}</p>
<ul class="points">${points.map((p) => `<li>${p}</li>`).join('')}</ul>
<p class="more"><a href="${howTo}">How to play</a></p>
<a class="play" href="${href}"><span data-design-text="${cls}Button">Play ${name}</span> ${CHEVRON}</a>
</div>
</article>`;

const themeSelect = `<label class="theme">Look <select id="theme-pick">
<option value="system">Match device</option><option value="light">Light</option><option value="dark">Dark</option><option value="contrast">High contrast</option>
</select></label>`;

// Things shared by every game. Account has its own page (account/). Messages
// (the game's own window in a frame, ?open=...&embed=1, web/js/app.js) and
// Report a Problem open over the front page, which stays where it is; Submit
// Puzzle Ideas asks which game first. Only the Play buttons open a game's page.
// Install and Support work right here. The games' menus hold only their own things.
const APP_ITEMS = [
  ['a', 'account/', 'Account and sync', 'Sign in or make a free account. Your saves, stats and settings follow you to every device and every game.'],
  ['a', 'fantastical/?open=messages', 'Messages and news', 'Notes from the team, and replies to what you sent.'],
  ['a', 'wizard/', 'Submit Puzzle Ideas', 'Make your own puzzle for any game, step by step, and send it to the team.'],
  ['a', 'report/', 'Report a Problem', 'Something not right? Tell us, with a screenshot if you like.'],
];

// A video from web/media/games, if the build has it (the files are added as
// they are made, so a missing one leaves its spot out rather than a broken player).
export const hasVideo = (site, name) => existsSync(join(site, 'media', 'games', `${name}.mp4`));
export const videoTag = (site, up, name, label, preload = 'none') => `<video controls preload="${preload}" playsinline${existsSync(join(site, 'media', 'games', `${name}.jpg`)) ? ` poster="${up}media/games/${name}.jpg"` : ''} width="1280" height="720" aria-label="${esc(label)}">
<source src="${up}media/games/${name}.mp4" type="video/mp4">${existsSync(join(site, 'media', 'games', `${name}.vtt`)) ? `\n<track kind="captions" srclang="en" label="English" src="${up}media/games/${name}.vtt">` : ''}
</video>`;

export function writeHubPages({ site, url, verification, tdmMeta, copyright, socialList = [], pages, updated, csp, cloud = '', socialHtml = null }) {
  const year = new Date().getUTCFullYear();
  const description = 'The Logic Grid: free logic and number puzzle games. The Fantastical Logic Grid, NINETIMESNINE, Cage Math, Sum Cross and Picture Grid, in your browser.';
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
  const organization = { '@type': 'Organization', name: SITE_NAME, url: url(''), logo: { '@type': 'ImageObject', url: url('icons/icon-512.png') }, sameAs: socialList.map((s) => s.url) };
  const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: url(''), description, inLanguage: 'en', publisher: organization };
  const list = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: GAME_PAGES.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.name, url: url(g.page) })) };
  // The Logic Grid's introduction and each game's highlight video.
  const watchMain = hasVideo(site, 'the-logic-grid');
  const watchGames = GAME_PAGES.filter((g) => hasVideo(site, g.video));
  const watch = watchMain || watchGames.length ? `<section class="watch" id="watch" aria-labelledby="watch-title">
<h2 id="watch-title" data-design-text="watchTitle">See the games</h2>
<p class="watch-lead" data-design-text="watchText">A quick look at The Logic Grid, then a minute with each game.</p>
${watchMain ? `<div class="watch-main">${videoTag(site, '', 'the-logic-grid', 'Introducing The Logic Grid', 'metadata')}</div>` : ''}
${watchGames.length ? `<ul class="watch-grid">${watchGames.map((g) => `<li>${videoTag(site, '', g.video, `${g.name} highlights`)}<h3>${esc(g.name)}</h3><p><a href="${g.page}">Play</a> · <a href="${howToPath(g)}">How to play</a></p></li>`).join('')}</ul>` : ''}
</section>` : '';

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
<a class="hdr-btn" href="account/">Account</a>
${themeSelect}
</div>
</header>
<section class="hero" aria-labelledby="hero-title">
<span class="eyebrow" data-design-text="heroEyebrow">Puzzle games</span>
<h1 id="hero-title" data-design-text="heroTitle">Pick your puzzle.</h1>
<p data-design-text="heroText">Five puzzle games, free to play in your browser. No guessing needed in any of them — every puzzle can be solved by reasoning alone.</p>
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
${GAME_PAGES.map((g, i) => card({ ...g, id: `g${i + 1}`, href: g.page, howTo: howToPath(g) })).join('\n')}
</main>
${watch}
<section class="app" id="app" aria-labelledby="app-title">
<h2 id="app-title" data-design-text="appTitle">One account for every game</h2>
<p class="app-lead" data-design-text="appText">Sign in once and your saves, stats and settings stay in step in every game, on every device.</p>
<div class="app-grid">
${APP_ITEMS.map(([, href, name, text]) => `<a class="app-item" href="${href}"${href === 'wizard/' ? ' data-wizard aria-haspopup="dialog"' : href === 'account/' ? '' : ' data-overlay aria-haspopup="dialog"'}><b>${name}</b><span>${text}</span></a>`).join('\n')}
<button class="app-item" type="button" id="install-app" hidden><b>Install the app</b><span>Every game on your home screen or desktop, and they work offline.</span></button>
<a class="app-item" id="support-app" href="#" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer" hidden><b>Support The Logic Grid</b><span>Every game stays free. A tip helps make more. (Opens in a new tab.)</span></a>
</div>
<p class="app-note" id="install-ios" hidden>To install on iPhone or iPad: tap the Share button in Safari, then Add to Home Screen.</p>
<div class="news" id="hub-news" hidden><h3>News from The Logic Grid</h3><ul id="hub-news-list"></ul></div>
${socialList.length && socialHtml ? `<div class="follow"><h3>Follow The Logic Grid</h3>${socialHtml(socialList).replace('aria-label="Follow The Fantastical Logic Grid"', 'aria-label="Follow The Logic Grid"')}</div>` : ''}
</section>
</div>
<footer>
<div class="wrap">
<span>${esc(copyright)}</span>
<span><span class="footer-links"><a href="privacy/">Privacy</a> · <a href="terms/">Terms of use</a> · <a href="report/" data-overlay aria-haspopup="dialog">Report a Problem</a> · </span><span data-design-text="footerNote">Questions?</span> ${contactLink()}</span>
</div>
</footer>
</body>
</html>
`;
  writeFileSync(join(site, 'index.html'), hub.replace("frame-src 'none'", "frame-src 'self'"));
  pages.unshift({ path: '', lastmod: updated, priority: 1 });

  // ---------- each game's own page (NINETIMESNINE, Cage Math, Sum Cross, Picture Grid) ----------
  // The game page's own security policy (it reaches the game's Worker for
  // settings and shared play data), with no inline scripts at all.
  const game = readFileSync(join(site, 'fantastical', 'index.html'), 'utf8');
  const gameCsp = (game.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
  if (!gameCsp) throw new Error('hub.mjs: the game page has no security policy to copy');
  const npCsp = gameCsp.replace(/script-src [^;]*/, "script-src 'self'").replace("frame-src 'none'", "frame-src 'self'");
  for (const g of OWN_PAGES) {
  const npDescription = g.description;
  const npGame = { '@context': 'https://schema.org', '@type': ['VideoGame', 'WebApplication'], name: g.name, url: url(g.page), description: npDescription, image: url('icons/icon-512.png'),
    inLanguage: 'en', genre: ['Puzzle', g.genre], gamePlatform: ['Web browser'], applicationCategory: 'GameApplication', operatingSystem: 'Any (web browser)',
    browserRequirements: 'Requires JavaScript', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: organization };
  const kit = g.root !== 'np';
  const np = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${npCsp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(g.title)}</title>
<meta name="description" content="${esc(npDescription)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#1F5FAD">
${tdmMeta}
${og(g.name, npDescription, g.page)}
<link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../icons/icon-192.png">
<link rel="preload" href="../fonts/atkinson-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../fonts/atkinson-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../app.css">
<link rel="stylesheet" href="../${g.css}"${kit ? ' id="gk-css"' : ''}>
<script src="../js/hub.js"></script>
<script type="module" src="../${g.script}"></script>
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
dialog.ovl { position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden; }
dialog.ovl::backdrop { background: rgb(8 10 20 / .45); }
.ovl iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
.ovl-x { position: fixed; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); z-index: 2; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--edge-hi, #888); background: var(--bg, #fff); color: var(--text, #111); font: inherit; font-weight: 700; cursor: pointer; }
.ovl-wait { position: fixed; inset: 0; display: grid; place-items: center; margin: 0; color: #fff; font-weight: 700; pointer-events: none; }
.hub-note { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 5; max-width: min(90vw, 460px); padding: 12px 18px; border-radius: 12px; background: var(--text, #111); color: var(--bg, #fff); font-weight: 700; box-shadow: 0 10px 30px rgb(0 0 0 / .3); }
</style>
</head>
<body>
<header class="np-top">
<a class="brand" href="../">${LOGO}<span>The Logic Grid</span></a>
<nav aria-label="Games"><a class="btn quiet small" href="../">‹ The Logic Grid home</a><a class="btn quiet small" href="how-to-play/">How to play</a>${g.wizard ? `<a class="btn small" href="../wizard/?game=${g.id}">Submit Puzzle Ideas</a>` : ''}</nav>
</header>
<main id="screen-${g.root}" class="screen" tabindex="-1"${kit ? ` data-kit-game="${g.id}"` : ''}>
<h1 class="sr-only">${esc(g.name)}</h1>
<div id="${g.root}-root"><p class="muted"${kit ? '' : ' id="np-loading"'}>Loading ${esc(g.name)}…</p></div>
<noscript><div class="card"><p><strong>${esc(g.name)}</strong> is a free ${esc(g.genre.toLowerCase())} game. Turn on JavaScript to play. <a href="how-to-play/">How to play</a></p></div></noscript>
</main>
<footer class="np-foot">
<nav aria-label="The Logic Grid"><a href="../">The Logic Grid home</a> · <a href="how-to-play/">How to play ${esc(g.name)}</a> · <a href="../privacy/">Privacy</a> · <a href="../terms/">Terms of use</a> · ${contactLink()}</nav>
<p>${esc(copyright)}</p>
</footer>
</body>
</html>
`;
  mkdirSync(join(site, g.page), { recursive: true });
  writeFileSync(join(site, g.page, 'index.html'), np);
  pages.push({ path: g.page, lastmod: updated, priority: 0.9 });
  }
}
