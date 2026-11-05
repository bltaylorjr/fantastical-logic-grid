/* ---------- Cover designer (Fabric.js) ---------- */
let cv = null, cvZoom = 0.5, coverReady = null, lastGeom = null, showCvGuides = true;
const THEMES = {
  navy: { name: 'Midnight', bg: '#1f3a5f', accent: '#f2c14e', text: '#ffffff', title: 'Bebas Neue', body: 'Nunito' },
  sunny: { name: 'Sunshine', bg: '#f6c945', accent: '#1d1d1d', text: '#1d1d1d', title: 'Fredoka', body: 'Nunito' },
  forest: { name: 'Forest', bg: '#244b3a', accent: '#e9d8a6', text: '#fdfbf3', title: 'Playfair Display', body: 'Lora' },
  berry: { name: 'Berry', bg: '#7a1f4b', accent: '#ffd5e5', text: '#ffffff', title: 'Oswald', body: 'Open Sans' },
  sky: { name: 'Sky', bg: '#3fa7d6', accent: '#ffffff', text: '#0f2a3a', title: 'Fredoka', body: 'Nunito' },
  ink: { name: 'Ink & red', bg: '#121212', accent: '#e63946', text: '#ffffff', title: 'Bebas Neue', body: 'Open Sans' }
};
const CV_PROPS = ['role', 'selectable', 'evented'];

async function ensureFonts(fams) { try { await Promise.all([...new Set(fams)].map(f => document.fonts.load(`40px "${f}"`))); } catch (e) { } }

function ensureCover() {
  if (coverReady) return coverReady;
  coverReady = (async () => {
    await loadLib('fabric');
    fabric.Object.prototype.transparentCorners = false;
    fabric.Object.prototype.cornerColor = '#1f5fd6'; fabric.Object.prototype.borderColor = '#1f5fd6'; fabric.Object.prototype.cornerSize = 10;
    cv = new fabric.Canvas('coverCanvas', { preserveObjectStacking: true, backgroundColor: '#ffffff' });
    cv.on('selection:created', cvSelChanged); cv.on('selection:updated', cvSelChanged); cv.on('selection:cleared', cvSelChanged);
    cv.on('object:modified', () => markDirty()); cv.on('text:changed', () => markDirty());
    sizeCoverCanvas();
    if (S.cover) await loadCoverJSON(S.cover, S.coverGeom);
    else await autoDesignCover();
    lastGeom = coverGeom();
    return cv;
  })().catch(e => { coverReady = null; toast(e.message, 6000); throw e; });
  return coverReady;
}
function loadCoverJSON(json, oldGeom) {
  return new Promise(res => {
    const fams = (json.objects || []).filter(o => o.fontFamily).map(o => o.fontFamily);
    ensureFonts(fams).then(() => cv.loadFromJSON(json, () => {
      sizeCoverCanvas();
      if (oldGeom) relayoutCover(oldGeom, coverGeom());
      cv.requestRenderAll(); res();
    }));
  });
}
function sizeCoverCanvas() {
  if (!cv) return; const g = coverGeom();
  cv.setZoom(cvZoom); cv.setDimensions({ width: Math.round(g.W * IN * cvZoom), height: Math.round(g.H * IN * cvZoom) });
  const st = $('#coverStage'); st.style.width = Math.round(g.W * IN * cvZoom) + 'px'; st.style.height = Math.round(g.H * IN * cvZoom) + 'px';
  drawCoverGuides(); updateCoverSpecs();
}
function drawCoverGuides() {
  const g = coverGeom(), z = cvZoom * IN, P = PUBLISHERS[S.pub]; const host = $('#coverGuides'); host.innerHTML = '';
  host.hidden = !showCvGuides;
  const line = (x, y, w, h, color, dash = true) => { const d = document.createElement('div'); d.className = 'g'; Object.assign(d.style, { left: x * z + 'px', top: y * z + 'px', width: w * z + 'px', height: h * z + 'px', border: `1px ${dash ? 'dashed' : 'solid'} ${color}` }); host.appendChild(d); return d; };
  const css = getComputedStyle(document.documentElement);
  const red = css.getPropertyValue('--guide-bleed').trim(), blue = css.getPropertyValue('--guide-safe').trim(), purple = css.getPropertyValue('--guide-spine').trim();
  line(g.b, g.b, g.W - 2 * g.b, g.H - 2 * g.b, red, false);
  line(g.spineX, 0, g.sp, g.H, purple, false);
  const s = P.coverSafe;
  line(g.backX + s, g.b + s, g.w - 2 * s, g.h - 2 * s, blue);
  line(g.frontX + s, g.b + s, g.w - 2 * s, g.h - 2 * s, blue);
  const bc = P.barcode; const bx = g.spineX - bc.from - bc.w, by = g.H - g.b - bc.from - bc.h;
  const bd = line(bx, by, bc.w, bc.h, '#555', false); bd.style.background = 'rgba(255,255,255,.92)';
  const lb = document.createElement('div'); lb.className = 'lbl'; lb.textContent = 'Barcode area'; Object.assign(lb.style, { left: (bx + 0.1) * z + 'px', top: (by + 0.1) * z + 'px' }); host.appendChild(lb);
  const names = $('#cvNames'); names.style.width = g.W * z + 'px';
  names.innerHTML = `<div style="width:${(g.b + g.w) * z}px">Back cover</div><div style="width:${g.sp * z}px" title="Spine">${g.sp * z > 40 ? 'Spine' : ''}</div><div style="width:${(g.b + g.w) * z}px">Front cover</div>`;
}
function updateCoverSpecs() {
  const g = coverGeom(); const P = PUBLISHERS[S.pub];
  $('#cvSpecs').innerHTML = `<dt>Full cover</dt><dd>${g.W.toFixed(3)} × ${g.H.toFixed(3)} in</dd><dt>Trim (each side)</dt><dd>${g.w} × ${g.h} in</dd><dt>Spine</dt><dd>${fmtIn(g.sp)}</dd><dt>Bleed</dt><dd>0.125 in</dd><dt>Pages</dt><dd>${pageCount()}</dd><dt>Spine text</dt><dd>${pageCount() >= P.spineTextMinPages ? 'allowed' : 'needs ' + P.spineTextMinPages + '+ pages'}</dd>`;
}

