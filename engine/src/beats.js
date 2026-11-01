// Story beats: short moments of story that appear while the player solves,
// one after another as grid sections are finished. They move the story along
// between the opening (shown at the start) and the ending (shown on solve).
//
// The game shows beats unless the admin dashboard switches them off
// (web/js/director.js). Generated puzzles do not change: beats are
// worked out from a finished puzzle, so the same puzzle always gets the same
// beats.
//
// Beats never give away the answer. They only use the cast word ("ghost
// hunter"), a cast member picked without looking at the solution, and the
// theme's own words.
//
// HOW TO WRITE BEATS (a good first task):
//   Each theme has three lists. "early" beats show after the first section,
//   "middle" beats around halfway, "late" beats just before the last section.
//   Write each beat as one or two short sentences. You can use these slots:
//     {one}  the cast word, e.g. "ghost hunter"   {One}  same, capitalized
//     {many} the plural, e.g. "ghost hunters"     {Many} same, capitalized
//     {name} one of the cast (any of them, picked at random)
//   A theme with an empty list uses the "default" lines instead.
import { hashString } from './rng.js';

export const BEATS = {
  // Placeholder lines so the feature can be tested. Replace or add to them.
  default: {
    early: [
      'The first pieces fall into place. Somewhere, a door creaks.',
      '{name} looks around the room, as if counting who is still here.',
    ],
    middle: [
      'Halfway there. The {many} start to watch each other more closely.',
      '{name} clears their throat and changes the subject, a little too fast.',
    ],
    late: [
      'Only one part of the puzzle is left. Everyone goes quiet.',
      'The {many} gather together. The answer is close now.',
    ],
  },
  // Bobby's beats for the Mystery theme go here.
  mystery: { early: [], middle: [], late: [] },
};

const STAGES = ['early', 'middle', 'late'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The beats for a puzzle: [{ stage, after, text }], where `after` is the
// number of finished sections that shows it. A puzzle with 3 sections gets
// 2 beats, one with 4 or more gets 3. The last section never has a beat, so
// the ending stays the final word.
export function storyBeats(puzzle, beats = BEATS) {
  const sections = puzzle.grid.blocks.length;
  const count = Math.min(STAGES.length, sections - 1);
  if (count < 1) return [];
  const own = beats[puzzle.theme.id] || {};
  const seed = hashString(String(puzzle.story.id));
  const names = puzzle.categories[0].items.map((it) => it.label);
  const one = puzzle.cast.one, many = puzzle.cast.many;
  const stages = count === STAGES.length ? STAGES : count === 2 ? ['early', 'late'] : ['middle'];
  return stages.map((stage, i) => {
    const list = own[stage] && own[stage].length ? own[stage] : beats.default[stage];
    const text = list[(seed + i * 7) % list.length];
    const name = names[(seed >>> 3) % names.length];
    const vars = { one, One: cap(one), many, Many: cap(many), name };
    // Beats spread evenly over the sections before the last one.
    const after = Math.max(1, Math.round(((i + 1) * (sections - 1)) / count));
    return { stage, after, text: text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) };
  });
}
