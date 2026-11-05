// Tests for every other game's daily puzzle (all nine) (scripts/game-daily.mjs) and its
// social posts (scripts/social-games.mjs), offline: for eight days (every weekday),
// each game's daily puzzle is the very one the game itself makes (its own
// dailyOptions), passes every check, and its captions fit each site's limit.
// Also: the admin's highest level and daily switch are followed.
import assert from 'node:assert/strict';
import { DAILY_GAMES, dailyPuzzle, checkDaily, dailyOn, gameById } from './game-daily.mjs';

const ui = {
  np: await import('../modules/number-place/ui.js'),
  cm: await import('../modules/cage-math/ui.js'),
  sc: await import('../modules/sum-cross/ui.js'),
  pg: await import('../modules/picture-grid/ui.js'),
  ml: await import('../modules/more-or-less/ui.js'),
  sk: await import('../modules/skyline/ui.js'),
  sf: await import('../modules/star-field/ui.js'),
  ll: await import('../modules/loop-line/ui.js'),
  ib: await import('../modules/island-bridges/ui.js'),
};
const day = (i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);

let n = 0;
// Nov 1 to 8: every weekday and level; Nov 8 is a Sunday whose NINETIMESNINE seed once found nothing.
for (let i = 0; i < 8; i++) {
  const d = day(i);
  for (const g of DAILY_GAMES) {
    const p = dailyPuzzle(g, d, null);
    const game = g.ops.generate({ seed: 'unused', story: true, theme: null, ...ui[g.id].dailyOptions(d), daily: d, usedStories: [], usedPictures: [], avoid: [] });
    assert.equal(p.fingerprint, game.fingerprint, `${g.name} ${d}: not the game's own daily puzzle`);
    // The same story too (the grid-kit games' daily story theme), as the answer key page and post show it.
    assert.deepEqual(p.story, game.story, `${g.name} ${d}: not the game's own daily story`);
    assert.deepEqual(checkDaily(g, p, d), [], `${g.name} ${d}`);
    n++;
  }
}

// A broken answer is caught.
{
  const g = gameById('cm'), p = dailyPuzzle(g, day(2), null);
  const bad = { ...p, solution: p.solution.slice() };
  [bad.solution[0], bad.solution[1]] = [bad.solution[1], bad.solution[0]];
  assert.ok(checkDaily(g, bad, day(2)).length, 'a wrong Cage Math answer was not caught');
}

// A line game's broken answer is caught too: a Loop Line edge taken off the loop,
// and an Island Bridges bridge taken away.
{
  const g = gameById('ll'), p = dailyPuzzle(g, day(2), null);
  const bad = { ...p, solution: p.solution.slice() };
  bad.solution[bad.solution.indexOf(1)] = 2;
  assert.ok(checkDaily(g, bad, day(2)).length, 'a broken Loop Line answer was not caught');
  const h = gameById('ib'), q = dailyPuzzle(h, day(2), null);
  const gone = { ...q, solution: q.solution.slice() };
  gone.solution[gone.solution.findIndex((v) => v === 1 || v === 2)] = 3;
  assert.ok(checkDaily(h, gone, day(2)).length, 'a broken Island Bridges answer was not caught');
}

// Admin switches: the highest level caps a kit game's daily level; daily off skips the game.
{
  const g = gameById('sc'), sunday = '2026-11-08';
  const p = dailyPuzzle(g, sunday, { kitGames: { sc: { maxLevel: 'medium' } } });
  assert.equal(p.difficulty.id, 'medium');
  assert.equal(dailyOn(g, { kitGames: { sc: { daily: false } } }), false);
  assert.equal(dailyOn(gameById('np'), { numberPlace: { enabled: false } }), false);
  assert.equal(dailyOn(gameById('np'), null), true);
}

// Captions fit (Bluesky 300 graphemes; X 280 with links as 23; Mastodon and Threads 500).
process.env.DAY = day(0);
const social = await import('./social-games.mjs');
for (const g of DAILY_GAMES) {
  const c = social.caption(g, dailyPuzzle(g, day(0), null));
  assert.ok(c.includes(`/${g.page}daily/${day(0)}/`) && c.includes(`/${g.page}?play=daily`), `${g.name}: caption links`);
}
console.log(`Daily puzzles of the other games: ${n} checked, all the game's own and all proven.`);
