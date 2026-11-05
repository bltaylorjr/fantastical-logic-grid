/* ---------- Import ---------- */
function fileToDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); }); }
const ext = name => (name.split('.').pop() || '').toLowerCase();
const IMG_NATIVE = ['png', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'apng'];

async function imageFileToDataURL(f) {
  const e = ext(f.name);
  if (e === 'tif' || e === 'tiff' || f.type === 'image/tiff') {
    await loadLibs('pako', 'utif');
    const buf = await f.arrayBuffer(); const ifds = UTIF.decode(buf); UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]); const cv = document.createElement('canvas'); cv.width = ifds[0].width; cv.height = ifds[0].height;
    const ctx = cv.getContext('2d'); const id = ctx.createImageData(cv.width, cv.height); id.data.set(rgba); ctx.putImageData(id, 0, 0);
    return cv.toDataURL('image/png');
  }
  if (e === 'heic' || e === 'heif' || /heic|heif/.test(f.type)) {
    if (LIBS.heic2any) { await loadLib('heic2any'); const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.95 }); return fileToDataURL(Array.isArray(out) ? out[0] : out); }
    // No HEIC decoder here: Safari can open HEIC itself; other browsers need a JPEG or PNG.
    const u = await fileToDataURL(f);
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); res(cv.toDataURL('image/jpeg', 0.95)); }; im.onerror = () => rej(new Error('This browser cannot open HEIC photos. Save it as JPEG or PNG (or use Safari) and import again.')); im.src = u; });
  }
  if (e === 'bmp' || e === 'ico' || e === 'avif') {
    // normalise to PNG so PDF export and older viewers handle it
    const u = await fileToDataURL(f); return await new Promise(res => { const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); res(cv.toDataURL('image/png')); }; im.onerror = () => res(u); im.src = u; });
  }
  return fileToDataURL(f);
}

function pickImage(cb) {
  const inp = $('#fileImg'); inp.value = '';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { busy('Loading image'); cb(await imageFileToDataURL(f)); } catch (e) { toast('Could not read that image: ' + e.message); } finally { busy(false); } };
  inp.click();
}

