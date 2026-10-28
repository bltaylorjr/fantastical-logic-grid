// The Fantastical Logic Grid: puzzle and story engine.
import { THEMES, THEME_GROUPS } from './themes.js';
import { getTopics, buildScenario } from './topics.js';
import { TIERS, TIER_ORDER, CLUE_TYPES, SIZE_LIMITS } from './tiers.js';

export { generatePuzzle, gridLayout, ENGINE_NAME, ENGINE_VERSION } from './generator.js';
export { getHint, checkMarks, checkAnswers, isSolved, formatPuzzleText } from './play.js';
export { THEMES, THEME_GROUPS, TIERS, CLUE_TYPES, SIZE_LIMITS };
export { STORYLINES } from './storylines.js';
export { TOPICS, getTopics, storyKey } from './topics.js';
export { pictureClue, solvePicture, lineClues, PICTURES } from './picture.js';
export { parseStoryId, checkStoryPart, partKey, PART_KINDS } from './story.js';

// The id to save once a player starts a puzzle; pass saved ids back as
// generatePuzzle({ usedStories }) and the engine never repeats one.
export const storyId = (puzzle) => puzzle.story.id;

// How many distinct storylines a theme (or one of its topics) can tell.
export function storylineCount(themeId, topicId) {
  const theme = THEMES.find((t) => t.id === themeId);
  const topics = getTopics(themeId);
  const topic = topicId ? topics.find((t) => t.id === topicId) : topics.find((t) => !t.story) || topics[0];
  if (!theme || !topic) return 0;
  const sc = buildScenario(theme, topic);
  const s = sc.story;
  const leads = sc.categories.reduce((n, c) => n + (s.leads[c.id] || []).length, 0);
  return s.adjs.length * s.openings.length * s.incidents.length * s.mishaps.length * leads * s.endings.length;
}

// Everything the setup screen needs: tiers with one-line descriptions and size
// ranges, themes with their topics ("any" first, the default), clue types and
// size limits.
export function describeOptions() {
  return {
    difficulties: TIER_ORDER.map((id) => {
      const t = TIERS[id];
      return { id, name: t.name, summary: t.summary, categories: t.categories, items: t.items, defaultSize: t.defaultSize, clueTypes: Object.keys(t.weights) };
    }),
    themes: THEMES.map((t) => ({
      id: t.id, name: t.name, description: t.description, defaultTopic: 'any',
      topics: [{ id: 'any', name: 'Any', description: `A surprise ${t.name.toLowerCase()} story each time.` },
        ...getTopics(t.id).map((p) => ({ id: p.id, name: p.name, description: p.description }))],
    })),
    themeGroups: THEME_GROUPS.map((g) => ({ id: g.id, name: g.name, themes: g.themes.slice() })),
    clueTypes: Object.entries(CLUE_TYPES).map(([id, name]) => ({ id, name })),
    sizeLimits: SIZE_LIMITS,
  };
}
