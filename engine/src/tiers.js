// Difficulty tiers. Each tier has fixed lever ranges (guideline: "Medium" means
// the same every time): categories, items per category, clue types, and the
// deduction techniques a solver needs.
//
// Technique levels used by the solver:
//   0 direct     - read a clue and mark it; one O in a row rules out the rest
//   1 cross-grid - carry a known match or mismatch into another grid
//   2 advanced   - ordering, either/or, if-then and "can't share any option" reasoning
//   3 what-if    - a short chain: "if this were true, a clue would break"
//                  (whatIfDepth caps how many passes of reasoning the chain may take)

export const CLUE_TYPES = {
  is: 'Direct match',
  not: 'Not a match',
  neither: 'Neither / nor',
  either: 'Either / or',
  pairs: 'One of each',
  allDiff: 'All different',
  less: 'More / less',
  diff: 'Exact gap',
  ifthen: 'If / then',
};

export const TIERS = {
  basic: {
    id: 'basic', name: 'Basic', order: 0,
    summary: '3 categories, 3 to 4 items, direct clues',
    categories: [3, 3], items: [3, 4], defaultSize: [3, 3],
    weights: { is: 3, not: 5, neither: 2 },
    maxLevel: 1, requireLevel: 0, minAdvancedSteps: 0, maxWhatIf: 0,
    removeFirst: ['neither', 'not', 'is'],
  },
  easy: {
    id: 'easy', name: 'Easy', order: 1,
    summary: '3 to 4 categories, 4 to 5 items, direct and either/or clues',
    categories: [3, 4], items: [4, 5], defaultSize: [3, 4],
    weights: { is: 2, not: 5, neither: 2, either: 2 },
    maxLevel: 1, requireLevel: 1, minAdvancedSteps: 0, maxWhatIf: 0,
    removeFirst: ['is', 'either', 'neither', 'not'],
  },
  medium: {
    id: 'medium', name: 'Medium', order: 2,
    summary: '4 categories, 4 to 5 items, adds more/less clues',
    categories: [4, 4], items: [4, 5], defaultSize: [4, 4],
    weights: { is: 1, not: 4, neither: 2, either: 2, less: 3, allDiff: 1 },
    maxLevel: 2, requireLevel: 2, minAdvancedSteps: 1, maxWhatIf: 0,
    removeFirst: ['is', 'not', 'neither', 'allDiff', 'either', 'less'],
  },
  hard: {
    id: 'hard', name: 'Hard', order: 3,
    summary: '4 to 5 categories, 5 items, adds exact gaps and one-of-each clues',
    categories: [4, 5], items: [5, 5], defaultSize: [4, 5],
    weights: { is: 0.5, not: 3, neither: 2, either: 2, pairs: 1.5, allDiff: 1.5, less: 3, diff: 2 },
    maxLevel: 2, requireLevel: 2, minAdvancedSteps: 4, maxWhatIf: 0,
    removeFirst: ['is', 'not', 'neither', 'allDiff', 'either', 'less', 'pairs', 'diff'],
  },
  expert: {
    id: 'expert', name: 'Expert', order: 4,
    summary: '5 categories, 5 to 6 items, adds if/then clues and longer chains',
    categories: [5, 5], items: [5, 6], defaultSize: [5, 5],
    weights: { is: 0.3, not: 3, neither: 2, either: 2, pairs: 2, allDiff: 1.5, less: 3, diff: 2, ifthen: 1.5 },
    maxLevel: 3, requireLevel: 2, minAdvancedSteps: 6, maxWhatIf: 2, whatIfDepth: 3,
    removeFirst: ['is', 'not', 'neither', 'allDiff', 'either', 'less', 'pairs', 'diff', 'ifthen'],
  },
  mensa: {
    id: 'mensa', name: 'MENSA', order: 5,
    summary: '5 to 6 categories, 6 to 7 items, every clue type, what-if chains',
    categories: [5, 6], items: [6, 7], defaultSize: [5, 6],
    weights: { is: 0.2, not: 2, neither: 1.5, either: 2, pairs: 2, allDiff: 1.5, less: 3, diff: 2.5, ifthen: 2 },
    maxLevel: 3, requireLevel: 3, minAdvancedSteps: 8, maxWhatIf: Infinity, whatIfDepth: 5,
    removeFirst: ['is', 'not', 'neither', 'allDiff', 'either', 'pairs', 'less', 'diff', 'ifthen'],
  },
};

export const TIER_ORDER = ['basic', 'easy', 'medium', 'hard', 'expert', 'mensa'];

// Custom sizes (advanced option) may go outside a tier's range, within these limits.
export const SIZE_LIMITS = { categories: [3, 6], items: [3, 8] };
