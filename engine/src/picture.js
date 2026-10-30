// Picture clues: a small picture puzzle (a nonogram) whose hidden picture is
// a piece of evidence. Solving it unlocks one of the puzzle's written clues.
//
// Players can turn picture clues off in Settings (web/js/picture-clue.js).
// Generated puzzles do not change: the picture and the locked clue are worked
// out from a finished puzzle, so the same puzzle always gets the same picture.
//
// Balance: easier levels get smaller pictures (TIER_SIZE), and the locked
// clue is one the solving path first needs about halfway through, so the
// player always makes a start before the picture matters.
//
// HOW TO DRAW A PICTURE (a good task): each picture is rows of the same
// length, "#" for a filled square and "." for an empty one. Theme pictures
// are 8 to 12 squares each way; "small" ones (for Basic and Easy) 6 or fewer. The tests check that every picture can be solved by logic
// alone, with no guessing; if one cannot, add or remove a few squares.
import { hashString } from './rng.js';

export const PICTURES = {
  // Used when a theme has no picture that fits the level.
  default: [
    {
      name: 'a key',
      rows: [
        '.###......',
        '#####.....',
        '##.#######',
        '#####..#.#',
        '.###...#.#',
      ],
    },
    {
      name: 'a footprint',
      rows: [
        '..###...',
        '.#####..',
        '.#####..',
        '.####...',
        '..###...',
        '..####..',
        '.#####..',
        '.#####..',
        '..###...',
      ],
    },
    {
      name: 'a glove',
      rows: [
        '.#.#.#..',
        '.#.#.#..',
        '.#.#.#.#',
        '.######.',
        '.######.',
        '..#####.',
        '..####..',
        '..####..',
      ],
    },
    {
      name: 'a bottle',
      rows: [
        '...##...',
        '...##...',
        '..####..',
        '.######.',
        '.#....#.',
        '.#.##.#.',
        '.#....#.',
        '.######.',
      ],
    },
    {
      name: 'a candle',
      rows: [
        '...#....',
        '..###...',
        '...#....',
        '..###...',
        '..###...',
        '..###...',
        '..###...',
        '.#####..',
        '#######.',
      ],
    },
  ],
  // Bobby's pictures for the Mystery theme go here (until then it uses the
  // default pictures above, which already suit a mystery).
  mystery: [],
  // Small pictures (6 squares or fewer each way) for Basic and Easy.
  small: [
    { name: 'a heart', rows: [
      '.##.##.',
      '#######',
      '#######',
      '.#####.',
      '..###..',
      '...#...',
    ] },
    { name: 'an arrow', rows: [
      '...#..',
      '...##.',
      '######',
      '######',
      '...##.',
      '...#..',
    ] },
    { name: 'a cup', rows: [
      '####..',
      '#..###',
      '#..#.#',
      '#..###',
      '.##...',
    ] },
    { name: 'a house', rows: [
      '..##..',
      '.####.',
      '######',
      '#.##.#',
      '#.##.#',
      '######',
    ] },
    { name: 'a flag', rows: [
      '#####',
      '####.',
      '#####',
      '#....',
      '#....',
      '#....',
    ] },
  ],
  action: [
    { name: 'a lightning bolt', rows: [
      '....###.',
      '...###..',
      '..###...',
      '.######.',
      '...###..',
      '..###...',
      '.##.....',
      '##......',
    ] },
    { name: 'a parachute', rows: [
      '..####..',
      '.######.',
      '########',
      '#..#..#.',
      '.#.#.#..',
      '..###...',
      '..###...',
      '...#....',
    ] },
  ],
  adventure: [
    { name: 'a tent', rows: [
      '...##...',
      '..####..',
      '..#..#..',
      '.##..##.',
      '.#....#.',
      '##....##',
      '#......#',
      '########',
    ] },
    { name: 'a backpack', rows: [
      '..####..',
      '.#....#.',
      '.######.',
      '##....##',
      '##.##.##',
      '##.##.##',
      '##....##',
      '.######.',
    ] },
  ],
  holiday: [
    { name: 'a gift box', rows: [
      '..#..#..',
      '...##...',
      '########',
      '#..##..#',
      '########',
      '.#.##.#.',
      '.#.##.#.',
      '.######.',
    ] },
    { name: 'a snowman', rows: [
      '...##...',
      '..####..',
      '...##...',
      '..####..',
      '.##..##.',
      '.######.',
      '########',
      '.######.',
    ] },
  ],
  occasion: [
    { name: 'a balloon', rows: [
      '..####..',
      '.######.',
      '.######.',
      '.######.',
      '..####..',
      '...##...',
      '....#...',
      '...#....',
    ] },
    { name: 'a cake', rows: [
      '.#.#.#..',
      '.#.#.#..',
      '########',
      '#......#',
      '########',
      '#......#',
      '########',
      '........',
    ] },
  ],
  fantasy: [
    { name: 'a sword', rows: [
      '......##',
      '.....###',
      '....###.',
      '#.####..',
      '.####...',
      '..##....',
      '.####...',
      '#..#....',
    ] },
    { name: 'a crown', rows: [
      '#..##..#',
      '##.##.##',
      '########',
      '########',
      '#.#..#.#',
      '########',
      '........',
      '........',
    ] },
  ],
  scifi: [
    { name: 'a rocket', rows: [
      '...#....',
      '..###...',
      '..#.#...',
      '..###...',
      '.#####..',
      '.#####..',
      '##.#.##.',
      '#..#..#.',
    ] },
    { name: 'a flying saucer', rows: [
      '...##...',
      '..####..',
      '.#....#.',
      '########',
      '#.#.#.##',
      '.######.',
      '..#..#..',
      '.#....#.',
    ] },
  ],
  sports: [
    { name: 'a trophy', rows: [
      '########',
      '#.####.#',
      '#.####.#',
      '.######.',
      '..####..',
      '...##...',
      '..####..',
      '.######.',
    ] },
    { name: 'a ball', rows: [
      '..####..',
      '.##..##.',
      '##.##.##',
      '#.####.#',
      '#.####.#',
      '##.##.##',
      '.##..##.',
      '..####..',
    ] },
  ],
  cooking: [
    { name: 'a teacup', rows: [
      '...###..',
      '..#.#...',
      '........',
      '######..',
      '#....###',
      '#....#.#',
      '.####.##',
      '########',
    ] },
    { name: 'a frying pan', rows: [
      '..###.....',
      '######....',
      '######....',
      '######....',
      '.#########',
      '..####..##',
    ] },
  ],
  pets: [
    { name: 'a paw print', rows: [
      '.#....#.',
      '###..###',
      '.##...#.',
      '...##...',
      '..####..',
      '.######.',
      '.######.',
      '..#..#..',
    ] },
    { name: 'a fish', rows: [
      '....###.',
      '#..#####',
      '##.##.##',
      '#######.',
      '##.#####',
      '#..#####',
      '....###.',
      '........',
    ] },
  ],
  town: [
    { name: 'a traffic light', rows: [
      '..####..',
      '.##..##.',
      '.#.##.#.',
      '.######.',
      '.#.##.#.',
      '.######.',
      '.#.##.#.',
      '..####..',
    ] },
    { name: 'a street lamp', rows: [
      '.####...',
      '.#..#...',
      '.####...',
      '..##....',
      '..##....',
      '..##....',
      '..##....',
      '.####...',
    ] },
  ],
  parks: [
    { name: 'a pine tree', rows: [
      '...##...',
      '..####..',
      '.######.',
      '..####..',
      '.######.',
      '########',
      '...##...',
      '...##...',
    ] },
    { name: 'a mountain', rows: [
      '....#...',
      '...###..',
      '..##.##.',
      '..#####.',
      '.#######',
      '########',
      '........',
      '........',
    ] },
  ],
  travel: [
    { name: 'a suitcase', rows: [
      '..####..',
      '..#..#..',
      '########',
      '#.#..#.#',
      '#.#..#.#',
      '#.#..#.#',
      '########',
      '.#....#.',
    ] },
    { name: 'a palm tree', rows: [
      '.##..##.',
      '###..###',
      '#.####.#',
      '...##...',
      '....#...',
      '....#...',
      '...##...',
      '.######.',
    ] },
  ],
  wonders: [
    { name: 'a pyramid', rows: [
      '....#...',
      '...###..',
      '..#.###.',
      '.#.#####',
      '#.######',
      '########',
      '........',
      '........',
    ] },
    { name: 'an arch', rows: [
      '########',
      '########',
      '###..###',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '###..###',
    ] },
  ],
  music: [
    { name: 'a music note', rows: [
      '...#####',
      '...#####',
      '...#...#',
      '...#...#',
      '.###.###',
      '####.###',
      '####....',
      '.##.....',
    ] },
    { name: 'a bell', rows: [
      '...##...',
      '..####..',
      '.######.',
      '.######.',
      '.######.',
      '########',
      '########',
      '...##...',
    ] },
  ],
  nautical: [
    { name: 'an anchor', rows: [
      '...##...',
      '..####..',
      '...##...',
      '.######.',
      '#..##.#.',
      '#..##..#',
      '.#.##.#.',
      '..####..',
    ] },
    { name: 'a sailboat', rows: [
      '...#....',
      '...##...',
      '...###..',
      '...####.',
      '...#....',
      '########',
      '.######.',
      '..####..',
    ] },
  ],
  farm: [
    { name: 'a barn', rows: [
      '...##...',
      '..####..',
      '.######.',
      '########',
      '#.####.#',
      '#.#..#.#',
      '#.#..#.#',
      '########',
    ] },
    { name: 'a carrot', rows: [
      '....###.',
      '.....#..',
      '..####..',
      '..####..',
      '..###...',
      '.###....',
      '.##.....',
      '#.......',
    ] },
  ],
  science: [
    { name: 'a flask', rows: [
      '..####..',
      '...##...',
      '...##...',
      '..####..',
      '.##..##.',
      '.#.##.#.',
      '##.##.##',
      '########',
    ] },
    { name: 'a magnet', rows: [
      '###..###',
      '###..###',
      '#.#..#.#',
      '#.#..#.#',
      '#.#..#.#',
      '#.####.#',
      '##....##',
      '.######.',
    ] },
  ],
  math: [
    { name: 'a pi sign', rows: [
      '########',
      '########',
      '.##..##.',
      '.##..##.',
      '.##..##.',
      '.##..##.',
      '.##..###',
      '##...##.',
    ] },
    { name: 'a calculator', rows: [
      '########',
      '#......#',
      '########',
      '#.#.#.##',
      '########',
      '#.#.#.##',
      '########',
      '........',
    ] },
  ],
  biology: [
    { name: 'a leaf', rows: [
      '....####',
      '...#####',
      '..###.##',
      '.###.###',
      '.##.####',
      '.#.####.',
      '#.####..',
      '#.......',
    ] },
    { name: 'a mushroom', rows: [
      '..####..',
      '.##.###.',
      '###.####',
      '########',
      '...##...',
      '...##...',
      '..####..',
      '........',
    ] },
  ],
  astronomy: [
    { name: 'a crescent moon', rows: [
      '..###...',
      '.###....',
      '###.....',
      '###.....',
      '###.....',
      '####...#',
      '.#######',
      '..#####.',
    ] },
    { name: 'a star', rows: [
      '...##...',
      '...##...',
      '########',
      '.######.',
      '..####..',
      '.######.',
      '.##..##.',
      '.#....#.',
    ] },
  ],
  paradox: [
    { name: 'an hourglass', rows: [
      '########',
      '.######.',
      '..####..',
      '...##...',
      '...##...',
      '..#..#..',
      '.#.##.#.',
      '########',
    ] },
    { name: 'an eye', rows: [
      '...####...',
      '.##....##.',
      '#...##...#',
      '#..####..#',
      '.##.##.##.',
      '...####...',
    ] },
  ],
  // Seasons: two pictures per season; `topic` keeps a snowflake out of summer.
  seasons: [
    { name: 'a maple leaf', topic: 'fall', rows: [
      '...##...',
      '.#.##.#.',
      '.######.',
      '########',
      '.######.',
      '..####..',
      '...##...',
      '...##...',
    ] },
    { name: 'a pumpkin', topic: 'fall', rows: [
      '...##...',
      '....#...',
      '.######.',
      '########',
      '##.##.##',
      '########',
      '#.#..#.#',
      '.######.',
    ] },
    { name: 'a snowflake', topic: 'winter', rows: [
      '...#....',
      '.#.#.#..',
      '..###...',
      '#######.',
      '..###...',
      '.#.#.#..',
      '...#....',
      '........',
    ] },
    { name: 'a snowman', topic: 'winter', rows: [
      '..###...',
      '..###...',
      '.#####..',
      '..###...',
      '.#####..',
      '#######.',
      '#######.',
      '.#####..',
    ] },
    { name: 'a flower', topic: 'spring', rows: [
      '..#.#...',
      '.#####..',
      '..###...',
      '.#####..',
      '..#.#...',
      '...#....',
      '.#.#.#..',
      '..###...',
    ] },
    { name: 'an umbrella', topic: 'spring', rows: [
      '..####..',
      '.######.',
      '########',
      '...#....',
      '...#....',
      '...#....',
      '.#.#....',
      '..#.....',
    ] },
    { name: 'a sailboat', topic: 'summer', rows: [
      '...#....',
      '...##...',
      '...###..',
      '...####.',
      '...#....',
      '########',
      '.######.',
      '..####..',
    ] },
    { name: 'an ice pop', topic: 'summer', rows: [
      '..####..',
      '.######.',
      '.######.',
      '.######.',
      '.######.',
      '.######.',
      '...##...',
      '...##...',
    ] },
  ],
};

