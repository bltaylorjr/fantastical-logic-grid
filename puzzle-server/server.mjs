// The Fantastical Logic Grid: private puzzle server (docs/PUZZLE-SERVER.md).
// Runs on the Oracle build server. It has no public address: the only way in
// is the game's Cloudflare Worker, through a Cloudflare Tunnel (Workers VPC),
// and every request must also carry the shared key FLG_PUZZLE_KEY.
//
//   POST /v1/run/<game>/<op>  { args }  -> { result }
//        every game and operation in engine/src/games.js
//   GET  /v1/health                -> { ok, release, engine, busy, queued, canary, upkeep, ops }
//
// Settings (environment):
//   FLG_PUZZLE_KEY   required, at least 32 characters
//   PORT             default 8080
//   ENGINE_DIR       the engine folder (default ../engine/src)
//   THREADS          engine threads (default 2; the VM also runs build jobs)
//   MAX_QUEUE        waiting requests before "busy" (default 60)
//   RELEASE_FILE     a file holding the live release id; when its contents
//                    change, the server finishes what it is doing and exits
//                    so Docker restarts it on the new release
//   RELEASE          this release's id
//   CANARY           1 (default) checks every game with engine/doctor.js on
//                    start; health says ok only once it passes. 0 skips it.
//   RECYCLE_JOBS     replace an engine thread after this many requests (default 400)
//   RECYCLE_MB       ...or once it holds this much memory (default 600)
//
// Upkeep, all automatic and rule-based: a thread is replaced when it times
// out, crashes, has served RECYCLE_JOBS requests or grows past RECYCLE_MB
// (memory never builds up), and a thread that keeps crashing is restarted
// more and more slowly (1 s doubling up to 60 s) instead of in a tight loop.
// Health shows, per operation, how many requests ran, failed and timed out
// and how long the middle and slowest 5% took (last 200 of each).
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.FLG_PUZZLE_KEY || '';
if (KEY.length < 32) {
  console.error('FLG_PUZZLE_KEY is missing or shorter than 32 characters; refusing to start.');
  process.exit(2);
}
const PORT = Number(process.env.PORT || 8080);
const ENGINE_DIR = resolve(process.env.ENGINE_DIR || join(here, '..', 'engine', 'src'));
const THREADS = Math.max(1, Number(process.env.THREADS || 2));
const MAX_QUEUE = Math.max(1, Number(process.env.MAX_QUEUE || 60));
const RELEASE = process.env.RELEASE || 'dev';
const RELEASE_FILE = process.env.RELEASE_FILE || '';
const CANARY = process.env.CANARY !== '0';
const RECYCLE_JOBS = Math.max(1, Number(process.env.RECYCLE_JOBS || 400));
const RECYCLE_MB = Math.max(64, Number(process.env.RECYCLE_MB || 600));
if (!existsSync(join(ENGINE_DIR, 'games.js'))) { console.error(`Engine not found in ${ENGINE_DIR}`); process.exit(2); }
// Every game and operation, with its size and time limits (engine/src/games.js).
const { ENGINE_GAMES, OP_KINDS } = await import(pathToFileURL(join(ENGINE_DIR, 'games.js')).href);
export const LIMITS = {};
for (const [id, game] of Object.entries(ENGINE_GAMES)) {
  for (const [op, kind] of Object.entries(game.kinds)) LIMITS[`${id}/${op}`] = { bytes: OP_KINDS[kind].maxBytes, ms: OP_KINDS[kind].serverMs };
}

const keyHash = createHash('sha256').update(KEY).digest();
const keyOk = (given) => typeof given === 'string' && timingSafeEqual(createHash('sha256').update(given).digest(), keyHash);

