/* ---------- Puzzle generators ---------- */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Sudoku: full grid by randomized backtracking, then remove clues while the solution stays unique.
function sdFill(g) {
  const i = g.indexOf(0); if (i < 0) return true;
  const r = Math.floor(i / 9), c = i % 9;
  for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) { if (sdOk(g, r, c, v)) { g[i] = v; if (sdFill(g)) return true; g[i] = 0; } }
  return false;
}
function sdOk(g, r, c, v) {
  for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false; }
  const br = r - r % 3, bc = c - c % 3;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (g[(br + y) * 9 + bc + x] === v) return false;
  return true;
}
function sdCount(g, limit = 2) {
  let best = -1, bestN = 10;
  for (let i = 0; i < 81; i++) if (!g[i]) {
    let n = 0; const r = Math.floor(i / 9), c = i % 9; for (let v = 1; v <= 9; v++) if (sdOk(g, r, c, v)) n++;
    if (n < bestN) { bestN = n; best = i; if (n === 0) return 0; }
  }
  if (best < 0) return 1;
  let total = 0; const r = Math.floor(best / 9), c = best % 9;
  for (let v = 1; v <= 9; v++) if (sdOk(g, r, c, v)) { g[best] = v; total += sdCount(g, limit); g[best] = 0; if (total >= limit) break; }
  return total;
}
function makeSudoku(diff) {
  const sol = new Array(81).fill(0); sdFill(sol);
  const target = { easy: 38, medium: 31, hard: 27, expert: 24 }[diff] || 31;
  const puz = sol.slice(); let clues = 81;
  for (const i of shuffle([...Array(81).keys()])) {
    if (clues <= target) break;
    const keep = puz[i]; puz[i] = 0;
    if (sdCount(puz.slice()) !== 1) puz[i] = keep; else clues--;
  }
  return { puz, sol };
}

// Word search
const WS_DIRS = { easy: [[0, 1], [1, 0]], medium: [[0, 1], [1, 0], [1, 1], [-1, 1]], hard: [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]] };
function makeWordSearch(words, size, level) {
  const clean = [...new Set(words.map(w => w.toUpperCase().replace(/[^A-Z]/g, '')).filter(w => w.length >= 2 && w.length <= size))].sort((a, b) => b.length - a.length);
  for (let attempt = 0; attempt < 30; attempt++) {
    const g = Array.from({ length: size }, () => Array(size).fill(''));
    const placed = []; let failed = [];
    for (const w of clean) {
      let ok = false;
      for (let t = 0; t < 300 && !ok; t++) {
        const [dr, dc] = WS_DIRS[level][Math.floor(Math.random() * WS_DIRS[level].length)];
        const r0 = Math.floor(Math.random() * size), c0 = Math.floor(Math.random() * size);
        const r1 = r0 + dr * (w.length - 1), c1 = c0 + dc * (w.length - 1);
        if (r1 < 0 || r1 >= size || c1 < 0 || c1 >= size) continue;
        let fits = true;
        for (let k = 0; k < w.length; k++) { const ch = g[r0 + dr * k][c0 + dc * k]; if (ch && ch !== w[k]) { fits = false; break; } }
        if (!fits) continue;
        const cells = [];
        for (let k = 0; k < w.length; k++) { g[r0 + dr * k][c0 + dc * k] = w[k]; cells.push((r0 + dr * k) * size + c0 + dc * k); }
        placed.push({ w, cells }); ok = true;
      }
      if (!ok) failed.push(w);
    }
    if (!failed.length || attempt === 29) {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!g[r][c]) g[r][c] = A[Math.floor(Math.random() * 26)];
      return { grid: g.flat(), size, placed, failed };
    }
  }
}

