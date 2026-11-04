// Voice engine: Vox, the free voice engine shared by every game, running on
// the owner's computer (vox serve), or online through a named Cloudflare
// tunnel at the owner's own address (https://voice.thelogicgrid.com). This page talks to it directly with the admin token Vox prints
// when it starts. Nothing here goes through the Worker, so it costs nothing.
// Until it's connected, the page shows "Open Vox": a running/not-running
// light, a downloadable Windows start shortcut, and auto-connect.
//
// Parts: Learning (how it improves, refine now, settings, rounds), Review
// takes (thumbs up/down and A/B choices that teach it), Voices (new voices
// blended from many speakers' samples, auto-optimize, undo refinement),
// Auto-tune (per-voice pitch correction with a preview), Words (the American
// English dictionary and your pronunciation fixes), Languages (translate and
// hear lines) and Versions (roll back).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const STORE_KEY = 'vox-engine';
const DEFAULT_URL = 'http://127.0.0.1:5150';
const TABS = [['learning', 'Learning'], ['review', 'Review takes'], ['voices', 'Voices'], ['autotune', 'Auto-tune'],
  ['words', 'Words'], ['languages', 'Languages'], ['versions', 'Versions']];

let h = null;       // dashboard helpers
let conn = null;    // { url, token }
let tab = 'learning';
let poll = null;
let player = null;  // the one Audio playing now
let presets = null; // { presets, keys, scales }
let voiceList = [];

function loadConn() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
}
function saveConn(c) {
  try { if (c) localStorage.setItem(STORE_KEY, JSON.stringify(c)); else localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
}

// Where the engine may be: this computer, or online through your own address
// (voice.thelogicgrid.com). The dashboard's content policy allows only these,
// and the token is never sent anywhere else. Quick tunnels
// (*.trycloudflare.com) are not allowed: anyone can make one.
function cleanUrl(raw, { linked = false } = {}) {
  let u;
  try { u = new URL(String(raw || '').trim() || DEFAULT_URL); } catch (e) { throw new Error('That address is not valid. Use http://127.0.0.1:5150 or your online address.'); }
  const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  // A ….trycloudflare.com address is accepted only when it came from the
  // server's Vox link (saved by the Windows admin app), never typed in.
  const online = u.protocol === 'https:' && (/\.thelogicgrid\.com$/.test(u.hostname) || (linked && /^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname)));
  if (!local && !online) {
    throw new Error('Use http://127.0.0.1:5150 on this computer, or the engine\'s own online address (https://voice.thelogicgrid.com). Quick tunnel addresses (….trycloudflare.com) are not allowed.');
  }
  return u.origin;
}

