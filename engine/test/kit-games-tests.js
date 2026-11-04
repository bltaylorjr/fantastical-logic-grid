// Cage Math, Sum Cross and Picture Grid tests: node test/kit-games-tests.js
// Cage Math uniqueness is checked with the brute-force counter, independent of
// the logic solver. Sum Cross and Picture Grid are checked by solving from the
// clues with sound deductions only, which can reach just one answer.
import { generateCageMath, countCageMath, solveCageMath, getCageMathHint, checkCageMath, CM_TIERS, CM_TECHNIQUES } from '../src/cage-math.js';
import { generateSumCross, solveSumCross, getSumCrossHint, checkSumCross, SC_TIERS, SC_TECHNIQUES, runsOf, combosFor } from '../src/sum-cross.js';
import { generatePictureGrid, solvePictureGrid, getPictureGridHint, checkPictureGrid, PG_TIERS, PG_TECHNIQUES, cluesOf } from '../src/picture-grid.js';
import { kitThemeStory, KIT_THEME_IDS, KIT_THEME_CHOICES } from '../src/kit-story.js';
import { GAMES as STORY_GAMES, THEMES as STORY_WORDS } from '../src/kit-story-words.js';
import { THEMES } from '../src/themes.js';
import { themeStoryChecks } from './kit-story-checks.js';
import { THEME_GROUPS, themeForDay, beatsReached, cleanStory } from '../../modules/grid-kit/story.js';
import { createLearning } from '../../modules/grid-kit/learning.js';
import { def as cmDef } from '../../modules/cage-math/game.js';
import { def as scDef } from '../../modules/sum-cross/game.js';
import { def as pgDef } from '../../modules/picture-grid/game.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

// Play a puzzle by hints alone: every hint must move it on correctly.
function playByHints(p, hint, isSolved, apply) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 2000; guard++) {
    if (isSolved(entries)) return true;
    const h = hint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean)) return false;
    apply(entries, h);
  }
  return false;
}

const levels = (tiers) => (quick ? Object.keys(tiers).filter((_, i) => i % 2 === 0) : Object.keys(tiers));
const seeds = quick ? ['a'] : ['a', 'b'];

