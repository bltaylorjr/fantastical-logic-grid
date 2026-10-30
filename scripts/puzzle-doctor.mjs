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
//   Builds the puzzle again with today's engine, trying the rebuild
//   strategies in the order the learning table says works best for this kind
//   of fault, and keeps it only if it passes every check above.
// probe(pattern) -> { tested, faults, codes }
//   Self-diagnosis: makes fresh puzzles like the faulty one and checks them.
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
      if (!holds) out.push({ ...find('false_clue', `Clue ${p.clues[i].number || i + 1} said something that is not true for the real answer, so the puzzle could not be solved correctly.`), clue: String(p.clues[i].type || c.type || '') });
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

// Ways to rebuild a puzzle, best first by default. The Worker's learning table
// (fault_patterns, server/src/puzzle-reports.js) counts how often each one
// works for each kind of fault, and hands the doctor its own order (playbook).
export const STRATEGIES = {
  // The settings as first asked with the theme left to chance: usually the very same story.
  'same-settings': (p, o) => ({ difficulty: o.difficulty, categories: o.categories, items: o.items, questions: o.questions, seed: p.seed }),
  // The same theme chosen on purpose: the same story when the player picked the theme.
  'same-theme': (p, o) => ({ difficulty: o.difficulty, theme: o.theme, categories: o.categories, items: o.items, questions: o.questions, seed: p.seed }),
  // Every recorded setting, topic and clue types included.
  'all-options': (p, o) => ({ ...o, seed: p.seed }),
  // A fresh seed in the same theme, topic, size and difficulty: a new story,
  // for faults the original seed keeps running into.
  'new-seed': (p, o) => ({ difficulty: o.difficulty, theme: o.theme, topic: o.topic, categories: o.categories, items: o.items, questions: o.questions, seed: `${p.seed}-repair` }),
};
export const DEFAULT_ORDER = Object.keys(STRATEGIES);

const changedFrom = (p, fresh) => !sameClues(p, fresh) || JSON.stringify([p.solution, p.answerKey, p.questions]) !== JSON.stringify([fresh.solution, fresh.answerKey, fresh.questions]);

// order: strategy names to try first (the learned playbook); the rest follow.
// Returns { puzzle, sameStory, changed, strategy, tried } or null.
export function repair(p, order = DEFAULT_ORDER) {
  if (!p || !p.options || p.seed === undefined) return null;
  const names = [...new Set([...(order || []), ...DEFAULT_ORDER])].filter((n) => STRATEGIES[n]);
  const tried = [];
  let fallback = null;
  for (const name of names) {
    tried.push(name);
    let fresh;
    try { fresh = generatePuzzle(STRATEGIES[name](p, p.options)); } catch { continue; }
    if (!diagnose(fresh).ok || fresh.theme?.id !== p.theme?.id || !changedFrom(p, fresh)) continue;
    const result = { puzzle: fresh, sameStory: fresh.title === p.title, changed: true, strategy: name, tried: [...tried] };
    if (result.sameStory) return result;
    fallback ||= result;
  }
  return fallback ? { ...fallback, tried } : null;
}

// What the team's email says was done, in everyday words.
export const repairedNote = (sameStory) => (sameStory
  ? 'We rebuilt your puzzle with the same story, size and difficulty using our corrected puzzle maker, then checked that every clue is true and that the clues lead to exactly one answer.'
  : 'We rebuilt your puzzle with the same theme, size and difficulty using our corrected puzzle maker (the story reads a little differently), then checked that every clue is true and that the clues lead to exactly one answer.');

// playbook: { [fault code]: [strategy names, most successful first] } from the Worker.
export function examine(p, playbook = {}) {
  const d = diagnose(p);
  const order = d.findings.flatMap((f) => playbook[f.code] || []);
  const fix = d.ok ? null : repair(p, order);
  const repaired = fix ? fix.puzzle : null;
  return {
    findings: d.findings, repaired, note: repaired ? repairedNote(fix.sameStory) : '', engine: ENGINE_VERSION,
    strategy: fix ? fix.strategy : null, tried: fix ? fix.tried : d.ok ? [] : [...new Set([...order, ...DEFAULT_ORDER])],
    clueTypes: [...new Set(d.findings.filter((f) => f.clue).map((f) => f.clue))],
  };
}

// Self-diagnosis: build fresh puzzles like the ones a known fault came from,
// with today's engine, and see whether the fault still happens. A fault that
// no longer shows lets the Worker send its waiting reports back for repair.
export function probe({ theme, tier, categories, items }, tested = 6, salt = '') {
  let faults = 0;
  const codes = {};
  let made = 0;
  for (let i = 0; i < tested; i++) {
    let p;
    try { p = generatePuzzle({ difficulty: tier || 'medium', theme: theme || undefined, categories: categories || undefined, items: items || undefined, seed: `probe-${salt}-${i}` }); } catch { continue; }
    made++;
    const d = diagnose(p);
    if (!d.ok) { faults++; for (const f of d.findings) codes[f.code] = (codes[f.code] || 0) + 1; }
  }
  return { tested: made, faults, codes, engine: ENGINE_VERSION };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) { console.error('Usage: node scripts/puzzle-doctor.mjs <reports.json> <results.json>'); process.exit(2); }
  const reports = JSON.parse(readFileSync(inFile, 'utf8'));
  const results = reports.map((r) => ({ id: r.id, ...examine(r.puzzle, r.playbook) }));
  writeFileSync(outFile, JSON.stringify(results));
  const n = (f) => results.filter(f).length;
  console.log(`Examined ${results.length}: ${n((r) => !r.findings.length)} with no fault found, ${n((r) => r.repaired)} repaired, ${n((r) => r.findings.length && !r.repaired)} need a fix in the code.`);
}
