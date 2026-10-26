// The tutorial's lessons: small fixed puzzles of its own (three friends at a
// fair), never drawn from the story pool, so a tutorial never uses up a story.
// Clue sentences come from the engine's own wording, so they read exactly like
// the clues in a real puzzle.
//
// A step is { title, text (HTML written here), expect: ['O Ava Owl', ...],
// given: marks already on the grid, clues: clue numbers to light up,
// spot: squares to point at, free: solve the whole grid, puzzle }.
import { makeLanguage, clueText } from '../engine/language.js';
import { gridLayout } from '../engine/generator.js';
import { CLUE_TYPES } from '../engine/tiers.js';

const N = 3;
const CATS = {
  name: { id: 'name', name: 'Friend', noun: 'friend', labels: ['Ava', 'Ben', 'Cleo'], pos: 'is {x}', neg: 'is not {x}' },
  pet: { id: 'pet', name: 'Pet', noun: 'pet', labels: ['Cat', 'Dog', 'Owl'], pos: 'brought the {x}', neg: 'did not bring the {x}' },
  hat: { id: 'hat', name: 'Hat', noun: 'hat', labels: ['Blue', 'Green', 'Red'], pos: 'wears the {x} hat', neg: 'does not wear the {x} hat' },
  age: {
    id: 'age', name: 'Age', noun: 'age', labels: ['7', '8', '9'], pos: 'is {x} years old', neg: 'is not {x} years old',
    ordinal: { less: 'is younger than', more: 'is older than', lessBy: 'is {d} younger than', moreBy: 'is {d} older than', gaps: ['', '1 year', '2 years'] },
  },
};
const CAST = { one: 'friend', many: 'friends' };

// Builds an engine-format puzzle. sol: { pet: [Ava's, Ben's, Cleo's item index], ... }.
// A clue is written with item labels: ['is', 'Ava', 'Owl'], ['neither', ['Ava', 'Ben'], 'Dog'], ...
export function buildPuzzle({ id, cats, sol, clues }) {
  const C = cats.map((k) => CATS[k]);
  const idOf = (label) => {
    for (const c of C) { const i = c.labels.indexOf(label); if (i >= 0) return `${c.id}:${i}`; }
    throw new Error(`Tutorial: no item ${label}`);
  };
  const toG = (itemId) => { const [c, i] = itemId.split(':'); return C.findIndex((x) => x.id === c) * N + Number(i); };
  const L = makeLanguage({ K: C.length, N, cast: CAST, cats: C.map((c) => ({ name: c.name, labels: c.labels, pos: c.pos, neg: c.neg, ordinal: c.ordinal || null })) });
  const ageIx = C.findIndex((c) => c.ordinal);
  const logicOf = ([type, ...a]) => {
    switch (type) {
      case 'is': case 'not': return { type, a: idOf(a[0]), b: idOf(a[1]) };
      case 'neither': return { type, xs: a[0].map(idOf), b: idOf(a[1]) };
      case 'either': return { type, a: idOf(a[0]), b1: idOf(a[1]), b2: idOf(a[2]) };
      case 'pairs': return { type, x1: idOf(a[0][0]), x2: idOf(a[0][1]), y1: idOf(a[1][0]), y2: idOf(a[1][1]) };
      case 'allDiff': return { type, items: a.map(idOf) };
      case 'less': return { type, o: ageIx, a: idOf(a[0]), b: idOf(a[1]) };
      case 'diff': return { type, o: ageIx, a: idOf(a[0]), b: idOf(a[1]), d: a[2] };
      case 'ifthen': return { type, p: a[0].map(idOf), q: a[1].map(idOf) };
      default: throw new Error(`Tutorial: unknown clue ${type}`);
    }
  };
  const asG = (logic) => Object.fromEntries(Object.entries(logic).map(([k, v]) => [k, k === 'type' || k === 'o' || k === 'd' ? v : Array.isArray(v) ? v.map(toG) : toG(v)]));
  return {
    engine: 'The Fantastical Logic Grid', id: `tutorial-${id}`, tutorial: true,
    title: 'Tutorial', theme: { id: 'tutorial', name: 'Tutorial' },
    difficulty: { id: 'basic', name: 'Basic' }, cast: CAST,
    categories: C.map((c) => ({
      id: c.id, name: c.name, noun: c.noun, ordinal: !!c.ordinal,
      items: c.labels.map((label, i) => ({ id: `${c.id}:${i}`, label })),
      pos: c.pos, neg: c.neg, ...(c.ordinal ? { phrases: c.ordinal } : {}),
    })),
    grid: gridLayout(C),
    clues: clues.map((c, i) => {
      const logic = logicOf(c);
      return { number: i + 1, text: clueText(L, asG(logic)), type: logic.type, typeName: CLUE_TYPES[logic.type], logic };
    }),
    questions: [],
    solution: [0, 1, 2].map((e) => Object.fromEntries(C.map((c, ci) => [c.id, `${c.id}:${ci === 0 ? e : sol[c.id][e]}`]))),
  };
}

