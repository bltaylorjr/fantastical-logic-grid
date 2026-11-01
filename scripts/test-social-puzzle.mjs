// Tests the checks the daily Facebook/Instagram puzzle must pass before it is
// posted (scripts/social-puzzle.mjs): a good puzzle passes, and each kind of
// error stops the post. node scripts/test-social-puzzle.mjs
import { generatePuzzle } from '../engine/src/index.js';
import { checkPuzzle, caption, instagramCaption, answerUrl, playUrl, statsLine } from './social-puzzle.mjs';

let failed = 0;
const check = (name, cond, detail = '') => { if (!cond) { failed++; console.log(`FAIL ${name} ${detail}`); } };
const DAY = '2026-11-02';

for (const difficulty of ['basic', 'easy', 'medium', 'hard']) {
  const fresh = () => ({ date: DAY, puzzle: generatePuzzle({ difficulty, theme: 'mystery', seed: `social-${difficulty}` }) });
  const tamper = (f) => { const r = fresh(); f(r.puzzle); return checkPuzzle(r, DAY); };
  const ok = checkPuzzle(fresh(), DAY);
  check(`${difficulty}: a good puzzle passes`, ok.length === 0, ok.join(' / '));
  check(`${difficulty}: wrong day stops it`, checkPuzzle(fresh(), '2026-11-03').length > 0);
  check(`${difficulty}: a wrong answer key stops it`, tamper((p) => { const a = p.answerKey.rows; [a[0][1], a[1][1]] = [a[1][1], a[0][1]]; }).length > 0);
  check(`${difficulty}: missing clues (more than one answer) stop it`, tamper((p) => { p.clues = p.clues.slice(0, 1); }).length > 0);
  check(`${difficulty}: broken text stops it`, tamper((p) => { p.clues[0].text += ' undefined'; }).length > 0);
  check(`${difficulty}: a misspelled item in a clue stops it`, tamper((p) => {
    const c = p.clues[0];
    const id = Object.entries(c.logic).find(([k, v]) => !['type', 'o', 'd'].includes(k) && typeof v === 'string')?.[1];
    const label = p.categories.flatMap((x) => x.items).find((i) => i.id === id)?.label;
    if (label) c.text = c.text.split(label).join(`${label}x`.slice(1));
  }).length > 0);
  check(`${difficulty}: no answer key stops it`, tamper((p) => { delete p.answerKey; }).length > 0);

  const r = fresh();
  const text = caption(r.puzzle, DAY);
  check(`${difficulty}: caption has the answer key link`, text.includes(answerUrl(DAY)));
  check(`${difficulty}: caption has the play link`, text.includes(playUrl(DAY)));
  check(`${difficulty}: caption fits Instagram (2,200 characters)`, instagramCaption(r.puzzle, DAY).length <= 2200);
  check(`${difficulty}: caption promotes the streak`, /streak/.test(text));
  check(`${difficulty}: caption fits Instagram with numbers too`, instagramCaption(r.puzzle, DAY, { solved: 12345, medianMs: 9 * 60000 }).length <= 2200);
  check(`${difficulty}: caption gives no answers`, !r.puzzle.answerKey.questions.some((q) => text.includes(`${q.question} ${q.answer}`)));
}

check('numbers shown with enough solvers', statsLine({ solved: 42, medianMs: 420000 }).includes('42 players') && statsLine({ solved: 42, medianMs: 420000 }).includes('7 minutes'));
check('no numbers with too few solvers', statsLine({ solved: 3, medianMs: 420000 }) === '' && statsLine(null) === '');

if (failed) { console.log(`${failed} social puzzle checks failed`); process.exit(1); }
console.log('Social puzzle checks passed');
