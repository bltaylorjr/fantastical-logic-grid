/* ---------- App shell ---------- */
function fillPubSelects() {
  for (const id of ['#pub', '#pub2']) $(id).replaceChildren(...Object.entries(PUBLISHERS).map(([k, p]) => new Option(p.name, k)));
}
function fillTrimSelect() {
  const P = PUBLISHERS[S.pub]; const list = P.trims.includes(S.trim) ? P.trims : [S.trim, ...P.trims];
  $('#trim').replaceChildren(...list.map(t => new Option(TRIM_LABEL(t) + (P.trims.includes(t) ? '' : ' (not offered)'), t)));
  $('#trim').value = S.trim;
}
function refreshUI() {
  $('#pub').value = S.pub; $('#pub2').value = S.pub; fillTrimSelect();
  $('#paper').value = S.paper; $('#ink').value = S.ink; $('#bleed').checked = S.bleed;
  refreshInspector(); renderPubCard(); updateStatus();
}
function refreshAll() { refreshUI(); }
function updateStatus() {
  const g = coverGeom(); $('#sbPages').textContent = pageCount(); $('#sbTrim').textContent = `${g.w} × ${g.h} in`;
  $('#sbSpine').textContent = fmtIn(g.sp); $('#sbCover').textContent = `${g.W.toFixed(3)} × ${g.H.toFixed(3)} in`;
  const e = lastIssues.filter(i => i.sev === 'error').length;
  $('#sbCheck').innerHTML = lastIssues.length || e ? `<span class="chip ${e ? 'error' : 'ok'}">${e ? e + ' to fix' : 'Ready'}</span>` : '';
  if (cv) updateCoverSpecs();
}

let currentTab = 'manuscript';
// Back returns to the step you came from; Next goes to the following step.
const STEPS = [['manuscript', 'Interior'], ['cover', 'Cover'], ['details', 'Book details'], ['publish', 'Check & export']];
const tabTrail = [];
function updateStepButtons() {
  const i = STEPS.findIndex(s => s[0] === currentTab); const next = STEPS[i + 1];
  $('#navNext').hidden = i < 0 || !next; if (i >= 0 && next) $('#navNext').textContent = `Next: ${next[1]} →`;
  const prev = tabTrail[tabTrail.length - 1];
  const prevName = prev === 'gridbooks' ? 'Grid books' : STEPS.find(s => s[0] === prev)?.[1];
  $('#navBack').hidden = !prev; if (prev) $('#navBack').textContent = `← Back to ${prevName}`;
}
function showTab(name, { back = false } = {}) {
  if (name === currentTab && !$('#view-' + name).hidden && name !== 'publish') return;
  if (name !== currentTab && !back) { tabTrail.push(currentTab); if (tabTrail.length > 20) tabTrail.shift(); }
  currentTab = name;
  updateStepButtons();
  $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false'));
  ['manuscript', 'cover', 'details', 'publish', 'gridbooks'].forEach(v => $('#view-' + v).hidden = v !== name);
  if (name === 'gridbooks' && typeof gaGridBooks === 'function') gaGridBooks();
  if (name === 'cover') ensureCover().then(() => { sizeCoverCanvas(); cv.calcOffset(); }).catch(() => { });
  if (name === 'publish') { syncPagesFromDom(); renderPubCard(); runChecks(); }
  if (name === 'manuscript') requestAnimationFrame(checkAllOverflow);
  try { if (location.hash !== '#' + name) location.hash = name; } catch (e) { }
}

function fillMetaForm() {
  $$('[data-meta]').forEach(el => { el.value = S.meta[el.dataset.meta] ?? ''; });
  updateMetaCounts();
}
function updateMetaCounts() {
  const P = PUBLISHERS[S.pub];
  const d = S.meta.description.length; const dc = $('#descCount'); dc.textContent = `${d} / ${P.descMax}`; dc.classList.toggle('over', d > P.descMax);
  const k = lines(S.meta.keywords).length; const kc = $('#kwCount'); kc.textContent = `${k} / ${P.keywords} keywords`; kc.classList.toggle('over', k > P.keywords);
  const c = lines(S.meta.categories).length; const cc = $('#catCount'); cc.textContent = `${c} / ${P.categories} categories`; cc.classList.toggle('over', c > P.categories);
}

