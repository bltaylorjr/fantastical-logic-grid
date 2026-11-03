// Story theme checks shared by every grid-kit game's tests:
//   themeStoryChecks(check, 'ml', generateMoreOrLess, def)
// The story is only a wrapper: the same seed gives the same puzzle with a
// theme, without one, or with no story at all, and a theme's story is the same
// every time. Story moments never hold a digit (so they cannot give away a
// number from the answer) and Picture Grid never names its picture before the end.
import { KIT_THEME_IDS } from '../src/kit-story.js';

const strip = ({ story, ...rest }) => JSON.stringify(rest);

export function themeStoryChecks(check, game, generate, def, { difficulty = 'basic', themes = ['mystery', 'nautical', 'paradox'] } = {}) {
  const seed = `story-${game}`;
  const off = generate({ difficulty, seed, story: false });
  const classic = generate({ difficulty, seed });
  check(`${game} classic story kept without a theme`, classic.story && classic.story.theme === null && !classic.story.id.includes('mystery'));
  check(`${game} classic story gets story moments`, classic.story.beats.length === 3 && classic.story.beats.every((b) => b && !/\d/.test(b)));
  check(`${game} classic puzzle matches story off`, strip(classic) === strip(off));
  for (const theme of themes) {
    const p = generate({ difficulty, seed, theme });
    const s = p.story;
    check(`${game} ${theme}: puzzle unchanged by the story`, strip(p) === strip(off));
    check(`${game} ${theme}: theme respected`, s.theme === theme && (game === 'pg' || s.id.includes(theme)));
    check(`${game} ${theme}: title, opening and ending`, s.title.startsWith('The ') && s.intro.length > 30 && s.ending.length > 10);
    check(`${game} ${theme}: three story moments, no digits`, s.beats.length === 3 && s.beats.every((b) => b.length > 5 && !/\d/.test(b)), JSON.stringify(s.beats));
    check(`${game} ${theme}: no slot left unfilled`, ![s.title, s.intro, s.ending, ...s.beats].some((t) => /[{}]/.test(t)));
    check(`${game} ${theme}: same seed, same story`, JSON.stringify(generate({ difficulty, seed, theme }).story) === JSON.stringify(s));
    if (p.picture) check(`${game} ${theme}: the picture is not named before the end`, ![s.title, s.intro, ...s.beats].some((t) => t.toLowerCase().includes(p.picture.name.replace(/^an? /, '').toLowerCase())));
    const kept = def.cleanPuzzle(JSON.parse(JSON.stringify(p)));
    check(`${game} ${theme}: cleanPuzzle keeps the story`, kept && JSON.stringify(kept.story) === JSON.stringify(s));
  }
  const sur = generate({ difficulty, seed, theme: 'surprise' });
  check(`${game} surprise picks a real theme, the same each time`, KIT_THEME_IDS.includes(sur.story.theme) && generate({ difficulty, seed, theme: 'surprise' }).story.id === sur.story.id);
  check(`${game} unknown theme is a surprise`, KIT_THEME_IDS.includes(generate({ difficulty, seed, theme: 'nope' }).story.theme));
  if (game !== 'pg') {
    const again = generate({ difficulty, seed, theme: 'mystery', usedStories: [generate({ difficulty, seed, theme: 'mystery' }).story.id] });
    check(`${game} a used story is not told again`, again.story.id !== generate({ difficulty, seed, theme: 'mystery' }).story.id);
  }
  const bad = def.cleanPuzzle({ ...JSON.parse(JSON.stringify(sur)), story: { ...sur.story, theme: '<x>', beats: ['a', 5, 'c', 'd', 'e'] } });
  check(`${game} cleanPuzzle checks the story fields`, bad && bad.story.theme === null && bad.story.beats.length === 3 && bad.story.beats.every((b) => typeof b === 'string'));
  const old = def.cleanPuzzle({ ...JSON.parse(JSON.stringify(sur)), story: { id: 'x', title: 'Old', intro: 'Old intro', ending: 'Old end' } });
  check(`${game} cleanPuzzle opens a save from before themes`, old && old.story.title === 'Old' && old.story.beats.length === 0);
}
