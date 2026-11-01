// The interactive staircase grid: rendering, roving focus, keyboard, pointer
// and the long-press / right-click cell menu. A small red "?" in a cell's top
// right corner is the player's own reminder ("come back to this"): tap the
// corner of an empty cell, press Q, or choose it in the cell menu (the ? key
// itself opens the list of keys). It
// never counts as a mark and only empty cells can have one. Game rules live in app.js; this
// module only reports what the player asked for through the handlers.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SVG_X = (auto) => `<svg class="mk-x${auto ? ' auto' : ''}" viewBox="0 0 26 26" aria-hidden="true"><line x1="${auto ? 9 : 6}" y1="${auto ? 9 : 6}" x2="${auto ? 17 : 20}" y2="${auto ? 17 : 20}"/><line x1="${auto ? 17 : 20}" y1="${auto ? 9 : 6}" x2="${auto ? 9 : 6}" y2="${auto ? 17 : 20}"/></svg>`;
const SVG_O = '<svg class="mk-o" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="9"/></svg>';

export const STATE_WORDS = { O: 'confirmed', X: 'ruled out', A: 'ruled out, automatic', '': 'empty' };

// Puzzle helpers shared by the app.
export function puzzleIndex(puzzle) {
  const cats = puzzle.categories;
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  const catIdx = Object.fromEntries(cats.map((c, i) => [c.id, i]));
  const label = (id) => { const [c, i] = id.split(':'); return byId[c].items[+i].label; };
  const key = (a, b) => (catIdx[a.split(':')[0]] < catIdx[b.split(':')[0]] ? `${a}|${b}` : `${b}|${a}`);
  const N = cats[0].items.length;
  return { cats, byId, catIdx, label, key, N, K: cats.length };
}

