// The Book maker: the admin dashboard's Books page (admin/books.js) shows this
// page of the website in a hidden frame and asks it for puzzles to print.
// Every game's puzzles are made the same way the game makes them (gameLink:
// the background worker, or the private puzzle server in server mode) and
// drawn by the game's own print layout, so a book page looks exactly like the
// game's own printout. Nothing is saved here.
//
// Messages (only from the dashboard's own address, the game's Worker):
//   { type: 'flg-book-games' }                       -> { type: 'flg-book-games', games }
//   { type: 'flg-book-make', req, game, difficulty, size, theme, count, avoid, usedStories, seed }
//        -> { type: 'flg-book-progress', req, done, count } while it works
//        -> { type: 'flg-book-made', req, items, css } or { type: 'flg-book-error', req, message }
//   { type: 'flg-book-show', req, html, css }   draw a finished book (or cover) on this page, every
//        page's contents shrunk to fit its page -> { type: 'flg-book-shown', req, pages }
//   { type: 'flg-book-print' }                  print what is shown (Save as PDF for the print file)
// Each item: { fp, game, gameName, title, level, size, story, rules, page, key, text }.
// page and key are HTML for the puzzle and its answer key; css (per game) is
// already scoped to .bk-g-<game>, so games never restyle each other.
import { CLOUD } from './cloud-config.js';
import { gameLink } from './engine-links.js';
import { OPTIONS } from '../engine/options.js';
import { buildPrint } from './print.js';
import { hashString } from '../engine/rng.js';

let admin = '';
try { admin = new URL(CLOUD.learnUrl || CLOUD.syncUrl).origin; } catch (e) { /* no Worker address */ }
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const trusted = (origin) => origin === admin || (local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

// The grid-kit games: their own print layout lives in the game's definition.
const KIT = [
  { id: 'cm', dir: 'cage-math', name: 'Cage Math' },
  { id: 'sc', dir: 'sum-cross', name: 'Sum Cross' },
  { id: 'pg', dir: 'picture-grid', name: 'Picture Grid' },
  { id: 'ml', dir: 'more-or-less', name: 'More or Less' },
  { id: 'sk', dir: 'skyline', name: 'Skyline' },
  { id: 'sf', dir: 'star-field', name: 'Star Field' },
  { id: 'll', dir: 'loop-line', name: 'Loop Line' },
  { id: 'ib', dir: 'island-bridges', name: 'Island Bridges' },
  { id: 'cw', dir: 'crossword', name: 'Crossword' },
];
const NP_LEVELS = [
  { id: 'basic', name: 'Basic', sizes: [4, 6] }, { id: 'easy', name: 'Easy', sizes: [6, 9] }, { id: 'medium', name: 'Medium', sizes: [9, 6] },
  { id: 'hard', name: 'Hard', sizes: [9] }, { id: 'expert', name: 'Expert', sizes: [9] }, { id: 'master', name: 'Master', sizes: [9] },
];
const themes = () => [{ id: 'surprise', name: 'Surprise me' }, ...OPTIONS.themes.map((t) => ({ id: t.id, name: t.name }))];

const defs = {};
async function kitDef(g) {
  if (!defs[g.id]) defs[g.id] = (await import(`../modules/${g.dir}/game.js`)).def;
  return defs[g.id];
}

// ---------- each game's printout, split into its puzzle and its answer key ----------

// The game's print document -> its style and its page sections.
function partsOf(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const sections = [...doc.body.querySelectorAll(':scope > section')];
  return { css, sections };
}
const isKey = (s) => /answer key/i.test(s.querySelector('h1, h2')?.textContent || '');

// Scope a game's print CSS to its own box: no @page, @media print unwrapped,
// body rules onto the box, every other selector inside it.
export function scopeCss(css, scope) {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@page\s*[^{]*\{[^}]*\}/g, '');
  // Unwrap @media print { ... } (one level of braces inside).
  text = text.replace(/@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g, '$1');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    const scoped = sel.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      if (/^(html|body|:root)$/.test(s)) return scope;
      if (/^(\*)$/.test(s)) return `${scope} *`;
      return `${scope} ${s.replace(/^body\s+/, '')}`;
    }).join(', ');
    // Page breaks belong to the book, not to a game's own printout.
    const body = m[2].split(';').map((d) => d.trim()).filter((d) => d && !/^(page-)?break-(after|before)\s*:/i.test(d)).join('; ');
    if (body) out.push(`${scoped} { ${body} }`);
  }
  return out.join('\n');
}

let flgCss = null;
// The Logic Grid's print rules from the site's stylesheet (app.css, its
// @media print block), read through the browser's own CSS parser so it works
// on the built, minified file too.
async function flgPrintCss() {
  if (flgCss != null) return flgCss;
  const text = await (await fetch(new URL('../app.css', import.meta.url))).text();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text.replace(/@import[^;]*;/g, ''));
  const out = [];
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSMediaRule) || !/print/.test(rule.conditionText || rule.media?.mediaText || '')) continue;
    for (const r of rule.cssRules) {
      const sel = r.selectorText || '';
      if (!sel || /print-root|^body\b/.test(sel)) continue;
      if (/\.pp\b|table\.pg|table\.ptab|\.psteps|\.pcover|\.po\b/.test(sel)) out.push(r.cssText);
    }
  }
  flgCss = out.join('\n');
  return flgCss;
}

