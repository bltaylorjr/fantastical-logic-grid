// How to play: the full rules of every NINETIMESNINE game, each with a worked
// example on a small 4×4 grid. ui.js shows them in the How to play dialog;
// the same text is the source for the printed rules document.
//
// Example grids are written a row at a time, cells split by spaces:
//   1    a given number          .    an empty cell
//   +2   a number just placed    n2   a number placed earlier
//   y2   a cell you claimed      r2   a cell the rival claimed
//   x2   a wrong number          z.   a cell that would link to the chain
//   ~    water over an empty cell    ~2   water hiding a given 2

// The 4×4 puzzle every example uses. Its answer is
//   1 2 | 3 4
//   3 4 | 1 2
//   2 1 | 4 3
//   4 3 | 2 1
const START = ['1 . . 4', '. 4 1 .', '2 . . 3', '. 3 2 .'];

export const HOWTO = [
  {
    id: 'classic',
    goal: 'Fill every empty cell so that each row, each column and each box holds every number exactly once.',
    rules: [
      'A 9×9 grid uses the numbers 1 to 9 and has nine 3×3 boxes. Smaller grids work the same way: a 6×6 grid uses 1 to 6 with 2×3 boxes, and a 4×4 grid uses 1 to 4 with 2×2 boxes.',
      'Some numbers are given at the start. They are printed in bold and cannot be changed.',
      'No number may appear twice in any row, any column or any box.',
      'Every puzzle has exactly one answer, and you can always reach it by logic. You never need to guess.',
      'Extra rules are optional. With Diagonals, both long diagonals also hold every number once. With Odd and even, shaded cells hold even numbers and the rest hold odd numbers.',
      'You win when every cell is filled in correctly. Your time, hints and slips are kept in your stats.',
    ],
    tools: [
      'Notes: switch Notes on (or hold Shift) to pencil in the numbers a cell could be. Fill notes does it for every empty cell at once.',
      'Hint: the first press gives a nudge, the next shows where to look, and the last explains why the number goes there.',
      'Check marks any wrong numbers in red. Undo and Redo step back and forward through your moves.',
      'Show the answer ends the puzzle without counting it as solved.',
    ],
    example: {
      intro: 'A 4×4 puzzle, with 2×2 boxes and the numbers 1 to 4.',
      steps: [
        { grid: START, say: 'The puzzle as given. Start with row 1: it already has 1 and 4, so it is missing 2 and 3.' },
        { grid: ['1 +2 . 4', '. 4 1 .', '2 . . 3', '. 3 2 .'], say: 'Column 2 already has a 3 (in row 4), so the 3 cannot go in row 1, column 2. That cell must be 2.' },
        { grid: ['1 n2 +3 4', '. 4 1 .', '2 . . 3', '. 3 2 .'], say: 'Row 1 now needs only a 3, so row 1, column 3 is 3.' },
        { grid: ['1 n2 n3 4', '+3 4 1 +2', '2 . . 3', '. 3 2 .'], say: 'Row 2 is missing 2 and 3. Column 1 already has a 2, so row 2, column 1 is 3 and row 2, column 4 is 2.' },
        { grid: ['1 n2 n3 4', 'n3 4 1 n2', '2 +1 +4 3', '+4 3 2 +1'], say: 'The same logic finishes rows 3 and 4. Every row, column and box now holds 1, 2, 3 and 4 once. Solved!' },
      ],
    },
    tips: ['Look for a row, column or box that is nearly full first.', 'If a number can go in only one cell of a row, column or box, it goes there.'],
  },
  {
    id: 'rival',
    goal: 'Claim more cells than the computer rival. You take turns on one shared grid.',
    rules: [
      'The puzzle follows the classic rules: each row, column and box holds every number once.',
      'You move first. On your turn, place one number in an empty cell.',
      'If the number is right, the cell becomes yours and is colored in your color. Your turn ends.',
      'If the number is wrong, it is taken back, it counts as a slip, and your turn passes to the rival.',
      'Then the rival takes its turn. It places one number it can prove by logic and claims that cell, outlined in its color. Sometimes it cannot find a move and passes back to you.',
      'Notes never end your turn, so you can pencil in as much as you like before you commit. You can write notes while the rival is thinking.',
      'There is no undo, and a claimed cell stays claimed. Given numbers belong to nobody.',
      'When the grid is full, whoever claimed more cells wins. Equal counts make a draw.',
    ],
    tools: [
      'Hint works on your turn. If you use Fill it in from a hint, that counts as your move.',
      'Check and Show mistakes are switched off, because a wrong number never stays on the grid.',
      'The rival adapts to you: it starts Steady, gets Sharp and then Relentless as you win, and eases back to Apprentice if you lose. A sharper rival thinks faster, knows harder techniques and misses fewer moves.',
    ],
    example: {
      intro: 'The same 4×4 puzzle, played as a duel.',
      steps: [
        { grid: START, say: 'Your turn. Row 1 is missing 2 and 3, and column 2 already has a 3.' },
        { grid: ['1 y2 . 4', '. 4 1 .', '2 . . 3', '. 3 2 .'], say: 'You place 2 in row 1, column 2. It is right, so the cell is yours. Score: you 1, rival 0.' },
        { grid: ['1 y2 r3 4', '. 4 1 .', '2 . . 3', '. 3 2 .'], say: 'The rival spots that row 1 now needs only a 3 and claims row 1, column 3. Score: 1 to 1.' },
        { grid: ['1 y2 r3 4', 'x2 4 1 .', '2 . . 3', '. 3 2 .'], say: 'You try 2 in row 2, column 1. But column 1 already has a 2, so it is wrong. It is taken back and your turn passes.' },
        { grid: ['1 y2 r3 4', 'r3 4 1 .', '2 . . 3', '. 3 2 .'], say: 'The rival claims the 3 in row 2, column 1. Score: you 1, rival 2. Your turn again: the 2 in row 2, column 4 is now forced, so take it.' },
      ],
    },
    tips: ['Use notes freely: they are the one thing that never costs a turn.', 'Grab forced cells before the rival sees them.'],
  },
  {
    id: 'chain',
    goal: 'Score as many points as you can by linking your moves into long chains.',
    rules: [
      'The puzzle follows the classic rules: each row, column and box holds every number once.',
      'A move links to your chain when the new number shares a row, a column or a box with the number you placed just before it. Cells that would link are outlined, and your last number is ringed.',
      'Each linked move makes the chain one longer. A move that does not link starts a new chain of 1.',
      'Each move scores the length of the chain it makes: the first number scores 1, the next linked number 2, then 3, and so on.',
      'A forced number scores double. A number is forced when it is the only number left for that cell, or the only cell left for that number in its row, column or box.',
      'A wrong number breaks the chain back to 0 and counts as a slip. Erase it and carry on.',
      'There is no undo, so look before you place.',
      'Your goal for the puzzle is shown at the top: a chain length to reach. It grows as your best chains grow.',
    ],
    tools: ['Notes, Fill notes, Hint and Check all work as usual. Hints do not break the chain.'],
    example: {
      intro: 'The same 4×4 puzzle, played for a chain.',
      steps: [
        { grid: START, say: 'Pick a starting point where the next moves will stay close together. Row 1 is a good start.' },
        { grid: ['1 +2 z. 4', 'z. 4 1 .', '2 z. . 3', '. 3 2 .'], say: 'You place 2 in row 1, column 2. It is forced, so this chain of 1 scores 1 × 2 = 2 points. The outlined cells share a row, column or box with it. Score: 2.' },
        { grid: ['1 n2 +3 4', '. 4 1 z.', '2 . z. 3', '. 3 2 .'], say: 'You place 3 in row 1, column 3. It is in the same row, so the chain grows to 2. It is forced too: 2 × 2 = 4 points. Score: 6.' },
        { grid: ['1 n2 n3 4', 'z. 4 1 +2', '2 . . 3', '. 3 2 z.'], say: 'You place 2 in row 2, column 4. It shares a box with your last number, so the chain is 3. Forced: 3 × 2 = 6 points. Score: 12.' },
        { grid: ['1 n2 n3 4', '. 4 1 n2', '2 . . 3', '. 3 2 x4'], say: 'You place 4 in row 4, column 4, but column 4 already has a 4. Wrong: the chain breaks back to 0. Your best chain so far stays 3. Erase it and start a new chain.' },
      ],
    },
    tips: ['Plan a few moves ahead so each number leads to the next.', 'Forced numbers are worth double, so finish nearly full rows and boxes inside your chain.'],
  },
  {
    id: 'tide',
    goal: 'Solve the puzzle while pools of water hide some of the given numbers. Drain the water to bring the hidden clues up.',
    rules: [
      'The puzzle follows the classic rules: each row, column and box holds every number once.',
      'Pools of water cover part of the grid. A given number under water is hidden. You cannot see it until the water over it drains.',
      'You can still fill in an empty cell under water, and you can work out a hidden given yourself and type it in.',
      'Every right number you place drains its own cell and the eight cells touching it, corners included. Any hidden clues there come up.',
      'If nothing can be worked out from what you can see, the tide ebbs on its own: hidden clues come up one at a time until there is a next move. You never need to guess.',
      'A wrong number drains nothing.',
      'You win when every cell is filled in correctly. Solving with no ebbs and no hints earns the Deep diver badge.',
    ],
    tools: [
      'Notes, Fill notes, Undo, Check and Hint all work. Hints only use the clues above water, so they never give away a hidden clue.',
      'The flood adapts to you: clean solves make the next one deeper, and struggles make it shallower.',
    ],
    example: {
      intro: 'The same 4×4 puzzle, with water over the bottom-left corner.',
      steps: [
        { grid: ['1 . . 4', '. 4 1 .', '~2 ~ . 3', '~ ~3 2 .'], say: 'Water covers four cells. Two of them hide given numbers: you cannot see the 2 in row 3 or the 3 in row 4.' },
        { grid: ['1 . . 4', '. 4 1 +2', '~2 ~ . 3', '~ ~3 2 .'], say: 'Row 1 is missing 2 and 3, but the 3 that would settle it is under water. Try row 2 instead: it is missing 2 and 3, and column 4 already has a 3, so row 2, column 4 is 2. It does not touch the water, so nothing drains.' },
        { grid: ['1 . . 4', '+3 4 1 n2', '2 . . 3', '~ ~3 2 .'], say: 'Row 2, column 1 must be 3. It touches the water, so the cells around it drain, and the hidden 2 in row 3 comes up as a given.' },
        { grid: ['1 . . 4', 'n3 4 1 n2', '2 +1 . 3', '. 3 2 .'], say: 'Row 3 is missing 1 and 4, and column 2 already has a 4, so row 3, column 2 is 1. It drains the rest of the pool and brings up the 3 in row 4.' },
        { grid: ['1 +2 +3 4', 'n3 4 1 n2', '2 n1 +4 3', '+4 3 2 +1'], say: 'Everything is above water now. Finish the grid as usual: 2 and 3 in row 1, then 4, 4 and 1. Solved with no ebbs!' },
      ],
    },
    tips: ['Work along the shore: numbers next to the water bring up the most clues.', 'A hidden given can be worked out like any empty cell, and typing it drains the water around it.'],
  },
  {
    id: 'glyph',
    glyph: true,
    goal: 'Travel the quest map by solving puzzles where the numbers are glyphs. Finish rows, columns and boxes to earn powers.',
    rules: [
      'The puzzle follows the classic rules, but each number is shown as a glyph. Each glyph stays the same number for the whole puzzle, so each row, column and box holds every glyph once.',
      'The map has six realms, each with its own glyphs: Roman numerals in the Elder Library, letters in the Scribe\'s Tower, shapes in the Crystal Caves, Greek letters in the Moonlit Meadow, weather signs in the Sky Harbor and Greek capitals in the Dragon Peaks.',
      'The number pad shows each glyph with its number in the corner. You can still type 1 to 9, and you can switch on Show the number under each glyph.',
      'Free hints and Fill notes give way to three powers, and you start with one of each. Tap a power to use it.',
      'Lantern fills in the notes for the row, column and box of the selected cell. You earn a Lantern each time you finish a row (or a diagonal).',
      'Compass points to your next move, like a hint. You earn a Compass each time you finish a column.',
      'Key opens the selected cell and fills in its right glyph. You earn a Key each time you finish a box.',
      'Solve the puzzle to clear the realm. The next puzzle takes you to the next realm on the map. After the Dragon Peaks the map starts a new lap.',
    ],
    tools: ['Notes, Undo, Check and Show the answer work as usual. If you struggled with the last two realms, you start the next one with a spare Key.'],
    example: {
      intro: 'The same 4×4 puzzle in the Elder Library, where I, II, III and IV stand for 1, 2, 3 and 4.',
      steps: [
        { grid: START, say: 'Row 1 has I and IV, so it is missing II and III. Column 2 already has a III.' },
        { grid: ['1 +2 . 4', '. 4 1 .', '2 . . 3', '. 3 2 .'], say: 'So row 1, column 2 is II. Press the II button (or type 2).' },
        { grid: ['1 n2 +3 4', '. 4 1 .', '2 . . 3', '. 3 2 .'], say: 'Row 1, column 3 is III. Row 1 is finished: you earn a Lantern.' },
        { grid: ['1 n2 n3 4', '+3 4 1 +2', '2 . . 3', '. 3 2 .'], say: 'Select row 2, column 1 and use the Key: it opens the cell as III. Row 2, column 4 is then II. Row 2 is finished (another Lantern), and so are both top boxes (two Keys).' },
        { grid: ['1 n2 n3 4', 'n3 4 1 n2', '2 +1 +4 3', '+4 3 2 +1'], say: 'Finish the grid to clear the Elder Library. The next puzzle is in the Scribe\'s Tower.' },
      ],
    },
    tips: ['Save Keys for the cells you cannot crack.', 'A Lantern on a busy box shows at a glance which glyphs are left.'],
  },
];

const ROMAN = ['I', 'II', 'III', 'IV'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One example grid as HTML, from the row notation above.
export function exampleGrid(rows, { glyph = false } = {}) {
  const show = (d) => (glyph ? ROMAN[d - 1] : String(d));
  let html = '<div class="np-ex" role="img" aria-label="Example grid: ';
  const said = [], cells = [];
  rows.forEach((row) => row.trim().split(/\s+/).forEach((t) => {
    const m = /^(\+|n|y|r|x|z|~)?(\d|\.)?$/.exec(t) || [];
    const kind = m[1] || (m[2] && m[2] !== '.' ? 'g' : ''), d = m[2] && m[2] !== '.' ? Number(m[2]) : 0;
    const cls = ['np-ex-cell', { g: 'given', '+': 'new', n: 'placed', y: 'mine', r: 'theirs', x: 'wrong', z: 'zone', '~': 'water' }[kind] || ''];
    const visible = d && kind !== '~';
    cells.push(`<span class="${cls.join(' ')}">${visible ? esc(show(d)) : ''}</span>`);
    said.push(visible ? show(d) : kind === '~' ? 'water' : 'empty');
  }));
  html += `${esc(said.join(', '))}">${cells.join('')}</div>`;
  return html;
}