export function createGrid(frame, puzzle, ix, handlers) {
  const { byId, N, label, key } = ix;
  const cols = puzzle.grid.columns.map((id) => byId[id]);
  const rows = puzzle.grid.rows.map((id) => byId[id]);

  // ---- markup ----
  let h = `<table class="lg" role="grid" aria-label="Logic grid. ${rows.length * N} rows. Arrow keys move, X rules out, O confirms." aria-rowcount="${rows.length * N + 2}">`;
  h += `<thead><tr role="row"><th class="corner" colspan="2" aria-hidden="true"></th>${cols.map((c) => `<th class="cath" colspan="${N}" scope="colgroup"><span>${esc(c.name)}</span></th>`).join('')}</tr>`;
  h += `<tr role="row"><th class="corner" colspan="2" aria-hidden="true"></th>${cols.map((c) => c.items.map((it, j) => `<th class="colh${j === N - 1 ? ' lastcol' : ''}" scope="col" role="columnheader" data-id="${it.id}" title="${esc(it.label)}"><div>${esc(it.label)}</div></th>`).join('')).join('')}</tr></thead><tbody>`;
  const matrix = [];
  rows.forEach((rc, ri) => {
    const nBlocks = cols.length - ri;
    rc.items.forEach((it, i) => {
      const r = ri * N + i;
      matrix[r] = [];
      h += `<tr role="row">${i === 0 ? `<th class="rcat" rowspan="${N}" scope="rowgroup">${esc(rc.name)}</th>` : ''}<th class="rowh${i === N - 1 ? ' lastrow' : ''}" scope="row" role="rowheader" data-id="${it.id}" title="${esc(it.label)}">${esc(it.label)}</th>`;
      for (let b = 0; b < cols.length; b++) {
        if (b >= nBlocks) { h += `<td class="gap" colspan="${N}" aria-hidden="true"></td>`; continue; }
        cols[b].items.forEach((ct, j) => {
          const c = b * N + j;
          matrix[r][c] = key(it.id, ct.id);
          const cls = ['c', j === N - 1 ? 'bR' : '', i === N - 1 ? 'bB' : ''].filter(Boolean).join(' ');
          h += `<td class="${cls}" role="gridcell" tabindex="-1" data-k="${matrix[r][c]}" data-r="${r}" data-c="${c}" data-row="${it.id}" data-col="${ct.id}"></td>`;
        });
      }
      h += '</tr>';
    });
  });
  frame.innerHTML = h + '</tbody></table>';
  const table = frame.querySelector('table');
  const cells = new Map([...table.querySelectorAll('td.c')].map((td) => [td.dataset.k, td]));
  const totalCols = cols.length * N;
  // Sticky offsets for the pinned headers.
  function pin() {
    const cath = table.querySelector('th.cath');
    const rcat = table.querySelector('th.rcat');
    if (cath) table.style.setProperty('--cath-h', `${cath.offsetHeight}px`);
    if (rcat) table.style.setProperty('--rcat-w', `${rcat.offsetWidth}px`);
  }
  // Phones and narrow windows: the whole grid fits the frame's width, so it
  // never scrolls sideways. Names get tighter and the squares smaller, only
  // as much as needed (bigger screens keep the full 44 px squares).
  // The room is measured with the full-size grid in place: on a PC or tablet
  // the grid's column is as wide as the grid, so measuring the shrunk grid
  // would shrink it again on every resize, down to the smallest squares.
  let fitted = { avail: -1, cell: 0, rowh: 0 };
  const setFit = (cell, rowh) => {
    table.classList.toggle('fit', !!cell);
    if (cell) { table.style.setProperty('--cell', `${cell}px`); table.style.setProperty('--rowh-w', `${rowh}px`); }
  };
  function fit() {
    if (!frame.clientWidth || !table.isConnected) return;
    setFit(0);
    for (const n of ['--cell', '--rowh-w']) table.style.removeProperty(n);
    const avail = frame.clientWidth;
    if (avail === fitted.avail) { setFit(fitted.cell, fitted.rowh); pin(); return; }
    let cell = 0, rowh = 0;
    if (table.scrollWidth > avail) {
      // Item names get at most about a fifth of the width (cut short with
      // "…"; the full name is in the tooltip and read out), the squares the rest.
      rowh = Math.min(table.querySelector('th.rowh').offsetWidth, Math.max(52, Math.round(avail * 0.22)));
      setFit(44, rowh);
      const head = table.querySelector('th.rcat').offsetWidth + table.querySelector('th.rowh').offsetWidth;
      cell = Math.min(44, Math.floor((avail - head - cols.length * 2) / totalCols));
      for (let tries = 0; tries < 40; tries++) {
        cell = Math.max(12, cell);
        setFit(cell, rowh);
        if (table.scrollWidth <= avail || cell <= 12) break;
        cell--;
      }
    }
    fitted = { avail, cell, rowh };
    frame.dataset.small = cell && cell < 24 ? 'true' : 'false';
    pin();
  }
  requestAnimationFrame(fit);
  if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fit)).observe(frame);

  let focused = null;
  const at = (r, c) => (matrix[r] && matrix[r][c] ? cells.get(matrix[r][c]) : null);

  function nameOf(td, state, extra = '') {
    return `${label(td.dataset.row)}, ${label(td.dataset.col)}, ${STATE_WORDS[state || '']}${extra}`;
  }

  function paint(k, state, flags = {}) {
    const td = cells.get(k);
    if (!td) return;
    const query = !!flags.query && !state;
    td.innerHTML = (state === 'O' ? SVG_O : state === 'X' || state === 'A' ? SVG_X(state === 'A') : '') + (flags.wrong ? '<span class="warn-ico" aria-hidden="true">⚠</span>' : '')
      + (query ? '<span class="q-mark" aria-hidden="true">?</span>' : '');
    td.classList.toggle('m-q', query);
    td.classList.toggle('m-x', state === 'X' || state === 'A');
    td.classList.toggle('m-o', state === 'O');
    td.classList.toggle('auto', state === 'A');
    td.classList.toggle('wrong', !!flags.wrong);
    td.classList.toggle('target', !!flags.target);
    td.setAttribute('aria-label', nameOf(td, state, (query ? ', marked with a question mark' : '') + (flags.wrong ? ', conflicts with the solution' : '') + (flags.target ? ', hint: look here' : '')));
  }

  function crosshair(td) {
    table.querySelectorAll('.cross, th.hl').forEach((el) => el.classList.remove('cross', 'hl'));
    if (!td) return;
    const r = +td.dataset.r, c = +td.dataset.c;
    for (let cc = 0; cc < totalCols; cc++) { const x = at(r, cc); if (x && x !== td) x.classList.add('cross'); }
    for (let rr = 0; rr < matrix.length; rr++) { const x = at(rr, c); if (x && x !== td) x.classList.add('cross'); }
    table.querySelector(`th.rowh[data-id="${td.dataset.row}"]`)?.classList.add('hl');
    table.querySelector(`th.colh[data-id="${td.dataset.col}"]`)?.classList.add('hl');
  }

  function focusCell(td, { scroll = true } = {}) {
    if (!td) return;
    if (focused && focused !== td) focused.tabIndex = -1;
    focused = td;
    td.tabIndex = 0;
    td.focus({ preventScroll: !scroll });
    crosshair(td);
    handlers.onFocus?.(td.dataset.k);
  }

  function setRoving(k) {
    const td = cells.get(k) || at(0, 0);
    if (focused) focused.tabIndex = -1;
    focused = td;
    td.tabIndex = 0;
  }
  setRoving(null);

  // ---- keyboard ----
  table.addEventListener('keydown', (e) => {
    const td = e.target.closest('td.c');
    if (!td) return;
    const r = +td.dataset.r, c = +td.dataset.c;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    let next = null;
    if (k === 'ArrowRight') next = scan(r, c, 0, 1);
    else if (k === 'ArrowLeft') next = scan(r, c, 0, -1);
    else if (k === 'ArrowDown') next = scan(r, c, 1, 0);
    else if (k === 'ArrowUp') next = scan(r, c, -1, 0);
    else if (k === 'Home' && mod) next = at(0, 0);
    else if (k === 'End' && mod) next = lastCell();
    else if (k === 'Home') next = at(r, 0);
    else if (k === 'End') next = at(r, matrix[r].length - 1);
    if (next !== null) { e.preventDefault(); if (next) focusCell(next); return; }
    if (mod || e.altKey) return;
    const lower = k.toLowerCase();
    if (lower === 'x' || k === ' ') { e.preventDefault(); handlers.onMark(td.dataset.k, 'X', 'key'); }
    else if (lower === 'o' || k === 'Enter') { e.preventDefault(); handlers.onMark(td.dataset.k, 'O', 'key'); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); handlers.onMark(td.dataset.k, '', 'key'); }
    else if (lower === 'r') { e.preventDefault(); handlers.onDescribeRow(td.dataset.row); }
    else if (lower === 'q') { e.preventDefault(); handlers.onQuery?.(td.dataset.k); }
    else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) { e.preventDefault(); const b = td.getBoundingClientRect(); openMenu(td, b.left + b.width / 2, b.bottom); }
  });

  function scan(r, c, dr, dc) {
    for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < matrix.length && cc >= 0 && cc < totalCols; rr += dr, cc += dc) {
      const x = at(rr, cc);
      if (x) return x;
      if (dc) break; // the staircase never has holes inside a row
    }
    return undefined; // stay put, but still swallow the key
  }
  function lastCell() {
    const r = matrix.length - 1;
    return at(r, matrix[r].length - 1);
  }

  // ---- pointer: tap cycles on release; long-press and right-click open the menu ----
  let press = null;
  let suppressClick = false;
  table.addEventListener('pointerdown', (e) => {
    const td = e.target.closest('td.c');
    if (!td || e.button !== 0) return;
    cancelPress(); // a second finger replaces the first press, so its timer cannot fire later
    const x = e.clientX, y = e.clientY;
    press = { td, x, y, timer: setTimeout(() => { suppressClick = true; press = null; openMenu(td, x, y); }, 550) };
  });
  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  table.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress(); });
  table.addEventListener('pointerup', cancelPress);
  table.addEventListener('pointercancel', cancelPress);
  table.addEventListener('click', (e) => {
    const td = e.target.closest('td.c');
    if (!td) return;
    if (suppressClick) { suppressClick = false; return; }
    focusCell(td, { scroll: false });
    handlers.onCycle(td.dataset.k);
  });
  table.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td.c');
    if (!td) return;
    e.preventDefault();
    cancelPress();
    focusCell(td, { scroll: false });
    openMenu(td, e.clientX, e.clientY);
  });
  table.addEventListener('focusin', (e) => { const td = e.target.closest('td.c'); if (td && td !== focused) focusCell(td, { scroll: false }); else if (td) crosshair(td); });
  table.addEventListener('focusout', (e) => { if (!table.contains(e.relatedTarget)) crosshair(null); });

  // ---- cell menu ----
  const menu = document.getElementById('cellmenu');
  let menuFor = null;
  function openMenu(td, x, y) {
    menuFor = td;
    menu.hidden = false;
    const w = menu.offsetWidth, hgt = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - hgt - 8))}px`;
    menu.querySelector('button').focus();
  }
  function closeMenu(refocus = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (refocus && menuFor) focusCell(menuFor, { scroll: false });
    menuFor = null;
  }
  menu.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || !menuFor) return;
    const k = menuFor.dataset.k;
    closeMenu();
    if (b.dataset.mark === '?') handlers.onQuery?.(k);
    else handlers.onMark(k, b.dataset.mark, 'menu');
  };
  menu.onkeydown = (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i + items.length - 1) % items.length].focus(); }
    else if (e.key === 'Tab') closeMenu(false);
  };
  const outside = (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(false); };
  document.addEventListener('pointerdown', outside);

  return {
    cells,
    paint,
    focusKey(k) { const td = cells.get(k) || at(0, 0); focusCell(td); },
    setRoving,
    focusedKey: () => focused && focused.dataset.k,
    destroy() { document.removeEventListener('pointerdown', outside); closeMenu(false); },
  };
}
