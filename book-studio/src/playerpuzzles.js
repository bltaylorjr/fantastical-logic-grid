/* ---------- Player puzzles: approved puzzles players sent in ----------
   Grid Admin build only (auth.js shows the tab). Lists every approved player
   puzzle (GET /admin/v1/studio/player-puzzles, server/src/studio-player-puzzles.js):
   Puzzle Wizard puzzles and storylines in the Approved or Published section of
   Grid Admin's Puzzle submissions page. For each one:
   - Add to book: its puzzle page goes after the current page, its answer key
     at the back of the book (or right after it), drawn like a Grid books page;
   - Download: the puzzle and answer key as a PDF;
   - Print: the same PDF, in the browser's print window.
   The website's Book maker (web/js/book-maker.js, in a hidden frame) builds
   each puzzle with the game's engine (a wizard puzzle again from the author's
   entry and seed, so it is the puzzle they made) and draws it with the game's
   print layout. A puzzle built here is kept with the entry, so every book
   prints the same one.
   Author credit: a player puzzle's page can show "Puzzle by <screen name>" at
   the foot of the page (editor.js buildPageNode), switched on or off for each
   puzzle (Current page, on the right) and for the whole book (S.playerCredits).
   Players who chose to stay anonymous are never credited.
   Publications: once the submission packet or the interior PDF is saved
   (publish.js), ppRecordExport() sends the player puzzles in the book, and
   the server counts each once per book (exporting it again does not). */
let ppData = null;          // { items, siteUrl }
let ppFrame = null, ppReady = null, ppReq = 0;
const ppWaiting = new Map();
const ppBuilt = new Map();  // id -> { item, css, pdf }
const ppPicked = new Set();
let ppQuery = { q: '', game: '', use: '' };

const PP_GAMES = { fantastical: 'The Fantastical Logic Grid', ninetimesnine: 'NINETIMESNINE' };
const PP_LEVELS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master', mensa: 'Quantum Physicist', theorist: 'Theoretical Physicist' };

// The player puzzle ids in this book (each counted once).
function ppBookIds() {
  return [...new Set(S.pages.map(p => p.player && Number(p.player.id)).filter(n => Number.isInteger(n) && n > 0))];
}
const ppCreditsOn = () => S.playerCredits !== false;

/* ---------- the Book maker frame ---------- */
function ppOnMessage(e) {
  if (!ppData || !ppFrame || e.source !== ppFrame.contentWindow || !e.data) return;
  let origin; try { origin = new URL(ppData.siteUrl).origin; } catch (x) { return; }
  if (e.origin !== origin) return;
  const m = e.data;
  if (m.type === 'flg-book-ready') { ppReady && ppReady.resolve(); return; }
  const w = ppWaiting.get(m.req);
  if (w) { ppWaiting.delete(m.req); w(m); }
}
function ppMount() {
  if (ppFrame) return;
  window.addEventListener('message', ppOnMessage);
  let resolve; ppReady = new Promise(r => { resolve = r; }); ppReady.resolve = resolve;
  ppFrame = document.createElement('iframe');
  ppFrame.title = 'Puzzle maker'; ppFrame.className = 'bk-frame'; ppFrame.hidden = true;
  ppFrame.src = `${ppData.siteUrl}/book-maker/`;
  $('#ppFrames').appendChild(ppFrame);
}
async function ppAsk(msg) {
  ppMount();
  await Promise.race([ppReady, new Promise((_, no) => setTimeout(() => no(new Error('The website did not answer. Check that it is online, then try again.')), 30000))]);
  const id = `pp${++ppReq}`;
  const m = await new Promise((resolve, reject) => {
    ppWaiting.set(id, resolve);
    setTimeout(() => { if (ppWaiting.delete(id)) reject(new Error('Building the puzzle took too long. Try again.')); }, 180000);
    ppFrame.contentWindow.postMessage({ ...msg, req: id }, new URL(ppData.siteUrl).origin);
  });
  if (m.type === 'flg-book-error') throw new Error(m.message);
  return m;
}

// The puzzle, built and drawn (once per visit).
async function ppBuild(it) {
  if (ppBuilt.has(it.id)) return ppBuilt.get(it.id);
  const m = await ppAsk({ type: 'flg-book-player', entry: it.puzzle ? null : it.entry, seed: it.seed, puzzle: it.puzzle, credit: it.credit });
  const out = { item: m.item, css: m.css, pdf: m.pdf };
  ppBuilt.set(it.id, out);
  // Keep the wizard puzzle just built, so every book prints this same one.
  if (m.puzzle && !it.puzzle) {
    it.puzzle = m.puzzle;
    adminApi(`studio/player-puzzles/${it.id}/puzzle`, { method: 'POST', body: { puzzle: m.puzzle } }).catch(() => {});
  }
  return out;
}

