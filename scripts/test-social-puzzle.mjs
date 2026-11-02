// Tests the checks the daily social media puzzle must pass before it is
// posted (scripts/social-puzzle.mjs): a good puzzle passes, and each kind of
// error stops the post. node scripts/test-social-puzzle.mjs
import { generatePuzzle } from '../engine/src/index.js';
import { checkPuzzle, caption, instagramCaption, answerUrl, playUrl, statsLine, gridHtml, bluesky, BLUESKY_LIMIT, mastodon, mastodonLength, MASTODON_LIMIT } from './social-puzzle.mjs';

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
  const grid = gridHtml(r.puzzle, DAY);
  check(`${difficulty}: grid slide has every item`, r.puzzle.categories.every((c) => c.items.every((i) => grid.includes(i.label))));
  check(`${difficulty}: grid slide gives no answers`, !grid.includes('●</td>') && !grid.includes('✕</td>'));
  check(`${difficulty}: caption mentions the grid slide`, /swipe for a blank grid/.test(text));
  const bs = bluesky(r.puzzle, DAY);
  check(`${difficulty}: Bluesky post fits 300 characters`, bs && [...new Intl.Segmenter().segment(bs.text)].length <= BLUESKY_LIMIT, bs?.text);
  check(`${difficulty}: Bluesky links show in the text`, bs && bs.links.every(([show, url]) => bs.text.includes(show) && url.startsWith('https://')));
  check(`${difficulty}: Bluesky answer link is the day's answer key`, bs && bs.links[1][1] === answerUrl(DAY));
  check(`${difficulty}: Bluesky alt text has every clue`, bs && r.puzzle.clues.every((c) => bs.alts[0].includes(c.text)) || bs.alts[0].length === 2000);
  const md = mastodon(r.puzzle, DAY);
  check(`${difficulty}: Mastodon post fits 500 characters`, md && mastodonLength(md.text) <= MASTODON_LIMIT, md?.text);
  check(`${difficulty}: Mastodon post has the play and answer key links`, md && md.text.includes(playUrl(DAY)) && md.text.includes(answerUrl(DAY)));
  check(`${difficulty}: Mastodon alt text fits 1,500 characters`, md && md.alts.length === 2 && md.alts.every((a) => a.length <= 1500));
  check(`${difficulty}: caption promotes the streak`, /streak/.test(text));
  check(`${difficulty}: caption fits Instagram with numbers too`, instagramCaption(r.puzzle, DAY, { solved: 12345, medianMs: 9 * 60000 }).length <= 2200);
  check(`${difficulty}: caption gives no answers`, !r.puzzle.answerKey.questions.some((q) => text.includes(`${q.question} ${q.answer}`)));
}

{
  const long = generatePuzzle({ difficulty: 'hard', theme: 'mystery', seed: 'social-long' });
  long.title = 'A Title So Very Long That It Takes Up Most Of The Room Bluesky Allows For One Whole Post And Then Some More Words';
  const bs = bluesky(long, DAY);
  check('a long title still fits Bluesky (shorter middle line)', bs && [...new Intl.Segmenter().segment(bs.text)].length <= BLUESKY_LIMIT);
  const md = mastodon(long, DAY);
  check('a long title still fits Mastodon', md && mastodonLength(md.text) <= MASTODON_LIMIT);
}
check('numbers shown with enough solvers', statsLine({ solved: 42, medianMs: 420000 }).includes('42 players') && statsLine({ solved: 42, medianMs: 420000 }).includes('7 minutes'));
check('no numbers with too few solvers', statsLine({ solved: 3, medianMs: 420000 }) === '' && statsLine(null) === '');

// The workflow checks out only some files: every file the checker imports must be in that list.
{
  const { readFileSync } = await import('node:fs');
  const wf = readFileSync(new URL('../.github/workflows/daily-puzzle-social.yml', import.meta.url), 'utf8');
  const src = readFileSync(new URL('./social-puzzle.mjs', import.meta.url), 'utf8');
  for (const [, rel] of src.matchAll(/^import .* from '(\.{1,2}\/[^']+)';/gm)) {
    const path = new URL(rel, new URL('./social-puzzle.mjs', import.meta.url)).pathname.split('/fantastical-logic-grid/').pop().replace(/^.*?(scripts|engine)\//, '$1/');
    const listed = wf.includes(path) || wf.split('\n').some((l) => l.trim() && path.startsWith(l.trim() + '/'));
    check(`workflow checks out ${path}`, listed);
  }
}

if (failed) { console.log(`${failed} social puzzle checks failed`); process.exit(1); }
console.log('Social puzzle checks passed');