// Ava has the Owl and the Red hat, Ben the Cat and Blue, Cleo the Dog and Green.
// Ages: Ava 9, Ben 7, Cleo 8.
const FAIR = { pet: [2, 0, 1], hat: [2, 0, 1], age: [2, 0, 1] };
const drill = (id, cats, clue) => buildPuzzle({ id: `drill-${id}`, cats, sol: FAIR, clues: [clue] });
const PH = ['name', 'pet', 'hat'];
const PA = ['name', 'pet', 'age'];

export const LESSONS = [
  {
    id: 'first-grid',
    title: 'Your first grid',
    summary: 'What a logic grid is, X and O, and the "only one left" trick.',
    puzzle: buildPuzzle({ id: 'first', cats: ['name', 'pet'], sol: FAIR, clues: [['is', 'Ava', 'Owl'], ['not', 'Ben', 'Dog']] }),
    steps: [
      { title: 'What a logic grid puzzle is', text: `<p>A logic grid puzzle gives you a few groups of things and some clues. Here there are three friends at a fair (Ava, Ben and Cleo) and three pets (a Cat, a Dog and an Owl).</p>
        <p>Each friend brought <b>exactly one</b> pet, and no two friends brought the same one. Your job is to work out who brought which, using only the clues. You never need to guess.</p>` },
      { title: 'Reading the grid', text: `<p>The grid has a <b>row</b> for each friend and a <b>column</b> for each pet. Each square asks one question: <i>do this friend and this pet go together?</i></p>
        <p>You answer with a mark. <b>X</b> means no, they don't go together. <b>O</b> means yes, they are a match. Tap a square once for X, twice for O, and a third time to clear it. With a keyboard, move with the arrow keys and press X or O. Right-click or long-press a square for a menu.</p>` },
      { title: 'A direct clue', clues: [1], spot: ['Ava Owl'], expect: ['O Ava Owl'], text: `<p>Clue 1 says Ava brought the Owl. That's a yes, so put an <b>O</b> where Ava's row meets the Owl column. Tap that square twice, or select it and press O.</p>` },
      { title: 'One match in every row and column', spot: ['Ava Cat', 'Ava Dog', 'Ben Owl', 'Cleo Owl'], expect: ['X Ava Cat', 'X Ava Dog', 'X Ben Owl', 'X Cleo Owl'], text: `<p>Ava brought only one pet, so she did not bring the Cat or the Dog. And nobody else brought the Owl.</p>
        <p>So every other square in Ava's row and in the Owl column is a no. Mark those four squares with <b>X</b> (one tap each).</p>` },
      { title: 'A "not" clue', clues: [2], spot: ['Ben Dog'], expect: ['X Ben Dog'], text: `<p>Clue 2 says Ben did not bring the Dog. That's a no for one square: put an <b>X</b> where Ben meets the Dog.</p>` },
      { title: 'Only one left', expect: ['O Ben Cat', 'X Cleo Cat'], text: `<p>Look along Ben's row. The Dog and the Owl both have an X, so only the Cat is left. Ben must have brought the Cat: mark it <b>O</b>.</p>
        <p>The Cat is now taken, so put an <b>X</b> for Cleo under the Cat.</p>` },
      { title: 'Finish the grid', expect: ['O Cleo Dog'], text: `<p>Cleo's row has one empty square left. When only one square is left in a row or column, it must be the match. Mark it <b>O</b>.</p>` },
      { title: 'Solved!', text: `<p>That is the whole game in three moves:</p>
        <ol><li>Read a clue and mark what it tells you.</li><li>After every O, put X in the rest of its row and column.</li><li>Look for a row or column with only one empty square left.</li></ol>
        <p>Tip: the setting <b>Auto-X</b> (in Settings) can fill in those X marks for you once you're used to it.</p>` },
    ],
  },
  {
    id: 'three-groups',
    title: 'Three groups and the staircase',
    summary: 'Grids with several sections, and carrying facts from one section to another.',
    puzzle: buildPuzzle({ id: 'three', cats: PH, sol: FAIR, clues: [['is', 'Ava', 'Owl'], ['is', 'Ava', 'Red'], ['not', 'Cleo', 'Blue'], ['not', 'Cat', 'Green']] }),
    steps: [
      { title: 'A bigger grid', text: `<p>Now each friend also wears a hat: Blue, Green or Red. With three groups, the grid has three <b>sections</b> set out like a staircase:</p>
        <ul><li>Friends and Pets, at the top left</li><li>Friends and Hats, at the top right</li><li>Hats and Pets, at the bottom</li></ul>
        <p>Every pair of groups gets one section, and the rule is the same in each: one O in every row and column of a section.</p>` },
      { title: 'Two direct clues', clues: [1, 2], expect: ['O Ava Owl', 'O Ava Red', 'X Ava Cat', 'X Ava Dog', 'X Ben Owl', 'X Cleo Owl', 'X Ava Blue', 'X Ava Green', 'X Ben Red', 'X Cleo Red'],
        text: `<p>Clues 1 and 2 tell you Ava's pet and Ava's hat. Mark both with <b>O</b>, then put <b>X</b> in the rest of each O's row and column, inside its own section. That's 2 O's and 8 X's.</p>
        <p>Stuck on any step? Press <b>Show me</b>.</p>` },
      { title: 'Carry facts across sections', spot: ['Red Owl'], expect: ['O Red Owl', 'X Red Cat', 'X Red Dog', 'X Blue Owl', 'X Green Owl'],
        text: `<p>Here is the most useful trick in logic puzzles. Ava brought the Owl, and Ava wears Red, so <b>the Owl's owner wears Red</b>.</p>
        <p>Find the square where Red meets the Owl in the bottom section and mark it <b>O</b>. Then put X in the rest of that row and column.</p>` },
      { title: 'A "not" clue, then only one left', clues: [3], expect: ['X Cleo Blue', 'O Cleo Green', 'X Ben Green', 'O Ben Blue'],
        text: `<p>Clue 3 says Cleo does not wear the Blue hat: mark it <b>X</b>. Now Cleo's row in the hats section has only Green left, so mark <b>O</b> there.</p>
        <p>That leaves Blue for Ben: X Ben's Green square, and O his Blue one.</p>` },
      { title: 'A clue for the bottom section', clues: [4], expect: ['X Green Cat', 'O Blue Cat', 'X Blue Dog', 'O Green Dog'],
        text: `<p>Clue 4 talks about a pet and a hat, so it belongs in the bottom section: put an <b>X</b> where Green meets the Cat.</p>
        <p>Now the Cat's column has only Blue left (O), and the Dog must go with Green (X its Blue square, O its Green one).</p>` },
      { title: 'Carry it back up', expect: ['O Ben Cat', 'O Cleo Dog', 'X Ben Dog', 'X Cleo Cat'],
        text: `<p>The bottom section now gives you the pets. Ben wears Blue, and Blue goes with the Cat, so <b>Ben brought the Cat</b>. Cleo wears Green, and Green goes with the Dog, so <b>Cleo brought the Dog</b>.</p>
        <p>Fill in the last of the top-left section.</p>` },
      { title: 'Solved!', text: `<p>When you are stuck, compare sections:</p>
        <ul><li>If A goes with B, and A goes with C, then B goes with C.</li><li>If A goes with B, but A does not go with C, then B does not go with C either.</li></ul>
        <p>Bigger puzzles just have more sections. The same two rules solve most of them.</p>` },
    ],
  },
  {
    id: 'clue-types',
    title: 'Every kind of clue',
    summary: 'All nine clue types, each with a short exercise.',
    puzzle: drill('is', PH, ['is', 'Ben', 'Cat']),
    steps: [
      { title: 'Direct match', expect: ['O Ben Cat', 'X Ben Dog', 'X Ben Owl', 'X Ava Cat', 'X Cleo Cat'], clues: [1],
        text: `<p>The puzzles in the game use nine kinds of clue. Here is each one, on a fresh grid.</p>
        <p><b>A direct match</b> is a plain yes. Mark the <b>O</b>, then X the rest of its row and column.</p>` },
      { title: 'Not a match', puzzle: drill('not', PH, ['not', 'Cleo', 'Owl']), clues: [1], expect: ['X Cleo Owl'],
        text: `<p><b>Not a match</b> is a no for one square: one <b>X</b>. These clues look small, but together they leave only one square in a row.</p>` },
      { title: 'Neither / nor', puzzle: drill('neither', PH, ['neither', ['Ava', 'Ben'], 'Dog']), clues: [1], expect: ['X Ava Dog', 'X Ben Dog', 'O Cleo Dog'],
        text: `<p><b>Neither / nor</b> names two people, and both are a no: X Ava's Dog square and X Ben's.</p>
        <p>Then look down the Dog's column: only Cleo is left, so mark her <b>O</b>.</p>` },
      { title: 'Either / or', puzzle: drill('either', PH, ['either', 'Ava', 'Cat', 'Owl']), given: ['O Ben Cat', 'X Ben Dog', 'X Ben Owl', 'X Ava Cat', 'X Cleo Cat'], clues: [1], expect: ['X Ava Dog', 'O Ava Owl'],
        text: `<p><b>Either / or</b> gives two choices, and exactly one is true. So every choice it doesn't name is out: <b>X</b> Ava's Dog square.</p>
        <p>An earlier clue already gave Ben the Cat (marked for you), so the Cat is taken. That leaves the Owl for Ava: <b>O</b>.</p>` },
      { title: 'One of each', puzzle: drill('pairs', PH, ['pairs', ['Ava', 'Ben'], ['Owl', 'Cat']]), clues: [1], expect: ['X Ava Dog', 'X Ben Dog', 'X Cleo Owl', 'X Cleo Cat', 'O Cleo Dog'],
        text: `<p><b>One of each</b> says two people have two things between them, in some order. So neither Ava nor Ben has the Dog (two X's), and Cleo has neither the Owl nor the Cat (two more X's).</p>
        <p>That leaves the Dog for Cleo: <b>O</b>.</p>` },
      { title: 'All different', puzzle: drill('alldiff', PH, ['allDiff', 'Cleo', 'Owl', 'Blue']), clues: [1], spot: ['Blue Owl'], expect: ['X Cleo Owl', 'X Cleo Blue', 'X Blue Owl'],
        text: `<p><b>All different</b> names three people who are all different: Cleo, the Owl's owner and the Blue hat wearer. No two of them can be the same person.</p>
        <p>So mark three <b>X</b>'s: Cleo and the Owl, Cleo and Blue, and Blue and the Owl in the bottom section.</p>` },
      { title: 'More / less', puzzle: drill('less', PA, ['less', 'Ben', 'Dog']), clues: [1], expect: ['X Ben Dog', 'X Ben 9', 'X 7 Dog'],
        text: `<p>Some groups have an order, like ages 7, 8 and 9. <b>More / less</b> clues compare two people, and tell you three things:</p>
        <ul><li>They are different people: X Ben and the Dog.</li><li>The younger one can't be the oldest: X Ben and 9.</li><li>The older one can't be the youngest: X 7 and the Dog, in the bottom section.</li></ul>` },
      { title: 'Exact gap', puzzle: drill('diff', PA, ['diff', 'Ben', 'Owl', 2]), clues: [1], expect: ['O Ben 7', 'O 9 Owl', 'X Ben Owl'],
        text: `<p><b>Exact gap</b> clues give the size of the difference. With ages 7 to 9, a gap of exactly 2 years only fits 7 and 9.</p>
        <p>So Ben is 7 and the Owl's owner is 9: mark both <b>O</b>. They are different people too, so <b>X</b> Ben and the Owl.</p>` },
      { title: 'If / then', puzzle: drill('ifthen', PH, ['ifthen', ['Ava', 'Cat'], ['Cleo', 'Blue']]), given: ['X Cleo Blue'], clues: [1], expect: ['X Ava Cat'],
        text: `<p><b>If / then</b> clues work best backwards: if the "then" part is false, the "if" part must be false too.</p>
        <p>An earlier clue already ruled out Cleo and Blue (marked for you). So Ava did not bring the Cat: <b>X</b>.</p>
        <p>Careful: it doesn't work the other way round. Knowing Ava did not bring the Cat would tell you nothing about Cleo's hat.</p>` },
      { title: 'Every clue, done', text: `<p>Those are all nine. Basic puzzles use the first three. Each level adds more: Easy adds either / or, Medium adds more / less and all different, Hard adds exact gaps and one of each, and Expert and MENSA add if / then.</p>
        <p>Whatever the clue, ask two questions: <i>what does it rule out?</i> and <i>what does that leave?</i></p>` },
    ],
  },
  {
    id: 'what-if',
    title: 'What if? Thinking ahead',
    summary: 'What to do when no clue gives a straight answer.',
    puzzle: buildPuzzle({ id: 'whatif', cats: PH, sol: { pet: [0, 2, 1], hat: [0, 1, 2] }, clues: [['either', 'Ava', 'Cat', 'Owl'], ['is', 'Owl', 'Green'], ['not', 'Ava', 'Green']] }),
    steps: [
      { title: 'When you are stuck', text: `<p>Sometimes no clue tells you anything straight away. Then pick one square and ask: <i>what if this were an O?</i> Follow the clues from there. If you reach something impossible, that square must be an <b>X</b>.</p>
        <p>Do this in your head, or in <b>My notes</b> in a real puzzle, rather than on the grid, so you never leave a guess behind. If you do try it on the grid, <b>Undo</b> takes it back.</p>` },
      { title: 'Try it', clues: [1, 2, 3], spot: ['Ava Owl'], expect: ['X Ava Owl'],
        text: `<p>Clue 1 gives Ava two choices. Test one: <i>what if Ava brought the Owl?</i> Clue 2 says the Owl's owner wears Green, so Ava would wear Green. But clue 3 says Ava does not wear Green. That's impossible.</p>
        <p>So Ava did not bring the Owl. Mark <b>X</b> where Ava meets the Owl.</p>` },
      { title: 'Back to the clue', clues: [1], expect: ['O Ava Cat', 'X Ava Dog', 'X Ben Cat', 'X Cleo Cat'],
        text: `<p>Clue 1 left Ava the Cat or the Owl. The Owl is out, so Ava brought the Cat: mark it <b>O</b>, and X the rest of its row and column.</p>` },
      { title: 'A shortcut', text: `<p>Many what-ifs have a shortcut. Here: the Owl goes with Green, and Ava does not go with Green, so Ava can't go with the Owl. That's the "carry facts across sections" trick from lesson 2.</p>
        <p>Reach for what-if last, after every clue and every section. Only Expert and MENSA puzzles need long what-if chains.</p>` },
    ],
  },
  {
    id: 'on-your-own',
    title: 'Hints, Check and your first solve',
    summary: 'The tools that help you, then a whole puzzle on your own.',
    puzzle: buildPuzzle({ id: 'solo', cats: PH, sol: { pet: [1, 2, 0], hat: [1, 2, 0] }, clues: [['is', 'Cleo', 'Cat'], ['neither', ['Ava', 'Cleo'], 'Red'], ['not', 'Cleo', 'Green'], ['not', 'Owl', 'Green']] }),
    steps: [
      { title: 'Your tools', text: `<p>Every puzzle has buttons to help you:</p>
        <ul><li><b>Hint</b> starts with a nudge (which clue to use), then shows the exact square, then explains the full reasoning.</li>
        <li><b>Check</b> shows any marks that are wrong. A wrong O leads to more wrong marks, so check early if something feels off.</li>
        <li><b>Undo</b> and <b>Redo</b> take back moves, as many as you like.</li>
        <li><b>My notes</b> is a private notepad for a chain of thought.</li>
        <li>Tick a clue's box when you have used it all up, so you can see what's left.</li></ul>
        <p>Hints and checks lower your score on the scoreboard a little, but they never stop you finishing.</p>` },
      { title: 'Solve it on your own', free: true,
        text: `<p>Here is a whole puzzle. Use the clues to place every <b>O</b>. Hint and Check work just like in the game. Here they cost nothing.</p>` },
      { title: 'Case closed!', text: `<p>You solved a logic grid puzzle on your own. You are ready for the real thing.</p>
        <p>Start with a <b>Basic</b> puzzle. When you can solve one without hints, try the next level up. The story questions under the clues are answered from the finished grid.</p>` },
    ],
  },
];