/* ---------- the page ---------- */
async function ppView({ reload = false } = {}) {
  const body = $('#ppBody');
  if (!ppData || reload) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    try { ppData = await adminApi('studio/player-puzzles'); }
    catch (e) { body.textContent = e.message || 'Player puzzles did not load. Check your connection and try again.'; return; }
  }
  $('#ppCredits').checked = ppCreditsOn();
  ppRender();
}
function ppStatus(it) {
  if (!it.puzzle && !it.entry) return 'not-built';
  return 'ok';
}
function ppRender() {
  const q = ppQuery.q.toLowerCase();
  const inBook = new Set(ppBookIds());
  const list = ppData.items.filter(it => (!ppQuery.game || it.game === ppQuery.game)
    && (!ppQuery.use || (ppQuery.use === 'new' ? !it.books : ppQuery.use === 'book' ? inBook.has(it.id) : it.books > 0))
    && (!q || [it.title, it.player, it.credit, String(it.id)].some(v => String(v || '').toLowerCase().includes(q))));
  const ready = list.filter(it => ppStatus(it) === 'ok');
  for (const id of [...ppPicked]) if (!ready.some(it => it.id === id)) ppPicked.delete(id);
  $('#ppCount').textContent = `${list.length} of ${ppData.items.length} approved player puzzle${ppData.items.length === 1 ? '' : 's'}`;
  $('#ppAddPicked').disabled = !ppPicked.size;
  $('#ppAddPicked').textContent = ppPicked.size ? `Add ${ppPicked.size} to the book` : 'Add ticked to the book';
  $('#ppBody').innerHTML = list.length ? `<ul class="pp-list">${list.map(it => {
    const ok = ppStatus(it) === 'ok';
    const level = PP_LEVELS[it.level] || it.level || '';
    const by = it.credit ? `by <b>${esc(it.credit)}</b>` : it.anonymous ? 'The author chose no credit' : 'by a player';
    const used = it.books ? `In ${it.books} book${it.books === 1 ? '' : 's'}${it.exports > it.books ? ` (${it.exports} exports)` : ''}` : 'Not in a book yet';
    return `<li class="pp-item${inBook.has(it.id) ? ' here' : ''}">
      <label class="pp-pick"><input type="checkbox" data-pp-pick="${it.id}"${ppPicked.has(it.id) ? ' checked' : ''}${ok ? '' : ' disabled'} aria-label="Tick ${esc(it.title)}"></label>
      <div class="pp-meta">
        <b class="pp-title">${esc(it.title)}</b>
        <span class="muted">${esc(PP_GAMES[it.game] || it.game)}${level ? ` · ${esc(level)}` : ''} · ${it.kind === 'storyline' ? 'Storyline' : 'Puzzle Wizard'} · #${it.id}</span>
        <span>${by}</span>
        <span class="pp-tags"><span class="chip ${it.books ? 'ok' : ''}">${used}</span>${it.status === 'published' ? '<span class="chip">Published</span>' : ''}${inBook.has(it.id) ? '<span class="chip ok">In this book</span>' : ''}</span>
        ${ok ? '' : '<span class="hint">No puzzle yet: build it in Grid Admin under Storyline submissions first.</span>'}
      </div>
      <div class="pp-acts">
        <button class="btn primary" type="button" data-pp-add="${it.id}"${ok ? '' : ' disabled'}>Add to book</button>
        <button class="btn" type="button" data-pp-pdf="${it.id}"${ok ? '' : ' disabled'}>Download</button>
        <button class="btn" type="button" data-pp-print="${it.id}"${ok ? '' : ' disabled'}>Print</button>
      </div>
    </li>`;
  }).join('')}</ul>` : `<p class="muted">${ppData.items.length ? 'Nothing matches. Clear the search to see them all.' : 'No approved player puzzles yet. Approve them in Grid Admin under Puzzle submissions.'}</p>`;
}