// Maze: recursive backtracker; returns a PNG data URL of puzzle and solution
function makeMaze(n, shape) {
  const W = n, H = n; const cell = Array.from({ length: W * H }, () => ({ n: 1, e: 1, s: 1, w: 1, v: 0 }));
  const inside = (x, y) => { if (shape !== 'circle') return true; const cx = (W - 1) / 2, cy = (H - 1) / 2; return ((x - cx) ** 2 + (y - cy) ** 2) <= (W / 2) ** 2; };
  const st = [[Math.floor(W / 2), 0]]; cell[Math.floor(W / 2)].v = 1;
  while (st.length) {
    const [x, y] = st[st.length - 1];
    const nb = [[0, -1, 'n', 's'], [1, 0, 'e', 'w'], [0, 1, 's', 'n'], [-1, 0, 'w', 'e']].filter(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && inside(nx, ny) && !cell[ny * W + nx].v; });
    if (!nb.length) { st.pop(); continue; }
    const [dx, dy, a, b] = nb[Math.floor(Math.random() * nb.length)];
    cell[y * W + x][a] = 0; const nc = cell[(y + dy) * W + x + dx]; nc[b] = 0; nc.v = 1; st.push([x + dx, y + dy]);
  }
  // entrance top middle, exit bottom middle (or lowest inside cell for round)
  const sx = Math.floor(W / 2); let ex = Math.floor(W / 2), ey = H - 1; while (!cell[ey * W + ex].v) ey--;
  cell[sx].n = 0; cell[ey * W + ex].s = 0;
  // solve (BFS)
  const prev = new Map(); const q = [sx]; prev.set(sx, -1);
  while (q.length) { const i = q.shift(); const x = i % W, y = Math.floor(i / W); const c = cell[i];
    [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']].forEach(([dx, dy, d]) => { const nx = x + dx, ny = y + dy; if (c[d] || nx < 0 || ny < 0 || nx >= W || ny >= H) return; const j = ny * W + nx; if (!prev.has(j) && cell[j].v) { prev.set(j, i); q.push(j); } }); }
  const path = []; for (let i = ey * W + ex; i !== -1 && i !== undefined; i = prev.get(i)) path.push(i);
  const draw = (sol) => {
    const px = Math.max(20, Math.floor(2400 / n)); const pad = px; const cv = document.createElement('canvas');
    cv.width = W * px + pad * 2; cv.height = H * px + pad * 2; const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (sol) { ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = px * 0.35; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      path.forEach((i, k) => { const x = pad + (i % W + .5) * px, y = pad + (Math.floor(i / W) + .5) * px; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); }
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(3, px * 0.12); ctx.lineCap = 'square'; ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = cell[y * W + x]; if (!c.v) continue; const X = pad + x * px, Y = pad + y * px;
      if (c.n) { ctx.moveTo(X, Y); ctx.lineTo(X + px, Y); } if (c.s) { ctx.moveTo(X, Y + px); ctx.lineTo(X + px, Y + px); }
      if (c.w) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + px); } if (c.e) { ctx.moveTo(X + px, Y); ctx.lineTo(X + px, Y + px); } }
    ctx.stroke();
    return cv.toDataURL('image/png');
  };
  return { puz: draw(false), sol: draw(true) };
}

