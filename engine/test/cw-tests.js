// Crossword tests: node engine/test/cw-tests.js [--quick]
// Every puzzle is checked again here, apart from the engine's own check: the
// grid's shape (symmetry, no short answers, every square crossed, all joined),
// the word limits, and accuracy: each answer spelled by the grid is a real
// dictionary answer and each clue is one of that answer's own dictionary
// clues. Then hints solve every puzzle, the same seed gives the same puzzle,
// and a saved puzzle survives the game's own cleanPuzzle.
import { generateCrossword, getCrosswordHint, checkCrosswordEntries, cluesFor, isAnswer, limitsFor, CW_TIERS } from '../src/crossword.js';
import { THEME_SETS } from '../src/crossword-themes.js';
import { OPS } from '../src/cw-ops.js';
import { def } from '../../modules/crossword/game.js';

const quick = process.argv.includes('--quick');
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

function shapeOk(p) {
  const N = p.size, b = p.blocks;
  if (!b.every((v, i) => v === b[N * N - 1 - i])) return 'not symmetric';
  const runs = [];
  for (let r = 0; r < N; r++) { let run = []; for (let c = 0; c <= N; c++) { if (c < N && !b[r * N + c]) run.push(r * N + c); else { if (run.length) runs.push(['A', run]); run = []; } } }
  for (let c = 0; c < N; c++) { let run = []; for (let r = 0; r <= N; r++) { if (r < N && !b[r * N + c]) run.push(r * N + c); else { if (run.length) runs.push(['D', run]); run = []; } } }
  if (runs.some(([, r]) => r.length < 3)) return 'an answer under 3 letters';
  const lim = limitsFor(N);
  if (runs.length > lim.maxWords) return `too many words (${runs.length})`;
  if (b.filter(Boolean).length > lim.maxBlocks) return 'too many black squares';
  if (runs.length !== p.across.length + p.down.length) return 'answers and runs differ';
  // All joined.
  const open = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const seen = new Set([open[0]]), q = [open[0]];
  while (q.length) { const i = q.pop(), r = Math.floor(i / N), c = i % N; for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) { const j = rr * N + cc; if (rr >= 0 && cc >= 0 && rr < N && cc < N && !b[j] && !seen.has(j)) { seen.add(j); q.push(j); } } }
  if (seen.size !== open.length) return 'not all joined';
  return '';
}

function accurate(p) {
  for (const e of [...p.across, ...p.down]) {
    const spelled = e.cells.map((c) => String.fromCharCode(64 + p.solution[c])).join('');
    if (spelled !== e.answer) return `${e.n}: grid spells ${spelled}, answer ${e.answer}`;
    if (!isAnswer(e.answer)) return `${e.answer} is not in the dictionary`;
    if (!cluesFor(e.answer).some((c) => c.text === e.clue.replace(/^\*/, ''))) return `clue "${e.clue}" is not one of ${e.answer}'s`;
    if (!e.clue.trim()) return `${e.answer} has no clue`;
  }
  const answers = [...p.across, ...p.down].map((e) => e.answer);
  if (new Set(answers).size !== answers.length) return 'an answer twice';
  if (p.theme) {
    const set = THEME_SETS.find((s) => s.id === p.theme.set);
    for (const e of [...p.across, ...p.down].filter((x) => x.theme)) {
      if (!set.words.map((w) => w.toUpperCase()).includes(e.theme.member)) return `${e.theme.member} is not one of the ${set.many}`;
      if (e.answer.slice(e.theme.at, e.theme.at + e.theme.member.length) !== e.theme.member) return `${e.answer} does not hold ${e.theme.member} where it says`;
      if (!e.clue.startsWith('*')) return 'a theme clue without its star';
    }
  }
  return '';
}

function playByHints(p) {
  const entries = Array(p.solution.length).fill(0);
  for (let guard = 0; guard < 400; guard++) {
    if (checkCrosswordEntries(p, entries).solved) return true;
    const h = getCrosswordHint(p, entries);
    if (h.kind !== 'step' || h.levels.length !== 3 || !h.levels.every(Boolean)) return false;
    entries[h.cell] = h.digit;
  }
  return false;
}

// Every theme set is a real list: plenty of plain words, each set used by some story theme.
for (const s of THEME_SETS) check(`theme set ${s.id}`, s.words.length >= 8 && s.words.every((w) => /^[a-z]{2,}$/.test(w)) && s.themes.length > 0 && s.kinds.length > 0);

const seeds = quick ? ['t1'] : ['t1', 't2', 't3'];
for (const [d, tier] of Object.entries(CW_TIERS)) {
  for (const N of tier.sizes) {
    for (const seed of seeds) {
      const t = Date.now();
      let p;
      try { p = generateCrossword({ difficulty: d, size: N, seed, theme: 'surprise' }); } catch (e) { check(`${d} ${N} ${seed} builds`, false, e.message); continue; }
      const ms = Date.now() - t;
      const tag = `${d} ${N}×${N} ${seed}`;
      check(`${tag} own check`, p.report.ok, p.report.failed.join('; '));
      const shape = shapeOk(p); check(`${tag} shape`, !shape, shape);
      const acc = accurate(p); check(`${tag} accuracy`, !acc, acc);
      check(`${tag} hints solve it`, playByHints(p));
      const again = OPS.generate({ difficulty: d, size: N, seed, theme: 'surprise' });
      check(`${tag} same seed, same puzzle`, again.fingerprint === p.fingerprint && JSON.stringify(again.across) === JSON.stringify(p.across));
      const clean = def.cleanPuzzle(JSON.parse(JSON.stringify(p)));
      check(`${tag} survives cleanPuzzle`, !!clean && clean.across.length === p.across.length && clean.solution.join() === p.solution.join());
      check(`${tag} prints`, def.printBoard(p, p.givens, { answers: false }).includes('Across') && def.printBoard(p, p.solution, { answers: true }).includes('<table'));
      check(`${tag} has a story`, !!p.story?.title && (!p.theme || p.story.themeBeats?.length === p.theme.members.length));
      console.log(`${tag}: ${ms} ms, ${p.report.words} words, ${p.report.blocks} black, average word score ${p.report.avgScore}${p.theme ? `, theme ${p.theme.title} (${p.theme.members.join(', ')})` : ''}`);
    }
  }
}
// A mistake is found by the hint.
{
  const p = generateCrossword({ difficulty: 'basic', size: 5, seed: 'mistake' });
  const entries = p.solution.slice();
  const i = p.solution.findIndex((v) => v);
  entries[i] = entries[i] === 1 ? 2 : 1;
  const h = getCrosswordHint(p, entries);
  check('a wrong letter is pointed out', h.kind === 'mistake' && h.cells.includes(i));
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
