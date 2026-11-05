// Play-time helpers that work from a saved puzzle JSON: checking marks and
// detecting a solve. Step-by-step hints live in hints.js, because they need the
// solver, which stays on the puzzle server when the site runs in server mode.
import { makeLanguage } from './language.js';

// Rebuild the internal model (global item numbers) from puzzle JSON.
export function modelFromPuzzle(puzzle) {
  const cats = puzzle.categories;
  const K = cats.length, N = cats[0].items.length;
  const catIndex = Object.fromEntries(cats.map((c, i) => [c.id, i]));
  const toG = (id) => {
    const [cid, idx] = id.split(':');
    if (!(cid in catIndex)) throw new Error(`Unknown item id ${id}`);
    return catIndex[cid] * N + Number(idx);
  };
  const toId = (g) => `${cats[Math.floor(g / N)].id}:${g % N}`;
  const clues = puzzle.clues.map((c) => {
    const out = { type: c.type };
    for (const [k, v] of Object.entries(c.logic)) {
      if (k === 'type') continue;
      out[k] = k === 'o' || k === 'd' ? v : Array.isArray(v) ? v.map(toG) : toG(v);
    }
    return out;
  });
  const entity = new Map();
  puzzle.solution.forEach((row, e) => Object.values(row).forEach((id) => entity.set(id, e)));
  const model = {
    K, N, cast: puzzle.cast,
    cats: cats.map((c) => ({ name: c.name, labels: c.items.map((it) => it.label), pos: c.pos, neg: c.neg, ordinal: c.phrases || null })),
  };
  return { K, N, clues, toG, toId, entity, model, L: makeLanguage(model) };
}

export const isMatch = (m, a, b) => m.entity.get(a) === m.entity.get(b);

// marks: [{ a: itemId, b: itemId, mark: 'O' | 'X' }]. Returns the wrong ones.
export function checkMarks(puzzle, marks) {
  const m = modelFromPuzzle(puzzle);
  return marks.filter((mk) => (mk.mark === 'O') !== isMatch(m, mk.a, mk.b));
}

// Solved when every match (O) is placed and no mark is wrong. X marks are optional.
export function isSolved(puzzle, marks) {
  const m = modelFromPuzzle(puzzle);
  if (marks.some((mk) => (mk.mark === 'O') !== isMatch(m, mk.a, mk.b))) return false;
  const placed = new Set(marks.filter((mk) => mk.mark === 'O').map((mk) => [mk.a, mk.b].sort().join('|')));
  const { K, N } = m;
  return placed.size === (K * (K - 1) / 2) * N;
}

// Score the player's answers to the story questions: { [questionNumber]: itemId }.
export function checkAnswers(puzzle, answers) {
  return puzzle.questions.map((q) => ({ number: q.number, correct: answers[q.number] === q.answer }));
}

// Plain text version for printing or sharing (the answer key starts on a new page).
export function formatPuzzleText(puzzle, { answerKey = true } = {}) {
  const lines = [puzzle.title, `${puzzle.theme.name}${puzzle.topic ? ` (${puzzle.topic.name})` : ''} · ${puzzle.difficulty.name} · ${puzzle.categories.length} categories x ${puzzle.categories[0].items.length} items`, ''];
  lines.push(...puzzle.story.paragraphs.flatMap((p) => [p, '']));
  lines.push('Categories:');
  for (const c of puzzle.categories) lines.push(`  ${c.name}: ${c.items.map((i) => i.label).join(', ')}`);
  lines.push('', 'Clues:');
  for (const c of puzzle.clues) lines.push(`  ${c.number}. ${c.text}`);
  lines.push('', 'Questions:');
  for (const q of puzzle.questions) lines.push(`  ${q.number}. ${q.text}`);
  if (answerKey) {
    lines.push('', '\f', `Answer key: ${puzzle.title}`, '');
    const cols = puzzle.answerKey.columns;
    const widths = cols.map((c, i) => Math.max(c.length, ...puzzle.answerKey.rows.map((r) => r[i].length)));
    const row = (r) => '  ' + r.map((v, i) => v.padEnd(widths[i])).join('  |  ');
    lines.push(row(cols), '  ' + widths.map((w) => '-'.repeat(w)).join('--+--'));
    for (const r of puzzle.answerKey.rows) lines.push(row(r));
    lines.push('');
    for (const q of puzzle.answerKey.questions) lines.push(`  ${q.question} ${q.answer}`);
    lines.push('', puzzle.story.ending);
  }
  return lines.join('\n');
}
