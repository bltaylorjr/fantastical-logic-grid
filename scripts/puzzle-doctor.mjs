// The puzzle doctor: checks a puzzle a player reported (Report a problem on
// the puzzle screen, server/PUZZLE-REPORTS.md) with the game's own engine, and
// rebuilds it when it can.
//
// diagnose(puzzle) -> { ok, findings: [{ code, text }] }
//   Every finding is one plain-English sentence a player can understand.
//   Checks: the answer uses every item exactly once; every clue is true for
//   the answer; the clues lead to exactly one answer by deduction (no
//   guessing); the answer key and the questions match the answer; nothing is
//   blank.
// repair(puzzle) -> { puzzle, changed } or null
//   Builds the puzzle again from its own seed and settings with today's
//   engine (same story, theme, size and difficulty) and keeps it only if it
//   passes every check above.
//
// Usage (the GitHub Action .github/workflows/puzzle-reports.yml):
//   node scripts/puzzle-doctor.mjs <reports.json> <results.json>
//   reports.json: [{ id, puzzle }]; results.json: [{ id, findings, repaired, engine }]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => import(pathToFileURL(join(root, 'engine', 'src', f)).href);
const { generatePuzzle, ENGINE_VERSION } = await load('index.js');
const { modelFromPuzzle } = await load('play.js');
const { clueHolds } = await load('clues.js');
const { solveWithTrace, YES } = await load('solver.js');

const find = (code, text) => ({ code, text });

export function diagnose(p) {
  const out = [];
  let m;
  try {
    if (!p || !Array.isArray(p.categories) || !Array.isArray(p.solution) || !Array.isArray(p.clues)) throw new Error('shape');
    m = modelFromPuzzle(p);
  } catch (e) {
    return { ok: false, findings: [find('unreadable', 'The puzzle was saved in a damaged form, so the game could not read all of its parts.')] };
  }
  const { K, N, clues, toG, L } = m;
  const cats = p.categories;

  // The answer: one item from each category per row, each item used once.
  const sol = cats.map(() => Array(N).fill(-1));
  let solOk = p.solution.length === N;
  p.solution.forEach((row, e) => cats.forEach((c, ci) => {
    const g = row && typeof row[c.id] === 'string' ? (() => { try { return toG(row[c.id]); } catch { return -1; } })() : -1;
    if (g < 0 || Math.floor(g / N) !== ci) { solOk = false; return; }
    sol[ci][e] = g % N;
  }));
  if (solOk) for (const col of sol) if (new Set(col).size !== N) solOk = false;
  if (!solOk) out.push(find('solution', 'The puzzle\'s answer was mixed up: some things were matched twice or not at all.'));

  // Blank text.
  const blankClue = p.clues.findIndex((c) => !c || typeof c.text !== 'string' || !c.text.trim());
  if (blankClue >= 0) out.push(find('blank_clue', `Clue ${blankClue + 1} was blank.`));
  if (cats.some((c) => c.items.some((it) => !String(it.label || '').trim()))) out.push(find('blank_label', 'Some names in the grid were blank.'));

  if (solOk) {
    // Every clue must be true for the answer.
    clues.forEach((c, i) => {
      let holds = false;
      try { holds = clueHolds({ N, sol }, c); } catch { holds = false; }
      if (!holds) out.push(find('false_clue', `Clue ${p.clues[i].number || i + 1} said something that is not true for the real answer, so the puzzle could not be solved correctly.`));
    });
    // The clues must lead to that one answer without guessing.
    if (!out.some((f) => f.code === 'false_clue')) {
      let res;
      try { res = solveWithTrace(K, N, clues, 3, L, [], 6); } catch { res = { solved: false }; }
      if (res.contradiction) out.push(find('contradiction', 'Some clues disagreed with each other, so no answer could fit them all.'));
      else if (!res.solved) out.push(find('not_unique', 'The clues did not give enough information to reach one answer, so more than one way of filling the grid looked right.'));
      else {
        // The solver's grid must be the stored answer.
        const KN = K * N;
        for (let e = 0; e < N && !out.length; e++) {
          for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
            const x = a * N + sol[a][e];
            const y = b * N + sol[b][e];
            if (res.cells[x * KN + y] !== YES) { out.push(find('wrong_answer', 'The clues led to a different answer from the one the game checked against, so a correct grid was marked wrong.')); a = K; break; }
          }
        }
      }
    }
    // The answer key and the questions.
    const key = p.answerKey;
    if (key && Array.isArray(key.rows)) {
      const rowsOk = key.rows.length === N && key.rows.every((r, e) => Array.isArray(r) && cats.every((c, ci) => r[ci] === c.items[sol[ci][e]]?.label));
      if (!rowsOk) out.push(find('answer_key', 'The answer key did not match the puzzle\'s real answer.'));
    }
    for (const q of p.questions || []) {
      const e = sol[0].findIndex((_, ent) => p.solution[ent] && Object.values(p.solution[ent]).includes(q.answer));
      if (e < 0) out.push(find('question', `The answer to question ${q.number || ''} was not one of the choices.`.replace('  ', ' ')));
    }
  }
  return { ok: !out.length, findings: out };
}

