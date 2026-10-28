// Picture clues: a small picture puzzle (a nonogram) whose hidden picture is
// a piece of evidence. Solving it unlocks one of the puzzle's written clues.
//
// EXPERIMENTAL: the game only uses picture clues when they are switched on
// for the player (web/js/picture-clue.js). Generated puzzles do not change:
// the picture and the locked clue are worked out from a finished puzzle.
//
// HOW TO DRAW A PICTURE (a good task): each picture is rows of the same
// length, "#" for a filled square and "." for an empty one. Keep it 8 to 12
// squares wide. The tests check that every picture can be solved by logic
// alone, with no guessing; if one cannot, add or remove a few squares.
import { hashString } from './rng.js';

export const PICTURES = {
  // Placeholder pictures so the feature can be tested. Replace or add to them.
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
  // Bobby's pictures for the Mystery theme go here.
  mystery: [],
};

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
  const own = pictures[puzzle.theme.id] || [];
  const list = own.length ? own : pictures.default;
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