// ---------- Cage Math ----------
for (const difficulty of levels(CM_TIERS)) for (const seed of seeds) {
  const p = generateCageMath({ difficulty, seed });
  const name = `cm ${p.id}`;
  if (p.size <= 7) check(`${name} unique`, countCageMath(p, 2) === 1);
  const res = solveCageMath(p, p.givens);
  check(`${name} logic solves it`, res.solved && res.values.every((d, i) => d === p.solution[i]));
  check(`${name} latin answer`, [...Array(p.size).keys()].every((r) => new Set(p.solution.slice(r * p.size, r * p.size + p.size)).size === p.size));
  check(`${name} every cell in one cage`, p.cages.flatMap((c) => c.cells).sort((a, b) => a - b).every((c, i) => c === i));
  check(`${name} every step named`, p.solvePath.every((s) => CM_TECHNIQUES[s.technique] && s.why));
  check(`${name} same seed same puzzle`, generateCageMath({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p, getCageMathHint, (e) => checkCageMath(p, e).solved, (e, h) => { e[h.cell] = h.value ?? h.digit; }));
}
{
  const p = generateCageMath({ difficulty: 'easy', seed: 'm' });
  const e = Array(p.solution.length).fill(0);
  e[0] = (p.solution[0] % p.size) + 1;
  check('cm a wrong number is caught', getCageMathHint(p, e).kind === 'mistake');
  const q = generateCageMath({ difficulty: 'easy', seed: 'n', avoid: [p.fingerprint] });
  check('cm avoid gives a different puzzle', q.fingerprint !== p.fingerprint);
}

// ---------- Sum Cross ----------
for (const difficulty of levels(SC_TIERS)) for (const seed of seeds) {
  const p = generateSumCross({ difficulty, seed });
  const name = `sc ${p.id}`;
  const res = solveSumCross(p, p.givens);
  check(`${name} logic solves it`, res.solved && res.values.every((d, i) => d === p.solution[i]));
  const white = p.solution.map((d) => d > 0);
  const runs = runsOf(p.size, p.cols, white);
  check(`${name} runs add up, no repeats`, runs.every((r) => {
    const ds = r.cells.map((c) => p.solution[c]);
    return new Set(ds).size === ds.length && combosFor(ds.length, ds.reduce((a, b) => a + b, 0)).length > 0;
  }));
  check(`${name} givens are part of answer`, p.givens.every((d, i) => !d || d === p.solution[i]));
  check(`${name} every step named`, p.solvePath.every((s) => SC_TECHNIQUES[s.technique] && s.why));
  check(`${name} same seed same puzzle`, generateSumCross({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p, getSumCrossHint, (e) => checkSumCross(p, e).solved, (e, h) => { e[h.cell] = h.value ?? h.digit; }));
}

// ---------- Picture Grid ----------
for (const difficulty of levels(PG_TIERS)) for (const seed of seeds) {
  const p = generatePictureGrid({ difficulty, seed });
  const name = `pg ${p.id}`;
  const res = solvePictureGrid(p, p.givens);
  check(`${name} logic solves it`, res.solved && res.values.every((v, i) => (v === 1) === (p.solution[i] === 1)));
  const row = (r) => p.solution.slice(r * p.cols, (r + 1) * p.cols);
  const col = (c) => p.solution.filter((_, i) => i % p.cols === c);
  check(`${name} clues match the picture`, p.rowClues.every((cl, r) => JSON.stringify(cl) === JSON.stringify(cluesOf(row(r))))
    && p.colClues.every((cl, c) => JSON.stringify(cl) === JSON.stringify(cluesOf(col(c)))));
  check(`${name} has a picture name`, !!p.picture?.name);
  check(`${name} every step named`, p.solvePath.every((s) => PG_TECHNIQUES[s.technique] && s.why));
  check(`${name} same seed same puzzle`, generatePictureGrid({ difficulty, seed }).fingerprint === p.fingerprint);
  check(`${name} plays by hints`, playByHints(p, getPictureGridHint, (e) => checkPictureGrid(p, e).solved, (e, h) => { for (const [c, v] of h.marks) e[c] = v; }));
}
{
  const p = generatePictureGrid({ difficulty: 'easy', seed: 'u' });
  const q = generatePictureGrid({ difficulty: 'easy', seed: 'v', usedPictures: [p.picture.id] });
  check('pg a used picture is not drawn again', q.picture.id !== p.picture.id);
}

// ---------- story themes (all eight kit games) ----------
themeStoryChecks(check, 'cm', generateCageMath, cmDef);
themeStoryChecks(check, 'sc', generateSumCross, scDef);
themeStoryChecks(check, 'pg', generatePictureGrid, pgDef);
{
  // Every theme tells a full story in every game.
  for (const game of Object.keys(STORY_GAMES)) for (const theme of KIT_THEME_IDS) {
    const s = kitThemeStory(game, `all-${theme}`, { theme, picture: 'a kite' });
    const ok = s && s.theme === theme && s.title && s.intro && s.ending && s.beats.length === 3 && s.beats.every((b) => b && !/\d/.test(b)) && ![s.title, s.intro, s.ending, ...s.beats].some((t) => /[{}]/.test(t));
    check(`story ${game} ${theme} is complete`, ok, JSON.stringify(s));
  }
  check('every theme has its own words', THEMES.every((t) => ['places', 'things', 'intros', 'endings'].every((k) => STORY_WORDS[t.id]?.[k]?.length)));
  check('no story word holds a digit', !/\d/.test(JSON.stringify(STORY_WORDS)) && !/\d/.test(JSON.stringify(STORY_GAMES)));
  check('the setup screen lists the main game\'s themes', JSON.stringify(THEME_GROUPS) === JSON.stringify(KIT_THEME_CHOICES));
  check('daily theme is the same all day and a real theme', themeForDay('2026-11-02') === themeForDay('2026-11-02') && KIT_THEME_IDS.includes(themeForDay('2026-11-02')));
  check('daily themes vary from day to day', new Set(['01', '02', '03', '04', '05', '06', '07', '08'].map((d) => themeForDay(`2026-11-${d}`))).size > 3);
  check('story moments at a third, two thirds and near the end', [0, 0.3, 0.34, 0.5, 0.67, 0.89, 0.9, 1].map(beatsReached).join('') === '00112233');
  check('cleanStory drops what does not belong', cleanStory({ id: 'a', title: 't', intro: 'i', ending: 'e', theme: 'mystery', beats: ['x'], extra: '<script>' }).extra === undefined);

  // Story on or off, any theme: the grids and clues are exactly those made
  // before stories had themes (engine/test/kit-story-proof.json).
  const proof = JSON.parse(readFileSync(new URL('./kit-story-proof.json', import.meta.url), 'utf8'));
  const gen = { cm: generateCageMath, sc: generateSumCross, pg: generatePictureGrid,
    ml: (await import('../src/more-or-less.js')).generateMoreOrLess, sk: (await import('../src/skyline.js')).generateSkyline,
    sf: (await import('../src/star-field.js')).generateStarField, ll: (await import('../src/loop-line.js')).generateLoopLine, ib: (await import('../src/island-bridges.js')).generateIslandBridges };
  const hash = (p) => { const { story, ...rest } = p; return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16); };
  for (const [key, want] of Object.entries(proof)) {
    const [game, difficulty] = key.split('-');
    const seed = `story-proof-${difficulty}`;
    check(`${key} story off: same puzzle as before themes`, hash(gen[game]({ difficulty, seed, story: false })) === want);
    if (difficulty === 'basic') check(`${key} with a theme: same puzzle as before themes`, hash(gen[game]({ difficulty, seed, theme: 'farm' })) === want);
  }
}

// ---------- learning: stepping up and easing off ----------
{
  const mem = {};
  const mk = () => createLearning({ load: (k, d) => mem[k] ?? d, keep: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, key: 'L', par: { easy: 100e3, medium: 200e3 } });
  const play = (L, o) => L.finished({ p: { fingerprint: Math.random().toString(36), difficulty: { id: o.d || 'easy' }, size: 6 }, mode: 'free', ms: o.ms, hints: o.hints || 0, mistakes: o.mistakes || 0 }, o.outcome || 'solved');
  const L = mk();
  play(L, { ms: 90e3, hints: 1 });
  const before = L.toughness('easy');
  play(L, { ms: 40e3 });
  const quickT = L.toughness('easy');
  play(L, { ms: 90e3, hints: 1 });
  const plainT = L.toughness('easy');
  check('a quick solve with no help steps toughness up more', quickT > before && quickT - plainT > 0.05, `${before} ${quickT} ${plainT}`);
  check('three good solves suggest the next level', L.suggestLevel() === 'medium');
  const M = (Object.keys(mem).forEach((k) => delete mem[k]), mk());
  play(M, { ms: 90e3, d: 'medium' });
  const t0 = M.toughness('medium');
  play(M, { ms: 300e3, d: 'medium', outcome: 'revealed' });
  const t1 = M.toughness('medium');
  check('a give-up eases toughness off at once', t1 < t0 - 0.3, `${t0} ${t1}`);
  play(M, { ms: 300e3, d: 'medium', outcome: 'abandoned' });
  check('two give-ups suggest a gentler level', M.suggestLevel() === 'easy');
  check('toughness stays inside its range', [t0, t1, M.toughness('medium')].every((t) => t >= 0.05 && t <= 0.95));
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