async function vox(path, { method = 'GET', body, raw = false } = {}) {
  if (!conn) throw new Error('Not connected to the voice engine.');
  let res;
  try {
    res = await fetch(conn.url + path, {
      method,
      headers: { 'X-Vox-Admin-Token': conn.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const err = new Error('The voice engine is not answering. Is "vox serve" running on this computer?');
    err.offline = true;
    throw err;
  }
  if (!res.ok) {
    let msg = `The engine said ${res.status}.`;
    try { msg = (await res.json()).detail || msg; } catch (e) { /* not JSON */ }
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}

// ------------------------------------------------------------------ audio
function stopAudio() {
  if (player) { player.pause(); URL.revokeObjectURL(player.src); player = null; }
  $$('#vx-body [data-playing]').forEach((b) => { b.removeAttribute('data-playing'); b.textContent = b.dataset.label || 'Play'; });
}
async function playBlob(blob, button) {
  stopAudio();
  player = new Audio(URL.createObjectURL(blob));
  if (button) { button.dataset.label = button.textContent; button.dataset.playing = '1'; button.textContent = 'Stop'; }
  player.onended = stopAudio;
  await player.play();
}
async function playTake(id, button) {
  if (button?.dataset.playing) { stopAudio(); return; }
  const res = await vox(`/v1/admin/takes/${encodeURIComponent(id)}/audio`, { raw: true });
  await playBlob(await res.blob(), button);
}
async function speakPreview(body, button) {
  if (button?.dataset.playing) { stopAudio(); return; }
  let res;
  try {
    res = await fetch(`${conn.url}/v1/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vox-Admin-Token': conn.token }, body: JSON.stringify(body) });
  } catch (e) { throw new Error('The voice engine is not answering.'); }
  if (!res.ok) { let m = 'Could not make that line.'; try { m = (await res.json()).detail || m; } catch (e) { /* */ } throw new Error(m); }
  await playBlob(await res.blob(), button);
}

// ---------------------------------------------------------------- helpers
const secs = (t) => (t ? t * 1000 : null);           // the engine counts seconds
const pct = (v) => (v == null ? '–' : Number(v).toFixed(1));
function qualityBadge(q) {
  if (q == null) return '<span class="muted">–</span>';
  const cls = q >= 80 ? 'ok' : q >= 60 ? 'warn' : 'bad';
  return `<span class="badge ${cls}" title="Quality score out of 100">${pct(q)}</span>`;
}
const SCORE_NAMES = { voice_match: 'Voice match', intelligibility: 'Clear words', emotion_match: 'Emotion', liveliness: 'Liveliness', pacing: 'Pacing', clean_audio: 'Clean audio' };
function scoreList(s) {
  const items = Object.entries(SCORE_NAMES).filter(([k]) => s?.[k] != null).map(([k, n]) => `${n} ${Math.round(s[k])}`);
  return items.length ? `<span class="muted">${h.esc(items.join(' · '))}</span>` : '';
}
function voiceOptions(selected, { all = false } = {}) {
  const opts = voiceList.map((v) => `<option value="${h.esc(v.name)}"${v.name === selected ? ' selected' : ''}>${h.esc(v.name)}${v.description ? ` (${h.esc(v.description.slice(0, 40))})` : ''}</option>`).join('');
  return (all ? '<option value="">Every voice</option>' : '') + opts;
}

function trendChart(trend) {
  if (trend.length < 2) {
    const t = trend[0];
    return `<figure class="chart"><h3>Quality over time</h3><p class="muted">${t ? `Today: ${t.quality} from ${h.fmt(t.takes)} lines. ` : ''}The line appears once there are two days of lines to compare.</p></figure>`;
  }
  const w = 600, ht = 120, n = Math.max(1, trend.length - 1);
  const lo = Math.max(0, Math.min(...trend.map((d) => d.quality)) - 5), hi = Math.min(100, Math.max(...trend.map((d) => d.quality)) + 5);
  const x = (i) => (i / n) * (w - 12) + 6;
  const y = (v) => ht - 6 - ((v - lo) / Math.max(1, hi - lo)) * (ht - 12);
  const pts = trend.map((d, i) => [x(i), y(d.quality), d]);
  const line = pts.length > 1 ? `<polyline class="trend" points="${pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}"></polyline>` : '';
  const dots = pts.map(([a, b, d]) => `<circle class="dot" cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3.5"><title>${h.esc(d.day)}: ${d.quality} from ${d.takes} lines</title></circle>`).join('');
  const first = trend[0], last = trend[trend.length - 1];
  const summary = `Average quality per day: ${first.quality} on ${first.day}, ${last.quality} on ${last.day}.`;
  return `<figure class="chart"><h3>Quality over time</h3><p class="muted">Average score of every line spoken each day (0 to 100)</p>
    <svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" role="img" aria-label="${h.esc(summary)}">${line}${dots}</svg></figure>`;
}

// ------------------------------------------------------------- open Vox
// The "Open Vox" card shown until the page is connected. A light shows
// whether Vox is running (checked every 3 seconds while this page is open).
// When it comes up and a token is already saved, the page connects by itself.
// A browser page can't start programs, so starting Vox is one double-click on
// a small "Start Vox.cmd" shortcut this card makes for you.
const LAUNCH_KEY = 'vox-launch';
let watch = null;          // status timer
let tokenRejected = false; // don't auto-connect again with a token that failed

function loadLaunch() {
  try { return { folder: '', model: 'practice.pt', online: false, ...JSON.parse(localStorage.getItem(LAUNCH_KEY) || '{}') }; } catch (e) { return { folder: '', model: 'practice.pt', online: false }; }
}
function saveLaunch(v) { try { localStorage.setItem(LAUNCH_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } }

// Windows paths and file names go inside "quotes" in the shortcut; quotes,
// % and line breaks would break out of them, so they are refused.
function checkLaunch({ folder, model }) {
  if (/["%\r\n<>|]/.test(folder)) throw new Error('The folder can\'t contain " % < > or |. Copy it from the address bar of the Vox folder in File Explorer.');
  if (!model) throw new Error('Type the model file name, like practice.pt.');
  if (/["%\r\n<>|]/.test(model) || !/\.pt$/i.test(model)) throw new Error('The model file name should end in .pt, like practice.pt or runs\\v1\\vox.pt.');
}
const startCommand = ({ model, online }) => `vox serve --ckpt "${model}"${online ? ' --tunnel-name vox' : ''}`;

function startShortcut(v) {
  const lines = [
    '@echo off',
    'title Vox voice engine',
    v.folder ? `cd /d "${v.folder}"` : 'cd /d "%~dp0"',
    'if exist ".venv\\Scripts\\activate.bat" call ".venv\\Scripts\\activate.bat"',
    'if exist "venv\\Scripts\\activate.bat" call "venv\\Scripts\\activate.bat"',
    'echo Starting Vox. Leave this window open: closing it stops Vox.',
    'echo The admin app connects by itself once Vox is ready.',
    'echo.',
    startCommand(v),
    'echo.',
    'echo Vox has stopped. If there is an error above, copy it and ask for help.',
    'pause',
  ];
  return lines.join('\r\n') + '\r\n';
}

async function engineHealth(url) {
  const res = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error('not ready');
  return res.json();
}

function openCard(message = '') {
  const c = loadConn() || {};
  const v = loadLaunch();
  const url = c.url || DEFAULT_URL;
  return `<section class="card vx-open" aria-labelledby="vx-open-h">
    <div class="head"><h2 id="vx-open-h">Open Vox</h2>
      <button class="btn" type="button" id="vx-studio" disabled title="Opens Vox's own Voice Studio in a new tab">Open Voice Studio</button></div>
    ${window.__FLG_ADMIN_DESKTOP__ ? '<p class="note">Update the admin app (it asks when a new version is ready) to start and stop Vox right here, with no shortcut or command window.</p>' : '<p class="note">Vox runs on your Windows PC. Start it there in the admin app for Windows (Voice engine, Start Vox) and it opens here by itself, on any device. The steps below are only for starting it by hand on this computer.</p>'}
    <p class="vx-light" id="vx-light" role="status" aria-live="polite" data-state="checking"><span class="vx-dot" aria-hidden="true"></span><span id="vx-light-text">Looking for Vox at ${h.esc(url)}…</span></p>
    ${message ? `<p class="error" role="alert">${h.esc(message)}</p>` : ''}

    <div class="vx-step" id="vx-step-start">
      <h3><span class="vx-num" aria-hidden="true">1</span> Start Vox</h3>
      <p>Vox runs free on your own computer. Make a start shortcut once, save it on your desktop, then double-click it whenever you want Vox. A black window opens: leave it open while you work, because closing it stops Vox.</p>
      <form id="vx-launch" class="stack" novalidate>
        <div class="row">
          <div class="field grow"><label for="vx-folder">Vox folder</label><input id="vx-folder" type="text" value="${h.esc(v.folder)}" placeholder="C:\\Users\\you\\vox-engine" autocomplete="off" spellcheck="false" aria-describedby="vx-folder-help">
            <span class="muted" id="vx-folder-help">In File Explorer, open the Vox folder, click the address bar and copy it. Leave this blank if you'll save the shortcut inside the Vox folder.</span></div>
          <div class="field"><label for="vx-model">Model file</label><input id="vx-model" type="text" value="${h.esc(v.model)}" autocomplete="off" spellcheck="false" aria-describedby="vx-model-help">
            <span class="muted" id="vx-model-help">practice.pt until you have a trained model (for example runs\\v1\\vox.pt).</span></div>
        </div>
        <label class="check"><input id="vx-online" type="checkbox"${v.online ? ' checked' : ''}> Also put it online at my own address (voice.thelogicgrid.com, after the one-time tunnel setup)</label>
        <div class="row"><button class="btn primary" type="submit">Download start shortcut</button></div>
      </form>
      <details class="vx-more"><summary>Or start it by typing a command</summary>
        <p>Open a Command Prompt in the Vox folder and type:</p>
        <div class="row vx-cmd-row"><code id="vx-cmd">${h.esc(startCommand(v))}</code><button class="btn small" type="button" id="vx-copy-cmd">Copy</button></div>
      </details>
    </div>

    <div class="vx-step">
      <h3><span class="vx-num" aria-hidden="true">2</span> Connect</h3>
      <p>Once Vox is running on this computer, this page gets its token from Vox and connects by itself: nothing to copy. Only if that can't work (an older Vox, or Vox on another computer), paste the token from the line beginning <b>Vox admin token:</b>, also saved in <code>learning\\admin_token.txt</code>.</p>
      <form id="vx-connect" class="stack" novalidate>
        <div class="row">
          <div class="field grow"><label for="vx-token">Admin token</label><input id="vx-token" type="password" value="${h.esc(c.token || '')}" autocomplete="off" spellcheck="false" required></div>
          <button class="btn primary" type="submit">Connect</button>
        </div>
        <details class="vx-more"${c.url && c.url !== DEFAULT_URL ? ' open' : ''}><summary>Engine address</summary>
          <div class="field"><label for="vx-url">Address</label><input id="vx-url" type="url" value="${h.esc(url)}" autocomplete="off" spellcheck="false" aria-describedby="vx-url-help">
            <span class="muted" id="vx-url-help">http://127.0.0.1:5150 when Vox runs on this computer. To reach it from anywhere, use its own online address (https://voice.thelogicgrid.com). Quick tunnel addresses (….trycloudflare.com) aren't allowed.</span></div>
        </details>
      </form>
      <p class="muted">The token stays on this device and is sent only to Vox. Chrome or Edge may ask once whether this page can use devices on your network: choose Allow.</p>
    </div>
  </section>`;
}

function setLight(state, text) {
  const el = $('#vx-light');
  if (!el) return;
  el.dataset.state = state;
  $('#vx-light-text').textContent = text;
  const studio = $('#vx-studio');
  if (studio) studio.disabled = state !== 'up';
  const step = $('#vx-step-start');
  if (step) step.classList.toggle('vx-done', state === 'up');
}

// Check whether Vox is up; connect by itself if a good token is saved.
// Vox on this computer hands the admin page its token (GET /v1/pair), so no
// one has to copy it. It answers only this page's own address, never through
// the internet tunnel.
async function pairToken(url) {
  try {
    const res = await fetch(`${url}/v1/pair`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const t = (await res.json()).token;
    return typeof t === 'string' && t ? t : null;
  } catch (e) { return null; }
}

async function watchEngine() {
  clearTimeout(watch);
  if (location.hash !== '#voice-engine' || !$('#vx-light')) return;
  if (loadConn()?.linked || link) {
    // Opened through the Vox link: wait for the PC, then connect.
    const r = await connectFromLink();
    if (r === 'reloading') return;
    if (r === true) { await render(); return; }
    setLight('down', link ? 'Vox is off on your Windows PC. Open the admin app there and click Start Vox; this page connects by itself.' : 'Vox isn\'t online. On your Windows PC, open the admin app\'s Voice engine page and start Vox: then it opens here too.');
    watch = setTimeout(watchEngine, 5000);
    return;
  }
  let url;
  try { url = cleanUrl($('#vx-url')?.value); } catch (e) { setLight('down', e.message); return; }
  try {
    const health = await engineHealth(url);
    const saved = loadConn();
    if (saved?.token && saved.url === url && !tokenRejected) { await render(); return; }
    const paired = await pairToken(url);
    if (paired) { tokenRejected = false; saveConn({ url, token: paired }); await render(); return; }
    setLight('up', `Vox is running${health.version ? ` (model ${health.version})` : ''}. ${saved?.token && !tokenRejected ? 'Connecting…' : 'Paste its admin token below to connect.'}`);
  } catch (e) {
    const saved = loadConn();
    setLight('down', `Vox isn't running at ${url} yet. Start it with step 1. ${saved?.token && !tokenRejected ? 'Your token is saved, so this page connects as soon as Vox is ready.' : 'This page notices when it\'s ready.'}`);
  }
  watch = setTimeout(watchEngine, 3000);
}


// ------------------------------------------------------------- Vox link
// The Windows admin app starts Vox online and saves where it is (a free
// Cloudflare address that changes on every start) with its token on the
// server. Any other signed-in device reads it here and connects by itself.
let link = null; // { url, token, at } or null
async function fetchLink() {
  try { const l = await h.api('vox-link'); link = l?.url ? l : null; } catch (e) { link = null; }
  return link;
}
// This page may only reach the Vox address that was current when it loaded
// (the server adds that one address to the page's content policy). When Vox
// has a new address, reload once to pick it up.
function reloadForLink(url) {
  let done = '';
  try { done = sessionStorage.getItem('vox-reloaded-for') || ''; } catch (e) { /* */ }
  if (done === url) return false;
  try { sessionStorage.setItem('vox-reloaded-for', url); } catch (e) { /* */ }
  location.reload();
  return true;
}
async function connectFromLink() {
  const l = await fetchLink();
  if (!l) return false;
  try { cleanUrl(l.url, { linked: true }); } catch (e) { return false; }
  const prev = loadConn();
  saveConn({ url: l.url, token: l.token, linked: true });
  conn = loadConn();
  try { await engineHealth(l.url); return true; } catch (e) {
    // Blocked by the page's policy (a newer address) or Vox is off right now.
    if (!prev || prev.url !== l.url) { if (reloadForLink(l.url)) return 'reloading'; }
    return false;
  }
}

// ---------------------------------------------------------- Windows app
// Inside the Windows admin app, the app itself starts and stops Vox (no
// command window) and hands this page the admin token, so it all happens here.
// Only these vox_* commands are open to the page (desktop-admin/src-tauri/src/vox.rs).
let desk = null; // null: not checked yet; false: a browser (or an older app)
let deskStatus = null;
const appCall = (cmd, args = {}) => window.__TAURI_INTERNALS__.invoke(cmd, args);
async function detectDesk() {
  if (!window.__FLG_ADMIN_DESKTOP__ || !window.__TAURI_INTERNALS__?.invoke) return false;
  try { deskStatus = await appCall('vox_status'); return true; } catch (e) { return false; }
}
let autoTried = true; // the app itself starts Vox when it opens; this page only starts it after a folder is chosen

function deskCard(message = '') {
  const st = deskStatus || {};
  const busy = ['starting', 'installing', 'making-model'].includes(st.phase);
  return `<section class="card vx-open" aria-labelledby="vx-open-h">
    <div class="head"><h2 id="vx-open-h">Vox</h2>
      <div class="row">
        <button class="btn primary" type="button" id="vx-app-start"${st.folder && !busy && !st.running ? '' : ' hidden'}>Start Vox</button>
        <button class="btn" type="button" id="vx-app-stop"${st.running || busy ? '' : ' hidden'}>Stop Vox</button>
        <button class="btn" type="button" id="vx-studio" disabled title="Opens Vox's own Voice Studio">Open Voice Studio</button>
      </div></div>
    <p class="vx-light" id="vx-light" role="status" aria-live="polite" data-state="checking"><span class="vx-dot" aria-hidden="true"></span><span id="vx-light-text">Checking Vox…</span></p>
    ${busy ? '<progress aria-label="Working"></progress>' : ''}
    ${message ? `<p class="error" role="alert">${h.esc(message)}</p>` : ''}
    ${st.folder
    ? `<p class="muted">Vox runs hidden on this computer: it starts when the admin app opens and stops when you close the app. Folder: <b>${h.esc(st.folder)}</b> · model <b>${h.esc(st.model || 'made the first time you start it')}</b></p>`
    : `<div class="note"><p>Choose the Vox folder once: the <b>vox-engine</b> folder you unzipped (it has README.md and a folder named vox inside).</p><button class="btn primary" type="button" id="vx-app-folder">Choose the Vox folder</button></div>`}
    <details class="vx-more"><summary>More</summary>
      <label class="check"><input id="vx-auto-start" type="checkbox"${st.autostart !== false ? ' checked' : ''}> Start Vox when the admin app opens</label>
      <label class="check"><input id="vx-online-app" type="checkbox"${st.online !== false ? ' checked' : ''}> Let my other devices open Vox (puts it online with a free Cloudflare address; applies the next time Vox starts)</label>
      <div class="row">
        ${st.folder ? '<button class="btn small" type="button" id="vx-app-folder">Change folder</button>' : ''}
        <button class="btn small" type="button" data-app-open="folder">Open the Vox folder</button>
        <button class="btn small" type="button" data-app-open="log">Open Vox's log</button>
        <button class="btn small" type="button" data-app-open="setup-log">Open the setup log</button>
      </div>
    </details>
  </section>`;
}

const st0 = () => deskStatus || {};
let waitOnline = 0;
let publishedUrl = '';
async function publishLink(token) {
  const url = st0().online_url;
  if (!url || url === publishedUrl) return;
  try { await h.api('vox-link', { method: 'POST', body: { url, token } }); publishedUrl = url; } catch (e) { h.toast(`Couldn't share Vox's online address: ${e.message}`); }
}
async function clearLink() {
  publishedUrl = '';
  try { await h.api('vox-link', { method: 'DELETE' }); } catch (e) { /* it times out on the server side anyway */ }
}

async function deskWatch() {
  clearTimeout(watch);
  if (location.hash !== '#voice-engine' || !$('#vx-light')) return;
  const before = deskStatus;
  try { deskStatus = await appCall('vox_status'); } catch (e) { /* keep the last one */ }
  let up = false;
  try { await engineHealth(DEFAULT_URL); up = true; } catch (e) { /* not yet */ }
  if (up) {
    const token = await appCall('vox_token').catch(() => null);
    if (token && st0().online && !st0().online_url && (waitOnline = (waitOnline || Date.now())) && Date.now() - waitOnline < 60000) { setLight('checking', 'Vox is running. Going online so your other devices can open it…'); watch = setTimeout(deskWatch, 2000); return; }
    if (token && !tokenRejected) { await publishLink(token); saveConn({ url: DEFAULT_URL, token }); await render(); return; }
  }
  // Redraw when the buttons need to change (started, stopped, a new step).
  if (!before || before.phase !== deskStatus.phase || before.running !== deskStatus.running || before.folder !== deskStatus.folder) {
    $('#vx-body').innerHTML = deskCard();
  }
  const st = deskStatus;
  if (up) setLight('up', 'Vox is running. Connecting…');
  else if (st.phase === 'failed') setLight('down', st.message);
  else if (['starting', 'installing', 'making-model', 'running'].includes(st.phase)) setLight('checking', st.message || 'Starting Vox…');
  else if (!st.folder) setLight('down', 'Choose the Vox folder to begin.');
  else setLight('down', 'Vox is stopped. Click Start Vox.');
  if (!up && !autoTried && st.autostart !== false && st.folder && (!st.phase || st.phase === 'idle') && !st.running) {
    autoTried = true;
    try { await appCall('vox_start'); } catch (e) { h.toast(String(e)); }
    watch = setTimeout(deskWatch, 500);
    return;
  }
  watch = setTimeout(deskWatch, 2000);
}

function showOpen(message = '') {
  if (desk) { $('#vx-body').innerHTML = deskCard(message); deskWatch(); return; }
  $('#vx-body').innerHTML = openCard(message);
  watchEngine();
}

function shell(health) {
  const tabs = TABS.map(([k, label]) => `<label class="tab"><input type="radio" name="vx-tab" value="${k}"${k === tab ? ' checked' : ''}> ${label}</label>`).join('');
  return `<div class="row vx-status"><p class="muted">Connected to <b>${h.esc(conn.linked ? 'Vox on your Windows PC' : conn.url)}</b>${health.public ? ' <span class="badge ok">online</span>' : ''}${desk && publishedUrl ? ' · <span class="muted">your other devices can open it too</span>' : ''} · model <b>${h.esc(health.version || '–')}</b> · ${h.esc(health.device)}${health.vocoder_trained ? '' : ' · <span class="badge warn">vocoder not trained yet</span>'}</p>
      <div class="row"><button class="btn small" type="button" id="vx-studio">Open Voice Studio</button>${desk ? '<button class="btn small" type="button" id="vx-app-stop">Stop Vox</button>' : ''}
      ${conn.linked ? '' : '<button class="btn small link" type="button" id="vx-forget">Disconnect</button>'}</div></div>
    ${health.learning ? '' : '<p class="note">Learning is off on this engine (it was started with --no-learning). Start it without that option to use this page fully.</p>'}
    <fieldset class="tabs"><legend class="sr-only">Part</legend>${tabs}</fieldset>
    <div id="vx-tab-body"><p class="muted">Loading…</p></div>`;
}

// ---------------------------------------------------------------- learning
async function renderLearning(el) {
  const st = await vox('/v1/admin/learning');
  const s = st.settings;
  const job = st.job && !st.job.done && !st.job.failed ? st.job : null;
  const lastJob = st.job && (st.job.done || st.job.failed) ? st.job : null;
  const rounds = st.rounds.map((r) => [h.when(secs(r.started)), h.esc(r.reason || ''), `${h.fmt(r.n_takes)} takes, ${h.fmt(r.n_prefs)} choices${r.n_replay ? `, ${h.fmt(r.n_replay)} original clips` : ''}`,
    r.before != null ? `${pct(r.before)} → ${pct(r.after)}` : '–',
    r.status === 'done' ? (r.promoted ? '<span class="badge ok">Promoted</span>' : '<span class="badge">Kept current</span>') : `<span class="badge ${r.status === 'failed' ? 'bad' : 'warn'}">${h.esc(r.status)}</span>`,
    h.esc(r.message || '')]);
  el.innerHTML = `
    <p class="muted">Every line the engine speaks is saved and scored. Your ratings and A/B choices teach it what you like. A refinement round trains a copy of the model on its best lines and your choices, tests the copy on the same fixed lines as the current model, and switches only if the copy scores higher. Every version is kept (see Versions).</p>
    <div class="tiles">
      ${h.tile('Model in use', h.esc(st.current || '–'))}
      ${h.tile('Quality, last 7 days', st.avg_quality_7d == null ? '–' : pct(st.avg_quality_7d), 'average score out of 100')}
      ${h.tile('Lines spoken', h.fmt(st.takes))}
      ${h.tile('Your ratings', h.fmt(st.rated), `${h.fmt(st.liked)} liked`)}
      ${h.tile('Choices to learn from', h.fmt(st.preferences), 'pairs: this one is better than that one')}
      ${h.tile('Since the last round', `${h.fmt(st.new_feedback)} / ${h.fmt(s.every_n_feedback)}`, `ratings and choices (or ${h.fmt(st.new_takes)} of ${h.fmt(s.every_n_takes)} lines)`)}
    </div>
    ${st.whisper ? '' : '<p class="note">Clear-words scoring is off: install Whisper on the engine\'s computer (<code>pip install faster-whisper</code>) to score how clearly each line is spoken and to find words it says wrong. It is free and runs on your computer.</p>'}
    <div class="charts">${trendChart(st.trend)}</div>
    <section class="card" aria-labelledby="vx-refine-h">
      <div class="head"><h2 id="vx-refine-h">Refine</h2>
        <button class="btn primary" type="button" id="vx-refine"${job ? ' disabled' : ''}>Refine now</button></div>
      ${job ? `<p>${h.esc(job.kind === 'optimize' ? 'Auto-optimizing a voice' : 'Refining')}: ${h.esc(job.message)}</p><progress max="1" value="${Number(job.progress) || 0}" aria-label="Progress"></progress>`
    : lastJob ? `<p class="${lastJob.failed ? 'error' : 'muted'}">Last job: ${h.esc(lastJob.message)}</p>` : `<p class="muted">${s.auto_learn ? 'Rounds also start on their own when enough new material comes in.' : 'Automatic rounds are off; use Refine now.'}</p>`}
    </section>
    <details class="card vx-settings"><summary><h2>Learning settings</h2></summary>
      <form id="vx-settings" class="stack" novalidate>
        <div class="field inline"><input id="vx-auto" type="checkbox"${s.auto_learn ? ' checked' : ''}><label for="vx-auto">Refine automatically</label></div>
        <div class="row">
          <div class="field"><label for="vx-nfb">After this many new ratings and choices</label><input id="vx-nfb" type="number" min="1" max="10000" value="${s.every_n_feedback}"></div>
          <div class="field"><label for="vx-ntk">Or this many new lines</label><input id="vx-ntk" type="number" min="1" max="100000" value="${s.every_n_takes}"></div>
          <div class="field"><label for="vx-gap">At most every (hours)</label><input id="vx-gap" type="number" min="0" max="720" step="0.5" value="${s.min_hours_between}"></div>
        </div>
        <div class="row">
          <div class="field"><label for="vx-minq">Lines scoring at least this teach it</label><input id="vx-minq" type="number" min="0" max="100" value="${s.min_quality}"></div>
          <div class="field"><label for="vx-steps">Training steps per round</label><input id="vx-steps" type="number" min="10" max="20000" value="${s.steps}"></div>
          <div class="field"><label for="vx-gain">Switch only if better by (points)</label><input id="vx-gain" type="number" min="0" max="20" step="0.25" value="${s.min_gain}"></div>
        </div>
        <div class="field inline"><input id="vx-refv" type="checkbox"${s.refine_voices ? ' checked' : ''}><label for="vx-refv">Nudge designed voices toward the takes you like (cloned voices never change)</label></div>
        <div class="field"><label for="vx-replay">Original training data to keep practicing (one manifest path per line)</label><textarea id="vx-replay" rows="2" spellcheck="false">${h.esc((s.replay_manifests || []).join('\n'))}</textarea>
          <span class="muted">Mixing in the original data stops it forgetting what it already knew.</span></div>
        <div class="row"><button class="btn primary" type="submit">Save settings</button></div>
      </form>
    </details>
    <h2>Rounds</h2>
    ${h.table(['Started', 'Why', 'Learned from', 'Test score', 'Result', 'Details'], rounds, 'No rounds yet.')}`;
  return Boolean(job);
}

// ------------------------------------------------------------------ review
let reviewFilter = 'unrated';
let reviewVoice = '';
let abPair = null;
async function renderReview(el) {
  const q = new URLSearchParams({ limit: '30' });
  if (reviewFilter !== 'all') q.set('rated', reviewFilter);
  if (reviewVoice) q.set('voice', reviewVoice);
  const takes = await vox(`/v1/admin/takes?${q}`);
  const list = takes.filter((t) => t.source !== 'retry').map((t) => `<li class="vx-take" data-id="${h.esc(t.id)}">
      <div class="vx-take-text"><b>${h.esc(t.text)}</b><br><span class="muted">${h.esc(t.voice)} · ${h.when(secs(t.created))} · ${h.esc(t.source)}</span> ${qualityBadge(t.quality)}<br>${scoreList(t.scores)}</div>
      <div class="row">
        <button class="btn small" type="button" data-play>Play</button>
        <button class="btn small${t.rating > 0 ? ' primary' : ''}" type="button" data-rate="1" aria-pressed="${t.rating > 0}">Good</button>
        <button class="btn small${t.rating < 0 ? ' primary danger' : ''}" type="button" data-rate="-1" aria-pressed="${t.rating < 0}">Not good</button>
      </div></li>`).join('');
  const ab = abPair ? `<div class="vx-ab" aria-live="polite"><p>Listen to both, then pick the better one.</p>
      <div class="row"><button class="btn" type="button" data-play-id="${h.esc(abPair.a)}">Play A</button><button class="btn" type="button" data-play-id="${h.esc(abPair.b)}">Play B</button></div>
      <div class="row"><button class="btn primary" type="button" data-pick="a">A is better</button><button class="btn primary" type="button" data-pick="b">B is better</button><button class="btn link" type="button" data-pick="none">Can't tell</button></div></div>` : '';
  el.innerHTML = `
    <p class="muted">Rate lines as you hear them. "Good" lines teach it directly; a good and a not-good take of the same line, or an A/B choice, teaches it what to prefer.</p>
    <section class="card" aria-labelledby="vx-ab-h"><h2 id="vx-ab-h">A or B?</h2>
      <form id="vx-ab-form" class="row" novalidate>
        <div class="field grow"><label for="vx-ab-text">Line</label><input id="vx-ab-text" type="text" maxlength="300" value="${h.esc(abPair?.text || 'Welcome back, traveler. The road was long.')}"></div>
        <div class="field"><label for="vx-ab-voice">Voice</label><select id="vx-ab-voice">${voiceOptions(abPair?.voice || voiceList[0]?.name)}</select></div>
        <button class="btn primary" type="submit">Make two takes</button>
      </form>${ab}
    </section>
    <form class="row" id="vx-review-filter" role="search">
      <div class="field"><label for="vx-rf">Show</label><select id="vx-rf">
        ${[['unrated', 'Not rated yet'], ['liked', 'Good'], ['disliked', 'Not good'], ['all', 'Everything']].map(([v, l]) => `<option value="${v}"${v === reviewFilter ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="vx-rv">Voice</label><select id="vx-rv">${voiceOptions(reviewVoice, { all: true })}</select></div>
    </form>
    ${list ? `<ul class="vx-takes">${list}</ul>` : '<p class="muted">Nothing here. Lines appear as games, the Voice Studio or the Auto-tune preview speak them.</p>'}`;
}

// ---------------------------------------------------------------- autotune
let atVoice = '';
function atFields(spec) {
  const p = presets;
  const preset = spec?.preset || (spec ? 'custom' : 'off');
  const base = { ...(p.presets.find((x) => x.name === preset) || {}), ...(spec || {}) };
  const num = (id, label, key, min, max, step, val, help = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-k="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${val ?? ''}" placeholder="preset">${help ? `<span class="muted">${help}</span>` : ''}</div>`;
  return `<div class="row">
      <div class="field"><label for="vx-at-preset">Style</label><select id="vx-at-preset">
        <option value="off"${preset === 'off' ? ' selected' : ''}>Off</option>
        ${p.presets.map((x) => `<option value="${h.esc(x.name)}"${x.name === preset ? ' selected' : ''}>${h.esc(x.name)}: ${h.esc(x.label)}</option>`).join('')}
        <option value="custom"${preset === 'custom' ? ' selected' : ''}>Custom (my settings below)</option></select></div>
      <div class="field"><label for="vx-at-key">Key</label><select id="vx-at-key" data-k="key">${p.keys.map((k) => `<option${k === (base.key || 'C') ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
      <div class="field"><label for="vx-at-scale">Scale</label><select id="vx-at-scale" data-k="scale">${p.scales.map((k) => `<option value="${k}"${k === (base.scale || 'chromatic') ? ' selected' : ''}>${k.replace('_', ' ')}</option>`).join('')}</select></div>
    </div>
    <details class="vx-more"><summary>Fine-tune</summary><div class="row">
      ${num('vx-at-retune', 'Retune speed (ms)', 'retune_ms', 0, 1000, 5, base.retune_ms, '0 = instant robotic snap')}
      ${num('vx-at-amount', 'Strength (0 to 1)', 'amount', 0, 1, 0.05, base.amount)}
      ${num('vx-at-human', 'Humanize (0 to 1)', 'humanize', 0, 1, 0.05, base.humanize)}
      ${num('vx-at-trans', 'Shift (semitones)', 'transpose', -12, 12, 0.5, base.transpose)}
      ${num('vx-at-vrate', 'Vibrato speed (Hz)', 'vibrato_rate', 0, 12, 0.5, base.vibrato_rate)}
      ${num('vx-at-vdepth', 'Vibrato depth (cents)', 'vibrato_depth', 0, 200, 5, base.vibrato_depth)}
      ${num('vx-at-mix', 'Mix with natural voice (0 to 1)', 'mix', 0, 1, 0.05, base.mix)}
    </div></details>`;
}
function atSpec() {
  const preset = $('#vx-at-preset').value;
  if (preset === 'off') return null;
  const spec = preset === 'custom' ? {} : { preset };
  $$('#vx-at [data-k]').forEach((el) => {
    if (el.value === '') return;
    const k = el.dataset.k;
    spec[k] = el.tagName === 'SELECT' ? el.value : Number(el.value);
  });
  return spec;
}
async function renderAutotune(el) {
  presets = presets || await (await fetch(`${conn.url}/v1/autotune/presets`)).json();
  atVoice = atVoice && voiceList.some((v) => v.name === atVoice) ? atVoice : voiceList[0]?.name || '';
  const v = voiceList.find((x) => x.name === atVoice);
  el.innerHTML = `
    <p class="muted">Pitch correction, from a light polish to the hard robotic snap, plus sing-song vibrato for bards and creature voices. Set a default per voice; a game can still choose its own for any line.</p>
    <section class="card" id="vx-at" aria-labelledby="vx-at-h"><h2 id="vx-at-h">Auto-tune for a voice</h2>
      <div class="row"><div class="field"><label for="vx-at-voice">Voice</label><select id="vx-at-voice">${voiceOptions(atVoice)}</select></div>
        <p class="muted">Now: ${v?.autotune ? `<b>${h.esc(v.autotune.preset || 'custom')}</b>` : 'off'}</p></div>
      ${atFields(v?.autotune)}
      <div class="field"><label for="vx-at-line">Line to try</label><input id="vx-at-line" type="text" maxlength="300" value="Oh, the dragon sleeps beneath the hill, and there it waits for you."></div>
      <div class="row">
        <button class="btn" type="button" id="vx-at-hear">Hear it</button>
        <button class="btn" type="button" id="vx-at-plain">Hear it without</button>
        <button class="btn primary" type="button" id="vx-at-save">Save for this voice</button>
      </div>
    </section>`;
}

// ------------------------------------------------------------------ voices
async function renderVoices(el) {
  // Keep the job's id even if the engine's answer leaves it out, so the next check still works.
  if (sampleJob && !sampleJob.done) sampleJob = { ...(await vox(`/v1/admin/jobs/${encodeURIComponent(sampleJob.id)}`)), id: sampleJob.id };
  const rows = voiceList.map((v) => [`<b>${h.esc(v.name)}</b>`, h.esc(v.origin), h.esc(v.description || ''),
    v.autotune ? h.esc(v.autotune.preset || 'custom') : '<span class="muted">off</span>',
    v.tuned ? '<span class="badge ok">optimized</span>' : '<span class="muted">default</span>',
    v.refined ? `${h.fmt(v.refined)}` : '<span class="muted">–</span>',
    `<div class="row"><button class="btn small" type="button" data-hear="${h.esc(v.name)}">Hear</button>
      <button class="btn small" type="button" data-opt="${h.esc(v.name)}">Auto-optimize</button>
      ${v.tuned ? `<button class="btn small link" type="button" data-reset="${h.esc(v.name)}">Reset settings</button>` : ''}
      ${v.refined ? `<button class="btn small link" type="button" data-unrefine="${h.esc(v.name)}">Undo last refinement</button>` : ''}
      ${v.name !== 'narrator' ? `<button class="btn small danger" type="button" data-del="${h.esc(v.name)}">Delete</button>` : ''}</div>`]);
  el.innerHTML = `${samplesForm()}<p class="muted">Auto-optimize tries several generation settings on test lines, scores each, and keeps the best for that voice; the comparisons also teach the learning loop. Refinements are the small identity nudges from takes you liked.</p>
    ${h.table(['Voice', 'Kind', 'Description', 'Auto-tune', 'Settings', 'Refinements', ''], rows, 'No voices yet.', { csv: false })}`;
  return Boolean(sampleJob && !sampleJob.done);
}

// ------------------------------------------------------------------ words
// The dictionary (every word's sounds, meanings and usage) and your fixes,
// in one place.
let wordQuery = '';
function wordCard(w) {
  if (!w.found) return `<p class="muted">\u201c${h.esc(w.word)}\u201d isn't in the dictionary${w.installed ? '' : ' (not installed yet)'}. Add how to say it below and every line will use it.</p>`;
  const say = (p) => `<li><b>${h.esc(p.respelling)}</b> <span class="muted">/${h.esc(p.ipa)}/ · ${h.fmt(p.syllables)} syllable${p.syllables === 1 ? '' : 's'} · ${h.esc(p.arpabet)} · ${h.esc(p.source)}</span>${p.usage ? ` <span class="badge">${h.esc(p.usage)}</span>` : ''}</li>`;
  const prons = (w.usage_pronunciations.length ? w.usage_pronunciations : w.pronunciations.slice(0, 3)).map(say).join('');
  const groups = {};
  w.senses.forEach((x) => { (groups[x.pos] = groups[x.pos] || []).push(x); });
  const example = w.senses.flatMap((x) => x.examples)[0] || '';
  const senses = Object.entries(groups).map(([pos, list]) => `<h4>${h.esc(pos)}</h4><ol class="vx-senses">${list.slice(0, 6).map((x) => `<li>${h.esc(x.definition)}${x.examples.length ? `<br><span class="muted">\u201c${h.esc(x.examples[0])}\u201d</span>` : ''}${x.synonyms.length ? `<br><span class="muted">Also: ${h.esc(x.synonyms.slice(0, 5).join(', '))}</span>` : ''}</li>`).join('')}${list.length > 6 ? `<li class="muted">and ${list.length - 6} more</li>` : ''}</ol>`).join('');
  return `<section class="card" aria-labelledby="vx-w-h"><div class="head"><h3 id="vx-w-h">${h.esc(w.word)}</h3>
      <div class="row"><button class="btn small" type="button" data-say="${h.esc(w.word)}">Hear it</button>
        <button class="btn small" type="button" data-say="${h.esc(w.word)}" data-clear="1">Hear it slowly</button>
        ${example ? `<button class="btn small" type="button" data-say="${h.esc(example)}">Hear it in use</button>` : ''}
        <button class="btn small link" type="button" data-fix="${h.esc(w.word)}">Fix how it's said</button></div></div>
    ${w.your_fix ? `<p class="note">Your fix: said as <b>${h.esc(w.your_fix)}</b>.</p>` : ''}
    ${usageNote(w)}<ul class="vx-prons">${prons}</ul>${senses || '<p class="muted">No meanings listed.</p>'}</section>`;
}
function usageNote(w) {
  return w.usage_pronunciations.length ? '<p class="muted">Said two ways depending on use; the engine picks from the words around it.</p>' : '';
}
async function renderWords(el, prefill = '') {
  const [r, d] = await Promise.all([vox('/v1/admin/lexicon'), vox('/v1/admin/dictionary')]);
  const running = d.running && d.running[0];
  const rows = Object.entries(r.words).map(([w, say]) => [`<b>${h.esc(w)}</b>`, h.esc(say),
    `<div class="row"><button class="btn small" type="button" data-say="${h.esc(w)}">Hear</button><button class="btn small danger" type="button" data-unword="${h.esc(w)}">Remove</button></div>`]);
  const issues = r.issues.map((i) => [`<b>${h.esc(i.word)}</b>`, `${h.fmt(i.misses)} of ${h.fmt(i.seen)}`, `<button class="btn small" type="button" data-fix="${h.esc(i.word)}">Add a fix</button>`]);
  const status = d.installed
    ? `<p class="muted">American English dictionary: <b>${h.fmt(d.words)}</b> words and phrases, ${h.fmt(d.with_pronunciation)} with pronunciations, ${h.fmt(d.senses)} meanings (CMU Pronouncing Dictionary and Open English WordNet). Words it doesn't list are worked out by its letters-to-sounds model${d.guesser ? ` (${Math.round(d.guesser.words_ignoring_stress * 100)}% exactly right on words it never saw)` : ''}.</p>`
    : running ? `<p>Installing the dictionary: ${h.esc(running.message)}</p><progress max="1" value="${Number(running.progress) || 0}" aria-label="Progress"></progress>`
      : '<div class="note"><p>The American English dictionary isn\'t installed yet. It\'s free, takes a couple of minutes, and gives every word its pronunciation, meanings and usage.</p><button class="btn primary" type="button" id="vx-dict-install">Install the dictionary</button></div>';
  el.innerHTML = `${status}
    <form id="vx-lookup" class="row" role="search">
      <div class="field grow"><label for="vx-q">Look up a word</label><input id="vx-q" type="search" list="vx-q-list" value="${h.esc(wordQuery)}" autocomplete="off" spellcheck="false"><datalist id="vx-q-list"></datalist></div>
      <button class="btn primary" type="submit">Look up</button>
    </form>
    <div id="vx-word-card"></div>
    <h2>Your pronunciation fixes</h2>
    <p class="muted">For names and made-up words. Write how it sounds (Aelith \u2192 AY-lith), or exact sounds from the dictionary (EY1 L IH0 TH). Fixes apply to every line at once, in every game.</p>
    <form id="vx-word" class="card row" novalidate>
      <div class="field"><label for="vx-w">Word</label><input id="vx-w" type="text" maxlength="64" value="${h.esc(prefill)}" autocomplete="off" required></div>
      <div class="field grow"><label for="vx-say">Say it as</label><input id="vx-say" type="text" maxlength="128" autocomplete="off" required></div>
      <button class="btn" type="button" id="vx-say-hear">Hear it</button>
      <button class="btn primary" type="submit">Save fix</button>
    </form>
    ${h.table(['Word', 'Said as', ''], rows, 'No fixes yet.', { csv: false })}
    <h2>Words it may be saying wrong</h2>
    <p class="muted">Words the transcriber often fails to hear in the engine's own lines (needs Whisper).</p>
    ${h.table(['Word', 'Misheard', ''], issues, 'None found.', { csv: false })}`;
  if (wordQuery) await showWord(wordQuery);
  if (prefill) $('#vx-say').focus();
  return Boolean(running);
}
async function showWord(word) {
  wordQuery = word;
  const card = $('#vx-word-card');
  let w = null, problem = '';
  try {
    const res = await fetch(`${conn.url}/v1/dictionary/${encodeURIComponent(word)}`, { headers: { 'X-Vox-Admin-Token': conn.token } });
    w = await res.json().catch(() => null);
    // A real answer always says whether the word was found; anything else is an error from the engine.
    if (!w || typeof w.found !== 'boolean') { problem = (w && typeof w.detail === 'string' && w.detail) || `The engine said ${res.status}.`; w = null; }
  } catch (e) { problem = 'The voice engine is not answering.'; }
  if (card) card.innerHTML = w ? wordCard({ word, ...w }) : `<p class="error" role="alert">Couldn't look up “${h.esc(word)}”: ${h.esc(problem)}</p>`;
}

// -------------------------------------------------------------- languages
let langLast = { to: 'es', text: 'Welcome back, traveler. The road was long, but you made it.' };
async function renderLanguages(el) {
  const r = await (await fetch(`${conn.url}/v1/languages`)).json();
  el.innerHTML = `<p class="muted">Translate any line into ${h.fmt(r.languages.length)} languages and hear it, free and on the engine's own computer (${h.esc(r.backend)} model, ${h.esc(r.license)} license). Markup like [breath] and [warm]\u2026[/warm] is kept. Games can ask for a language on any line (<code>"translate_to": "es"</code>), and each translation is saved so it's only made once.</p>
    <form id="vx-tr" class="card stack" novalidate>
      <div class="field"><label for="vx-tr-text">Line (English)</label><textarea id="vx-tr-text" rows="2" maxlength="1000">${h.esc(langLast.text)}</textarea></div>
      <div class="row">
        <div class="field"><label for="vx-tr-to">Into</label><select id="vx-tr-to">${r.languages.filter((l) => l.code !== 'en').map((l) => `<option value="${h.esc(l.code)}"${l.code === langLast.to ? ' selected' : ''}>${h.esc(l.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="vx-tr-voice">Voice</label><select id="vx-tr-voice">${voiceOptions(langLast.voice || voiceList[0]?.name)}</select></div>
        <button class="btn primary" type="submit">Translate</button>
        <button class="btn" type="button" id="vx-tr-hear">Hear it</button>
      </div>
      <div id="vx-tr-out" aria-live="polite">${langLast.out ? `<p class="vx-tr-result" lang="${h.esc(langLast.to)}">${h.esc(langLast.out)}</p>` : ''}</div>
    </form>
    <p class="note">The voices speak a language well once the engine has been trained on recordings in it (for example Common Voice or Multilingual LibriSpeech, both free; see the engine's README). Until then translated lines are read from their spelling.</p>`;
}

// ------------------------------------------------------- voices from samples
let sampleJob = null;
function samplesForm() {
  if (sampleJob && !sampleJob.done) return `<section class="card" aria-live="polite"><h2>Making a voice from samples</h2><p>${h.esc(sampleJob.message)}</p><progress max="1" value="${Number(sampleJob.progress) || 0}" aria-label="Progress"></progress></section>`;
  const done = sampleJob && sampleJob.done ? (sampleJob.failed ? `<p class="error" role="alert">${h.esc(sampleJob.message)}</p>`
    : `<p class="note">Made <b>${h.esc(sampleJob.result.name)}</b> from ${h.fmt(sampleJob.result.used)} speakers (closest match to any one of them: ${Math.round(sampleJob.result.max_similarity * 100)}%, limit 75%). <button class="btn small" type="button" data-hear="${h.esc(sampleJob.result.name)}">Hear it</button></p>`) : '';
  return `<details class="card vx-settings"${done ? ' open' : ''}><summary><h2>New voice from samples</h2></summary>
    <p class="muted">Searches openly licensed recordings (public domain or Creative Commons BY) for your keywords, finds different speakers, and blends at least 3 of them into a new voice that sounds like none of them: no one person carries more than 40%, and the result must stay well apart from every speaker. No recording needed. To copy one specific person, use cloning with their consent.</p>
    ${done}
    <form id="vx-samples" class="stack" novalidate>
      <div class="row"><div class="field"><label for="vx-s-name">Name for the voice</label><input id="vx-s-name" type="text" maxlength="64" pattern="[A-Za-z0-9_-]+" autocomplete="off" required></div>
        <div class="field"><label for="vx-s-n">Speakers to blend</label><input id="vx-s-n" type="number" min="3" max="12" value="5"></div></div>
      <div class="field"><label for="vx-s-kw">Keywords (comma between each)</label><input id="vx-s-kw" type="text" maxlength="300" placeholder="old sea captain, harbor radio, sailor stories" autocomplete="off"></div>
      <details class="vx-more"><summary>Add your own links or files</summary>
        <div class="field"><label for="vx-s-urls">Links (one per line)</label><textarea id="vx-s-urls" rows="2" spellcheck="false"></textarea></div>
        <div class="field"><label for="vx-s-files">Files</label><input id="vx-s-files" type="file" accept="audio/*,video/*" multiple></div>
        <div class="row"><div class="field"><label for="vx-s-lic">Their license</label><select id="vx-s-lic"><option value="">Choose…</option>
          ${[['public-domain', 'Public domain'], ['cc0', 'CC0'], ['cc-by-4.0', 'CC BY 4.0'], ['cc-by-sa-4.0', 'CC BY-SA 4.0'], ['own-recording', 'My own recordings'], ['consented', 'Speakers gave written consent']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          <div class="field grow"><label for="vx-s-credit">Credit (who made them)</label><input id="vx-s-credit" type="text" maxlength="200" autocomplete="off"></div></div>
      </details>
      <div class="row"><button class="btn primary" type="submit">Make the voice</button></div>
    </form></details>`;
}

// ---------------------------------------------------------------- versions
async function renderVersions(el) {
  const vs = await vox('/v1/admin/models');
  const label = { current: '<span class="badge ok">In use</span>', kept: 'Earlier', rejected: '<span class="badge">Not better, not used</span>', candidate: '<span class="badge warn">Candidate</span>' };
  const rows = vs.map((v) => [`<b>${h.esc(v.version)}</b>`, h.when(secs(v.created)), v.quality == null ? '–' : pct(v.quality), label[v.current ? 'current' : v.status] || h.esc(v.status), h.esc(v.note || ''),
    v.current ? '' : `<button class="btn small" type="button" data-use="${h.esc(v.version)}">Use this version</button>`]);
  const cur = vs.find((v) => v.current);
  el.innerHTML = `<p class="muted">Every model the learning loop made. Switching is instant and can be undone; voices go back to how they were with that version.</p>
    ${cur?.parent ? '<div class="row"><button class="btn" type="button" id="vx-rollback">Roll back to the previous version</button></div>' : ''}
    ${h.table(['Version', 'Made', 'Test score', 'Status', 'Note', ''], rows, 'No versions yet.')}`;
}

// --------------------------------------------------------------- rendering
const RENDER = { learning: renderLearning, review: renderReview, autotune: renderAutotune, voices: renderVoices, words: renderWords, languages: renderLanguages, versions: renderVersions };

// While a job runs the tab refreshes every 3 seconds, but not while you are
// typing in one of its forms: then it waits until you save or change tabs.
let editing = false;
function pollLater() {
  poll = setTimeout(() => {
    if (location.hash !== '#voice-engine') return;
    if (editing) { pollLater(); return; }
    renderTab();
  }, 3000);
}

async function renderTab(extra) {
  clearTimeout(poll);
  editing = false;
  const el = $('#vx-tab-body');
  if (!el) return;
  // Panels you opened (Learning settings, New voice from samples, Fine-tune)
  // stay open when the tab is drawn again.
  const open = new Set($$('details[open] > summary', el).map((s) => s.textContent.trim()));
  try {
    voiceList = await (await fetch(`${conn.url}/v1/voices`)).json();
    const busy = await RENDER[tab](el, extra);
    $$('details > summary', el).forEach((s) => { if (open.has(s.textContent.trim())) s.parentElement.open = true; });
    if (busy) pollLater();
  } catch (e) {
    if (e.offline || e.status === 401) { render(e.message); return; }
    el.innerHTML = `<p class="error">${h.esc(e.message)}</p>`;
  }
}

async function render(message = '') {
  clearTimeout(poll);
  clearTimeout(watch);
  stopAudio();
  const body = $('#vx-body');
  if (desk === null) desk = await detectDesk();
  conn = loadConn();
  if (!desk && !message && (!conn || conn.linked)) {
    const r = await connectFromLink();
    if (r === 'reloading') return false;
    conn = loadConn();
  }
  if (!conn || message) { showOpen(message); return false; }
  let health;
  try {
    health = await engineHealth(conn.url);
    await vox('/v1/admin/check');
  } catch (e) {
    if (!desk && !conn.linked && e.status !== 401 && await connectFromLink() === true) return render();
    // Not running: the Open Vox card watches for it and connects by itself.
    // A refused token is shown once and isn't retried until you paste another.
    if (e.status === 401 && !conn.linked) {
      const paired = await pairToken(conn.url);
      if (paired && paired !== conn.token) { saveConn({ url: conn.url, token: paired }); return render(); }
    }
    if (e.status === 401) tokenRejected = true;
    showOpen(e.status === 401 ? 'Vox didn\'t accept that admin token. Copy it again from the Vox window (the line beginning "Vox admin token:") and connect.' : '');
    return false;
  }
  tokenRejected = false;
  body.innerHTML = shell(health);
  await renderTab();
  return true;
}

export function voiceEngineView(helpers) {
  h = helpers;
  return render();
}

export function initVoiceEngine(helpers) {
  h = helpers;
  const body = $('#vx-body');
  addEventListener('hashchange', () => { if (location.hash !== '#voice-engine') { clearTimeout(poll); clearTimeout(watch); stopAudio(); } });

  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'vx-online-app') { appCall('vox_set_online', { on: t.checked }).catch((err) => h.toast(String(err))); return; }
    if (t.id === 'vx-auto-start') { appCall('vox_set_autostart', { on: t.checked }).catch((err) => h.toast(String(err))); return; }
    if (t.name === 'vx-tab') { tab = t.value; renderTab(); }
    else if (t.id === 'vx-rf') { reviewFilter = t.value; renderTab(); }
    else if (t.id === 'vx-rv') { reviewVoice = t.value; renderTab(); }
    else if (t.id === 'vx-at-voice') { atVoice = t.value; renderTab(); }
    else if (t.id === 'vx-at-preset' && t.value !== 'custom' && t.value !== 'off') {
      const p = presets.presets.find((x) => x.name === t.value) || {};
      $$('#vx-at .vx-more [data-k]').forEach((el) => { el.value = p[el.dataset.k] ?? ''; });
      if (p.scale) $('#vx-at-scale').value = p.scale;
    }
  });

  let suggestTimer = null;
  body.addEventListener('input', (e) => {
    // Typing or choosing in a form pauses the 3-second refresh, so it never
    // wipes what you are in the middle of (see pollLater).
    if (e.target.closest('#vx-tab-body form')) editing = true;
    if (['vx-model', 'vx-online'].includes(e.target.id)) {
      $('#vx-cmd').textContent = startCommand({ model: $('#vx-model').value.trim() || 'practice.pt', online: $('#vx-online').checked });
      return;
    }
    if (e.target.id === 'vx-url') { tokenRejected = false; clearTimeout(watch); watch = setTimeout(watchEngine, 600); return; }
    if (e.target.id !== 'vx-q') return;
    clearTimeout(suggestTimer);
    const q = e.target.value.trim();
    suggestTimer = setTimeout(async () => {
      if (q.length < 2) return;
      try {
        const r = await (await fetch(`${conn.url}/v1/dictionary?prefix=${encodeURIComponent(q)}`, { headers: { 'X-Vox-Admin-Token': conn.token } })).json();
        const list = $('#vx-q-list');
        if (list) list.innerHTML = r.words.map((w) => `<option value="${h.esc(w)}"></option>`).join('');
      } catch (err) { /* suggestions are optional */ }
    }, 200);
  });

  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    editing = false; // sending the form means you're done with it; refreshing can go on
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    if (f.id === 'vx-connect') {
      try {
        const url = cleanUrl($('#vx-url').value);
        const token = $('#vx-token').value.trim();
        if (!token) throw new Error('Paste the admin token from the Vox window (the line beginning "Vox admin token:").');
        saveConn({ url, token });
        tokenRejected = false;
        try { await engineHealth(url); } catch (err) {
          h.announce('Token saved. Waiting for Vox to start.');
          watchEngine();
          return;
        }
        if (await render()) h.toast('Connected to Vox.');
      } catch (err) { showOpen(err.message); }
      return;
    }
    if (f.id === 'vx-launch') {
      const v = { folder: $('#vx-folder').value.trim().replace(/[\\/]+$/, ''), model: $('#vx-model').value.trim(), online: $('#vx-online').checked };
      try { checkLaunch(v); } catch (err) { h.toast(err.message); h.announce(err.message); return; }
      saveLaunch(v);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([startShortcut(v)], { type: 'application/octet-stream' }));
      a.download = 'Start Vox.cmd';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      const msg = 'Start shortcut downloaded. Move "Start Vox.cmd" to your desktop and double-click it. If Windows warns about it, click More info, then Run anyway.';
      h.toast(msg); h.announce(msg);
      return;
    }
    if (f.id === 'vx-settings') {
      await h.act(btn, async () => {
        const n = (id) => Number($(id).value);
        await vox('/v1/admin/learning/settings', { method: 'PUT', body: {
          auto_learn: $('#vx-auto').checked, every_n_feedback: n('#vx-nfb'), every_n_takes: n('#vx-ntk'),
          min_hours_between: n('#vx-gap'), min_quality: n('#vx-minq'), steps: n('#vx-steps'), min_gain: n('#vx-gain'),
          refine_voices: $('#vx-refv').checked,
          replay_manifests: $('#vx-replay').value.split('\n').map((s) => s.trim()).filter(Boolean),
        } });
      }, 'Learning settings saved.');
    } else if (f.id === 'vx-ab-form') {
      await h.act(btn, async () => {
        const text = $('#vx-ab-text').value.trim();
        if (!text) throw new Error('Type a line first.');
        const voice = $('#vx-ab-voice').value;
        btn.textContent = 'Making two takes…';
        try {
          const r = await vox('/v1/admin/ab', { method: 'POST', body: { text, voice } });
          abPair = { ...r, text, voice };
        } finally { btn.textContent = 'Make two takes'; }
        await renderTab();
      });
    } else if (f.id === 'vx-lookup') {
      const q = $('#vx-q').value.trim();
      if (q) await h.act(btn, () => showWord(q));
    } else if (f.id === 'vx-tr') {
      await h.act(btn, async () => {
        const text = $('#vx-tr-text').value.trim();
        if (!text) throw new Error('Type a line first.');
        langLast = { ...langLast, text, to: $('#vx-tr-to').value, voice: $('#vx-tr-voice').value };
        btn.textContent = 'Translating…';
        let r, j;
        try {
          r = await fetch(`${conn.url}/v1/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vox-Admin-Token': conn.token }, body: JSON.stringify({ text, to: langLast.to }) });
          j = await r.json().catch(() => ({}));
        } catch (err) {
          throw new Error('The voice engine is not answering.');
        } finally { btn.textContent = 'Translate'; }
        if (!r.ok) throw new Error(j.detail || 'Translation failed.');
        langLast.out = j.text;
        $('#vx-tr-out').innerHTML = `<p class="vx-tr-result" lang="${h.esc(langLast.to)}">${h.esc(j.text)}</p>`;
      });
    } else if (f.id === 'vx-samples') {
      await h.act(btn, async () => {
        const name = $('#vx-s-name').value.trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('Name the voice with letters, numbers, - or _ (no spaces).');
        const fd = new FormData();
        fd.append('name', name);
        fd.append('keywords', $('#vx-s-kw').value);
        fd.append('speakers', String(Math.max(3, Number($('#vx-s-n').value) || 5)));
        fd.append('urls', $('#vx-s-urls').value);
        fd.append('license', $('#vx-s-lic').value);
        fd.append('attribution', $('#vx-s-credit').value);
        for (const file of $('#vx-s-files').files) fd.append('files', file);
        let res;
        try { res = await fetch(`${conn.url}/v1/admin/voices/from-samples`, { method: 'POST', headers: { 'X-Vox-Admin-Token': conn.token }, body: fd }); }
        catch (e) { throw new Error('The voice engine is not answering.'); }
        const j = await res.json();
        if (!res.ok) throw new Error(j.detail || 'Could not start.');
        sampleJob = { id: j.job, done: false, message: 'Starting…', progress: 0 };
        await renderTab();
      });
    } else if (f.id === 'vx-word') {
      await h.act(btn, async () => {
        const word = $('#vx-w').value.trim(), sayAs = $('#vx-say').value.trim();
        if (!word || !sayAs) throw new Error('Fill in the word and how to say it.');
        await vox('/v1/admin/lexicon', { method: 'PUT', body: { word, say_as: sayAs } });
        await renderTab();
      }, 'Fix saved. Every line uses it from now on.');
    }
  });

  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'vx-forget') { saveConn(null); render(); return; }
    if (b.id === 'vx-app-start') {
      tokenRejected = false;
      try { await appCall('vox_start'); } catch (err) { h.toast(String(err)); }
      deskWatch();
      return;
    }
    if (b.id === 'vx-app-stop') {
      b.disabled = true;
      try { await appCall('vox_stop'); } catch (err) { h.toast(String(err)); }
      await clearLink();
      waitOnline = 0;
      autoTried = true; // don't start it again by itself
      h.toast('Vox is stopped.'); h.announce('Vox is stopped.');
      await render();
      return;
    }
    if (b.id === 'vx-app-folder') {
      try { await appCall('vox_choose_folder'); deskStatus = null; autoTried = false; showOpen(); } catch (err) { if (!/No folder chosen/.test(String(err))) h.toast(String(err)); }
      return;
    }
    if (b.dataset.appOpen) {
      try { await appCall('vox_open', { what: b.dataset.appOpen }); } catch (err) { h.toast(String(err)); }
      return;
    }
    if (b.id === 'vx-studio') {
      let url = conn?.url;
      if (!url) { try { url = cleanUrl($('#vx-url')?.value); } catch (err) { h.toast(err.message); return; } }
      window.open(`${url}/`, '_blank', 'noopener');
      return;
    }
    if (b.id === 'vx-copy-cmd') {
      try { await navigator.clipboard.writeText($('#vx-cmd').textContent); h.toast('Copied.'); h.announce('Copied.'); } catch (err) { h.toast('Select the command and copy it by hand.'); }
      return;
    }
    if (b.id === 'vx-refine') {
      await h.act(b, async () => { await vox('/v1/admin/learning/refine', { method: 'POST' }); await renderTab(); }, 'Refinement started.');
      return;
    }
    const take = b.closest('[data-id]')?.dataset.id;
    if (b.hasAttribute('data-play')) { await h.act(null, () => playTake(take, b)); return; }
    if (b.dataset.playId) { await h.act(null, () => playTake(b.dataset.playId, b)); return; }
    if (b.dataset.rate) {
      const now = b.getAttribute('aria-pressed') === 'true';
      await h.act(b, async () => {
        await vox(`/v1/admin/takes/${encodeURIComponent(take)}/feedback`, { method: 'POST', body: { rating: now ? 0 : Number(b.dataset.rate) } });
        await renderTab();
      }, now ? 'Rating cleared.' : 'Thanks, noted.');
      return;
    }
    if (b.dataset.pick) {
      const pair = abPair;
      abPair = null;
      if (b.dataset.pick === 'none') { await renderTab(); return; }
      const [winner, loser] = b.dataset.pick === 'a' ? [pair.a, pair.b] : [pair.b, pair.a];
      await h.act(b, async () => { await vox('/v1/admin/compare', { method: 'POST', body: { winner, loser } }); await renderTab(); }, 'Choice saved. It will learn from it.');
      return;
    }
    if (b.id === 'vx-at-hear' || b.id === 'vx-at-plain') {
      const spec = b.id === 'vx-at-hear' ? atSpec() : 'off';
      await h.act(null, () => speakPreview({ text: $('#vx-at-line').value || 'Hello.', voice: $('#vx-at-voice').value, seed: 7, autotune: spec || 'off' }, b));
      return;
    }
    if (b.id === 'vx-at-save') {
      const spec = atSpec();
      await h.act(b, async () => {
        await vox(`/v1/admin/voices/${encodeURIComponent($('#vx-at-voice').value)}`, { method: 'PATCH', body: spec ? { autotune: spec } : { clear_autotune: true } });
        await renderTab();
      }, spec ? 'Auto-tune saved for this voice.' : 'Auto-tune turned off for this voice.');
      return;
    }
    if (b.dataset.hear) { await h.act(null, () => speakPreview({ text: 'Hello there. This is how I sound today.', voice: b.dataset.hear, seed: 3 }, b)); return; }
    if (b.dataset.say) { await h.act(null, () => speakPreview({ text: b.dataset.say, voice: voiceList[0]?.name || 'narrator', seed: 3, enunciate: b.dataset.clear ? 1 : 0 }, b)); return; }
    if (b.id === 'vx-dict-install') {
      await h.act(b, async () => { await vox('/v1/admin/dictionary/install', { method: 'POST' }); await renderTab(); }, 'Installing the dictionary. This takes a couple of minutes.');
      return;
    }
    if (b.id === 'vx-tr-hear') {
      const text = $('#vx-tr-text').value.trim();
      if (text) await h.act(null, () => speakPreview({ text, voice: $('#vx-tr-voice').value, seed: 3, translate_to: $('#vx-tr-to').value }, b));
      return;
    }
    if (b.id === 'vx-say-hear') {
      const t = $('#vx-say').value.trim() || $('#vx-w').value.trim();
      if (t) await h.act(null, () => speakPreview({ text: t, voice: voiceList[0]?.name || 'narrator', seed: 3 }, b));
      return;
    }
    if (b.dataset.fix) {
      $('#vx-w').value = b.dataset.fix;
      $('#vx-say').value = '';
      $('#vx-say').focus();
      $('#vx-word').scrollIntoView({ block: 'center' });
      return;
    }
    if (b.dataset.unword) {
      await h.act(b, async () => { await vox(`/v1/admin/lexicon/${encodeURIComponent(b.dataset.unword)}`, { method: 'DELETE' }); await renderTab(); }, 'Fix removed.');
      return;
    }
    if (b.dataset.opt) {
      await h.act(b, async () => {
        await vox(`/v1/admin/voices/${encodeURIComponent(b.dataset.opt)}/optimize`, { method: 'POST' });
        tab = 'learning';
        const radio = $('input[name=vx-tab][value=learning]');
        if (radio) radio.checked = true;
        await renderTab();
      }, `Auto-optimizing ${b.dataset.opt}. Progress shows under Learning.`);
      return;
    }
    if (b.dataset.reset) {
      await h.act(b, async () => { await vox(`/v1/admin/voices/${encodeURIComponent(b.dataset.reset)}`, { method: 'PATCH', body: { reset_tuning: true } }); await renderTab(); }, 'Back to the default settings.');
      return;
    }
    if (b.dataset.unrefine) {
      await h.act(b, async () => { await vox(`/v1/admin/voices/${encodeURIComponent(b.dataset.unrefine)}/undo-refine`, { method: 'POST' }); await renderTab(); }, 'Voice put back as it was before the last refinement.');
      return;
    }
    if (b.dataset.del) {
      const ok = await h.ask({ title: `Delete the voice "${b.dataset.del}"?`, text: 'Games that ask for it will get an error. Lines already baked into files are not affected.', ok: 'Delete voice', danger: true });
      if (ok) await h.act(b, async () => { await vox(`/v1/admin/voices/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); await renderTab(); }, 'Voice deleted.');
      return;
    }
    if (b.dataset.use || b.id === 'vx-rollback') {
      const target = b.dataset.use;
      const ok = await h.ask({ title: target ? `Use ${target}?` : 'Roll back?', text: 'Every game using the engine switches at once. You can switch back any time.', ok: target ? 'Use this version' : 'Roll back' });
      if (ok) {
        await h.act(b, async () => {
          if (target) await vox(`/v1/admin/models/${encodeURIComponent(target)}/promote`, { method: 'POST' });
          else await vox('/v1/admin/models/rollback', { method: 'POST' });
          await render();
        }, 'Switched.');
      }
    }
  });
}