/* ---------- Puzzle HTML ---------- */
function setPuzzleSize(el, inches) {
  el.dataset.size = inches; el.style.width = inches + 'in';
  const grid = $('.pz-grid', el); if (!grid) return;
  const n = +grid.dataset.n; const cellIn = inches / n;
  grid.style.fontSize = (cellIn * 72 * (el.dataset.kind === 'sudoku' ? 0.55 : 0.6)).toFixed(1) + 'pt';
}
function sudokuHTML(puz, sol, sizeIn, showSol, label) {
  const cells = puz.map((v, i) => { const r = Math.floor(i / 9), c = i % 9; const cls = [r % 3 === 0 && r ? 'bt' : '', c % 3 === 0 && c ? 'bl' : '', v ? 'given' : (showSol ? 'fill' : '')].join(' ').trim();
    return `<div class="${cls}">${v || (showSol ? sol[i] : '')}</div>`; }).join('');
  const el = document.createElement('div'); el.className = 'puzzle'; el.contentEditable = 'false'; el.dataset.kind = 'sudoku';
  el.dataset.puz = puz.join(''); el.dataset.sol = sol.join(''); if (label) el.dataset.label = label;
  el.innerHTML = `<div class="pz-grid pz-sudoku" data-n="9" style="grid-template-columns:repeat(9,1fr)">${cells}</div>${showSol && label ? `<div class="pz-caption">${esc(label)}</div>` : ''}`;
  setPuzzleSize(el, sizeIn); return el.outerHTML;
}
function wordsearchHTML(ws, words, sizeIn, showSol, label) {
  const hits = new Set(showSol ? ws.placed.flatMap(p => p.cells) : []);
  const el = document.createElement('div'); el.className = 'puzzle'; el.contentEditable = 'false'; el.dataset.kind = 'wordsearch';
  el.dataset.grid = ws.grid.join(''); el.dataset.n = ws.size; el.dataset.cells = JSON.stringify(ws.placed.map(p => p.cells)); if (label) el.dataset.label = label;
  el.dataset.words = JSON.stringify(ws.placed.map(p => p.w));
  el.innerHTML = `<div class="pz-grid pz-ws" data-n="${ws.size}" style="grid-template-columns:repeat(${ws.size},1fr);border-width:1.5px">${ws.grid.map((ch, i) => `<div class="${hits.has(i) ? 'hit' : ''}" style="border:0">${ch}</div>`).join('')}</div>` +
    (showSol ? (label ? `<div class="pz-caption">${esc(label)}</div>` : '') : `<div class="pz-words">${ws.placed.map(p => `<span>${p.w}</span>`).sort().join('')}</div>`);
  setPuzzleSize(el, sizeIn); return el.outerHTML;
}
function mazeHTML(src, sol, sizeIn, showSol, label) {
  return `<div class="puzzle" contenteditable="false" data-kind="maze" data-size="${sizeIn}" ${label ? `data-label="${esc(label)}"` : ''} style="width:${sizeIn}in"><img src="${showSol ? sol : src}" alt="Maze" style="width:100%;margin:0">${showSol && label ? `<div class="pz-caption">${esc(label)}</div>` : ''}</div>`;
}

const SAMPLE_LISTS = `Garden
TULIP
DAISY
ROSE
SEEDS
SPADE
HOSE
COMPOST
ORCHID
FERN
LILAC
SHOVEL
BLOSSOM

Ocean Life
WHALE
DOLPHIN
OCTOPUS
CORAL
SHARK
SEAHORSE
STARFISH
CRAB
JELLYFISH
TURTLE
SQUID
LOBSTER`;

function contentWidthIn() { const { w } = trimWH(); return w - S.margins.inside - S.margins.outside; }
function contentHeightIn() { const { h } = trimWH(); return h - S.margins.top - S.margins.bottom; }

