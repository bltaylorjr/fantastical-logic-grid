// The Fantastical Logic Grid: puzzle and story engine.
import { THEMES } from './themes.js';
import { TIERS, TIER_ORDER, CLUE_TYPES, SIZE_LIMITS } from './tiers.js';

export { generatePuzzle, gridLayout, ENGINE_NAME, ENGINE_VERSION } from './generator.js';
export { getHint, checkMarks, checkAnswers, isSolved, formatPuzzleText } from './play.js';
export { THEMES, TIERS, CLUE_TYPES, SIZE_LIMITS };
export { STORYLINES, storylineCount } from './storylines.js';
export { parseStoryId, checkStoryPart, partKey, PART_KINDS } from './story.js';

// The id to save once a player starts a puzzle; pass saved ids back as
// generatePuzzle({ usedStories }) and the engine never repeats one.
export const storyId = (puzzle) => puzzle.story.id;

// Everything the setup screen needs: tiers with one-line descriptions and size
// ranges, themes, clue types and size limits.
export function describeOptions() {
  return {
    difficulties: TIER_ORDER.map((id) => {
      const t = TIERS[id];
      return { id, name: t.name, summary: t.summary, categories: t.categories, items: t.items, defaultSize: t.defaultSize, clueTypes: Object.keys(t.weights) };
    }),
    themes: THEMES.map((t) => ({ id: t.id, name: t.name, description: t.description })),
    clueTypes: Object.entries(CLUE_TYPES).map(([id, name]) => ({ id, name })),
    sizeLimits: SIZE_LIMITS,
  };
}
