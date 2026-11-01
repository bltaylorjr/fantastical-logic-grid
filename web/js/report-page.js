// The Report a Problem page (web/report/), opened from the footer button under
// every screen of the game (puzzle-report.js) and every page of the website
// (site-report.js). It replaces the old pop-up box, so there is room for
// pictures and files.
//
// What it sends (server/src/puzzle-reports.js, POST /v1/puzzle-report):
//   Puzzle Problem   the open (or last played) puzzle and its picture, handed
//                    over by the game, so the puzzle doctor can check and
//                    repair it the moment the report arrives
//   Web Page Issue   which screen or page, the app version and window size
//   both             up to 1,000 characters, and up to 3 pictures or files
//                    (server/src/report-files.js checks them again)
// Pictures are re-drawn here before sending: smaller, and without the hidden
// details a photo carries (such as where it was taken).
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import { feature } from './remote-config.js';
import { platform } from './platform.js';
import { takeHandoff } from './report-handoff.js';

const $ = (s, el = document) => el.querySelector(s);
const MAX = 1000;
const MAX_FILES = 3;
const MAX_BYTES = 1_048_576;
const MAX_SIDE = 1600;
const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
const TEXT_EXT = /\.(txt|log|json|csv)$/i;
const REPLY_WORDS = {
  queued: 'We emailed you a copy of your report, and will email you again when it is fixed.',
  limit: 'We will email you when it is fixed.',
  unverified: 'To get an email when it is fixed, confirm your email address in the game first (Account).',
};

// The player's saved color theme, as in the game.
try { const s = JSON.parse(localStorage.getItem('flg.settings') || '{}'); if (s.colorTheme && s.colorTheme !== 'system') document.documentElement.dataset.theme = s.colorTheme; } catch (e) { /* default */ }
// Never inside another site's frame.
if (window.top !== window.self) { document.documentElement.hidden = true; try { window.top.location = window.location.href; } catch (e) { /* blocked */ } }

const ctx = takeHandoff();
const fromSite = ctx.from === 'site';
const form = $('#rp-form');
const text = $('#rp-text');
const kind = () => $('input[name=kind]:checked', form).value;
let files = []; // { name, type, size, blob, url }

// ---------- leaving the page
// Opened in its own tab: closing it returns to the game or page, just as the
// player left it. Otherwise go back to where they came from.
const backHref = '../';
function leave(e) {
  if (ctx.tab) {
    e?.preventDefault();
    window.close();
    // Some browsers keep a tab the page did not open; then go back instead.
    setTimeout(() => { if (history.length > 1) history.back(); else location.href = backHref; }, 250);
  } else if (fromSite && history.length > 1) {
    e?.preventDefault();
    history.back(); // the website page they came from
  }
}
for (const a of [$('#rp-back'), $('#rp-cancel'), $('#rp-done-back')]) {
  a.href = backHref;
  a.addEventListener('click', leave);
}
if (fromSite) { $('#rp-back-text').textContent = 'Back to the page'; $('#rp-done-back').textContent = 'Back to the page'; }

// ---------- what it is about
function about() {
  const p = ctx.puzzle;
  $('#rp-about').textContent = kind() === 'page'
    ? `Tell us what looked wrong or did not work${ctx.where ? ` on ${ctx.where.split(':')[0]}` : ' on the page'}. We also send which ${fromSite ? 'page' : 'screen'} it was, the app version and your window size, nothing personal.`
    : p ? `About the puzzle “${p.title}”. The puzzle and its picture are sent with your report, so our puzzle doctor can check it and fix it straight away.`
      : 'Open the puzzle in the game and report it from there, so it is sent with your report. Or tell us which puzzle it was, and add a screenshot if you can.';
}
for (const r of form.querySelectorAll('input[name=kind]')) r.addEventListener('change', about);
$(`input[name=kind][value=${ctx.kind === 'page' || (!ctx.puzzle && ctx.kind !== 'puzzle') ? 'page' : 'puzzle'}]`, form).checked = true;
about();

// ---------- words
const count = () => { $('#rp-text-c').textContent = `${text.value.length.toLocaleString()} of ${MAX.toLocaleString()} characters`; };
text.addEventListener('input', () => { count(); fieldError(''); });
const fieldError = (msg) => {
  const f = text.closest('.sl-field');
  f.classList.toggle('invalid', !!msg);
  $('.sl-err', f).textContent = msg;
  text.setAttribute('aria-invalid', msg ? 'true' : 'false');
};

