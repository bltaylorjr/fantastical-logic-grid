# The Fantastical Logic Grid: puzzle and story engine

Generates logic grid puzzles with a storyline, numbered clues, story questions,
an answer key, a full step-by-step solve path and on-demand hints. Every puzzle
has exactly one solution and can be solved by deduction alone, with no guessing.

Plain JavaScript (ES modules), no dependencies. It runs in the browser and in Node 18+.

```js
import { generatePuzzle, getHint, isSolved, describeOptions } from './src/index.js';

const puzzle = generatePuzzle({ difficulty: 'hard', theme: 'holiday', topic: 'halloween', clueCount: 12, seed: 'abc' });
```

```
node cli.js --difficulty medium --theme holiday --topic halloween --seed party
node cli.js --difficulty mensa --json > puzzle.json
node cli.js --help
npm test            # full suite (about 2 minutes)
npm run test:quick  # one seed per theme and tier
```

## How a puzzle is made

This follows the design process step by step:

1. **Choose a theme and categories.** The player picks the theme. The engine picks
   one of its scenarios and the categories that story needs, and adds a numbered
   category (time, age, score...) whenever the tier uses ordering clues.
2. **Build the solution first.** A random, complete answer table is made before any clue.
3. **Set up the grid.** A standard staircase layout where every pair of categories
   meets exactly once (`puzzle.grid`).
4. **Write clues.** True clues of mixed types are drawn from the answer table,
   weighted by tier (direct matches, eliminations, either/or, ordering, conditional links...).
5. **Test for a single solution.** A solver that only makes human deductions tries
   to fill the grid. While it gets stuck, more clues are added. Then each clue is
   removed in turn, and any clue the puzzle does not need is dropped. A puzzle
   is accepted only when the solver fills every cell, which proves the solution
   is unique and needs no guessing. The test suite double-checks this with a
   separate brute-force search.
6. **Grade it.** The solve path is checked against the tier's rules (hardest
   technique needed, number of advanced steps, what-if steps). If it does not
   fit, the engine tries again with a fresh answer table (up to 60 tries or 15 seconds)
   and returns the closest match, with a note saying how it differs.

## Options

| Option | Values | Default |
| --- | --- | --- |
| `difficulty` | `basic`, `easy`, `medium`, `hard`, `expert`, `mensa` | `easy` |
| `theme` | `mystery`, `action`, `adventure`, `holiday`, `occasion` (Special Occasion), `fantasy`, `scifi`, `sports`, `cooking`, `pets`, `town` (Around Town), `parks` (National Parks), `travel` (Vacation Destinations), `wonders` (Architectural Wonders), `random` | `random` |
| `topic` | a topic id from the theme (see Themes, topics and stories), or `any`. Ignored when the theme is `random` | `any` (a random topic in the theme) |
| `categories` | 3 to 6 (number of categories, including the cast) | tier default |
| `items` | 3 to 8 (items per category) | tier default |
| `clueCount` | target number of clues | the fewest that work |
| `clueTypes` | subset of the clue types below | the tier's types |
| `customNames` | list of cast names (great for birthdays and family puzzles) | theme names |
| `title` | custom puzzle title | from the story |
| `questions` | 1 to 6 story questions | 3 |
| `seed` | any text. The same seed and options always give the same puzzle | random |
| `usedStories` | story ids already used on this device; none will be repeated | `[]` |

`describeOptions()` returns everything a setup screen needs (each theme lists
its `topics`, with `any` first as the default), including a
one-line summary for each tier.

**Clue count.** More clues make a puzzle easier, fewer make it harder. If the
target is above the minimum, the engine adds extra true clues that still keep
the tier's hardest technique necessary. If it is below what a unique solution
needs, the engine returns the smallest puzzle it found and says so in `notes`.

## Difficulty tiers

Each tier has fixed lever ranges, so a tier means the same thing every time.

| Tier | Categories | Items | Clue types | Deduction needed |
| --- | --- | --- | --- | --- |
| Basic | 3 | 3-4 | direct match, not, neither/nor | read clues, carry across grids |
| Easy | 3-4 | 4-5 | + either/or | must carry facts across grids |
| Medium | 4 | 4-5 | + more/less, all different | at least one advanced step |
| Hard | 4-5 | 5 | + exact gap, one of each | 4+ advanced steps |
| Expert | 5 | 5-6 | + if/then | 6+ advanced steps, up to 2 short what-if chains |
| MENSA | 5-6 | 6-7 | every type | 8+ advanced steps and at least one what-if chain |

Deduction levels used by the solver and in hints:

- **Direct**: read a clue and mark it. One O in a row rules out the rest of that row. The last open cell is the match.
- **Cross-grid**: carry a known match or mismatch from one grid into another.
- **Advanced**: ordering and exact gaps, if/then, and "these two share no possible option, so they cannot match".
- **What-if**: "If Ada were in the Library, clue 5 would break within a few steps, so she was not." The chain length is capped (3 passes for Expert, 5 for MENSA), so this stays reasoning, not guessing.