function onSpecChange(fn) {
  return e => { applyLog = null; syncPagesFromDom(); fn(e); renderPages(); refreshUI(); onGeometryChanged(); markDirty(); lastIssues = []; updateStatus(); };
}

function loadProject(data) {
  const base = blankProject();
  S = { ...base, ...data, meta: { ...base.meta, ...(data.meta || {}) }, margins: { ...base.margins, ...(data.margins || {}) }, body: { ...base.body, ...(data.body || {}) }, folio: { ...base.folio, ...(data.folio || {}) }, counters: { ...base.counters, ...(data.counters || {}) } };
  if (!TRIMS[S.trim]) S.trim = PUBLISHERS[S.pub]?.defaultTrim || '8.5x11';
  if (!PUBLISHERS[S.pub]) S.pub = 'kdp';
  curPage = 0; undoStack = []; lastIssues = [];
  renderPages(); refreshUI(); fillMetaForm();
  if (cv) { const json = S.cover; if (json) loadCoverJSON(json, S.coverGeom).then(() => { lastGeom = coverGeom(); }); else autoDesignCover(); }
  markDirty();
}

/* Sample book: realistic example content, generated fresh */
function sampleProject() {
  const p = blankProject();
  p.meta = { ...p.meta, title: 'Weekend Brain Teasers', subtitle: 'Sudoku, Word Search & Mazes for Adults', author: 'Sample Author', imprint: 'Sample Press', pubDate: new Date().toISOString().slice(0, 10), price: '9.99', copyright: 'Sample Author',
    description: 'Example book. Replace this text with your own description.\n\nA relaxing mix of 3 puzzle types in a large 8.5 × 11 format: sudoku from easy to hard, themed word searches and hand-drawn-style mazes, with full solutions at the back.',
    blurb: 'Example blurb. Unplug and unwind with a mix of sudoku, word searches and mazes, printed large and clear. Full solutions are at the back of the book.',
    keywords: 'sudoku for adults\nword search large print\nmaze puzzle book\nbrain games\nlogic puzzles\nactivity book for adults\ngift for puzzle lovers', categories: 'GAM007000 Games & Activities / Puzzles' };
  p.body = { font: 'Nunito', size: 12, lh: 1.35 };
  S = p; curPage = 0;
  return p;
}
async function buildSample() {
  sampleProject(); S.pages = [{ id: uid(), html: '<h1 class="center">How to play</h1><h3>Sudoku</h3><p>Fill every row, column and 3 × 3 box with the digits 1 to 9. Each digit appears once in each row, column and box.</p><h3>Word search</h3><p>Find each word in the list. Words run across, down and diagonally.</p><h3>Mazes</h3><p>Start at the gap at the top and find your way to the gap at the bottom.</p><p>Solutions for every puzzle are at the back of the book.</p>' }];
  renderPages(); refreshUI(); fillMetaForm();
  curPage = 0;
  await generatePuzzles('sudoku', { count: 2, perPage: 1, answers: true, newPages: true, diff: 'easy' });
  curPage = S.pages.length - 2;
  await generatePuzzles('wordsearch', { count: 2, perPage: 1, answers: true, newPages: true, wsSize: 15, wsDir: 'medium', lists: SAMPLE_LISTS });
  curPage = S.pages.length - 2;
  await generatePuzzles('maze', { count: 1, perPage: 1, answers: true, newPages: true, mzSize: 18, mzShape: 'square' });
  insertFrontMatter(true);
  renderPages(); refreshUI(); fillMetaForm(); setActivePage(0, false);
  setTimeout(reflowAnswers, 80);
  if (cv) await autoDesignCover();
  undoStack = []; markDirty();
}