// The biggest picture (squares across or down) for each level.
export const TIER_SIZE = { basic: 6, easy: 6, medium: 8, hard: 10, expert: 12, mensa: 12, theorist: 12 };
const sizeOf = (pic) => Math.max(pic.rows.length, pic.rows[0].length);

// Run lengths of filled squares in one line: '.##..#' -> [2, 1]; empty -> [].
export function runs(line) {
  return (line.match(/#+/g) || []).map((r) => r.length);
}

export function lineClues(rows) {
  const cols = rows[0].split('').map((_, x) => rows.map((r) => r[x]).join(''));
  return { rows: rows.map(runs), cols: cols.map(runs) };
}

// Every way to place `clue` in a line of length n that fits what is known
// (cells: 1 filled, -1 empty, 0 unknown). Returns the cells every placement
// agrees on, or null when nothing fits.
function solveLine(clue, cells) {
  const n = cells.length;
  const fill = new Array(n).fill(0), empty = new Array(n).fill(0);
  let count = 0;
  const line = new Array(n).fill(-1);
  const place = (k, start) => {
    if (count > 20000) return;
    if (k === clue.length) {
      for (let i = start; i < n; i++) if (cells[i] === 1) return;
      count++;
      for (let i = 0; i < n; i++) (line[i] === 1 ? fill : empty)[i]++;
      return;
    }
    const len = clue[k];
    const restMin = clue.slice(k + 1).reduce((s, x) => s + x + 1, 0);
    for (let s = start; s + len + restMin <= n; s++) {
      if (s > start && cells[s - 1] === 1) break; // a filled cell left behind
      let ok = true;
      for (let i = s; i < s + len; i++) if (cells[i] === -1) { ok = false; break; }
      if (!ok || (s + len < n && cells[s + len] === 1)) continue;
      for (let i = s; i < s + len; i++) line[i] = 1;
      place(k + 1, s + len + 1);
      for (let i = s; i < s + len; i++) line[i] = -1;
    }
  };
  // Cells before each block's start stay -1 in `line`; place() checks gaps.
  place(0, 0);
  if (count > 20000) return cells.slice(); // too many ways to tell: learn nothing
  if (!count) return null;
  return cells.map((c, i) => (fill[i] === count ? 1 : empty[i] === count ? -1 : 0));
}

// Solve by line logic only (no guessing). Returns the grid of 1/-1, or null
// when logic alone cannot finish it.
export function solvePicture({ rows, cols }) {
  const H = rows.length, W = cols.length;
  const g = Array.from({ length: H }, () => new Array(W).fill(0));
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < H; y++) {
      const out = solveLine(rows[y], g[y]);
      if (!out) return null;
      out.forEach((v, x) => { if (v && !g[y][x]) { g[y][x] = v; changed = true; } });
    }
    for (let x = 0; x < W; x++) {
      const out = solveLine(cols[x], g.map((r) => r[x]));
      if (!out) return null;
      out.forEach((v, y) => { if (v && !g[y][x]) { g[y][x] = v; changed = true; } });
    }
  }
  return g.every((r) => r.every((v) => v)) ? g : null;
}

