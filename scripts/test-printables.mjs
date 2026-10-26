// The website's printable worksheets (scripts/seo.mjs): one page per level,
// each with a story, clues, a blank staircase grid and the answer key on its
// own printed page. Run after `npm run build`.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'site');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const index = readFileSync(join(site, 'printables', 'index.html'), 'utf8');
const levels = ['basic', 'easy', 'medium', 'hard'];
assert(levels.every((l) => index.includes(`printables/${l}/`)), 'the printables page links a worksheet for each level');
const titles = new Set();
for (const l of levels) {
  const html = readFileSync(join(site, 'printables', l, 'index.html'), 'utf8');
  const cells = (html.match(/<td( class="l")?><\/td>/g) || []).length;
  const [k, n] = { basic: [3, 3], easy: [3, 4], medium: [4, 4], hard: [4, 5] }[l];
  assert(cells === (k * (k - 1) / 2) * n * n, `${l}: the blank grid has ${cells} cells`);
  assert(/<ol class="clues">/.test(html) && /class="key"/.test(html), `${l}: clues and an answer key`);
  titles.add((html.match(/<h1>([^<]+)<\/h1>/) || [])[1]);
}
assert(titles.size === levels.length, 'each level has its own story');
const sitemap = readFileSync(join(site, 'sitemap.xml'), 'utf8');
assert(sitemap.includes('/printables/'), 'the printables are in the sitemap');
const daily = readdirSync(join(site, 'daily', 'puzzles')).map((f) => JSON.parse(readFileSync(join(site, 'daily', 'puzzles', f), 'utf8')).puzzle.title);
assert(![...titles].some((t) => daily.includes(t)), 'worksheet stories are not the daily puzzles');