function textToHTML(t) {
  return t.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
function rtfToText(rtf) {
  let s = rtf.replace(/\\par[d]?/g, '\n\n').replace(/\\line/g, '\n').replace(/\\tab/g, '\t');
  s = s.replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n));
  // drop groups such as font tables, color tables, stylesheets, pictures
  s = s.replace(/\{\\(\*|fonttbl|colortbl|stylesheet|info|pict|header|footer)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '');
  s = s.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  return s.replace(/\n{3,}/g, '\n\n');
}
function csvToHTML(t, sep) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return `<table>${rows.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}
async function odtToHTML(f) {
  await loadLib('jszip'); const z = await JSZip.loadAsync(f); const xml = await z.file('content.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); const out = [];
  const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const walk = n => { for (const c of n.childNodes) {
    if (c.namespaceURI === TEXT && c.localName === 'h') out.push(`<h2>${esc(c.textContent)}</h2>`);
    else if (c.namespaceURI === TEXT && c.localName === 'p') out.push(`<p>${esc(c.textContent) || '<br>'}</p>`);
    else if (c.nodeType === 1) walk(c); } };
  walk(doc.documentElement); return out.join('');
}
async function epubToHTML(f) {
  await loadLib('jszip'); const z = await JSZip.loadAsync(f);
  const cont = new DOMParser().parseFromString(await z.file('META-INF/container.xml').async('string'), 'application/xml');
  const opfPath = cont.querySelector('rootfile').getAttribute('full-path'); const base = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
  const opf = new DOMParser().parseFromString(await z.file(opfPath).async('string'), 'application/xml');
  const items = {}; opf.querySelectorAll('manifest item').forEach(i => items[i.getAttribute('id')] = i.getAttribute('href'));
  let html = '';
  for (const ir of opf.querySelectorAll('spine itemref')) {
    const href = items[ir.getAttribute('idref')]; const file = z.file(base + decodeURIComponent(href)); if (!file) continue;
    const d = new DOMParser().parseFromString(await file.async('string'), 'text/html');
    for (const img of d.querySelectorAll('img')) { const src = img.getAttribute('src'); const dir = (base + href).replace(/[^/]+$/, '');
      const p = new URL(src, 'http://x/' + dir).pathname.slice(1); const imf = z.file(decodeURIComponent(p));
      if (imf) { const b64 = await imf.async('base64'); const e = ext(p); img.setAttribute('src', `data:image/${e === 'jpg' ? 'jpeg' : e === 'svg' ? 'svg+xml' : e};base64,${b64}`); } }
    html += sanitizeHTML(d.body.innerHTML);
  }
  return html;
}
async function pdfLoad(f) {
  await loadLibs('pdfworker', 'pdfjs');
  return pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
}
async function pdfToText(f) {
  const pdf = await pdfLoad(f); let html = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(`Reading PDF page ${i} of ${pdf.numPages}`, i / pdf.numPages);
    const tc = await (await pdf.getPage(i)).getTextContent(); let lines = [], line = '', lastY = null;
    tc.items.forEach(it => { const y = it.transform[5]; if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; } line += it.str; lastY = y; if (it.hasEOL) { lines.push(line); line = ''; lastY = null; } });
    lines.push(line);
    html += textToHTML(lines.join('\n').replace(/([^\n.!?:"”])\n(?=[a-z])/g, '$1 '));
  }
  return html;
}
async function pdfToImages(f, dpi = 300) {
  const pdf = await pdfLoad(f); const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(`Rendering PDF page ${i} of ${pdf.numPages}`, i / pdf.numPages);
    const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: dpi / 72 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(cv.toDataURL('image/jpeg', 0.92)); cv.width = cv.height = 0;
  }
  return out;
}

async function fileToHTML(f) {
  const e = ext(f.name);
  if (e === 'docx') { await loadLib('mammoth'); const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() }); return sanitizeHTML(r.value); }
  if (e === 'doc') throw new Error('Old .doc files cannot be read in the browser. Save it as .docx and import again.');
  if (e === 'odt') return odtToHTML(f);
  if (e === 'epub') return epubToHTML(f);
  if (e === 'rtf') return textToHTML(rtfToText(await f.text()));
  if (e === 'md' || e === 'markdown') { await loadLib('marked'); return sanitizeHTML(marked.parse(await f.text())); }
  if (e === 'html' || e === 'htm' || e === 'xhtml') return sanitizeHTML(await f.text());
  if (e === 'csv') return csvToHTML(await f.text(), ',');
  if (e === 'tsv') return csvToHTML(await f.text(), '\t');
  if (e === 'pdf') return pdfToText(f);
  return textToHTML(await f.text());
}

async function importFiles(files) {
  const textMode = $('#impTextMode').value, imgMode = $('#impImgMode').value, pdfMode = $('#impPdfMode').value;
  snapshot('import'); syncPagesFromDom();
  let insertAt = curPage + 1, flowStart = -1, added = 0;
  const addImagePages = urls => {
    urls.forEach(u => {
      if (imgMode === 'page-bleed') S.pages.splice(insertAt++, 0, { id: uid(), html: '<p><br></p>', bg: u, noFolio: true });
      else S.pages.splice(insertAt++, 0, { id: uid(), html: `<img src="${u}" alt="" style="max-height:${(contentHeightIn() - 0.1).toFixed(2)}in;width:auto;max-width:100%">` });
      added++;
    });
  };
  try {
    for (const [k, f] of [...files].entries()) {
      busy(`Importing ${f.name}`, k / files.length); await nextFrame();
      const e = ext(f.name);
      if (e === 'json') { const data = JSON.parse(await f.text()); if (data && data.pages) { loadProject(data); toast('Opened project ' + (data.meta?.title || f.name)); busy(false); return; } continue; }
      const isImg = f.type.startsWith('image/') || IMG_NATIVE.includes(e) || ['tif', 'tiff', 'heic', 'heif'].includes(e);
      if (isImg) {
        const u = await imageFileToDataURL(f);
        if (imgMode === 'cursor') { if (added) { renderPages(); added = 0; } insertHTMLAtCursor(`<img src="${u}" alt="">`); syncPagesFromDom(); }
        else addImagePages([u]);
        continue;
      }
      if (e === 'pdf' && pdfMode === 'images') {
        const urls = await pdfToImages(f, +($('#dpi')?.value || 300));
        if (imgMode === 'cursor') { if (added) { renderPages(); added = 0; } urls.forEach(u => insertHTMLAtCursor(`<img src="${u}" alt="">`)); syncPagesFromDom(); }
        else addImagePages(urls);
        continue;
      }
      const html = await fileToHTML(f);
      if (textMode === 'cursor') { if (added) { renderPages(); added = 0; } insertHTMLAtCursor(html); syncPagesFromDom(); }
      else { const flow = uid(); if (flowStart < 0) flowStart = insertAt; S.pages.splice(insertAt++, 0, { id: uid(), html: html || '<p><br></p>', flow }); added++; }
    }
  } catch (err) { busy(false); toast(err.message || 'Import failed', 6000); renderPages(); refreshAll(); return; }
  renderPages(); refreshAll();
  if (flowStart >= 0) { busy('Laying out pages', 0.9); await nextFrame(); await nextFrame(); reflow(flowStart, true); }
  busy(false); markDirty();
  setActivePage(Math.min(curPage + 1, S.pages.length - 1), true);
  toast(`Imported ${files.length} file${files.length > 1 ? 's' : ''}. The book now has ${S.pages.length} pages.`);
}

function wireImport() {
  $('#importBtn').onclick = () => openDlg('#dlgImport');
  const dz = $('#dropzone'), inp = $('#importFile');
  dz.onclick = () => inp.click(); dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') inp.click(); };
  inp.onchange = () => { const fl = [...inp.files]; inp.value = ''; if (fl.length) { closeDlg('#dlgImport'); importFiles(fl); } };
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files.length) { closeDlg('#dlgImport'); importFiles([...e.dataTransfer.files]); } };
  // Dropping files straight onto the pages also imports them
  $('#desk').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  $('#desk').addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); importFiles([...e.dataTransfer.files]); } });
}
