// Mouse and touch for the line games (def.kind 'edges': Loop Line, Island
// Bridges). The board is one surface: where the pointer lands is worked out
// from the game's own geometry (def.hit), so thin lines are as easy to hit as
// cells. A tap marks one edge with the pen (def.nextValue). A drag from dot to
// dot draws every edge it passes (def.dragDraws), or, for games that join
// nodes, a drag from one node to another marks the edge between them once.
//
//   def.hit(p, fx, fy)  -> { edge, node, near }  fx, fy: 0..1 across the board
//   def.path(p, a, b)   -> edges between two nodes, or null
//   def.nextValue(p, i, value, pen) -> the value after one tap
export function edgePointer(board, k) {
  let s = null;
  const rel = (e) => {
    const r = board.getBoundingClientRect();
    return [(e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height)];
  };
  board.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !k.ready()) return;
    const h = k.def.hit(k.p(), ...rel(e));
    if (h.edge < 0 && h.node < 0) return;
    e.preventDefault();
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    s = { id: e.pointerId, start: h, node: k.def.dragDraws ? h.near : h.node, moved: false, changes: [], done: new Set(), value: null, target: -1 };
  });
  board.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const p = k.p();
    const h = k.def.hit(p, ...rel(e));
    if (h.node < 0 || h.node === s.node || s.node < 0) return;
    const path = k.def.path(p, s.node, h.node);
    if (!path || !path.length) return;
    s.moved = true;
    s.node = h.node;
    if (!k.def.dragDraws) { s.target = path[0]; return; }
    for (const i of path) {
      if (s.done.has(i)) continue;
      s.done.add(i);
      // The first edge sets what the whole drag does: draw, cross or clear.
      if (s.value === null) s.value = k.def.nextValue(p, i, k.value(i), k.pen());
      if (k.value(i) !== s.value) s.changes.push({ i, from: k.value(i), to: s.value });
    }
    k.preview(s.changes.filter((ch) => k.value(ch.i) !== ch.to));
  });
  const end = (e) => {
    if (!s || (e && e.pointerId !== undefined && e.pointerId !== s.id)) return;
    const t = s;
    s = null;
    if (!k.ready()) { k.cancel(t.changes); return; }
    if (k.def.dragDraws && t.moved) { if (t.changes.length) k.commit(t.changes); return; }
    if (!k.def.dragDraws && t.moved && t.target >= 0) { k.tap(t.target); return; }
    if (t.start.edge >= 0) k.tap(t.start.edge);
  };
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', (e) => { if (s && e.pointerId === s.id) { k.cancel(s.changes); s = null; } });
  board.addEventListener('lostpointercapture', (e) => { if (s && e.pointerId === s.id) end(e); });
}
