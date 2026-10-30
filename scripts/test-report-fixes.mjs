// Report fixes (scripts/report-fixes.mjs) reads what a merged pull request
// fixed from its body.
import assert from 'node:assert/strict';
import { parseFixes } from './report-fixes.mjs';

assert.deepEqual(parseFixes('Small change, nothing reported.'), { trackings: [], note: '', errors: [] });
const body = `Make the grid fit small tablets

- **Fixes reports:** WS-ABCD2345, pz-efgh6789 and WS-ABCD2345
**Player note:** The grid now fits on small tablets without extra scrolling.
Fixes error: \`Cannot read properties of undefined (reading 'toLowerCase') | app.js\`
Fixed errors - Script error | sw.js
Player note: a second note is ignored`;
assert.deepEqual(parseFixes(body), {
  trackings: ['WS-ABCD2345', 'PZ-EFGH6789'],
  note: 'The grid now fits on small tablets without extra scrolling.',
  errors: [
    { message: "Cannot read properties of undefined (reading 'toLowerCase')", place: 'app.js' },
    { message: 'Script error', place: 'sw.js' },
  ],
});
assert.deepEqual(parseFixes('Fixes reports: none here').trackings, [], 'only real tracking ids');
console.log('Report fixes: all checks passed.');