function wireShell() {
  fillPubSelects();
  $$('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
  $('#navBack').onclick = () => { const prev = tabTrail.pop(); if (prev) showTab(prev, { back: true }); };
  $('#navNext').onclick = () => { const i = STEPS.findIndex(s => s[0] === currentTab); if (STEPS[i + 1]) showTab(STEPS[i + 1][0]); };
  updateStepButtons();
  const setPub = v => { S.pub = v; if (!PUBLISHERS[v].trims.includes(S.trim)) toast(`${PUBLISHERS[v].short} does not offer ${TRIM_LABEL(S.trim)}. Apply specs to switch to the nearest size.`, 5000); updateMetaCounts(); };
  $('#pub').onchange = onSpecChange(e => setPub(e.target.value));
  $('#pub2').onchange = onSpecChange(e => setPub(e.target.value));
  $('#trim').onchange = onSpecChange(e => { S.trim = e.target.value; });
  $('#paper').onchange = onSpecChange(e => { S.paper = e.target.value; if (S.paper === 'color') { S.ink = 'color'; } });
  $('#ink').onchange = onSpecChange(e => { S.ink = e.target.value; if (S.ink === 'bw' && S.paper === 'color') S.paper = 'white'; });
  $('#bleed').onchange = onSpecChange(e => { S.bleed = e.target.checked; });
  $('#applyPub').onclick = applyPublisher; $('#applyPub2').onclick = applyPublisher;
  $('#runCheck').onclick = () => runChecks();
  $('#expPacket').onclick = exportPacket; $('#expInterior').onclick = exportInterior; $('#expCover').onclick = exportCover;
  $('#expMeta').onclick = async () => (await mayExport('metadata')) && saveFile(slug(S.meta.title) + '-metadata.txt', metadataText());
  $('#addFront').onclick = () => { snapshot('front matter'); insertFrontMatter(false); showTab('manuscript'); };
  $$('[data-meta]').forEach(el => el.addEventListener('input', () => { S.meta[el.dataset.meta] = el.value; updateMetaCounts(); markDirty(); }));
  // Project menu
  $('#projMenuBtn').onclick = () => { $('#projNewConfirm').hidden = true; openDlg('#dlgProject'); };
  $('#projSave').onclick = () => { syncPagesFromDom(); syncCoverToState(); saveFile(slug(S.meta.title) + '-project.json', JSON.stringify(S)); };
  $('#projOpen').onclick = () => { const f = $('#fileProj'); f.value = ''; f.onchange = async () => { try { const d = JSON.parse(await f.files[0].text()); if (!d.pages) throw new Error('not a project file'); delete d.syncId; closeDlg('#dlgProject'); loadProject(d); toast('Opened ' + (d.meta?.title || 'project')); } catch (e) { toast('That file is not a Puzzle Book Studio project'); } }; f.click(); };
  $('#projSample').onclick = async () => { closeDlg('#dlgProject'); busy('Building the sample book'); await buildSample(); busy(false); showTab('manuscript'); };
  $('#projNew').onclick = () => { $('#projNewConfirm').hidden = false; };
  $('#projNewYes').onclick = () => { closeDlg('#dlgProject'); loadProject(blankProject()); if (cv) autoDesignCover(); toast('Started a blank book'); };
}

async function init() {
  wireShell(); wireEditor(); wirePuzzles(); wireImport(); wireCover();
  const saved = await idbGet('current');
  const restored = !!(saved && saved.pages && saved.pages.length);
  if (restored) { loadProject(saved); $('#sbSave').textContent = 'Restored from this browser'; }
  else { busy('Building the sample book'); await buildSample(); busy(false); $('#sbSave').textContent = 'Sample book loaded. Open Project to start your own.'; }
  // Grid Admin build: fetch this account's books, open the newest on a new device (sync.js).
  if (typeof syStart === 'function') syStart({ restored });
  const h = (location.hash || '').slice(1); if (['cover', 'details', 'publish'].includes(h) || (h === 'gridbooks' && !$('[data-tab=gridbooks]').hidden)) showTab(h);
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (['manuscript', 'cover', 'details', 'publish', 'gridbooks'].includes(t) && t !== currentTab) { const back = tabTrail[tabTrail.length - 1] === t; if (back) tabTrail.pop(); showTab(t, { back }); } });
  document.fonts && document.fonts.ready.then(() => checkAllOverflow());
}
// init() runs from auth.js once Grid Admin says this account may publish
// (or straight away in the stand-alone build).