function wirePuzzles() {
  let kind = 'sudoku';
  $('#wsLists').value = SAMPLE_LISTS;
  $$('#pzKind button').forEach(b => b.onclick = () => {
    kind = b.dataset.k; $$('#pzKind button').forEach(x => x.classList.toggle('on', x === b));
    ['sudoku', 'wordsearch', 'maze'].forEach(k => $('#pzOpts-' + k).hidden = k !== kind);
    if (kind === 'wordsearch') $('#pzCount').value = $('#wsLists').value.trim().split(/\n\s*\n/).length;
  });
  $('#insPuzzle').onclick = () => openDlg('#dlgPuzzle');
  $('#insPuzzle').addEventListener('click', () => fillThemeSelects($('#pzGenTheme'), $('#pzGenSub'), lastGenTheme.theme, lastGenTheme.sub));
  $('#pzGenTheme').onchange = () => fillThemeSelects($('#pzGenTheme'), $('#pzGenSub'), $('#pzGenTheme').value, '');
  $('#pzGenThemeEdit').onclick = () => openThemeEditor(() => fillThemeSelects($('#pzGenTheme'), $('#pzGenSub'), $('#pzGenTheme').value, $('#pzGenSub').value));
  wireThemes();
  $('#pzGo').onclick = async () => {
    closeDlg('#dlgPuzzle');
    lastGenTheme = { theme: $('#pzGenTheme').value, sub: $('#pzGenSub').value };
    await generatePuzzles(kind, {
      theme: lastGenTheme.theme, sub: lastGenTheme.sub,
      count: clamp(+$('#pzCount').value || 1, 1, 500), perPage: +$('#pzPerPage').value, answers: $('#pzAnswers').checked, newPages: $('#pzNewPages').checked,
      diff: $('#sdDiff').value, wsSize: +$('#wsSize').value, wsDir: $('#wsDir').value, lists: $('#wsLists').value, mzSize: +$('#mzSize').value, mzShape: $('#mzShape').value
    });
  };
}

async function generatePuzzles(kind, o) {
  snapshot('generate puzzles'); syncPagesFromDom();
  const cw = contentWidthIn(), ch = contentHeightIn();
  const per = o.perPage;
  // Puzzle size: fit width, and leave room for heading + word list
  const size = per === 1 ? Math.min(cw, ch * (kind === 'wordsearch' ? 0.66 : 0.82)) : per === 2 ? Math.min(cw * 0.8, ch / 2 - 0.9) : Math.min(cw / 2 - 0.2, ch / 2 - 0.8);
  const lists = kind === 'wordsearch' ? o.lists.trim().split(/\n\s*\n/).map(b => { const ls = b.trim().split(/\n/).map(s => s.trim()).filter(Boolean); return { title: ls[0], words: ls.slice(1) }; }).filter(l => l.words.length) : [];
  const count = kind === 'wordsearch' ? Math.min(o.count, Math.max(lists.length, 1) * 50) : o.count;
  if (kind === 'wordsearch' && !lists.length) { toast('Add at least one word list'); return; }
  const blocks = [], answers = [];
  const theme = o.theme ? { theme: o.theme, sub: o.sub || '' } : null;
  for (let k = 0; k < count; k++) {
    busy(`Generating ${kind === 'wordsearch' ? 'word search' : kind} ${k + 1} of ${count}`, k / count); await nextFrame();
    const num = ++S.counters[kind];
    if (kind === 'sudoku') {
      const { puz, sol } = makeSudoku(o.diff); const d = o.diff[0].toUpperCase() + o.diff.slice(1);
      blocks.push(`<h2 class="center">Sudoku #${num} · ${d}</h2>` + sudokuHTML(puz, sol, size, false));
      answers.push(sudokuHTML(puz, sol, 2.1, true, `Sudoku #${num}`));
    } else if (kind === 'wordsearch') {
      const L = lists[k % lists.length]; const ws = makeWordSearch(L.words, o.wsSize, o.wsDir);
      blocks.push(`<h2 class="center">${esc(L.title)}</h2>` + wordsearchHTML(ws, L.words, size, false));
      answers.push(wordsearchHTML(ws, L.words, Math.max(2.1, o.wsSize * 0.165), true, `Word search #${num}: ${L.title}`));
      if (ws.failed.length) toast(`Could not fit: ${ws.failed.join(', ')}. Try a bigger grid.`, 5000);
    } else {
      const m = makeMaze(o.mzSize, o.mzShape);
      blocks.push(`<h2 class="center">Maze #${num}</h2>` + mazeHTML(m.puz, m.sol, size, false));
      answers.push(mazeHTML(m.puz, m.sol, 2.1, true, `Maze #${num}`));
    }
    // The puzzle and its solution share an id, so a theme set later reaches both.
    const pid = uid(); const tag = h => tagPuzzleHTML(h, pid, theme);
    blocks[blocks.length - 1] = tag(blocks[blocks.length - 1]); answers[answers.length - 1] = tag(answers[answers.length - 1]);
  }
  busy(false);
  if (o.newPages) {
    const pagesNew = []; for (let i = 0; i < blocks.length; i += per) pagesNew.push({ id: uid(), html: blocks.slice(i, i + per).join(per > 2 ? '' : '<p><br></p>'), noFlow: true });
    if (per === 4) pagesNew.forEach(p => p.html = `<div class="answers-wrap" style="text-align:center">${p.html}</div>`);
    S.pages.splice(curPage + 1, 0, ...pagesNew);
    curPage = curPage + 1;
  } else {
    S.pages[curPage].html += blocks.join('');
  }
  if (o.answers) addAnswers(answers);
  renderPages(); refreshAll(); markDirty();
  setTimeout(() => { setActivePage(curPage, true); reflowAnswers(); }, 60);
  toast(`Added ${count} puzzle${count > 1 ? 's' : ''}${o.answers ? ' and their solutions' : ''}`);
}

