// The market test's 7-day return (web/js/campaign.js): a player from a
// campaign visit who comes back on a later day within a week is counted once.
// Runs campaign.js in Node with a pretend browser and a pretend Worker URL.
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'flg-campaign-'));
cpSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js'), dir, { recursive: true });
writeFileSync(join(dir, 'cloud-config.js'), "export const CLOUD = { learnUrl: 'https://api.test', siteUrl: 'https://thelogicgrid.com', appVersion: 'test' };\nexport const CLOUD_URL = CLOUD.learnUrl;\nexport const cloudEnabled = () => false;\n");
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const sent = [];
const mem = new Map();
const storage = () => ({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) });
let now = Date.parse('2026-11-02T15:00:00Z');
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])); }
  static now() { return now; }
};
globalThis.window = globalThis;
globalThis.localStorage = storage();
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.history = { state: null, replaceState: (s, t, u) => { globalThis.location.href = `https://thelogicgrid.com${u}`; } };
globalThis.document = { referrer: '' };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test', onLine: true }, configurable: true });
globalThis.fetch = async (url, o) => { sent.push(JSON.parse(o.body).e); return { ok: true }; };
const go = (href) => { globalThis.location = { href, hostname: 'thelogicgrid.com' }; };

const campaign = await import(pathToFileURL(join(dir, 'campaign.js')).href);
const ok = (m) => console.log(`ok  ${m}`);

go('https://thelogicgrid.com/?utm_source=reddit&utm_medium=forum&utm_campaign=launch-2026');
campaign.init();
assert.deepEqual(sent, ['visit']);
ok('a campaign visit is counted');

now += 3600_000;
go('https://thelogicgrid.com/');
campaign.init();
assert.deepEqual(sent, ['visit']);
ok('coming back the same day is not a return');

now += 3 * 86400_000;
go('https://thelogicgrid.com/');
campaign.init();
assert.deepEqual(sent, ['visit', 'return']);
ok('coming back three days later counts one return');

now += 86400_000;
campaign.init();
assert.deepEqual(sent, ['visit', 'return']);
ok('and only once');

mem.clear();
sent.length = 0;
go('https://thelogicgrid.com/?utm_source=reddit&utm_campaign=launch-2026');
campaign.init();
now += 9 * 86400_000;
go('https://thelogicgrid.com/');
campaign.init();
assert.deepEqual(sent, ['visit']);
ok('coming back after more than a week is not counted');