const FLG_RULES = [
  'Read the story, then use the clues to work out who goes with what.',
  'Mark a cell with an O when two things go together, and with an X when they do not.',
  'Each item goes with exactly one item in every other category.',
  'Every puzzle has exactly one answer and can be solved by logic alone, with no guessing.',
];
const plainText = (el) => el.textContent.replace(/\s+/g, ' ').trim();

// ---------- the games ----------

const GAMES = {
  flg: {
    name: 'The Fantastical Logic Grid',
    levels: () => OPTIONS.difficulties.map((d) => ({ id: d.id, name: d.name, sizes: [] })),
    themes: true,
    async make({ difficulty, theme, seed, usedStories }) {
      return gameLink('flg').call('generate', { difficulty, theme: theme && theme !== 'surprise' ? theme : 'random', seed, usedStories });
    },
    fp: (p) => `flg:${hashString(JSON.stringify([p.title, p.clues.map((c) => c.text)])).toString(36)}`,
    async render(p) {
      const html = buildPrint(p, { answerKey: true, paper: 'letter' });
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
      const sections = [...doc.body.querySelectorAll('section')];
      return { css: await flgPrintCss(), sections };
    },
    meta: (p) => ({ title: p.title, level: p.difficulty.name, size: `${p.categories.length} × ${p.categories[0]?.items.length || ''}`, story: p.story?.id || '' }),
  },
  np: {
    name: 'NINETIMESNINE',
    levels: () => NP_LEVELS,
    // NINETIMESNINE tells its own stories (engine/number-place-story.js).
    themes: async () => {
      try { return [{ id: 'surprise', name: 'Surprise me' }, ...(await import('../engine/number-place-story.js')).NP_STORY_THEMES.map((t) => ({ id: t.id, name: t.name }))]; } catch (e) { return [{ id: 'surprise', name: 'Surprise me' }]; }
    },
    async make({ difficulty, size, theme, seed, usedStories, avoid }) {
      return gameLink('np').call('generate', { difficulty, size, theme: theme && theme !== 'surprise' ? theme : null, seed, usedStories, avoid, story: true, toughness: 0.5 });
    },
    fp: (p) => p.fingerprint || `np:${hashString(p.givens.join('')).toString(36)}`,
    async render(p) {
      const { printableHtml } = await import('../modules/number-place/print.js');
      return partsOf(printableHtml({ p, v: [], daily: null }, { answers: true }));
    },
    meta: (p) => ({ title: p.story?.title || 'NINETIMESNINE', level: p.difficulty.name, size: `${p.size}×${p.size}`, story: p.story?.id || '' }),
  },
};
for (const g of KIT) {
  GAMES[g.id] = {
    name: g.name,
    levels: async () => (await kitDef(g)).levels.map((l) => ({ id: l.id, name: l.name, sizes: l.sizes })),
    themes: true,
    async make({ difficulty, size, theme, seed, usedStories, avoid }) {
      return gameLink(g.id).call('generate', { difficulty, size, theme, seed, usedStories, usedPictures: [], avoid, story: true, toughness: 0.5 });
    },
    fp: (p) => p.fingerprint || `${g.id}:${hashString(JSON.stringify(p.solution)).toString(36)}`,
    async render(p) {
      const def = await kitDef(g);
      const { printableHtml } = await import('../modules/grid-kit/print.js');
      return partsOf(printableHtml({ p, v: [], daily: null }, def, { answers: true }));
    },
    meta: (p, def) => ({ title: p.story?.title && !p.picture ? p.story.title : g.name, level: p.difficulty.name, size: def ? def.sizeLabel(p.size) : String(p.size), story: p.story?.id || '' }),
  };
}

async function gameList() {
  const out = [];
  for (const [id, g] of Object.entries(GAMES)) out.push({ id, name: g.name, levels: await g.levels(), themes: typeof g.themes === 'function' ? await g.themes() : g.themes ? themes() : [] });
  return out;
}