function addAnswers(list) {
  let idx = S.pages.findIndex(p => p.answers);
  if (idx < 0) { S.pages.push({ id: uid(), html: '<h1 class="center">Solutions</h1><div class="answers-wrap" style="text-align:center"></div>', answers: true, flow: 'answers' }); idx = S.pages.length - 1; }
  // append to the last answers page; reflow will spread them
  const last = S.pages.map((p, i) => p.answers ? i : -1).filter(i => i >= 0).pop();
  const d = document.createElement('div'); d.innerHTML = S.pages[last].html;
  let wrap = d.querySelector('.answers-wrap'); if (!wrap) { wrap = document.createElement('div'); wrap.className = 'answers-wrap'; wrap.style.textAlign = 'center'; d.appendChild(wrap); }
  wrap.insertAdjacentHTML('beforeend', list.join(''));
  S.pages[last].html = d.innerHTML;
}
// Answer pages hold one wrapper of many small grids: split the wrapper across pages when it overflows.
function reflowAnswers() {
  let changed = false;
  for (let guard = 0; guard < 500; guard++) {
    const pgs = $$('#pages .page'); let moved = false;
    for (let i = 0; i < S.pages.length; i++) {
      if (!S.pages[i].answers) continue;
      const c = $('.content', pgs[i]); const wrap = $('.answers-wrap', c); if (!wrap || !isOverflow(c)) continue;
      const out = [];
      while (isOverflow(c) && wrap.children.length > 1) { out.unshift(wrap.lastElementChild.outerHTML); wrap.lastElementChild.remove(); }
      if (!out.length) continue;
      S.pages[i].html = c.innerHTML;
      let nx = S.pages[i + 1];
      if (!nx || !nx.answers) { nx = { id: uid(), html: '<div class="answers-wrap" style="text-align:center"></div>', answers: true, flow: 'answers' }; S.pages.splice(i + 1, 0, nx); }
      const d = document.createElement('div'); d.innerHTML = nx.html; let w2 = d.querySelector('.answers-wrap');
      if (!w2) { w2 = document.createElement('div'); w2.className = 'answers-wrap'; w2.style.textAlign = 'center'; d.appendChild(w2); }
      w2.insertAdjacentHTML('afterbegin', out.join('')); nx.html = d.innerHTML;
      moved = changed = true; break;
    }
    if (!moved) break;
    renderPages();
  }
  if (changed) { refreshAll(); markDirty(); }
}

