/* ---------- Utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtIn = v => (Math.round(v * 1000) / 1000).toFixed(3) + ' in';
const slug = s => (String(s || 'book').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book').slice(0, 60);

let toastTimer;
function toast(msg, ms = 3200) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
let busyEl;
function busy(label, frac) {
  if (label === false) { if (busyEl) busyEl.remove(); busyEl = null; return; }
  if (!busyEl) {
    busyEl = document.createElement('div'); busyEl.className = 'busy';
    busyEl.innerHTML = '<div class="busy-card"><b class="busy-label"></b><div class="progress"><div></div></div><small class="hint busy-sub"></small></div>';
    document.body.appendChild(busyEl);
  }
  $('.busy-label', busyEl).textContent = label;
  $('.progress > div', busyEl).style.width = (frac == null ? 5 : Math.round(frac * 100)) + '%';
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

/* Lazy CDN loader (only allow-listed CDNs work inside the viewer) */
const LIBS = {
  fabric: { url: 'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js', test: () => window.fabric },
  jspdf: { url: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', test: () => window.jspdf },
  html2canvas: { url: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', test: () => window.html2canvas },
  jszip: { url: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', test: () => window.JSZip },
  mammoth: { url: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js', test: () => window.mammoth },
  pdfjs: { url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', test: () => window.pdfjsLib },
  pdfworker: { url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js', test: () => window.pdfjsWorker },
  pako: { url: 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js', test: () => window.pako },
  utif: { url: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js', test: () => window.UTIF },
  heic2any: { url: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js', test: () => window.heic2any },
  marked: { url: 'https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js', test: () => window.marked }
};
const libPromises = {};
function loadLib(name) {
  const L = LIBS[name];
  if (L.test()) return Promise.resolve();
  if (!libPromises[name]) libPromises[name] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = L.url; s.async = true;
    s.onload = () => res(); s.onerror = () => { delete libPromises[name]; rej(new Error('Could not load the ' + name + ' library. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return libPromises[name];
}
async function loadLibs(...names) { for (const n of names) await loadLib(n); }

/* File save: uses the viewer's download capability when hosted, a plain link otherwise */
async function saveFile(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  if (window.claude && typeof window.claude.use === 'function') {
    let d = null;
    try { d = await window.claude.use('downloads'); } catch (e) { d = null; }
    if (d) {
      try { await d.save({ filename, data: blob }); toast('Saved ' + filename); return true; }
      catch (e) {
        if (e && e.code === 'declined') { toast('Download canceled'); return false; }
        if (e && e.code === 'rate_limited') { toast('Another download is waiting for your answer'); return false; }
        if (e && e.code === 'rejected_extension') { toast('This file type cannot be downloaded here'); return false; }
      }
    }
  }
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    toast('Saved ' + filename); return true;
  } catch (e) { toast('Download is not available in this view'); return false; }
}

/* ---------- Fonts ---------- */
const BOOK_FONTS = ['Libre Baskerville', 'Merriweather', 'Lora', 'EB Garamond', 'Playfair Display', 'Roboto Slab', 'Open Sans', 'Nunito', 'Fredoka', 'Oswald', 'Bebas Neue', 'Patrick Hand', 'Permanent Marker', 'Courier Prime', 'Georgia', 'Arial', 'Times New Roman', 'Verdana'];
const fontStack = f => `"${f}", ${/Courier/.test(f) ? 'monospace' : /Sans|Nunito|Fredoka|Oswald|Bebas|Arial|Verdana|Hand|Marker/.test(f) ? 'sans-serif' : 'serif'}`;

/* ---------- State ---------- */
const DEFAULT_META = { title: '', subtitle: '', author: '', contributors: '', series: '', seriesNo: '', edition: 'First edition', imprint: '', isbn: '', pubDate: '', language: 'English', price: '', audience: 'Adult', copyright: '', description: '', blurb: '', keywords: '', categories: '' };
function blankProject() {
  return {
    version: 1, meta: { ...DEFAULT_META },
    pub: 'kdp', trim: '8.5x11', paper: 'white', ink: 'bw', bleed: false,
    margins: { top: 0.5, bottom: 0.5, inside: 0.5, outside: 0.5 },
    body: { font: 'Nunito', size: 12, lh: 1.35 },
    folio: { on: true, pos: 'outside', start: 3 },
    pages: [{ id: uid(), html: '<h1>Untitled puzzle book</h1><p>Start typing, import a manuscript, or use Puzzles to generate pages.</p>' }],
    counters: { sudoku: 0, wordsearch: 0, maze: 0 },
    cover: null, coverGeom: null, theme: 'navy'
  };
}
let S = blankProject();
let curPage = 0;

/* Geometry helpers */
function trimWH() { const t = TRIMS[S.trim] || [8.5, 11]; return { w: t[0], h: t[1] }; }
function bleedIn() { return S.bleed ? 0.125 : 0; }
function pageCount() { return S.pages.length; }
function spineIn() { return spineWidth(S.pub, S.paper, Math.max(pageCount(), 1)); }
function coverGeom() {
  const { w, h } = trimWH(); const b = 0.125; const sp = spineIn();
  return { w, h, b, sp, W: 2 * b + 2 * w + sp, H: 2 * b + h, backX: b, spineX: b + w, frontX: b + w + sp };
}

/* ---------- Persistence (IndexedDB, falls back silently) ---------- */
const DB_NAME = 'puzzle-book-studio', STORE = 'projects';
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function idbPut(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); return true; } catch (e) { return false; } }
async function idbGet(key) { try { const db = await idb(); return await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const q = tx.objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return null; } }

let saveTimer;
function markDirty() {
  $('#sbSave').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState();
    const ok = await idbPut('current', JSON.parse(JSON.stringify(S)));
    $('#sbSave').textContent = ok ? 'Saved in this browser' : 'Not saved: browser storage is unavailable. Save a project file.';
  }, 1200);
}