// ---------- pictures and files
const kb = (n) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const say = (msg) => { $('#rp-files-live').textContent = msg; };
const filesError = (msg) => { $('#rp-files-err').textContent = msg; };

// A picture redrawn on a canvas: at most MAX_SIDE across and under MAX_BYTES.
// WebP where the browser can make it, JPEG otherwise; PNG kept for small
// screenshots where it is already smaller. Animated GIFs stay as they are.
async function shrink(file) {
  if (file.type === 'image/gif') {
    if (file.size > MAX_BYTES) throw new Error(`“${file.name}” is over 1 MB. Try a screenshot instead.`);
    return file;
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch (e) {
    throw new Error(`“${file.name}” could not be opened. Save it as a PNG or JPEG picture and try again.`);
  }
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  const draw = () => {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // transparent parts would turn black in a JPEG
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  const encode = (type, q) => new Promise((ok) => canvas.toBlob(ok, type, q));
  draw();
  for (let round = 0; round < 6; round++) {
    let best = null;
    for (const [type, q] of [['image/webp', 0.86 - round * 0.08], ['image/jpeg', 0.86 - round * 0.08]]) {
      const b = await encode(type, Math.max(0.4, q));
      if (b && b.type === type && (!best || b.size < best.size)) best = b;
      if (best && type === 'image/webp') break; // WebP made: no need for JPEG
    }
    if (file.type === 'image/png' && round === 0) {
      const png = await encode('image/png');
      if (png && png.size < MAX_BYTES && (!best || png.size <= best.size * 1.15)) best = png; // crisp screenshots
    }
    if (best && best.size <= MAX_BYTES) { bitmap.close?.(); return best; }
    scale *= 0.75;
    draw();
  }
  bitmap.close?.();
  throw new Error(`“${file.name}” is too big to send, even made smaller.`);
}

const extFor = (type) => ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }[type]);
let busy = 0;
async function add(list) {
  filesError('');
  busy++;
  $('#rp-send').disabled = true;
  $('.rp-drop-hint').textContent = 'Preparing your pictures and files…';
  try { await addAll(list); } finally {
    if (--busy === 0) { $('#rp-send').disabled = !CLOUD_URL || !feature('feedback'); $('.rp-drop-hint').textContent = 'or drop them here, or paste a screenshot'; }
  }
}
async function addAll(list) {
  for (const file of [...list]) {
    if (files.length >= MAX_FILES) { filesError(`You can attach up to ${MAX_FILES} pictures or files.`); break; }
    try {
      let blob;
      let name = file.name || 'screenshot.png';
      if (IMAGE.test(file.type) || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)) {
        blob = await shrink(file);
        if (extFor(blob.type)) name = `${name.replace(/\.[^.]*$/, '') || 'picture'}.${extFor(blob.type)}`;
      } else if (file.type === 'application/pdf' || /\.pdf$/i.test(name) || TEXT_EXT.test(name)) {
        if (file.size > MAX_BYTES) throw new Error(`“${name}” is over 1 MB. Try a smaller file, or a screenshot.`);
        blob = file;
      } else {
        throw new Error(`“${name}” is not a type we accept. Attach pictures, PDFs or text files (.txt, .log, .json, .csv).`);
      }
      const item = { name, type: blob.type || file.type, size: blob.size, blob, url: blob.type.startsWith('image/') ? URL.createObjectURL(blob) : '' };
      files.push(item);
      say(`${name} attached, ${kb(item.size)}. ${files.length} of ${MAX_FILES}.`);
    } catch (e) { filesError(e.message); }
  }
  drawFiles();
}

function drawFiles() {
  const ul = $('#rp-files');
  ul.replaceChildren(...files.map((f, i) => {
    const li = document.createElement('li');
    li.className = 'rp-file';
    const thumb = f.url ? Object.assign(document.createElement('img'), { src: f.url, alt: '', className: 'rp-thumb' })
      : Object.assign(document.createElement('span'), { className: 'rp-thumb', textContent: (f.name.split('.').pop() || 'file').slice(0, 4) });
    thumb.setAttribute('aria-hidden', 'true');
    const meta = document.createElement('div');
    meta.className = 'rp-meta';
    meta.append(Object.assign(document.createElement('div'), { className: 'rp-name', textContent: f.name }), Object.assign(document.createElement('div'), { className: 'rp-size', textContent: kb(f.size) }));
    const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'btn quiet small', textContent: 'Remove' });
    rm.setAttribute('aria-label', `Remove ${f.name}`);
    rm.onclick = () => {
      if (f.url) URL.revokeObjectURL(f.url);
      files.splice(i, 1);
      drawFiles();
      say(`${f.name} removed.`);
      (ul.querySelector('button') || $('#rp-file')).focus();
    };
    li.append(thumb, meta, rm);
    return li;
  }));
  $('#rp-pick').toggleAttribute('aria-disabled', files.length >= MAX_FILES);
  $('#rp-file').disabled = files.length >= MAX_FILES;
}