// ------------------------------------------------------------ stats
// Per operation: counts and the last 200 timings, for health and tuning.
const stats = {};
const statFor = (op) => (stats[op] ||= { runs: 0, failed: 0, timedOut: 0, busy: 0, times: [] });
function record(op, ms, outcome) {
  const s = statFor(op);
  if (outcome === 'busy') { s.busy++; return; }
  s.runs++;
  if (outcome === 'failed') s.failed++;
  if (outcome === 'timeout') s.timedOut++;
  if (outcome === 'ok') { s.times.push(ms); if (s.times.length > 200) s.times.shift(); }
}
const pct = (xs, q) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return Math.round(a[Math.min(a.length - 1, Math.floor(q * a.length))]); };
const opStats = () => Object.fromEntries(Object.entries(stats).map(([op, s]) => [op, { runs: s.runs, failed: s.failed, timedOut: s.timedOut, busy: s.busy, p50Ms: pct(s.times, 0.5), p95Ms: pct(s.times, 0.95) }]));

// ------------------------------------------------------------ engine pool
const threads = [];
const queue = [];
let seq = 0;
let engineVersion = null;
const upkeep = { started: 0, recycled: 0, crashed: 0, timedOut: 0, restartDelayMs: 0 };
let crashTimes = [];

function startThread() {
  upkeep.started++;
  const t = { worker: new Worker(join(here, 'engine-thread.mjs'), { workerData: { engineDir: ENGINE_DIR } }), job: null, ready: false, jobs: 0, planned: false };
  t.worker.on('message', (msg) => {
    if (msg.ready) { t.ready = true; engineVersion = msg.version; pump(); return; }
    const job = t.job;
    if (!job || job.id !== msg.id) return;
    clearTimeout(job.timer);
    t.job = null;
    t.jobs++;
    record(job.op, Date.now() - job.began, msg.ok ? 'ok' : 'failed');
    msg.ok ? job.resolve(msg.result) : job.reject(Object.assign(new Error(msg.error), { engine: true }));
    // Upkeep: a thread that has done a lot of work or grown big is replaced while idle.
    if (t.jobs >= RECYCLE_JOBS || (msg.heapMb || 0) >= RECYCLE_MB) { upkeep.recycled++; retire(t); }
    pump();
  });
  t.worker.on('error', (err) => console.error('engine thread error:', err));
  t.worker.on('exit', () => {
    const i = threads.indexOf(t);
    if (i >= 0) threads.splice(i, 1);
    if (t.job) { clearTimeout(t.job.timer); record(t.job.op, 0, 'failed'); t.job.reject(new Error('engine thread stopped')); }
    if (stopping) return;
    if (t.planned) { startThread(); return; }
    // An unplanned exit is a crash: restart, but back off if it keeps happening.
    upkeep.crashed++;
    const at = Date.now();
    crashTimes = crashTimes.filter((x) => at - x < 60000).concat(at);
    upkeep.restartDelayMs = crashTimes.length >= 3 ? Math.min(60000, 1000 * 2 ** (crashTimes.length - 3)) : 0;
    if (upkeep.restartDelayMs) console.error(`engine thread crashed ${crashTimes.length} times in a minute; restarting in ${upkeep.restartDelayMs} ms`);
    setTimeout(() => { if (!stopping) startThread(); }, upkeep.restartDelayMs).unref();
  });
  threads.push(t);
}

// Replace a thread on purpose (its exit starts the new one).
function retire(t) {
  t.planned = true;
  t.ready = false;
  t.worker.terminate();
}

function pump() {
  for (const t of threads) {
    if (!t.ready || t.job || !queue.length) continue;
    const job = queue.shift();
    t.job = job;
    job.began = Date.now();
    // A puzzle that runs too long is stopped by replacing its thread.
    job.timer = setTimeout(() => {
      upkeep.timedOut++;
      record(job.op, job.ms, 'timeout');
      job.reject(Object.assign(new Error('timed out'), { timeout: true }));
      t.job = null;
      retire(t);
    }, job.ms);
    t.worker.postMessage({ id: job.id, op: job.op, args: job.args });
  }
}

function run(op, args) {
  if (queue.length >= MAX_QUEUE) { record(op, 0, 'busy'); return Promise.reject(Object.assign(new Error('busy'), { busy: true })); }
  return new Promise((resolve, reject) => { queue.push({ id: ++seq, op, args, ms: LIMITS[op].ms, resolve, reject }); pump(); });
}

