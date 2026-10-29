// The puzzle doctor (scripts/puzzle-doctor.mjs) finds broken puzzles in plain
// words and rebuilds them from their seed; sound puzzles pass untouched.
import assert from 'node:assert/strict';
import { generatePuzzle } from '../engine/src/index.js';
import { diagnose, repair, examine } from './puzzle-doctor.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
let checked = 0;
for (const [difficulty, categories, items] of [['easy', 3, 4], ['medium', 4, 4], ['hard', 4, 5], ['expert', 5, 5]]) {
  const p = generatePuzzle({ difficulty, categories, items, seed: `doctor-${difficulty}` });
  const themed = generatePuzzle({ difficulty, theme: 'scifi', categories, items, seed: `doctor-t-${difficulty}` });
  const lie2 = clone(themed); lie2.answerKey.rows[0][0] = 'x';
  assert.ok(repair(lie2).sameStory, 'a chosen theme rebuilds the same story too');
  assert.deepEqual(diagnose(p), { ok: true, findings: [] }, `${difficulty} puzzle is sound`);
  assert.equal(examine(p).repaired, null, 'nothing to repair');

  // A clue that is not true for the answer.
  const lie = clone(p);
  const c = lie.clues.find((x) => x.logic.type === 'is');
  if (c) {
    const [cat, idx] = c.logic.b.split(':');
    c.logic.b = `${cat}:${(Number(idx) + 1) % items}`;
    const d = diagnose(lie);
    assert.ok(d.findings.some((f) => f.code === 'false_clue'), `${difficulty}: false clue found`);
    assert.match(d.findings[0].text, /^Clue \d+ said something/);
    const fixed = repair(lie);
    assert.ok(fixed && fixed.changed && diagnose(fixed.puzzle).ok, 'rebuilt from its seed');
    assert.equal(fixed.puzzle.theme.id, p.theme.id, 'same theme');
    assert.ok(fixed.sameStory, 'same story when the settings allow');
    assert.match(examine(lie).note, /same story/);
  }

  // Too few clues: more than one answer.
  const thin = clone(p);
  thin.clues = thin.clues.slice(0, 1);
  assert.ok(diagnose(thin).findings.some((f) => f.code === 'not_unique'), `${difficulty}: missing information found`);

  // An answer key that does not match.
  const key = clone(p);
  key.answerKey.rows[0][1] = key.answerKey.rows[1][1];
  assert.ok(diagnose(key).findings.some((f) => f.code === 'answer_key'), `${difficulty}: answer key found`);
  assert.ok(examine(key).repaired, 'a wrong answer key is repaired too');

  // A mixed-up answer.
  const mixed = clone(p);
  const cid = mixed.categories[1].id;
  mixed.solution[1][cid] = mixed.solution[0][cid];
  assert.ok(diagnose(mixed).findings.some((f) => f.code === 'solution'), `${difficulty}: mixed answer found`);
  checked++;
}
assert.equal(diagnose(null).findings[0].code, 'unreadable');
assert.equal(repair({ clues: [] }), null, 'no seed, no rebuild');
console.log(`Puzzle doctor: ${checked} difficulties checked.`);
