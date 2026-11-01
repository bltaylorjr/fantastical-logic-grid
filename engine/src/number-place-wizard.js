// The Puzzle Wizard's check of an author's own NINETIMESNINE starting numbers:
// exactly one answer, and reachable by reasoning alone (no guessing). The page
// (web/js/wizard-build.js) turns the result into words for the author; this
// file does the solving, so in server mode (docs/PUZZLE-SERVER.md) it runs on
// the puzzle server and the solver never reaches the browser.
//
// analyzeGivens({ size, diagonal, givens }) ->
//   { count: 0 }                                          no way to fill the grid
//   { count: 2, suggestion: { cell, digit }, unique }      more than one answer;
//        unique: true when that one extra number makes the answer unique
//   { count: 1, solved: false, suggestion }               one answer, but needs guessing
//   { count: 1, solved: true, levelId, solution, puzzle } ready: puzzle holds the
//        engine's fields for a saved NINETIMESNINE puzzle (box, solvePath, ...)
import { makeShape, countSolutions, solveLogically, NP_TECHNIQUES, NP_SIZES, toughnessOf, fingerprintOf } from './number-place.js';

// The level a set of solving steps suits (number-place.js NP_TIERS).
export function levelIdOf(N, hardest, steps) {
  if (N === 4) return hardest <= 1 ? 'basic' : 'easy';
  if (N === 6) return hardest <= 1 ? 'easy' : hardest <= 2 ? 'medium' : 'hard';
  if (hardest <= 2) return 'medium';
  if (hardest === 3) return 'hard';
  const top = steps.filter((s) => NP_TECHNIQUES[s.technique].level === 5).length;
  return hardest === 5 && top >= 2 ? 'master' : 'expert';
}

export function analyzeGivens({ size, diagonal = false, givens = [] } = {}) {
  const N = Number(size);
  if (!NP_SIZES[N]) throw new Error(`NINETIMESNINE grids are ${Object.keys(NP_SIZES).join(', ')} wide.`);
  const variants = diagonal ? ['diagonal'] : [];
  const shape = makeShape(N, variants);
  const grid = Array.from({ length: N * N }, (_, i) => {
    const d = Number(givens[i]) || 0;
    return d >= 1 && d <= N ? d : 0;
  });
  const first = countSolutions(shape, grid, 2);
  if (first.count === 0) return { count: 0 };
  if (first.count > 1) {
    // Which one more number makes the answer unique?
    for (let c = 0; c < N * N; c++) {
      if (grid[c]) continue;
      const g = grid.slice();
      g[c] = first.solution[c];
      if (countSolutions(shape, g, 2).count === 1) return { count: 2, unique: true, suggestion: { cell: c, digit: first.solution[c] } };
    }
    const c = grid.findIndex((d) => !d);
    return { count: 2, unique: false, suggestion: { cell: c, digit: first.solution[c] } };
  }
  const res = solveLogically(shape, grid, { maxLevel: 5 });
  if (!res.solved) {
    const c = res.values.findIndex((d) => !d);
    return { count: 1, solved: false, suggestion: { cell: c, digit: first.solution[c] } };
  }
  return {
    count: 1, solved: true, levelId: levelIdOf(N, res.hardest, res.steps), solution: first.solution,
    puzzle: {
      size: N, box: NP_SIZES[N].box, variants, givens: grid, solution: first.solution,
      solvePath: res.steps.map((x) => ({ technique: x.technique, techniqueName: NP_TECHNIQUES[x.technique].name, place: x.place || null, remove: x.remove || null, why: x.why })),
      hardestTechnique: res.hardest, techniques: [...new Set(res.steps.map((x) => x.technique))],
      toughness: toughnessOf(res.steps, grid.filter((d) => !d).length), fingerprint: fingerprintOf(grid, [], variants),
    },
  };
}
