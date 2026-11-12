// Errors from a browser add-on are not reported (web/js/error-filter.js).
import assert from 'node:assert/strict';
import { fromAddOn } from '../web/js/error-filter.js';

const addOn = "TypeError: Cannot assign to read only property 'writeText' of object '#<Clipboard>'\n    at chrome-extension://abcdefghijklmnop/copy-tracker-bridge.js:1:220\n    at https://thelogicgrid.com/fantastical/js/app.js:43:100";
assert.equal(fromAddOn(addOn), true, 'an error thrown in an add-on file is skipped');
assert.equal(fromAddOn('foo@moz-extension://1234/content.js:3:9'), true, 'Firefox add-on frames are skipped');
const ours = "TypeError: x is null\n    at https://thelogicgrid.com/fantastical/js/app.js:43:100\n    at chrome-extension://abc/hook.js:1:1";
assert.equal(fromAddOn(ours), false, 'an error from the game is still sent, even if an add-on is further down the stack');
assert.equal(fromAddOn(''), false, 'an error with no stack is still sent');
console.log('error filter ok');
