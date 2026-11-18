// Checks the game's own badges (web/js/stats.js): every badge a player may
// already hold is still listed (earned badges are kept for good), the bar is
// high, and the progress numbers add up.
import assert from 'node:assert/strict';
import { BADGES, facts } from '../web/js/stats.js';

const byId = Object.fromEntries(BADGES.map((b) => [b.id, b]));
assert.equal(Object.keys(byId).length, BADGES.length, 'badge ids are unique');
const OLD = ['first', 'nohints', 'perfect', 'quick', 'medium', 'hard', 'expert', 'mensa', 'theorist', 'big', 'ten', 'fifty', 'hundred', 'explorer', 'globetrotter', 'daily', 'streak3', 'streak7', 'streak30', 'racer'];
for (const id of OLD) assert.ok(byId[id], `badge ${id} is still listed, so players who earned it keep seeing it`);
assert.ok(BADGES.length >= 35, 'there are plenty of badges to earn');

let t = Date.UTC(2026, 0, 1);
const solve = (o = {}) => ({ at: (t += 3600000), storyId: `s${t}`, tier: 'easy', theme: 'pets', ms: 300000, expectedMs: 600000, hints: 0, checks: 0, mistakes: 0, revealed: false, cells: 48, categories: 3, daily: null, race: false, ...o });
const earned = (log) => BADGES.filter((b) => b.test(facts(log))).map((b) => b.id);

// A handful of easy, clean, quick solves only earn the starter badge.
const easy = Array.from({ length: 9 }, () => solve());
assert.deepEqual(earned(easy), ['first'], `easy solves earn only the first badge (${earned(easy)})`);

// Hard without hints earns "On my own" and "Hard case"; with a hint it does not.
assert.ok(!earned([solve({ tier: 'hard', hints: 1 })]).includes('nohints'));
const hard = earned([solve({ tier: 'hard', ms: 200000, expectedMs: 600000 })]);
for (const id of ['nohints', 'hard', 'quick']) assert.ok(hard.includes(id), `a quick hard solve without hints earns ${id}`);
assert.ok(!hard.includes('perfect') && !hard.includes('lightning'), 'Flawless and Lightning mind need Expert or harder');

// Runs without hints: a hint or a revealed answer breaks the run.
const run = [...Array.from({ length: 9 }, () => solve()), solve({ hints: 1 }), ...Array.from({ length: 9 }, () => solve())];
assert.equal(facts(run).bestNoHintRun, 9);
assert.ok(!earned(run).includes('hotstreak10'));
assert.ok(earned([...run, solve()]).includes('hotstreak10'), '10 in a row earns Hot hand');

// Progress for counted badges.
const f = facts(easy);
assert.deepEqual(byId.ten.goal(f), [9, 25]);
assert.deepEqual(byId.racer.goal(f), [0, 5]);
assert.deepEqual(byId.ladder.goal(facts([solve({ tier: 'medium' }), solve({ tier: 'mensa' })])), [2, 5]);

// Revealed answers never count.
assert.deepEqual(earned([solve({ revealed: true, tier: 'theorist' })]), []);
console.log(`badges ok (${BADGES.length} badges)`);
