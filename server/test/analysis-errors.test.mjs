// The Analysis page counts only errors still open: ones from app versions
// older than the version that fixed them are counted apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitErrors } from '../src/analysis.js';

test('errors fixed in a newer version are counted apart', () => {
  const rows = [
    { message: "Cannot read properties of undefined (reading 'toLowerCase')", place: 'app.js:1882', platform: 'web', version: '1.7.0', n: 5 },
    { message: "Cannot read properties of undefined (reading 'toLowerCase')", place: 'app.js:900', platform: 'web', version: '1.7.2', n: 1 },
    { message: "Cannot set properties of null (setting 'hidden')", place: 'app.js:43', platform: 'web', version: '1.16.2', n: 4 },
    { message: 'grid is undefined', place: 'grid.js:2', platform: 'web', version: '1.18.3', n: 2 },
  ];
  const fixes = [
    { message: "Cannot read properties of undefined (reading 'toLowerCase')", file: 'app.js', fixedIn: '1.7.1' },
    { message: "Cannot set properties of null (setting 'hidden')", file: 'app.js', fixedIn: '1.18.4' },
  ];
  const out = splitErrors(rows, fixes);
  assert.equal(out.errorsFixed, 9);
  assert.equal(out.errorsOpen, 3);
  assert.deepEqual(out.errorsOpenTop.map((x) => [x.message, x.n]), [['grid is undefined', 2], ["Cannot read properties of undefined (reading 'toLowerCase')", 1]]);
  assert.deepEqual(splitErrors(null, null), {});
});
