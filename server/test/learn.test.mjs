// Local check of the shared service with wrangler dev (no Cloudflare account
// needed): plays are saved, tuning adds them up, shared story parts wait for
// review, admin needs the token, and voices fall back when not set up.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTuning } from '../src/learn.js';

const here = dirname(fileURLToPath(import.meta.url));
const state = mkdtempSync(join(tmpdir(), 'flg-learn-'));
const W = 'npx --yes wrangler@4.145.0';
const cfg = `--config ${join(here, 'learn.wrangler.toml')} --persist-to ${state}`;

let passed = 0, failed = 0;
const rawFetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) => rawFetch(u, { ...o, signal: AbortSignal.timeout(8000) });
const check = (name, cond, detail = '') => { if (cond) { passed++; console.log(`ok  ${name}`); } else { failed++; console.log(`FAIL ${name} ${detail}`); } };

// Pure aggregation.
const many = (n, p) => Array.from({ length: n }, () => ({ clue_types: '{"not":3,"either":1}', ...p }));
const t = computeTuning([...many(12, { tier: 'easy', theme: 'pets', effort: 0, signal: 1, rating: 5 }), ...many(12, { tier: 'hard', theme: 'mystery', effort: 0, signal: -1, rating: 2 })], []);
check('easy players who found it too easy get tougher Easy puzzles', t.effort.easy > 0.2, JSON.stringify(t.effort));
check('hard players who struggled get gentler Hard puzzles', t.effort.hard < -0.2);
check('shared limits stay gentle', Math.abs(t.effort.easy) <= 0.6 && Object.values(t.clueWeights).every((w) => w >= 0.75 && w <= 1.4));
check('liked themes lean up', t.themeWeights.pets > t.themeWeights.mystery, JSON.stringify(t.themeWeights));
check('a level with few games is left alone', computeTuning(many(3, { tier: 'basic', theme: 'pets', effort: 0, signal: 1 }), []).effort.basic === undefined);

// Local worker.
const port = 8700 + Math.floor(Math.random() * 200);
writeFileSync(join(here, '.dev.vars'), 'ADMIN_TOKEN=test-admin-token-1234567890\nGEMINI_API_KEY=not-a-real-key\n');
execSync(`${W} d1 migrations apply flg-cloud --local ${cfg}`, { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' }, timeout: 90000 });
const dev = spawn(`${W} dev --local --port ${port} --var DAILY_TTS_CAP:1 ${cfg}`, { shell: true, stdio: ['ignore', process.env.DEV_LOG ? 'inherit' : 'ignore', process.env.DEV_LOG ? 'inherit' : 'ignore'], detached: true });
let stored = '';
const base = `http://localhost:${port}`;
const origin = { Origin: 'https://thelogicgrid.com', 'Content-Type': 'application/json' };
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/v1/health`)).ok) break; } catch (e) { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  const play = { tier: 'medium', theme: 'cooking', outcome: 'solved', effort: 0.2, signal: 0.6, rating: 4, feel: 'right', clueTypes: { not: 4, less: 2 }, parts: { o: '1', i: 'x3k' }, platform: 'android', minutes: 7.5, hints: 1, mistakes: 0 };
  const r1 = await fetch(`${base}/v1/learn/plays`, { method: 'POST', headers: origin, body: JSON.stringify({ plays: [play, { tier: 'nope', theme: 'cooking', outcome: 'solved' }, { ...play, email: 'a@b.c', name: 'Sam' }] }) });
  check('plays are saved; bad rows are dropped', (await r1.json()).saved === 2);
  check('CORS allows the game site', r1.headers.get('Access-Control-Allow-Origin') === 'https://thelogicgrid.com');
  const r2 = await fetch(`${base}/v1/learn/plays`, { method: 'POST', headers: { ...origin, Origin: 'https://evil.example' }, body: JSON.stringify({ plays: [] }) });
  check('CORS does not allow other sites', !r2.headers.get('Access-Control-Allow-Origin'));

  const bad = await fetch(`${base}/v1/learn/parts`, { method: 'POST', headers: origin, body: JSON.stringify({ theme: 'pets', kind: 'openings', value: 'Five dogs met.' }) });
  check('a shared part that breaks the rules is refused', bad.status === 400);
  const part = { theme: 'pets', kind: 'openings', value: 'The dog park was muddy, but {n} {many} came anyway.' };
  const good = await fetch(`${base}/v1/learn/parts`, { method: 'POST', headers: origin, body: JSON.stringify(part) });
  check('a good shared part waits for review', (await good.json()).status === 'pending');
  let tun = await (await fetch(`${base}/v1/learn/tuning`, { headers: origin })).json();
  check('unreviewed parts are not sent to players', !tun.parts.pets);
  check('tuning counts games', tun.games === 2, JSON.stringify(tun));

  check('admin needs the token', (await fetch(`${base}/admin/learn/parts`)).status === 401);
  const auth = { Authorization: 'Bearer test-admin-token-1234567890', 'Content-Type': 'application/json' };
  const list = await (await fetch(`${base}/admin/learn/parts`, { headers: auth })).json();
  check('admin lists the waiting part', list.parts.length === 1 && list.stats.games === 2);
  await fetch(`${base}/admin/learn/review`, { method: 'POST', headers: auth, body: JSON.stringify({ key: list.parts[0].key, status: 'approved' }) });
  tun = await (await fetch(`${base}/v1/learn/tuning`, { headers: origin })).json();
  check('approved parts reach every player', tun.parts.pets && tun.parts.pets.openings[0] === part.value);
  check('the review page loads', (await (await fetch(`${base}/admin/learn`)).text()).includes('Story review'));

  const say = () => fetch(`${base}/v1/tts`, { method: 'POST', headers: origin, body: JSON.stringify({ text: 'Hello there.', voice: 'Kore' }) });
  const t1 = await say();
  check('a voice the server cannot make tells the app to use Kokoro', t1.status >= 500 && (await t1.json()).fallback === 'kokoro', String(t1.status));
  const t2 = await say();
  check('the daily voice cap stops new clips and falls back to Kokoro', t2.status === 429 && (await t2.json()).fallback === 'kokoro', String(t2.status));
  const long = await fetch(`${base}/v1/tts`, { method: 'POST', headers: origin, body: JSON.stringify({ text: 'x'.repeat(500) }) });
  check('long text is refused', long.status === 400);
} finally {
  try { process.kill(-dev.pid); } catch (e) { dev.kill(); }
  rmSync(join(here, '.dev.vars'), { force: true });
}
await new Promise((r) => setTimeout(r, 1000));
stored = execSync(`${W} d1 execute flg-cloud --local --json ${cfg} --command "SELECT * FROM plays"`).toString();
check('nothing personal is stored', !/a@b\.c|Sam|127\.0\.0\.1/.test(stored) && /android/.test(stored));
rmSync(state, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