function regionOf(x, g) { return x < g.spineX ? 'back' : x < g.frontX ? 'spine' : 'front'; }
function regionSpan(r, g) { return r === 'back' ? [0, g.spineX] : r === 'spine' ? [g.spineX, g.frontX] : [g.frontX, g.W]; }
function relayoutCover(o, n) {
  if (!cv) return;
  const O = { ...o, W: o.W * IN, H: o.H * IN, spineX: o.spineX * IN, frontX: o.frontX * IN };
  const N = { ...n, W: n.W * IN, H: n.H * IN, spineX: n.spineX * IN, frontX: n.frontX * IN };
  if (Math.abs(O.W - N.W) < 0.01 && Math.abs(O.H - N.H) < 0.01 && Math.abs(O.spineX - N.spineX) < 0.01) return;
  const sc = n.w / o.w;
  cv.getObjects().forEach(ob => {
    if (ob.role === 'bg') { ob.set({ left: 0, top: 0, width: N.W, height: N.H, scaleX: 1, scaleY: 1 }); ob.setCoords(); return; }
    if (ob.role === 'bgimg') { const s = Math.max(N.W / ob.width, N.H / ob.height); ob.set({ scaleX: s, scaleY: s, left: N.W / 2, top: N.H / 2, originX: 'center', originY: 'center' }); ob.setCoords(); return; }
    const c = ob.getCenterPoint(); const r = regionOf(c.x, O); const [a0, a1] = regionSpan(r, O), [b0, b1] = regionSpan(r, N);
    const fx = (c.x - a0) / Math.max(a1 - a0, 1e-6), fy = c.y / O.H;
    if (Math.abs(sc - 1) > 0.001 && r !== 'spine') ob.set({ scaleX: ob.scaleX * sc, scaleY: ob.scaleY * sc });
    if (r === 'spine' && ob.type === 'textbox') { const maxF = (n.sp * IN) * 0.55; if (ob.fontSize * ob.scaleY > maxF) ob.set({ scaleX: maxF / ob.fontSize, scaleY: maxF / ob.fontSize }); }
    ob.setPositionByOrigin(new fabric.Point(b0 + fx * (b1 - b0), fy * N.H), 'center', 'center'); ob.setCoords();
  });
  cv.requestRenderAll();
}
function onGeometryChanged() {
  if (!cv) { updateStatus(); return; }
  const g = coverGeom(); if (lastGeom) relayoutCover(lastGeom, g); lastGeom = g; sizeCoverCanvas(); updateStatus();
}