async function make(m, reply) {
  const g = GAMES[m.game];
  if (!g) throw new Error('That game is not on this site.');
  const count = Math.max(1, Math.min(200, Number(m.count) || 1));
  const avoid = new Set(Array.isArray(m.avoid) ? m.avoid : []);
  const usedStories = Array.isArray(m.usedStories) ? m.usedStories.slice(-500) : [];
  const items = [];
  let css = '';
  const kit = KIT.find((k) => k.id === m.game);
  const def = kit ? await kitDef(kit) : null;
  for (let tries = 0; items.length < count && tries < count * 4; tries++) {
    const seed = `${m.seed || 'book'}-${m.game}-${items.length}-${tries}`;
    const p = await g.make({ difficulty: m.difficulty, size: Number(m.size) || undefined, theme: m.theme || 'surprise', seed, usedStories, avoid: [...avoid] });
    const fp0 = String(g.fp(p));
    const fp = fp0.startsWith(`${m.game}:`) ? fp0 : `${m.game}:${fp0}`;
    if (avoid.has(fp)) continue;
    avoid.add(fp);
    const info = g.meta(p, def);
    if (info.story) usedStories.push(info.story);
    const parts = await g.render(p);
    if (!css) css = scopeCss(parts.css, `.bk-g-${m.game}`);
    const keys = parts.sections.filter(isKey), pages = parts.sections.filter((s) => !isKey(s) && !/step by step/i.test(s.querySelector('h1, h2')?.textContent || ''));
    items.push({
      fp, game: m.game, gameName: g.name, ...info,
      rules: Array.isArray(p.rules) && p.rules.length ? p.rules.slice(0, 8).map(String) : FLG_RULES,
      // Each part keeps its own section's class (the game's styles may need it).
      page: pages.map((s) => `<div class="${s.className}">${s.innerHTML}</div>`).join('<div class="bk-break"></div>'),
      key: keys.map((s) => `<div class="${s.className}">${s.innerHTML}</div>`).join(''),
      // Every word printed, for the trademark and copyright scan.
      text: pages.map(plainText).join(' ').slice(0, 6000),
    });
    reply({ type: 'flg-book-progress', req: m.req, done: items.length, count });
  }
  if (items.length < count) throw new Error(`Only ${items.length} new ${g.name} puzzles could be made with those choices. Try another level, size or theme.`);
  return { items, css };
}

// ---------- showing and printing a finished book ----------

// Shrink each page's contents so they fit the page (books use smaller pages
// than the games' own Letter printouts). Returns the number of pages.
function fitPages() {
  const pages = [...document.querySelectorAll('.bk-page')];
  for (const page of pages) {
    for (const box of page.querySelectorAll('.bk-fit')) {
      const room = box.parentElement;
      box.style.zoom = '1';
      const availW = room.clientWidth, availH = room.clientHeight - (box.getBoundingClientRect().top - room.getBoundingClientRect().top);
      if (!availW || availH <= 0) continue; // not laid out (a hidden frame)
      // Lay the contents out wider when they must shrink, so words rewrap
      // into the space the shrinking makes, then shrink to fit both ways.
      let z = 1;
      box.style.width = `${availW}px`;
      for (let k = 0; k < 3; k++) {
        const next = Math.max(0.3, Math.min(1, availW / Math.max(1, box.scrollWidth), availH / Math.max(1, box.scrollHeight)));
        if (Math.abs(next - z) < 0.01 && k) break;
        z = next;
        box.style.width = `${availW / z}px`;
      }
      // Some boards grow with the space they get: measure once more at the final width.
      z = Math.max(0.3, Math.min(z, availW / Math.max(1, box.scrollWidth), availH / Math.max(1, box.scrollHeight)));
      box.style.zoom = String(Math.floor(z * 100) / 100);
    }
  }
  return pages.length;
}
async function show(m) {
  let style = document.getElementById('book-style');
  if (!style) { style = document.createElement('style'); style.id = 'book-style'; document.head.append(style); }
  style.textContent = String(m.css || '');
  // Only the dashboard sends this (trusted above), and it only sends pages it
  // drew; still, nothing here may run: scripts, frames and event handlers are
  // dropped before the pages are shown.
  const doc = new DOMParser().parseFromString(String(m.html || ''), 'text/html');
  for (const n of doc.querySelectorAll('script, iframe, object, embed, link, meta, base')) n.remove();
  for (const n of doc.body.querySelectorAll('*')) {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    }
  }
  document.body.replaceChildren(...doc.body.childNodes);
  document.body.className = 'bk-shown';
  if (document.fonts?.ready) await document.fonts.ready;
  // A frame that is not shown never paints, so wait with a timer, not a paint.
  await new Promise((r) => setTimeout(r, 30));
  return fitPages();
}

addEventListener('message', async (e) => {
  if (!trusted(e.origin) || !e.data || typeof e.data !== 'object') return;
  const m = e.data;
  const reply = (msg) => { try { e.source.postMessage(msg, local ? '*' : admin); } catch (err) { /* frame gone */ } };
  try {
    if (m.type === 'flg-book-games') reply({ type: 'flg-book-games', games: await gameList() });
    else if (m.type === 'flg-book-make') reply({ type: 'flg-book-made', req: m.req, ...(await make(m, reply)) });
    else if (m.type === 'flg-book-show') reply({ type: 'flg-book-shown', req: m.req, pages: await show(m) });
    else if (m.type === 'flg-book-print') window.print();
  } catch (err) {
    reply({ type: 'flg-book-error', req: m.req, message: String(err?.message || err) });
  }
});
if (window.parent !== window && (admin || local)) { try { parent.postMessage({ type: 'flg-book-ready' }, local ? '*' : admin); } catch (e) { /* none */ } }
