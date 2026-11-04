// Tests for racing the computer (web/js/computer-race.js): its race time by
// skill and by the player's own pace, its progress through the race, the race
// time rules (1 minute a hint, 15 seconds a check) and the record on this device.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const cpu = await import('../web/js/computer-race.js');

const E = 10 * 60_000;
assert.equal(cpu.computerMs(E, 'steady'), E);
assert.ok(cpu.computerMs(E, 'apprentice') > cpu.computerMs(E, 'steady'));
assert.ok(cpu.computerMs(E, 'sharp') < cpu.computerMs(E, 'steady'));
assert.ok(cpu.computerMs(E, 'relentless') < cpu.computerMs(E, 'sharp'));
assert.ok(cpu.computerMs(1000, 'relentless') >= 45_000, 'never impossibly fast');

// Matched: a little quicker than the player's median pace; steady with too few solves.
const plays = [0.5, 0.6, 0.7, 2].map((r) => ({ outcome: 'solved', ms: r * E, expectedMs: E, hints: 0, checks: 0 }));
assert.equal(cpu.playerPace(plays), 0.7);
assert.equal(cpu.playerPace(plays.slice(0, 1)), null);
assert.equal(cpu.computerMs(E, 'matched', 0.7), Math.round(E * 0.7 * 0.92));
assert.equal(cpu.computerMs(E, 'matched', null), Math.round(E * 0.92));
// Hints and checks count toward the player's pace, as in a race.
assert.equal(cpu.playerPace([{ outcome: 'solved', ms: E, expectedMs: E, hints: 1, checks: 0 }, { outcome: 'solved', ms: E, expectedMs: E, hints: 1, checks: 0 }]), 1.1);

// Progress: 0 at the start, 1 at the finish, never going backwards, same every time.
let last = -1;
for (let t = 0; t <= E; t += 5000) { const p = cpu.progressAt(t, E, 'seed'); assert.ok(p >= last && p >= 0 && p <= 1); last = p; }
assert.equal(cpu.progressAt(0, E, 's'), 0);
assert.equal(cpu.progressAt(E, E, 's'), 1);
assert.equal(cpu.progressAt(E / 2, E, 's'), cpu.progressAt(E / 2, E, 's'));
assert.ok(cpu.progressAt(E / 2, E, 's') > 0.3 && cpu.progressAt(E / 2, E, 's') < 0.7, 'about halfway at half time');

assert.equal(cpu.raceMsOf({ elapsedMs: 100_000, hintsUsed: 2, checksUsed: 3 }), 100_000 + 120_000 + 45_000);
const r = cpu.newRace({ id: 'x', expectedMs: E }, 'sharp', []);
assert.deepEqual(r, { skill: 'sharp', ms: Math.round(E * 0.7), seed: 'x', done: false });

assert.equal(cpu.recordText(), '');
cpu.addResult(true); cpu.addResult(false); cpu.addResult(true);
assert.deepEqual(cpu.record(), { wins: 2, losses: 1 });
assert.equal(cpu.recordText(), 'Your record against the computer: 2 wins, 1 loss.');
console.log('Race the computer: all checks passed');
