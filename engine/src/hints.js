// Step-by-step hints from the player's current grid (clue, then cell, then
// reasoning). Kept apart from play.js because hints need the solver: in
// server mode (docs/PUZZLE-SERVER.md) this file and the solver never reach
// the browser, and hints come from the private puzzle server instead.
import { TIERS } from './tiers.js';
import { solveWithTrace, TECHNIQUE_NAMES } from './solver.js';
import { modelFromPuzzle, isMatch } from './play.js';

// Next hint from the player's current grid. Mistakes come first (they make
// every later hint unreliable); otherwise the easiest next deduction.
export function getHint(puzzle, marks = []) {
  const m = modelFromPuzzle(puzzle);
  const wrong = marks.filter((mk) => (mk.mark === 'O') !== isMatch(m, mk.a, mk.b));
  if (wrong.length) {
    return {
      kind: 'mistake',
      marks: wrong,
      levels: [
        `${wrong.length === 1 ? 'One mark does' : `${wrong.length} marks do`} not fit the clues.`,
        `Check the mark where ${label(m, wrong[0].a)} meets ${label(m, wrong[0].b)}.`,
        `${label(m, wrong[0].a)} and ${label(m, wrong[0].b)} ${wrong[0].mark === 'O' ? 'do not go together' : 'do go together'}.`,
      ],
    };
  }
  const tier = TIERS[puzzle.difficulty.id] || TIERS.mensa;
  const start = marks.map((mk) => [m.toG(mk.a), m.toG(mk.b), mk.mark === 'O' ? 1 : -1]);
  const res = solveWithTrace(m.K, m.N, m.clues, Math.max(tier.maxLevel, 3), m.L, start, tier.whatIfDepth || 5);
  const step = res.steps[0];
  if (!step) return { kind: 'done', levels: ['Every cell is already worked out.'] };
  const marksOut = step.sets.map(([x, y, v]) => ({ a: m.toId(Math.min(x, y)), b: m.toId(Math.max(x, y)), mark: v > 0 ? 'O' : 'X' }));
  const [x, y] = step.sets[0];
  const catA = m.L.catName(Math.floor(Math.min(x, y) / m.N)), catB = m.L.catName(Math.floor(Math.max(x, y) / m.N));
  return {
    kind: 'step',
    clue: step.clue >= 0 ? step.clue + 1 : null,
    technique: step.technique,
    techniqueName: TECHNIQUE_NAMES[step.technique],
    marks: marksOut,
    explanation: step.why,
    chain: step.chain || null,
    levels: [
      step.clue >= 0 ? `Look at clue ${step.clue + 1}.` : `Look at the ${catA} and ${catB} grid.`,
      `Look at the cell where ${m.L.label(x)} meets ${m.L.label(y)}.`,
      step.why,
    ],
  };
}

const label = (m, id) => m.L.label(m.toG(id));