const sameClues = (a, b) => JSON.stringify(a.clues.map((c) => [c.text, c.logic])) === JSON.stringify(b.clues.map((c) => [c.text, c.logic]));

export function repair(p) {
  if (!p || !p.options || p.seed === undefined) return null;
  // The puzzle's settings as first asked (theme left to chance or chosen), so
  // the rebuild usually tells the very same story; failing that, the same
  // theme, topic, size and difficulty.
  const o = p.options;
  const tries = [
    { difficulty: o.difficulty, categories: o.categories, items: o.items, questions: o.questions, seed: p.seed },
    { difficulty: o.difficulty, theme: o.theme, categories: o.categories, items: o.items, questions: o.questions, seed: p.seed },
    { ...o, seed: p.seed },
  ];
  let fallback = null;
  for (const t of tries) {
    let fresh;
    try { fresh = generatePuzzle(t); } catch { continue; }
    if (!diagnose(fresh).ok) continue;
    if (fresh.theme?.id !== p.theme?.id) continue;
    const sameStory = fresh.title === p.title;
    const result = { puzzle: fresh, sameStory, changed: !sameClues(p, fresh) || JSON.stringify([p.solution, p.answerKey, p.questions]) !== JSON.stringify([fresh.solution, fresh.answerKey, fresh.questions]) };
    if (sameStory) return result;
    fallback ||= result;
  }
  return fallback;
}

// What the team's email says was done, in everyday words.
export const repairedNote = (sameStory) => (sameStory
  ? 'We rebuilt your puzzle with the same story, size and difficulty using our corrected puzzle maker, then checked that every clue is true and that the clues lead to exactly one answer.'
  : 'We rebuilt your puzzle with the same theme, size and difficulty using our corrected puzzle maker (the story may read a little differently), then checked that every clue is true and that the clues lead to exactly one answer.');

export function examine(p) {
  const d = diagnose(p);
  const fix = d.ok ? null : repair(p);
  const repaired = fix && fix.changed ? fix.puzzle : null;
  return { findings: d.findings, repaired, note: repaired ? repairedNote(fix.sameStory) : '', engine: ENGINE_VERSION };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) { console.error('Usage: node scripts/puzzle-doctor.mjs <reports.json> <results.json>'); process.exit(2); }
  const reports = JSON.parse(readFileSync(inFile, 'utf8'));
  const results = reports.map((r) => ({ id: r.id, ...examine(r.puzzle) }));
  writeFileSync(outFile, JSON.stringify(results));
  const n = (f) => results.filter(f).length;
  console.log(`Examined ${results.length}: ${n((r) => !r.findings.length)} with no fault found, ${n((r) => r.repaired)} repaired, ${n((r) => r.findings.length && !r.repaired)} need a fix in the code.`);
}