// ------------------------------------------------------------ start-up check
// Every game builds, checks and hints correctly (engine/doctor.js) before the
// server calls itself healthy. Runs in its own thread so requests are not held up.
const canary = { ok: !CANARY, state: CANARY ? 'checking' : 'off', ms: null, failed: [] };
const doctorFile = join(ENGINE_DIR, '..', 'doctor.js');
if (CANARY && existsSync(doctorFile)) {
  const w = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.doctor).then((d) => d.canary({ dir: workerData.engineDir, budgetMs: 90000 }))
      .then((r) => parentPort.postMessage(r), (e) => parentPort.postMessage({ ok: false, results: [{ game: 'all', level: '-', ok: false, problems: [String(e && e.message || e)] }] }));`,
  { eval: true, workerData: { doctor: pathToFileURL(doctorFile).href, engineDir: ENGINE_DIR } });
  w.once('message', (r) => {
    canary.ok = r.ok;
    canary.state = r.ok ? 'passed' : 'failed';
    canary.ms = r.ms ?? null;
    canary.failed = (r.results || []).filter((x) => !x.ok).map((x) => `${x.game}/${x.level}: ${x.problems.join('; ')}`).slice(0, 20);
    console.log(r.ok ? `Start-up check passed in ${r.ms} ms.` : `Start-up check FAILED:\n  ${canary.failed.join('\n  ')}`);
    w.terminate();
  });
  w.once('error', (e) => { canary.ok = false; canary.state = 'failed'; canary.failed = [String(e.message)]; });
} else if (CANARY) {
  canary.ok = true;
  canary.state = 'no doctor';
}

// ------------------------------------------------------------ http
const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
};

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

let inFlight = 0;
let stopping = false;
const server = createServer(async (req, res) => {
  if (!keyOk(req.headers['x-flg-key'])) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://puzzles');
  if (req.method === 'GET' && url.pathname === '/v1/health') {
    return send(res, 200, {
      ok: !stopping && canary.ok && threads.some((t) => t.ready), release: RELEASE, engine: engineVersion,
      threads: threads.length, busy: threads.filter((t) => t.job).length, queued: queue.length,
      canary, upkeep, ops: opStats(),
    });
  }
  const m = req.method === 'POST' && url.pathname.match(/^\/v1\/run\/([a-z0-9-]+\/[a-z0-9-]+)$/);
  const op = m && Object.hasOwn(LIMITS, m[1]) ? m[1] : null;
  if (!op) return send(res, 404, { error: 'not_found' });
  if (stopping) return send(res, 503, { error: 'restarting' });
  inFlight++;
  try {
    const body = await readJson(req, LIMITS[op].bytes);
    if (!isPlainObject(body.args)) return send(res, 400, { error: 'bad_args' });
    const args = body.args;
    const result = await run(op, args);
    send(res, 200, { result });
  } catch (err) {
    if (err.status) send(res, err.status, { error: err.message.replace(/ /g, '_') });
    else if (err.busy) send(res, 429, { error: 'busy' });
    else if (err.timeout) send(res, 504, { error: 'timed_out' });
    else if (err.engine) send(res, 422, { error: 'cannot_build', message: err.message.slice(0, 300) });
    else { console.error(err); send(res, 500, { error: 'server_error' }); }
  } finally {
    inFlight--;
  }
});
server.requestTimeout = 200000;
server.headersTimeout = 15000;

for (let i = 0; i < THREADS; i++) startThread();
server.listen(PORT, () => console.log(`Puzzle server ${RELEASE} listening on ${PORT} with ${THREADS} engine threads.`));

// ------------------------------------------------------------ restarts
// Finish the requests in hand (up to 3 minutes), then exit for Docker to restart.
function stop(why) {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping: ${why}`);
  server.close();
  const deadline = Date.now() + 180000;
  const check = setInterval(() => {
    if (inFlight === 0 || Date.now() > deadline) { clearInterval(check); for (const t of threads) t.worker.terminate(); process.exit(0); }
  }, 500);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
if (RELEASE_FILE) {
  setInterval(() => {
    try { if (readFileSync(RELEASE_FILE, 'utf8').trim() !== RELEASE) stop('a new release is live'); } catch (e) { /* file being replaced */ }
  }, 15000).unref();
}