// The picture clue for a puzzle, or null when the puzzle is too small to
// lock a clue. { picture: { name, rows }, clues: { rows, cols }, locked }
// `locked` is the number of the written clue the picture unlocks: one the
// solving path first needs about halfway through, so the player can make a
// start before the picture matters.
export function pictureClue(puzzle, pictures = PICTURES) {
  if (!puzzle.clues || puzzle.clues.length < 4) return null;
  const max = TIER_SIZE[puzzle.difficulty && puzzle.difficulty.id] || 12;
  const fits = (list) => (list || []).filter((pic) => sizeOf(pic) <= max);
  // A picture with a `topic` only shows in that topic's puzzles.
  const topicId = puzzle.topic && puzzle.topic.id;
  const own = (pictures[puzzle.theme.id] || []).filter((pic) => !pic.topic || pic.topic === topicId);
  const list = [fits(own), fits(pictures.default), fits(pictures.small), pictures.small || pictures.default].find((l) => l && l.length);
  const seed = hashString(`picture|${puzzle.story.id}`);
  const picture = list[seed % list.length];
  const firstUse = new Map();
  for (const step of puzzle.solvePath || []) {
    if (step.clue && !firstUse.has(step.clue)) firstUse.set(step.clue, step.step);
  }
  const used = [...firstUse.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
  const locked = used.length ? used[Math.floor(used.length / 2)] : puzzle.clues[Math.floor(puzzle.clues.length / 2)].number;
  return { picture, clues: lineClues(picture.rows), locked };
}

// Printed version of a picture clue (game printouts and storyline PDFs).
// The puzzle page shows the empty picture puzzle with its numbers and the
// locked clue printed upside down underneath, to read once the picture is
// drawn. The answer key shows the finished picture. Styles: .pic-print*.
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export function picturePrintHtml(pc, clueText, { answer = false } = {}) {
  const { rows, cols } = pc.clues;
  const W = cols.length;
  const head = cols.map((c) => `<th>${(c.length ? c : [0]).join('<br>')}</th>`).join('');
  const body = rows.map((r, y) => `<tr><th>${(r.length ? r : [0]).join(' ')}</th>${Array.from({ length: W }, (_, x) => `<td${answer && pc.picture.rows[y][x] === '#' ? ' class="f"' : ''}></td>`).join('')}</tr>`).join('');
  const table = `<table class="pic-print"><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table>`;
  if (answer) return `<div class="pic-print-box"><h2>The evidence</h2><p>Clue ${pc.locked}'s picture is ${escHtml(pc.picture.name)}.</p>${table}</div>`;
  return `<div class="pic-print-box"><h2>Locked evidence</h2><p>Clue ${pc.locked} is locked. Fill in the squares to uncover the evidence: the numbers tell you how many filled squares sit together in each row and column, in order. Then turn the page around to read the clue.</p>${table}<p class="pic-print-flip">Clue ${pc.locked}: ${escHtml(clueText)}</p></div>`;
}