function regeneratePuzzle(el) {
  const k = el.dataset.kind; const size = parseFloat(el.dataset.size || 5);
  let html;
  if (k === 'sudoku') { const filled = (el.dataset.puz || '').replace(/0/g, '').length; const diff = filled >= 36 ? 'easy' : filled >= 30 ? 'medium' : filled >= 26 ? 'hard' : 'expert'; const { puz, sol } = makeSudoku(diff); html = sudokuHTML(puz, sol, size, false); }
  else if (k === 'wordsearch') { const words = JSON.parse(el.dataset.words || '[]'); const ws = makeWordSearch(words, +el.dataset.n || 15, 'medium'); html = wordsearchHTML(ws, words, size, false); }
  else { const m = makeMaze(18, 'square'); html = mazeHTML(m.puz, m.sol, size, false); }
  const t = document.createElement('div'); t.innerHTML = html; const nu = t.firstElementChild;
  ['pzTheme', 'pzSub'].forEach(k => { if (el.dataset[k]) nu.dataset[k] = el.dataset[k]; }); // keeps its theme (its old solution no longer matches, so no shared id)
  el.replaceWith(nu);
  selPuzzle = null; showSelTools(); afterEdit();
  toast('New puzzle made. Its old solution in the answer key no longer matches; delete it there.', 5000);
}

/* ---------- Puzzle themes ----------
   A puzzle's theme and subcategory are data-pz-theme / data-pz-sub on the
   puzzle (or, for a Grid book page, its .grid-room), so they are saved and
   synced with the page. A generated puzzle and its solution share data-pz-id,
   so changing one changes both. The list is S.puzzleThemes (core.js). */