function motifGroup(sizePx, t, digits = true) {
  const n = 3, cell = sizePx / n; const items = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const filled = (r + c) % 2 === 0;
    items.push(new fabric.Rect({ left: c * cell, top: r * cell, width: cell, height: cell, fill: filled ? t.accent : 'rgba(255,255,255,0.0)', stroke: t.text, strokeWidth: Math.max(2, sizePx * 0.012) }));
    if (digits) { const d = [5, 3, 7, 6, 1, 9, 8, 2, 4][r * 3 + c]; items.push(new fabric.Text(String(d), { left: c * cell + cell / 2, top: r * cell + cell / 2, originX: 'center', originY: 'center', fontSize: cell * 0.62, fontFamily: 'Courier Prime', fontWeight: 'bold', fill: filled ? t.bg : t.text })); }
  }
  const g = new fabric.Group(items, { originX: 'center', originY: 'center' }); g.role = 'motif'; return g;
}

async function autoDesignCover(themeKey) {
  await loadLib('fabric'); if (!cv) return ensureCover();
  const t = THEMES[themeKey || S.theme] || THEMES.navy; S.theme = themeKey || S.theme;
  const g = coverGeom(); const P = PUBLISHERS[S.pub]; const m = S.meta; const px = v => v * IN;
  await ensureFonts([t.title, t.body, 'Courier Prime']);
  cv.clear(); cv.backgroundColor = '#ffffff';
  const bg = new fabric.Rect({ left: 0, top: 0, width: px(g.W), height: px(g.H), fill: t.bg, selectable: false, evented: false }); bg.role = 'bg'; cv.add(bg);
  const fcx = px(g.frontX + g.w / 2), bcx = px(g.backX + g.w / 2), wpx = px(g.w);
  const title = new fabric.Textbox((m.title || 'Puzzle Book').toUpperCase(), { left: fcx, top: px(g.b + g.h * 0.08), originX: 'center', width: wpx * 0.84, fontSize: wpx * (t.title === 'Bebas Neue' || t.title === 'Oswald' ? 0.15 : 0.11), fontFamily: t.title, fontWeight: t.title === 'Playfair Display' ? 800 : 'normal', fill: t.text, textAlign: 'center', lineHeight: 0.95 }); title.role = 'title';
  cv.add(title);
  // keep the title to roughly the top quarter of the front cover
  for (let k = 0; k < 30 && title.height * title.scaleY > px(g.h) * 0.24; k++) { title.set('fontSize', title.fontSize * 0.92); title.initDimensions(); }
  let bottom = title.top + title.height + px(0.15);
  if (m.subtitle) { const sub = new fabric.Textbox(m.subtitle, { left: fcx, top: bottom, originX: 'center', width: wpx * 0.78, fontSize: wpx * 0.042, fontFamily: t.body, fill: t.text, textAlign: 'center' }); sub.role = 'subtitle'; cv.add(sub); bottom = sub.top + sub.height; }
  const authorTop = px(g.b + g.h * 0.86); const motSize = Math.min(wpx * 0.5, authorTop - bottom - px(0.5));
  if (motSize > px(0.8)) { const mot = motifGroup(motSize, t); mot.set({ left: fcx, top: (bottom + authorTop) / 2 }); cv.add(mot); }
  const au = new fabric.Textbox(m.author || 'Author Name', { left: fcx, top: px(g.b + g.h * 0.86), originX: 'center', width: wpx * 0.8, fontSize: wpx * 0.05, fontFamily: t.body, fontWeight: 'bold', fill: t.accent, textAlign: 'center' }); au.role = 'author'; cv.add(au);
  if (pageCount() >= P.spineTextMinPages) addSpineText(t);
  const blurb = new fabric.Textbox(m.blurb || m.description || 'Describe what makes this puzzle book fun: how many puzzles, the difficulty levels, and who it is for.', { left: bcx, top: px(g.b + 0.9), originX: 'center', width: wpx - px(1.4), fontSize: Math.max(14, wpx * 0.032), fontFamily: t.body, fill: t.text, textAlign: 'left', lineHeight: 1.3 }); blurb.role = 'blurb'; cv.add(blurb);
  const mot2 = motifGroup(wpx * 0.22, t, false); mot2.set({ left: px(g.backX + 0.9 + 0.11 * g.w), top: px(g.H - g.b - 1.25) }); cv.add(mot2);
  cv.requestRenderAll(); lastGeom = coverGeom(); $('#cvBg').value = t.bg; markDirty();
}
function addSpineText(t) {
  t = t || THEMES[S.theme] || THEMES.navy; const g = coverGeom(); const m = S.meta;
  const fs = Math.min(g.sp * IN * 0.5, 30);
  const sp = new fabric.Textbox(`${(m.title || 'Puzzle Book').toUpperCase()}   ${m.author || ''}`.trim(), { width: g.h * IN * 0.8, fontSize: fs, fontFamily: t.title, fill: t.text, textAlign: 'center', angle: 90, originX: 'center', originY: 'center' });
  sp.role = 'spine'; sp.left = (g.spineX + g.sp / 2) * IN; sp.top = (g.b + g.h / 2) * IN; cv.add(sp);
}