Custom sizes outside a tier's range are allowed and noted. Large custom grids
(6 x 8 at MENSA) can take 10 to 20 seconds, so in the app run `generatePuzzle`
in a Web Worker and show the "Writing your story..." message.

## Clue types

| Type | Example |
| --- | --- |
| `is` direct match | Ada was holding the Teacup. |
| `not` | The suspect who was in the Cellar was not drinking Mint Tea. |
| `neither` | Neither Felix nor Jasper was in the Library. |
| `either` | The suspect who arrived at 7:15 PM is either Ada or Hugo. |
| `pairs` one of each | Of Ada and Basil, one was in the Study and the other was in the Attic. |
| `allDiff` | Ada was not in the Study, and neither of them was drinking Cocoa. |
| `less` more/less | Basil arrived earlier than the suspect who was holding the Old Map. |
| `diff` exact gap | Clara is exactly 10 years older than Hugo. |
| `ifthen` | If Ada was in the Library, then Felix was drinking Coffee. |

Item names in clues match the grid labels exactly, and clue order is fixed once the puzzle is made.

## Themes, topics and stories

Fourteen themes, each a small world with its own cast and six categories (two of
them numbered) with eight items each.

Each theme has topics: the scenario under it, such as which holiday or which
kind of mystery. The topic shapes the whole puzzle: its categories and items
(Halloween has costumes, streets and pumpkins; Museum Heist has wings and
jobs), the cast ("trick-or-treaters"), the story parts and the art prompt. The
player can pick a topic or leave it on **Any**, which picks one at random.

| Theme | Topics |
| --- | --- |
| Mystery | Classic Whodunit (`whodunit`), Museum Heist (`heist`), Missing Person (`missing`), Cozy Village Mystery (`cozy`), Haunted House (`haunted`) |
| Action | Spy Mission (`spy`), Bank Heist Chase (`chase`), Disaster Rescue (`rescue`), Superhero Showdown (`heroes`) |
| Adventure | Jungle Treasure (`jungle`), Pirate Voyage (`pirates`), Polar Expedition (`polar`), Desert Ruins (`desert`) |
| Holiday | Christmas (`christmas`), Halloween (`halloween`), Thanksgiving (`thanksgiving`), Fourth of July (`july4`), Valentine's Day (`valentines`), New Year's Eve (`newyear`), Easter (`easter`) |
| Special Occasion | Birthday Party (`birthday`), Wedding (`wedding`), Graduation (`graduation`), Anniversary (`anniversary`), Baby Shower (`babyshower`), Retirement Party (`retirement`) |
| Fantasy | Dragon Kingdom (`dragons`), Wizard School (`school`), Fairy Forest (`fairy`), Knights' Quest (`knights`) |
| Sci-Fi | Space Station (`starbase`), Alien Contact (`contact`), Robot Lab (`robots`), Time Travel (`timetravel`) |
| Sports | World Games (`games`), Soccer Tournament (`soccer`), City Marathon (`marathon`), School Field Day (`fieldday`) |
| Cooking | Cook-Off (`cookoff`), Bake Sale (`bakesale`), Restaurant Kitchen (`restaurant`), Food Truck Rally (`foodtrucks`) |
| Pets | Pet Show (`show`), Pet Hotel (`hotel`), Dog Park (`dogpark`), Animal Shelter (`shelter`) |
| Around Town | Errand Day (`errands`), Fitness Center (`gym`), Church Bake Sale (`church`), Grocery Store (`grocery`), Public Library (`library`), Town Park (`townpark`) |
| National Parks | Trail Day (`trails`), Campground (`campground`), Junior Rangers (`juniors`), River Rafting (`rafting`), Stargazing Night (`stargazing`) |
| Vacation Destinations | Dream Getaways (`getaways`), Beach Resort (`beach`), City Sightseeing (`city`), Cruise Ship (`cruise`), Theme Park (`themepark`) |
| Architectural Wonders | Model Wonders Fair (`models`), Famous Bridges (`bridges`), Skyscrapers (`skyscrapers`), Ancient Wonders (`ancient`), Castles and Palaces (`castles`) |

The first topic of most themes is its classic setting (Classic Whodunit, Spy
Mission...), which uses the theme's own categories and story parts. A puzzle
reports its topic in `puzzle.topic` and its picture prompt in `puzzle.art`
(`setting`, a phrase for the scene, and `mood`, a few words for color and music).