let lastGenTheme = { theme: '', sub: '' };
// Every generated puzzle's HTML starts with <div class="puzzle" (sudokuHTML,
// wordsearchHTML, mazeHTML), so the attributes go in there, escaped.
function tagPuzzleHTML(html, pid, theme) {
  const at = ` data-pz-id="${esc(pid)}"` + (theme ? ` data-pz-theme="${esc(theme.theme)}"` + (theme.sub ? ` data-pz-sub="${esc(theme.sub)}"` : '') : '');
  return html.replace(/<div class="puzzle"/, m => m + at);
}
function setPuzzleTheme(el, theme, sub) {
  if (theme) el.dataset.pzTheme = theme; else delete el.dataset.pzTheme;
  if (theme && sub) el.dataset.pzSub = sub; else delete el.dataset.pzSub;
}
// Fill a theme select and its subcategory select. A value that is no longer in
// the list (renamed, removed, or from another book) still shows, marked so.
function fillThemeSelects(selT, selS, theme, sub) {
  const list = puzzleThemes();
  const known = list.find(t => t.name === theme);
  selT.innerHTML = '<option value="">No theme</option>' + list.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('') +
    (theme && !known ? `<option value="${esc(theme)}">${esc(theme)} (not in your list)</option>` : '');
  selT.value = theme || '';
  const subs = known ? known.subs : [];
  selS.innerHTML = `<option value="">${theme ? 'Any ' + esc(theme.toLowerCase()) : 'Pick a theme first'}</option>` + subs.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('') +
    (theme && sub && !subs.includes(sub) ? `<option value="${esc(sub)}">${esc(sub)} (not in your list)</option>` : '');
  selS.value = theme ? (sub || '') : '';
  selS.disabled = !theme;
}
function showThemeTools() {
  const el = selPuzzle; $('#pzThemeTools').hidden = !el; if (!el) return;
  fillThemeSelects($('#pzTheme'), $('#pzSub'), el.dataset.pzTheme || '', el.dataset.pzSub || '');
}
// Puzzles that change with this one: its solution (same id), anywhere in the book.
function puzzleTwins(el) {
  const id = el.dataset.pzId; if (!id) return [el];
  return $$('#pages .puzzle').filter(p => p === el || p.dataset.pzId === id);
}
function applyThemeTo(els, theme, sub) {
  const set = new Set(); els.forEach(e => puzzleTwins(e).forEach(x => set.add(x)));
  set.forEach(x => setPuzzleTheme(x, theme, sub));
  syncPagesFromDom(); markDirty(); // twins can be on other pages
  if (selPuzzle) selPuzzle.classList.add('sel');
}
function wireThemes() {
  $('#pzTheme').onchange = () => { const el = selPuzzle; if (!el) return; fillThemeSelects($('#pzTheme'), $('#pzSub'), $('#pzTheme').value, ''); applyThemeTo([el], $('#pzTheme').value, ''); };
  $('#pzSub').onchange = () => { const el = selPuzzle; if (!el) return; applyThemeTo([el], $('#pzTheme').value, $('#pzSub').value); };
  $('#pzThemePage').onclick = () => {
    const el = selPuzzle; if (!el) return; const pg = el.closest('.page'); if (!pg) return;
    const all = $$('.content .puzzle, .content .grid-room', pg);
    const th = el.dataset.pzTheme || '', sb = el.dataset.pzSub || '';
    applyThemeTo(all, th, sb);
    toast(th ? `${all.length} puzzle${all.length === 1 ? ' is' : 's are'} now ${th}${sb ? ' › ' + sb : ''}` : `Took the theme off ${all.length} puzzle${all.length === 1 ? '' : 's'}`);
  };
  $('#pzThemeEdit').onclick = () => openThemeEditor(showThemeTools);
  $('#thAdd').onclick = () => { const r = themeRow({ name: '', subs: [] }); $('#thList').appendChild(r); $('input', r).focus(); };
  $('#thReset').onclick = () => { $('#thList').innerHTML = ''; DEFAULT_PUZZLE_THEMES.forEach(t => $('#thList').appendChild(themeRow(t))); };
  $('#thList').addEventListener('click', e => { const b = e.target.closest('.th-del'); if (b) b.closest('.th-row').remove(); });
  $('#thSave').onclick = saveThemeEditor;
}
let themeEditorDone = null;
function themeRow(t) {
  const r = document.createElement('div'); r.className = 'th-row'; r.dataset.orig = t.name || '';
  r.innerHTML = `<label class="lab">Theme <input type="text" class="th-name" maxlength="60" value="${esc(t.name)}" placeholder="Theme name"></label>` +
    `<label class="lab th-subs">Subcategories <input type="text" class="th-sub" value="${esc(t.subs.join(', '))}" placeholder="Separate with commas"></label>` +
    `<button class="btn danger th-del" type="button" aria-label="Remove ${esc(t.name || 'this theme')}">Remove</button>`;
  return r;
}
function openThemeEditor(done) {
  themeEditorDone = done || null;
  const box = $('#thList'); box.innerHTML = '';
  puzzleThemes().forEach(t => box.appendChild(themeRow(t)));
  openDlg('#dlgThemes');
}
function saveThemeEditor() {
  const rows = $$('#thList .th-row');
  const list = cloneThemes(rows.map(r => ({ name: $('.th-name', r).value, subs: $('.th-sub', r).value.split(/[,\n]/) })));
  if (!list.length) { toast('Keep at least one theme, or press Use the default list'); return; }
  // A renamed theme is renamed on every puzzle in the book.
  const renames = new Map();
  rows.forEach(r => { const o = r.dataset.orig, n = $('.th-name', r).value.trim(); if (o && n && o !== n) renames.set(o, n); });
  snapshot('edit themes');
  S.puzzleThemes = list; themeSeed = list;
  if (renames.size) {
    // Every page is on screen in #pages, so rename there and save the pages.
    let n = 0;
    $$('#pages [data-pz-theme]').forEach(el => { const to = renames.get(el.dataset.pzTheme); if (to) { el.dataset.pzTheme = to; n++; } });
    if (n) { syncPagesFromDom(); if (selPuzzle) selPuzzle.classList.add('sel'); }
  }
  closeDlg('#dlgThemes'); markDirty();
  toast(`Saved ${list.length} theme${list.length === 1 ? '' : 's'}`);
  if (themeEditorDone) themeEditorDone();
}