function cvSelChanged() {
  const o = cv.getActiveObject(); $('#cvObjTools').hidden = !o; if (!o) return;
  const isText = 'fontFamily' in o && o.type !== 'group';
  ['cvFont', 'cvSize', 'cvBold', 'cvItalic', 'cvAlign'].forEach(id => $('#' + id).disabled = !isText);
  if (isText) { $('#cvFont').value = o.fontFamily; $('#cvSize').value = Math.round(o.fontSize * o.scaleY); $('#cvAlign').value = o.textAlign || 'left'; }
  const fill = typeof o.fill === 'string' && o.fill.startsWith('#') ? o.fill : '#ffffff'; $('#cvColor').value = fill.length === 7 ? fill : '#ffffff';
  $('#cvOpacity').value = Math.round((o.opacity ?? 1) * 100);
}
function cvSet(props) { const o = cv?.getActiveObject(); if (!o) return; o.set(props); o.setCoords(); cv.requestRenderAll(); markDirty(); }

function syncCoverToState() { if (!cv) return; S.cover = cv.toJSON(CV_PROPS); S.coverGeom = coverGeom(); }

function wireCover() {
  $('#cvTheme').innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');
  $('#cvFont').innerHTML = BOOK_FONTS.map(f => `<option>${f}</option>`).join('');
  $('#cvAuto').onclick = async () => { await ensureCover(); await autoDesignCover($('#cvTheme').value); toast('Cover rebuilt from your book details'); };
  $('#cvTheme').onchange = async e => { await ensureCover(); await autoDesignCover(e.target.value); };
  $('#cvText').onclick = async () => { await ensureCover(); const g = coverGeom(); const t = new fabric.Textbox('Double-click to edit', { left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center', width: g.w * IN * 0.7, fontSize: 40, fontFamily: 'Nunito', fill: '#ffffff', textAlign: 'center' }); t.role = 'user'; cv.add(t); cv.setActiveObject(t); cv.requestRenderAll(); markDirty(); };
  $('#cvImage').onclick = async () => { await ensureCover(); pickImage(u => fabric.Image.fromURL(u, img => { const g = coverGeom(); const s = (g.w * IN * 0.6) / img.width; img.set({ scaleX: s, scaleY: s, left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center' }); img.role = 'user'; cv.add(img); cv.setActiveObject(img); cv.requestRenderAll(); markDirty(); })); };
  $('#cvBgImg').onclick = async () => { await ensureCover(); pickImage(u => fabric.Image.fromURL(u, img => { const g = coverGeom(); cv.getObjects().filter(o => o.role === 'bgimg').forEach(o => cv.remove(o)); const s = Math.max(g.W * IN / img.width, g.H * IN / img.height); img.set({ scaleX: s, scaleY: s, left: g.W * IN / 2, top: g.H * IN / 2, originX: 'center', originY: 'center' }); img.role = 'bgimg'; cv.add(img); const bgi = cv.getObjects().findIndex(o => o.role === 'bg'); img.moveTo(bgi + 1); cv.requestRenderAll(); markDirty(); })); };
  $('#cvRect').onclick = async () => { await ensureCover(); const g = coverGeom(); const r = new fabric.Rect({ left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center', width: g.w * IN * 0.6, height: g.w * IN * 0.25, fill: (THEMES[S.theme] || THEMES.navy).accent, rx: 8, ry: 8 }); r.role = 'user'; cv.add(r); cv.setActiveObject(r); cv.requestRenderAll(); markDirty(); };
  $('#cvCircle').onclick = async () => { await ensureCover(); const g = coverGeom(); const r = new fabric.Circle({ left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN, originX: 'center', originY: 'center', radius: g.w * IN * 0.15, fill: (THEMES[S.theme] || THEMES.navy).accent }); r.role = 'user'; cv.add(r); cv.setActiveObject(r); cv.requestRenderAll(); markDirty(); };
  $('#cvGrid').onclick = async () => { await ensureCover(); const g = coverGeom(); const m = motifGroup(g.w * IN * 0.4, THEMES[S.theme] || THEMES.navy); m.set({ left: (g.frontX + g.w / 2) * IN, top: (g.b + g.h / 2) * IN }); cv.add(m); cv.setActiveObject(m); cv.requestRenderAll(); markDirty(); };
  $('#cvBg').oninput = async e => { await ensureCover(); const bg = cv.getObjects().find(o => o.role === 'bg'); if (bg) { bg.set('fill', e.target.value); cv.requestRenderAll(); markDirty(); } };
  $('#cvFwd').onclick = () => { const o = cv?.getActiveObject(); if (o) { o.bringForward(); cv.requestRenderAll(); markDirty(); } };
  $('#cvBack').onclick = () => { const o = cv?.getActiveObject(); if (o) { const bgi = cv.getObjects().findIndex(x => x.role === 'bg' || x.role === 'bgimg'); if (cv.getObjects().indexOf(o) > bgi + 1) o.sendBackwards(); cv.requestRenderAll(); markDirty(); } };
  $('#cvDup').onclick = () => { const o = cv?.getActiveObject(); if (o) o.clone(c => { c.set({ left: o.left + 20, top: o.top + 20 }); c.role = o.role === 'bg' ? 'user' : o.role; cv.add(c); cv.setActiveObject(c); cv.requestRenderAll(); markDirty(); }, CV_PROPS); };
  const del = () => { const o = cv?.getActiveObject(); if (!o || o.isEditing) return; (o.type === 'activeSelection' ? o.getObjects() : [o]).forEach(x => cv.remove(x)); cv.discardActiveObject(); cv.requestRenderAll(); markDirty(); };
  $('#cvDel').onclick = del;
  document.addEventListener('keydown', e => { if ($('#view-cover').hidden) return; if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const o = cv?.getActiveObject(); if (o && !o.isEditing) { e.preventDefault(); del(); } } });
  $('#cvZoom').onchange = e => { cvZoom = +e.target.value; sizeCoverCanvas(); };
  $('#cvGuidesBtn').onclick = () => { showCvGuides = !showCvGuides; $('#cvGuidesBtn').classList.toggle('on', showCvGuides); drawCoverGuides(); };
  $('#cvGuidesBtn').classList.add('on');
  $('#cvFont').onchange = async e => { await ensureFonts([e.target.value]); cvSet({ fontFamily: e.target.value }); };
  $('#cvSize').onchange = e => { const o = cv?.getActiveObject(); if (o) cvSet({ fontSize: (+e.target.value || 20) / (o.scaleY || 1) }); };
  $('#cvColor').oninput = e => cvSet({ fill: e.target.value });
  $('#cvBold').onclick = () => { const o = cv?.getActiveObject(); if (o) cvSet({ fontWeight: o.fontWeight === 'bold' || o.fontWeight >= 700 ? 'normal' : 'bold' }); };
  $('#cvItalic').onclick = () => { const o = cv?.getActiveObject(); if (o) cvSet({ fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }); };
  $('#cvAlign').onchange = e => cvSet({ textAlign: e.target.value });
  $('#cvOpacity').oninput = e => cvSet({ opacity: +e.target.value / 100 });
  $$('[data-snap]').forEach(b => b.onclick = () => {
    const o = cv?.getActiveObject(); if (!o) return; const g = coverGeom(); const c = o.getCenterPoint(); const a = b.dataset.snap;
    if (a === 'rotate') { o.rotate(((o.angle || 0) + 90) % 360); }
    else { const x = a === 'front' ? g.frontX + g.w / 2 : a === 'back' ? g.backX + g.w / 2 : g.spineX + g.sp / 2; if (a === 'spine') { o.rotate(90); o.role = o.role === 'user' ? 'spine' : o.role; } o.setPositionByOrigin(new fabric.Point(x * IN, a === 'spine' ? (g.b + g.h / 2) * IN : c.y), 'center', 'center'); }
    o.setCoords(); cv.requestRenderAll(); markDirty();
  });
}

/* Cover checks used by preflight */
function coverIssues() {
  const out = []; if (!cv) return out;
  const g = coverGeom(), P = PUBLISHERS[S.pub];
  const objs = cv.getObjects().filter(o => o.role !== 'bg' && o.role !== 'bgimg');
  const spineTexts = objs.filter(o => o.role === 'spine');
  if (spineTexts.length && pageCount() < P.spineTextMinPages) out.push({ sev: 'error', id: 'spine-text', msg: `Spine text is not allowed under ${P.spineTextMinPages} pages`, sub: `${P.short} rejects spine text on a ${pageCount()}-page book because the spine is only ${fmtIn(g.sp)} wide.`, fix: () => { spineTexts.forEach(o => cv.remove(o)); cv.requestRenderAll(); markDirty(); } });
  if (!spineTexts.length && pageCount() >= P.spineTextMinPages && S.meta.title) out.push({ sev: 'info', id: 'spine-add', msg: 'No spine text yet', sub: 'Your page count allows a title on the spine.', fix: () => { addSpineText(); cv.requestRenderAll(); markDirty(); } });
  const s = P.coverSafe * IN; const bc = P.barcode;
  const barcode = { l: (g.spineX - bc.from - bc.w) * IN, t: (g.H - g.b - bc.from - bc.h) * IN, r: (g.spineX - bc.from) * IN, b: (g.H - g.b - bc.from) * IN };
  let unsafe = 0, overBarcode = 0;
  objs.forEach(o => {
    const r = o.getBoundingRect(true, true); const L = r.left, T = r.top, R = r.left + r.width, B = r.top + r.height;
    const isText = o.type === 'textbox' || o.type === 'text' || o.type === 'i-text';
    if (isText) {
      const reg = regionOf(o.getCenterPoint().x, { spineX: g.spineX * IN, frontX: g.frontX * IN });
      let x0, x1; if (reg === 'back') { x0 = g.backX * IN + s; x1 = g.spineX * IN - s; } else if (reg === 'front') { x0 = g.frontX * IN + s; x1 = (g.frontX + g.w) * IN - s; } else { x0 = g.spineX * IN + P.spineTextClearance * IN; x1 = g.frontX * IN - P.spineTextClearance * IN; }
      if (L < x0 - 1 || R > x1 + 1 || T < g.b * IN + s - 1 || B > (g.b + g.h) * IN - s + 1) unsafe++;
    }
    if (o.role !== 'motif' && L < barcode.r && R > barcode.l && T < barcode.b && B > barcode.t && (isText || o.type === 'image')) overBarcode++;
    if (o.type === 'image' && o._element) { const dpi = o._element.naturalWidth / (o.width * o.scaleX / IN); if (dpi < 290) out.push({ sev: 'warn', id: 'cv-dpi', msg: `Cover image prints at ${Math.round(dpi)} DPI`, sub: 'Use an image with more pixels or make it smaller. 300 DPI is the print standard.' }); }
  });
  cv.getObjects().filter(o => o.role === 'bgimg' && o._element).forEach(o => { const dpi = o._element.naturalWidth / (o.width * o.scaleX / IN); if (dpi < 290) out.push({ sev: 'warn', id: 'cv-bgdpi', msg: `Cover background prints at ${Math.round(dpi)} DPI`, sub: `A full-wrap background needs about ${Math.round(g.W * 300)} × ${Math.round(g.H * 300)} pixels.` }); });
  if (unsafe) out.push({ sev: 'warn', id: 'cv-safe', msg: `${unsafe} text item${unsafe > 1 ? 's' : ''} on the cover cross the safe zone`, sub: `Keep text ${P.coverSafe} in inside the trim and clear of the spine folds. Open the Cover tab and drag it inside the blue guides.` });
  if (overBarcode) out.push({ sev: 'warn', id: 'cv-barcode', msg: 'Something overlaps the barcode area', sub: 'Move text and images out of the white box on the back cover.' });
  const front = objs.filter(o => o.getCenterPoint().x > g.frontX * IN); if (!front.length) out.push({ sev: 'error', id: 'cv-empty', msg: 'The front cover is empty', sub: 'Use Auto-design cover or add a title.', fix: () => autoDesignCover() });
  return out;
}

async function renderCoverDataURL(dpi) {
  await ensureCover(); cv.discardActiveObject(); cv.requestRenderAll();
  const fams = cv.getObjects().filter(o => o.fontFamily).map(o => o.fontFamily); await ensureFonts(fams);
  return cv.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: (dpi / IN) / cvZoom });
}
