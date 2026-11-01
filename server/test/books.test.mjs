// Book publishing: the books database's reuse guard and scan (src/books.js),
// and the print layout it shares with the admin page (admin/book-layout.js).
// The full page is checked in a browser by scripts/e2e-books.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reuse, placeFindings, puzzleFields } from '../src/books.js';
import { watchListFindings } from '../src/ip-scan.js';
import * as L from '../../admin/book-layout.js';
import { generatePuzzle } from '../../admin/engine/index.js';
import { engineFiles, ENGINE_SRC, ENGINE_COPY } from '../../scripts/admin-engine.mjs';

test('admin/engine is an up-to-date copy of the engine (node scripts/admin-engine.mjs)', () => {
  for (const f of engineFiles()) {
    assert.equal(readFileSync(join(ENGINE_COPY, f), 'utf8'), readFileSync(join(ENGINE_SRC, f), 'utf8'), `admin/engine/${f} is out of date: run node scripts/admin-engine.mjs`);
  }
});

test('the starting settings make Volume 1 again: 40 puzzles, 108 pages, keys on page 88', () => {
  const s = L.defaults();
  const puzzles = L.makeBookPuzzles(generatePuzzle, s);
  assert.equal(puzzles.length, 40);
  assert.deepEqual(puzzles.slice(0, 3).map((p) => p.title), ['The Hallway Time Capsule', 'The Frozen Lost Diary', 'The Summery Banner']);
  assert.equal(puzzles[39].title, 'The Wild Dew Drop');
  const book = L.buildInterior(puzzles, L.examplePuzzle(generatePuzzle), s);
  assert.equal(book.pages.length, 108);
  assert.equal(book.keysStart, 88);
  assert.equal(book.pages[7].key, 'pz-1-a');
  assert.equal(book.pages[7].n % 2, 0, 'a puzzle spread opens on a left page');
  assert.ok(!book.pages.some((p) => /style="/.test(p.html)), 'no inline styles (the admin CSP blocks them)');
  // Leaving Volume 1 out gives 40 new puzzles.
  const next = L.makeBookPuzzles(generatePuzzle, s, () => {}, { stories: puzzles.map((p) => p.story.id), fingerprints: puzzles.map(L.puzzleFingerprint) });
  assert.equal(next.length, 40);
  assert.ok(next.every((p) => !puzzles.some((q) => q.story.id === p.story.id)));
});

test('spreads stay on facing pages when front pages are switched off', () => {
  const s = L.defaults();
  s.puzzles.counts = { easy: 3 };
  for (const k of ['contents', 'howto', 'levels']) s.pages[k] = false;
  const book = L.buildInterior(L.makeBookPuzzles(generatePuzzle, s), L.examplePuzzle(generatePuzzle), s);
  assert.equal(book.pages.length % 2, 0);
  for (const p of book.pages.filter((x) => x.kind === 'clues')) assert.equal(p.n % 2, 0, `${p.key} on a left page`);
});

test('page colors: book, black and white, or the page’s own; gray in a black-and-white book', () => {
  const s = L.defaults();
  s.style.colors = JSON.parse(JSON.stringify(L.COLOR_PRESETS.purple[1]));
  s.style.pages['pz-1-b'] = { mode: 'custom', colors: { grids: { headBg: '#ffcc00' } } };
  s.style.pages['pz-2-b'] = { mode: 'bw' };
  s.format.ink = 'standard';
  assert.equal(L.pageColors(s, 'pz-1-b').grids.headBg, '#ffcc00');
  assert.equal(L.pageColors(s, 'pz-1-a').words.heading, '#5B3CC4');
  assert.ok(L.isGray(L.pageColors(s, 'pz-2-b').words.heading));
  s.format.ink = 'bw';
  assert.ok(L.isGray(L.pageColors(s, 'pz-1-b').grids.headBg));
});

test('KDP numbers: printing cost, royalty, lowest price, spine and cover', () => {
  const s = L.defaults();
  assert.equal(L.printingCost(s, 108), 2.84); // large trim, black ink, up to 110 pages
  assert.equal(L.printingCost(s, 200), 4.4);
  s.format.trim = '6x9';
  assert.equal(L.printingCost(s, 108), 2.3);
  assert.equal(L.printingCost(s, 300), 4.6); // KDP's own worked example
  assert.deepEqual(L.royalty(9.99, 2.84), { rate: 0.6, amazon: 3.15, expanded: null });
  assert.equal(L.royalty(7.99, 2.3).rate, 0.5);
  assert.equal(L.minimumPrice(2.84), 5.68);
  s.format.trim = '8.5x11';
  const g = L.coverGeometry(s, 108);
  assert.equal(g.spine.toFixed(4), '0.2432');
  assert.equal(g.w.toFixed(3), '17.493');
  assert.equal(g.pageW * 72, 1260);
  assert.equal(L.coverGeometry(s, 60).spineText, false);
});

test('KDP checks catch bad margins, cream paper in color, and too few pages', () => {
  const s = L.defaults();
  s.format.margins.inside = 0.2;
  s.format.ink = 'standard';
  s.format.paper = 'cream';
  const levels = L.kdpChecks(s, { pages: Array.from({ length: 30 }, (_, i) => ({ n: i + 1, vars: '--p-bg:#ffffff', color: false })) }).filter((c) => c.level === 'bad').map((c) => c.text).join(' ');
  assert.match(levels, /Inside margin/);
  assert.match(levels, /Cream paper/);
  assert.match(levels, /72 to 600 pages/);
});

test('reuse: a published book blocks its puzzles, a draft only warns', () => {
  const rows = [
    { bookId: 1, position: 4, storyId: 's-1', fingerprint: 'f-1', bookTitle: 'Vol 1', status: 'published' },
    { bookId: 2, position: 2, storyId: 's-2', fingerprint: 'f-2', bookTitle: 'Draft', status: 'draft' },
  ];
  const r = reuse([{ position: 1, storyId: 's-1', fingerprint: 'x' }, { position: 2, storyId: 'new', fingerprint: 'f-2' }, { position: 3, storyId: 'n', fingerprint: 'n' }], rows);
  assert.equal(r.blocking.length, 1);
  assert.equal(r.blocking[0].theirPosition, 4);
  assert.equal(r.drafts.length, 1);
  assert.equal(reuse([{ position: 1, storyId: 's-1', fingerprint: 'x' }], rows, 1).blocking.length, 0, 'a book never blocks itself');
});

test('the scan finds trademarks, characters and real places in a puzzle', () => {
  const text = JSON.stringify({ title: 'The Lego Heist', story: ['Elsa met Harry Potter at Carnegie Hall.'], clues: [], questions: [], items: ['Frisbee'] });
  const fields = puzzleFields(text);
  const terms = [...watchListFindings(fields), ...placeFindings(fields)].map((f) => f.term);
  for (const t of ['Lego', 'Harry Potter', 'Frisbee', 'Carnegie Hall']) assert.ok(terms.includes(t), t);
  assert.equal(placeFindings(fields)[0].serious, false, 'a real place is to look at, not a problem');
  const rec = L.puzzleRecord(generatePuzzle({ difficulty: 'easy', theme: 'pets', seed: 'r' }), 1);
  assert.ok(rec.storyId && /^[0-9a-f]{16}$/.test(rec.fingerprint) && JSON.parse(rec.text).clues.length);
});