// Short tips for the reference page: [heading, [tips]].
export const TIPS = [
  ['Getting started', [
    'Read the story first. It tells you who is involved, and its last line is the question you are working toward.',
    'Start with direct clues ("Ava brought the Owl"). They give you O\'s straight away.',
    'After every O, put X in the rest of its row and column in that section. Auto-X in Settings can do this for you.',
    'Basic puzzles never need guessing. Neither does any other level: every puzzle has exactly one answer you can reason your way to.',
  ]],
  ['Finding the next move', [
    'Look for a row or column with only one empty square. It must be the O.',
    'Carry facts across sections: if A goes with B and A goes with C, then B goes with C. If A goes with B but not with C, then B does not go with C.',
    'Go back over the clues after each new O. A clue that told you nothing at first often finishes a row later on.',
    'Clues about two groups that aren\'t people (a pet and a hat) belong in the bottom sections of the staircase.',
    'Tick a clue when everything it says is on the grid. Only tick "not" clues once their X is marked.',
  ]],
  ['Reading tricky clues', [
    'Either / or: everything the clue doesn\'t name is ruled out.',
    'Neither / nor and all different: everyone named is a different person, so they rule each other out.',
    'One of each: the two people share those two things, so nobody else has them, and they have nothing else from that group.',
    'More / less: the smaller one can\'t be the largest value, and the larger one can\'t be the smallest. They are never the same person.',
    'Exact gap: count which pairs of values have that gap. In a small range there are often only one or two.',
    'If / then: if the "then" part is false, the "if" part is false too. It never works the other way round.',
  ]],
  ['When you are stuck', [
    'Ask "what if this square were an O?" and follow the clues. If something breaks, it\'s an X.',
    'Write the chain in My notes rather than guessing on the grid, or use Undo to take a test mark back.',
    'Press Check to make sure no earlier mark is wrong. One wrong O can block the whole puzzle.',
    'Press Hint for a nudge. Each step of a hint (the clue, the square, the reason) is one hint.',
    'Take a break. A fresh look often shows a row you missed.',
  ]],
  ['Playing your way', [
    'Prefer words to grids? List view lets you pick each match from a menu.',
    'The whole game works by keyboard. Press R on a square to hear its row described, and ? for every key.',
    'Silent mode shows only the story, grid, clues and answer key, with no pictures, sound or animation.',
    'Move up a level when you can solve without hints. Bigger sizes in the same level are a gentle next step too.',
  ]],
];
