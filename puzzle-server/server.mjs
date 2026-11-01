// The Fantastical Logic Grid: private puzzle server (docs/PUZZLE-SERVER.md).
// Runs on the Oracle build server. It has no public address: the only way in
// is the game's Cloudflare Worker, through a Cloudflare Tunnel (Workers VPC),
// and every request must also carry the shared key FLG_PUZZLE_KEY.
//
//   POST /v1/run/<game>/<op>  { args }  -> { result }
//        every game and operation in engine/src/games.js
//   GET  /v1/health                -> { ok, release, engine, busy, queued }
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
if (!existsSync(join(ENGINE_DIR, 'games.js'))) { console.error(`Engine not found in ${ENGINE_DIR}`); process.exit(2); }
// Every game and operation, with its size and time limits (engine/src/games.js).
const { ENGINE_GAMES, OP_KINDS } = await import(pathToFileURL(join(ENGINE_DIR, 'games.js')).href);
export const LIMITS = {};
for (const [id, game] of Object.entries(ENGINE_GAMES)) {
  for (const [op, kind] of Object.entries(game.kinds)) LIMITS[`${id}/${op}`] = { bytes: OP_KINDS[kind].maxBytes, ms: OP_KINDS[kind].serverMs };
}

const keyHash = createHash('sha256').update(KEY).digest();
const keyOk = (given) => typeof given === 'string' && timingSafeEqual(createHash('sha256').update(given).digest(), keyHash);

// ------------------------------------------------------------ engine pool
const threads = [];
const queue = [];
let seq = 0;
let engineVersion = null;

function startThread() {
  const t = { worker: new Worker(join(here, 'engine-thread.mjs'), { workerData: { engineDir: ENGINE_DIR } }), job: null, ready: false };
  t.worker.on('message', (msg) => {
    if (msg.ready) { t.ready = true; engineVersion = msg.version; pump(); return; }
    const job = t.job;
    if (!job || job.id !== msg.id) return;
    clearTimeout(job.timer);
    t.job = null;
    msg.ok ? job.resolve(msg.result) : job.reject(Object.assign(new Error(msg.error), { engine: true }));
    pump();
  });
  t.worker.on('error', (err) => console.error('engine thread error:', err));
  t.worker.on('exit', () => {
    const i = threads.indexOf(t);
    if (i >= 0) threads.splice(i, 1);
    if (t.job) { clearTimeout(t.job.timer); t.job.reject(new Error('engine thread stopped')); }
    if (!stopping) startThread();
  });
  threads.push(t);
}

function pump() {
  for (const t of threads) {
    if (!t.ready || t.job || !queue.length) continue;
    const job = queue.shift();
    t.job = job;
    // A puzzle that runs too long is stopped by replacing its thread.
    job.timer = setTimeout(() => { job.reject(Object.assign(new Error('timed out'), { timeout: true })); t.job = null; t.worker.terminate(); }, job.ms);
    t.worker.postMessage({ id: job.id, op: job.op, args: job.args });
  }
}

function run(op, args) {
  if (queue.length >= MAX_QUEUE) return Promise.reject(Object.assign(new Error('busy'), { busy: true }));
  return new Promise((resolve, reject) => { queue.push({ id: ++seq, op, args, ms: LIMITS[op].ms, resolve, reject }); pump(); });
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
    return send(res, 200, { ok: !stopping && threads.some((t) => t.ready), release: RELEASE, engine: engineVersion, threads: threads.length, busy: threads.filter((t) => t.job).length, queued: queue.length });
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
