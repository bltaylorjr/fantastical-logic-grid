// Shared engine core: engine-host.js (worker side) and engine-link.js (page side).
// Runs in Node with a pretend worker. node test/kernel-tests.js
import assert from 'node:assert/strict';
import { serveEngine } from '../src/engine-host.js';
import { engineLink } from '../src/engine-link.js';

// A pretend worker: the host runs in `scope`, messages go both ways as in a browser.
function fakeWorker(ops) {
  const scope = { location: { origin: 'https://thelogicgrid.com' } };
  const w = {
    terminated: false,
    postMessage(data) { setTimeout(() => scope.onmessage({ data: structuredClone(data), origin: '' }), 0); },
    terminate() { this.terminated = true; },
  };
  scope.postMessage = (data) => { if (!w.terminated) setTimeout(() => w.onmessage({ data: structuredClone(data) }), 0); };
  serveEngine(ops, scope);
  return { w, scope };
}

let started = 0;
const make = (ops) => () => { started++; return fakeWorker(ops).w; };

// Calls, async calls, errors, built-in ops.
{
  const link = engineLink(make({ add: (a) => a.x + a.y, later: async (a) => a.v * 2, boom: () => { throw new Error('bad'); } }));
  assert.equal(await link.call('add', { x: 2, y: 3 }), 5);
  assert.equal(await link.call('later', { v: 21 }), 42);
  await assert.rejects(link.call('boom'), /bad/);
  await assert.rejects(link.call('nope'), /Unknown request "nope"/);
  assert.deepEqual(await link.call('ops'), ['add', 'later', 'boom']);
  assert.equal(await link.call('ping'), 'pong');
  // Inherited names are not operations.
  await assert.rejects(link.call('toString'), /Unknown request/);
}

// Messages from another origin are ignored.
{
  const { scope } = fakeWorker({ add: () => 1 });
  let replied = false;
  scope.postMessage = () => { replied = true; };
  await scope.onmessage({ data: { id: 1, op: 'add' }, origin: 'https://example.com' });
  assert.equal(replied, false);
}

// A crashed worker: waiting calls fail, and the next call starts a fresh worker.
{
  started = 0;
  let current;
  const link = engineLink(() => { started++; current = fakeWorker({ slow: () => new Promise(() => {}), add: (a) => a.x + 1 }).w; return current; });
  const waiting = link.call('slow');
  current.onerror({ message: 'crashed' });
  await assert.rejects(waiting, /crashed/);
  assert.equal(await link.call('add', { x: 1 }), 2);
  assert.equal(started, 2);
}

// A call that runs too long is stopped and the worker restarted.
{
  started = 0;
  const link = engineLink(make({ slow: () => new Promise(() => {}), add: (a) => a.x + 1 }), { timeoutMs: 30 });
  await assert.rejects(link.call('slow'), /took too long/);
  assert.equal(await link.call('add', { x: 4 }), 5);
  assert.equal(started, 2);
}

// No workers: the fallback runs the same operations on the page, loaded once.
{
  let loads = 0;
  const link = engineLink(() => { throw new Error('no module workers'); }, {
    fallback: async () => { loads++; return { add: (a) => a.x + a.y }; },
  });
  assert.equal(await link.call('add', { x: 1, y: 1 }), 2);
  assert.equal(await link.call('add', { x: 2, y: 2 }), 4);
  assert.equal(loads, 1);
  await assert.rejects(link.call('nope'), /Unknown request/);
}

console.log('kernel tests passed');