/* ---------- adding to the book ---------- */
function ppAddCss(css) {
  const clean = cleanGridCss(css);
  const games = (clean.match(/\.bk-g-[\w-]+/) || [])[0];
  if (!clean || (games && (S.gridCss || '').includes(games + ' '))) return;
  S.gridCss = cleanGridCss(((S.gridCss || '') + '\n' + clean).trim());
  applyGridCss();
}
// One player puzzle as editor pages: its puzzle page(s) and its answer key page.
function ppPages(it, built) {
  const x = built.item; const g = esc(x.game);
  const head = `${esc(x.gameName)}${x.level ? ` · ${esc(x.level)}` : ''}`;
  const parts = String(x.page || '').split('<div class="bk-break"></div>').filter(Boolean);
  const player = { id: it.id, credit: it.credit || '', title: String(it.title || '').slice(0, 120) };
  const pages = parts.map((part, k) => ({
    id: uid(), grid: 'puzzle', player: { ...player },
    html: gridPageHtml({ kind: 'puzzle', head: head + (parts.length > 1 ? ` (${k + 1} of ${parts.length})` : ''), body: `<div class="bk-fit bk-g-${g}">${part}</div>` })
  }));
  const key = x.key ? {
    id: uid(), grid: 'key', playerKey: it.id,
    html: gridPageHtml({ kind: 'key', head: `Answer · ${esc(it.title)}`, body: `<div class="bk-key"><p class="bk-keyh">${esc(it.title)}</p><div class="bk-room"><div class="bk-fit bk-g-${g}">${x.key}</div></div></div>` })
  } : null;
  return { pages, key };
}
async function ppAdd(ids) {
  const items = ids.map(id => ppData.items.find(it => it.id === id)).filter(Boolean);
  if (!items.length) return;
  const where = $('#ppKeys').value;
  const made = [];
  try {
    for (let k = 0; k < items.length; k++) {
      busy(`Building “${items[k].title}” (${k + 1} of ${items.length})`, (k + 0.5) / items.length);
      made.push([items[k], await ppBuild(items[k])]);
    }
  } catch (e) { busy(false); toast(e.message || 'That puzzle could not be built.', 7000); return; }
  busy(false);
  snapshot('player puzzles');
  syncPagesFromDom();
  let at = clamp(curPage, 0, S.pages.length - 1) + 1;
  const first = at;
  for (const [it, built] of made) {
    ppAddCss(built.css);
    const { pages, key } = ppPages(it, built);
    S.pages.splice(at, 0, ...pages); at += pages.length;
    if (key && where === 'after') { S.pages.splice(at, 0, key); at += 1; }
    else if (key && where === 'back') S.pages.push(key);
  }
  renderPages(); refreshAll(); setActivePage(first, false); markDirty();
  showTab('manuscript');
  setTimeout(() => setActivePage(first, true), 60);
  toast(`Added ${made.length} player puzzle${made.length === 1 ? '' : 's'}${where === 'none' ? '' : where === 'after' ? ', each with its answer key after it' : ', with the answer keys at the back'}.`, 5000);
  made.forEach(([it]) => ppPicked.delete(it.id));
}

/* ---------- publications ---------- */
async function ppRecordExport(kind) {
  syncPagesFromDom();
  const puzzles = ppBookIds(); if (!puzzles.length) return;
  const book = typeof syEnsureId === 'function' ? syEnsureId() : '';
  try {
    const r = await adminApi('studio/player-puzzles/published', { method: 'POST', body: { kind, book, title: S.meta.title || 'Untitled', platform: PUBLISHERS[S.pub].name, puzzles } });
    if (r.counted) {
      toast(`${r.counted} player puzzle${r.counted === 1 ? '' : 's'} counted as published in this book.`, 5000);
      ppData = null; // counts changed: load again next time
    }
  } catch (e) { /* the export is saved; the count catches up the next time it is exported */ }
}

/* ---------- download and print ---------- */
async function ppPdf(id) {
  const it = ppData.items.find(x => x.id === id); if (!it) return null;
  busy(`Building “${it.title}”`, 0.4);
  try { const b = await ppBuild(it); busy(false); return { it, blob: new Blob([b.pdf], { type: 'application/pdf' }) }; }
  catch (e) { busy(false); toast(e.message || 'That puzzle could not be built.', 7000); return null; }
}
async function ppDownload(id) {
  const r = await ppPdf(id); if (!r) return;
  await saveFile(`${slug(r.it.title)}-puzzle.pdf`, r.blob);
}
async function ppPrint(id) {
  const r = await ppPdf(id); if (!r) return;
  const url = URL.createObjectURL(r.blob);
  const f = document.createElement('iframe');
  f.title = 'Printable puzzle'; f.className = 'pp-print';
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(url, '_blank', 'noopener'); } };
  f.src = url; document.body.appendChild(f);
  setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120000);
}

function wirePlayerPuzzles() {
  $('#ppSearch').onsubmit = e => { e.preventDefault(); ppQuery = { q: $('#ppQ').value.trim(), game: $('#ppGame').value, use: $('#ppUse').value }; if (ppData) ppRender(); };
  $('#ppGame').onchange = $('#ppUse').onchange = () => $('#ppSearch').requestSubmit();
  $('#ppReload').onclick = () => { ppBuilt.clear(); ppView({ reload: true }); };
  $('#ppCredits').onchange = e => { syncPagesFromDom(); S.playerCredits = e.target.checked; renderPages(); refreshAll(); markDirty(); toast(e.target.checked ? 'Author credit shows on player puzzle pages (where it is on for the puzzle).' : 'Author credit is off for every player puzzle in this book.'); };
  $('#ppAddPicked').onclick = () => ppAdd([...ppPicked]);
  $('#ppBody').onclick = e => {
    const b = e.target.closest('button, input'); if (!b || b.disabled) return;
    if (b.dataset.ppPick) { const id = +b.dataset.ppPick; b.checked ? ppPicked.add(id) : ppPicked.delete(id); $('#ppAddPicked').disabled = !ppPicked.size; $('#ppAddPicked').textContent = ppPicked.size ? `Add ${ppPicked.size} to the book` : 'Add ticked to the book'; return; }
    if (b.dataset.ppAdd) ppAdd([+b.dataset.ppAdd]);
    else if (b.dataset.ppPdf) ppDownload(+b.dataset.ppPdf);
    else if (b.dataset.ppPrint) ppPrint(+b.dataset.ppPrint);
  };
}
