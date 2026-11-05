// Attachments on Report a Problem (src/report-files.js): only pictures, PDFs
// and plain text are kept, the type comes from the file's own bytes, names
// are made safe, and sizes and counts are capped. Run with `npm test` in server/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFiles, sniff, safeName, MAX_FILES, MAX_FILE_BYTES } from '../src/report-files.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const WEBP = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')];

test('the type comes from the first bytes, not the name', () => {
  assert.equal(sniff(new Uint8Array(PNG), 'shot.jpg'), 'image/png');
  assert.equal(sniff(new Uint8Array(JPEG), 'x'), 'image/jpeg');
  assert.equal(sniff(new Uint8Array(WEBP), 'x'), 'image/webp');
  assert.equal(sniff(new Uint8Array(Buffer.from('GIF89a....')), 'x'), 'image/gif');
  assert.equal(sniff(new Uint8Array(Buffer.from('%PDF-1.7 ...')), 'a.pdf'), 'application/pdf');
  assert.equal(sniff(new Uint8Array(Buffer.from('TypeError: x is undefined')), 'console.log'), 'text/plain');
  assert.equal(sniff(new Uint8Array(Buffer.from('{"a":1}')), 'state.json'), 'application/json');
  // Pages and scripts are refused whatever they are called.
  assert.equal(sniff(new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>')), 'pic.svg'), null);
  assert.equal(sniff(new Uint8Array(Buffer.from('<html><script></script>')), 'page.html'), null);
  assert.equal(sniff(new Uint8Array([0x4d, 0x5a, 0x90, 0]), 'notes.txt'), null); // a program with a .txt name
  assert.equal(sniff(new Uint8Array([0xc3, 0x28]), 'bad.txt'), null); // not UTF-8
});

test('names are made safe and get the extension of their real type', () => {
  assert.equal(safeName('../../etc/passwd', 'image/png', 1), 'passwd.png');
  assert.equal(safeName('C:\\Users\\me\\Screen Shot <1>.jpg', 'image/png', 1), 'Screen Shot 1.png');
  assert.equal(safeName('', 'image/jpeg', 2), 'attachment-2.jpg');
  assert.equal(safeName('errors.log', 'text/plain', 1), 'errors.log');
});

test('reports take up to three files of up to 1 MB each', () => {
  assert.deepEqual(readFiles(undefined), []);
  const ok = readFiles([{ name: 'screen.png', data: b64(PNG) }, { name: 'log.txt', data: `data:text/plain;base64,${b64(Buffer.from('oops'))}` }]);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].mime, 'image/png');
  assert.equal(ok[1].size, 4);
  assert.equal(readFiles(Array.from({ length: MAX_FILES + 1 }, () => ({ name: 'a.png', data: b64(PNG) }))).error, 'too_many_files');
  const big = new Uint8Array(MAX_FILE_BYTES + 1); big.set(PNG);
  assert.equal(readFiles([{ name: 'big.png', data: b64(big) }]).error, 'file_too_large');
  assert.equal(readFiles([{ name: 'x.svg', data: b64(Buffer.from('<svg/>')) }]).error, 'file_type');
  assert.equal(readFiles([{ name: 'x.png', data: 'not base64!' }]).error, 'bad_file');
  assert.equal(readFiles('nope').error, 'bad_files');
});