$('#rp-file').addEventListener('change', (e) => { add(e.target.files); e.target.value = ''; });
const drop = $('#rp-drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) add(e.dataTransfer.files); });
// A screenshot pasted anywhere on the page (not into the words box as text).
document.addEventListener('paste', (e) => {
  const pics = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (pics.length) { e.preventDefault(); add(pics); }
});

// ---------- who is sending
function drawWho() {
  const me = account.current();
  const emails = feature('feedbackReplies') && !fromSite;
  $('#rp-reply-card').hidden = !me || !emails;
  $('#rp-reply-to').textContent = me?.email ? ` at ${me.email}` : '';
  $('#rp-who').textContent = fromSite ? 'Want an email when it is fixed? Report it from the game while signed in.'
    : !me && emails && account.enabled() ? 'Want an email when it is fixed? Sign in to the game with a confirmed email first.' : '';
}
account.onChange(drawWho);
drawWho();
count();
if (!CLOUD_URL || !feature('feedback')) { $('#rp-closed').hidden = false; $('#rp-send').disabled = true; }

// ---------- sending
const DOCTOR_WORDS = {
  called: 'Our puzzle doctor is checking the puzzle right now and repairs it if anything is wrong.',
  queued: 'Our puzzle doctor checks it within 15 minutes and repairs it if anything is wrong.',
};
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#rp-error');
  err.hidden = true;
  const words = text.value.trim();
  if (words.length < 5) { fieldError('Tell us a little about the problem first (at least 5 characters).'); text.focus(); return; }
  const btn = $('#rp-send');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = files.length ? 'Sending your report and files…' : 'Sending…';
  try {
    const me = account.current();
    const wants = !$('#rp-reply-card').hidden && $('#rp-reply').checked && !!me;
    let token = null;
    if (wants) { try { token = await account.getIdToken(); } catch (x) { /* sent without the email */ } }
    const k = kind();
    // The report's JSON and the files as form parts: no base64, so nothing
    // grows by a third on the way.
    const report = {
      kind: k, text: words.slice(0, MAX), reply: !!token,
      platform: fromSite ? 'site' : (ctx.platform || platform()), version: ctx.version || CLOUD.appVersion || (fromSite ? 'site' : 'dev'),
      ...(fromSite ? { page: String(ctx.page || '/').slice(0, 200) } : { where: String(ctx.where || 'Game').slice(0, 200) }),
      screen: ctx.screen || `${innerWidth}x${innerHeight}`,
      ...(k === 'puzzle' && ctx.puzzle ? { puzzle: ctx.puzzle, image: ctx.image || undefined } : {}),
    };
    const fd = new FormData();
    fd.append('report', JSON.stringify(report));
    for (const f of files) fd.append('file', f.blob, f.name);
    const res = await fetch(`${CLOUD_URL}/v1/puzzle-report`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || (res.status === 413 ? 'Your pictures and files are too big to send together. Remove one and try again.' : 'The report could not be sent right now. Please try again later.'));
    done(data, k);
  } catch (x) {
    err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again. Your words and files are still here.' : x.message;
    err.hidden = false;
    err.focus?.();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = 'Submit report';
  }
});

function done(data, k) {
  $('#rp-formwrap').hidden = true;
  const box = $('#rp-done');
  box.hidden = false;
  $('#rp-done-number').textContent = data.tracking;
  const n = data.files || 0;
  $('#rp-done-text').textContent = [
    n ? `Your ${n === 1 ? 'picture or file was' : `${n} pictures and files were`} received with it.` : '',
    DOCTOR_WORDS[data.doctor] || (k === 'puzzle' ? 'The team will look into it.' : 'The team will look into it, and fixes go out in the next update.'),
    REPLY_WORDS[data.reply] || '',
  ].filter(Boolean).join(' ');
  document.title = `Report ${data.tracking} sent · The Fantastical Logic Grid`;
  box.focus();
}

$('#rp-again').addEventListener('click', () => {
  for (const f of files) if (f.url) URL.revokeObjectURL(f.url);
  files = [];
  drawFiles();
  text.value = '';
  count();
  filesError('');
  $('#rp-done').hidden = true;
  $('#rp-formwrap').hidden = false;
  $('#rp-main').focus();
});