**Stories are never reused.** Each story is assembled from parts in
`src/storylines.js` (or the topic's own in `src/topics.js`): a title word, an
opening, an incident (what is at stake), a mishap (why the facts are scrambled),
a lead tied to the goal category, and an ending. That gives 55,000 to 220,000
storylines per topic (`storylineCount(theme, topic)`), before the cast names and
items change. Every story has an id (`puzzle.story.id`) that records which parts
it used. It starts with the theme, plus the topic when the topic has its own
story parts: `mystery|t2|o1|i3|m0|lroom.1|e4` (Classic Whodunit) or
`holiday/halloween|t0|o5|i2|m1|lcostume.0|e3`. Ids saved before topics existed
stay valid, because classic topics kept the same id form.

**Stories match their grid.** A story only talks about its own topic: its
setting, its cast word and the categories in the grid. No story part names an
item or a cast name its topic can put in a grid (a story that says "a dozen
roses appeared" reads like a clue when Roses is a Flower item), every topic
with its own story gives every part kind and a lead for each of its
categories, and a topic can reuse a theme category with items that suit it
(`{ from: 'gear', items: [...] }`). The tests check all of this part by part
for every theme and topic, and on built stories at every grid size.

Story parts a player adds (`storyParts`) are keyed by story key: the theme id
for its classic topic, or `theme/topic` for one topic.

The app saves each id once a puzzle is started and passes the list back:

```js
const puzzle = generatePuzzle({ difficulty: 'hard', theme: 'mystery', usedStories: savedIds });
savedIds.push(puzzle.story.id);   // or storyId(puzzle)
```

The engine never returns a story whose id is in `usedStories`. It also picks
the story that shares the fewest parts (opening, incident, ending...) with the
last 300 used stories of the same topic, so back-to-back puzzles feel
different, not just technically different.

A story sets the scene in under 150 words and ends with the goal question
("Can you work out who was in the Library?"). The ending in `story.ending` is
the reward, shown on solve.

To add a theme, add its categories to `src/themes.js`, its story parts to
`src/storylines.js` and at least one topic to `src/topics.js`.

To add a topic, add an entry to the theme's list in `src/topics.js` with `id`,
`name`, `description` and `art`. Give it `categories` (theme category ids to
reuse and/or new ones: at least five, one numbered, eight items each, no label
used twice, and not the id `name`), and `story` parts (`adjs`, `openings`,
`incidents`, plus `mishaps`, `endings` or `leads` where the theme's own do not
fit). Every category needs at least one lead. The test suite checks all of this.

## The puzzle JSON

`generatePuzzle` returns plain JSON that can be saved and reloaded as is:

- `title`, `theme`, `topic` (`id`, `name`, `description`), `difficulty`, `seed`, `options`
- `art`: `setting` and `mood` for picture and music prompts
- `categories`: each with `id`, `name`, `items` (`{ id: 'room:2', label: 'Kitchen' }`), and phrasing
- `grid`: `columns`, `rows` and `blocks` (every pair of categories once)
- `story`: `id` (save it, see above), `title`, `paragraphs`, `goal`, `ending`, `wordCount`
- `clues`: `number`, `text`, `type`, `typeName`, and `logic` (machine-readable form)
- `questions`: `text`, `options` (item ids), `answer`
- `solution` and `answerKey` (`columns`, `rows`, question answers) for the answer page
- `solvePath`: each step's technique, clue number, the marks it makes and a plain-English explanation
- `stats`: clue count, steps by level, hardest level, longest what-if chain, difficulty score
- `notes`: anything that differs from what was asked

## Play helpers

All of these work from the saved puzzle JSON. Marks are `{ a: itemId, b: itemId, mark: 'O' | 'X' }`.

- `getHint(puzzle, marks)`: the next easiest deduction from the player's grid, with three
  levels for stepped hints: which clue, which cell, then the reasoning. Wrong marks are reported first.
- `checkMarks(puzzle, marks)`: returns the marks that are wrong.
- `isSolved(puzzle, marks)`: true when every match is placed and nothing is wrong (X marks are optional).
- `checkAnswers(puzzle, { 1: 'name:2', ... })`: scores the story questions.
- `formatPuzzleText(puzzle)`: a plain text version for printing, with the answer key on its own page.

## Browser build and workshop page

`dist/logic-grid-engine.js` is a single-file browser build (global `LogicGrid`).
`preview/workshop.html` is a playable test page: pick options, generate, play with
stepped hints, and see the answer key, solve path and JSON. Rebuild both after
changing `src/` with:

```
npx esbuild src/index.js --bundle --format=iife --global-name=LogicGrid --outfile=dist/logic-grid-engine.js
python3 preview/build.py
```

## Files

```
src/index.js       public API
src/generator.js   puzzle building, clue selection, grading, JSON output
src/solver.js      human-style deduction solver (also drives hints)
src/clues.js       true clue candidates from the solution
src/language.js    clue and hint wording
src/story.js       storyline and questions
src/themes.js      theme casts and categories
src/topics.js      topics under each theme: categories, story parts, art
src/storylines.js  story parts per theme
src/tiers.js       difficulty tiers and clue types
src/play.js        hints, checking and print text
cli.js             command line generator
dist/              single-file browser build
preview/           workshop page (preview.src.html + build.py -> workshop.html)
test/run-tests.js  test suite with brute-force uniqueness check
```
