/* ---------- Make a copy without AI content (Project menu) ----------
   Makes a new book from the one open, leaving the original exactly as it is,
   with the AI-made parts taken out, so KDP's AI question can honestly be
   answered "None" for the copy:

   1. Review: every picture (pages and cover) and every block of words
      (pages, cover text, description, back cover blurb) is listed. Pictures
      whose file says an AI made them (C2PA / IPTC "trained algorithmic
      media", AI image tools' prompt notes) come ticked. Words can't be
      told apart, so you tick the ones an AI wrote. Puzzles made by Book
      Studio's generators or the game's engines are not AI and are not listed.
   2. The copy: the original is synced (or saved as a project file in the
      stand-alone build), then a new book opens with each ticked part taken
      out and a marked empty spot in its place.
   3. Fill: each empty spot opens in turn with a text box to write what goes
      there instead (or your own picture, for a picture), Leave it out, or
      Later. Project > Fill the removed spots comes back to the rest, and the
      Publish check stops an export while any are empty. */

const NOAI_MARKS = [
  [/trainedAlgorithmicMedia/i, 'the file is labelled as made by an AI'],
  [/c2pa|jumbf/i, 'the file carries a Content Credentials (C2PA) record'],
  [/Stable[ _-]?Diffusion|sd_xl|SDXL/i, 'made with Stable Diffusion'],
  [/DALL[·· _-]?E|OpenAI/i, 'made with DALL·E'],
  [/Midjourney/i, 'made with Midjourney'],
  [/Firefly/i, 'made with Adobe Firefly'],
  [/Imagen|SynthID|Gemini/i, 'made with Google Imagen or Gemini'],
  [/Workers AI|@cf\/(?:black-forest-labs|stabilityai|bytedance|lykon|runwayml)/i, 'made with Cloudflare Workers AI'],
  [/ComfyUI|NovelAI|Leonardo\.Ai|Ideogram|DreamStudio|Flux\.1|black-forest-labs/i, 'made with an AI image tool'],
  [/Negative prompt:|Steps: \d+, Sampler:/, 'the file holds an AI image prompt'],
];
// The first and last part of a picture's file, where its labels are kept.
function noaiPictureWhy(src) {
  const s = String(src || '');
  const m = /^data:([^;,]+)(;base64)?,/.exec(s);
  if (!m) return '';
  let text = '';
  try {
    const body = s.slice(m[0].length);
    if (!m[2]) text = decodeURIComponent(body.slice(0, 600_000));
    else {
      const head = body.slice(0, 700_000 - (700_000 % 4));
      const tailStart = Math.max(head.length, body.length - 200_000);
      const tail = body.slice(tailStart - (tailStart % 4));
      text = atob(head) + (tail.length && tailStart > head.length ? atob(tail) : '');
    }
  } catch (e) { return ''; }
  const hit = NOAI_MARKS.find(([re]) => re.test(text));
  return hit ? hit[1] : '';
}

const NOAI_TEXT_BLOCKS = 'p,h1,h2,h3,h4,ul,ol,blockquote,table,pre,div';
const noaiShort = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// One page's pictures and blocks of words, in order, read from the page as
// the editor shows it (never re-parsed from text). Puzzles and the game's
// fixed puzzle blocks are left out: engines made them, not an AI.
function noaiScanPage(root) {
  const skip = (el) => el.closest('.puzzle,.grid-block,.grid-room,.bk-head,.ai-gap');
  const out = [];
  const walk = (el) => {
    for (const c of [...el.children]) {
      if (skip(c)) continue;
      if (c.tagName === 'IMG') { out.push({ type: 'pic', el: c }); continue; }
      const imgs = $$('img', c).filter(i => !skip(i));
      if (c.matches(NOAI_TEXT_BLOCKS) && c.tagName === 'DIV' && c.querySelector(NOAI_TEXT_BLOCKS)) { walk(c); continue; }
      if (c.textContent.trim() && c.matches(NOAI_TEXT_BLOCKS + ',span,b,i,em,strong')) out.push({ type: 'text', el: c });
      imgs.forEach(i => out.push({ type: 'pic', el: i }));
    }
  };
  if (root) walk(root);
  return { items: out };
}

// Everything that could have come from an AI, for the review list.
function noaiCollect() {
  syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState();
  const items = [];
  S.pages.forEach((pg, pi) => {
    if (pg.grid) return; // a Grid book's puzzle pages: made by the game's engines
    noaiScanPage(contentEls()[pi]).items.forEach((it, k) => {
      const src = it.type === 'pic' ? it.el.getAttribute('src') || '' : '';
      items.push({ key: `p${pi}:${k}`, where: `Page ${pi + 1}`, page: pi, k, type: it.type, src, text: it.type === 'text' ? it.el.textContent : '', tag: it.el.tagName.toLowerCase(), why: it.type === 'pic' ? noaiPictureWhy(src) : '' });
    });
  });
  (S.cover?.objects || []).forEach((o, k) => {
    if (o.role === 'gridcover' || o.role === 'bg' || o.role === 'spine' || /^aigap/.test(o.role || '')) return; // the game's own cover picture, plain shapes
    if (o.type === 'image') items.push({ key: `c${k}`, where: 'Cover', k, type: 'coverpic', src: o.src || '', why: noaiPictureWhy(o.src) });
    else if (/textbox|i-text|text/.test(o.type) && String(o.text || '').trim()) items.push({ key: `c${k}`, where: 'Cover', k, type: 'covertext', text: o.text, role: o.role });
  });
  [['description', 'Description'], ['blurb', 'Back cover blurb']].forEach(([f, label]) => {
    if (String(S.meta[f] || '').trim()) items.push({ key: `m:${f}`, where: label, type: 'meta', field: f, text: S.meta[f] });
  });
  return items;
}

let noaiItems = [];
let noaiWas = {}; // what each removed spot held, this visit only: never saved into the copy
let noaiQueue = [], noaiAt = 0;

function noaiOpenReview() {
  closeDlg('#dlgProject');
  noaiItems = noaiCollect();
  const flagged = noaiItems.filter(i => i.why).length;
  const groups = {};
  noaiItems.forEach(i => { (groups[i.where] ||= []).push(i); });
  const row = (i) => {
    const what = i.type === 'pic' || i.type === 'coverpic'
      ? `<img class="noai-thumb" src="${esc(i.src)}" alt=""><span>Picture${i.why ? ` <b class="noai-flag">AI label found: ${esc(i.why)}</b>` : ''}</span>`
      : `<span>${i.type === 'covertext' ? 'Cover words: ' : ''}${esc(noaiShort(i.text))}</span>`;
    return `<label class="noai-item"><input type="checkbox" data-noai="${esc(i.key)}"${i.why ? ' checked' : ''}> ${what}</label>`;
  };
  $('#noaiList').innerHTML = noaiItems.length ? Object.entries(groups).map(([g, list]) => `<fieldset class="noai-group"><legend>${esc(g)} <button class="btn ghost" type="button" data-noai-all="${esc(g)}">Tick all</button></legend>${list.map(row).join('')}</fieldset>`).join('')
    : '<p class="hint">Nothing to review: this book has no pictures or words of its own outside the puzzles.</p>';
  $('#noaiSummary').textContent = `${noaiItems.length} part${noaiItems.length === 1 ? '' : 's'} to look at${flagged ? `, ${flagged} picture${flagged === 1 ? '' : 's'} labelled as AI-made (ticked)` : ''}. Tick everything an AI made; the rest stays in the copy.`;
  noaiCount();
  openDlg('#dlgNoAi');
}
function noaiCount() {
  const n = $$('[data-noai]:checked').length;
  $('#noaiMake').textContent = n ? `Make the copy without ${n} part${n === 1 ? '' : 's'}` : 'Make the copy';
}

async function noaiMakeCopy() {
  const picked = new Set($$('[data-noai]:checked').map(c => c.dataset.noai));
  closeDlg('#dlgNoAi');
  busy('Keeping the original safe');
  try {
    syncPagesFromDom(); if (typeof syncCoverToState === 'function') syncCoverToState();
    // The original stays as it is: on the account (synced first), or as a project file here.
    const synced = typeof syPush === 'function' && typeof syReady !== 'undefined' && syReady && typeof gaMe !== 'undefined' && gaMe;
    if (synced) await syPush();
    else await saveFile(slug(S.meta.title) + '-original-project.json', JSON.stringify(S));
    busy('Making the copy');
    const copy = JSON.parse(JSON.stringify(S));
    delete copy.syncId;
    copy.noAi = { from: S.syncId || '', title: S.meta.title || '', at: new Date().toISOString().slice(0, 10) };
    copy.aiGaps = [];
    noaiWas = {};
    const gap = (g, was) => { g.id = 'g' + uid(); copy.aiGaps.push(g); noaiWas[g.id] = was; return g.id; };
    // Cover: the part comes off, and a dashed box keeps its place.
    const objs = copy.cover?.objects || [];
    const coverPicked = noaiItems.filter(i => picked.has(i.key) && (i.type === 'coverpic' || i.type === 'covertext')).sort((a, b) => b.k - a.k);
    coverPicked.forEach(i => {
      const o = objs[i.k]; if (!o) return;
      const w = (o.width || 100) * (o.scaleX || 1), h = (o.height || 40) * (o.scaleY || 1);
      const style = i.type === 'covertext' ? Object.fromEntries(['left', 'top', 'width', 'originX', 'originY', 'angle', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fill', 'textAlign', 'lineHeight', 'role'].filter(k => o[k] != null).map(k => [k, o[k]])) : null;
      const id = gap({ kind: i.type === 'coverpic' ? 'coverpic' : 'covertext', where: 'Cover', box: { left: o.left, top: o.top, originX: o.originX || 'left', originY: o.originY || 'top', angle: o.angle || 0, w, h }, style }, i.type === 'coverpic' ? { src: i.src } : { text: i.text });
      objs.splice(i.k, 1, { type: 'rect', version: o.version, left: o.left, top: o.top, originX: o.originX || 'left', originY: o.originY || 'top', angle: o.angle || 0, width: w, height: h, scaleX: 1, scaleY: 1, fill: 'rgba(255,255,255,0.15)', stroke: '#d33', strokeWidth: 3, strokeDashArray: [12, 8], role: 'aigap:' + id });
    });
    // Description and blurb.
    noaiItems.filter(i => picked.has(i.key) && i.type === 'meta').forEach(i => {
      gap({ kind: 'meta', where: i.where, field: i.field }, { text: copy.meta[i.field] });
      copy.meta[i.field] = '';
    });
    await loadProject(copy);
    // Pages: each ticked part becomes a marked empty spot, on the copy's pages as shown.
    // Their prompts come first, in page order, then the cover's and the details'.
    const later = copy.aiGaps.splice(0);
    const byPage = {};
    noaiItems.filter(i => picked.has(i.key) && i.page != null).forEach(i => { (byPage[i.page] ||= []).push(i); });
    for (const [pi, list] of Object.entries(byPage)) {
      const pg = S.pages[pi];
      const { items } = noaiScanPage(contentEls()[pi]);
      list.forEach(i => {
        const el = items[i.k]?.el; if (!el || !el.isConnected) return; // inside a part already taken out
        const isPic = i.type === 'pic';
        const id = gap({ kind: isPic ? 'pic' : 'text', where: i.where, pageId: pg.id, tag: isPic ? 'p' : i.tag }, isPic ? { src: i.src } : { text: i.text });
        const ph = document.createElement('div');
        ph.className = 'ai-gap'; ph.dataset.gap = id; ph.setAttribute('contenteditable', 'false');
        ph.textContent = `Removed: ${isPic ? 'an AI-made picture' : 'AI-written words'}. Project › Fill the removed spots`;
        el.replaceWith(ph);
      });
    }
    copy.aiGaps.push(...later);
    S.aiGaps = copy.aiGaps;
    syncPagesFromDom();
    if (typeof syEnsureId === 'function') { syEnsureId(); markDirty(); }
    showTab('manuscript');
    busy(false);
    toast(`Copy made without ${copy.aiGaps.length} AI part${copy.aiGaps.length === 1 ? '' : 's'}. The original is ${synced ? 'still on your account, unchanged' : 'saved as a project file'}.`, 7000);
    if (copy.aiGaps.length) noaiOpenFill();
  } catch (e) { busy(false); console.error(e); toast('The copy was not made: ' + (e.message || e), 7000); }
}

// ---------- Filling the removed spots ----------
function aiGapCount() { return (S.aiGaps || []).length; }
function noaiUpdateMenu() {
  const n = aiGapCount(); const b = $('#noaiFillBtn');
  if (b) { b.hidden = !n; b.textContent = `Fill the removed spots (${n})`; }
}
function noaiOpenFill() {
  closeDlg('#dlgProject');
  noaiQueue = (S.aiGaps || []).map(g => g.id); noaiAt = 0;
  if (!noaiQueue.length) { toast('No removed spots left to fill.'); return; }
  noaiShowGap();
  openDlg('#dlgNoAiFill');
}
function noaiShowGap() {
  const g = (S.aiGaps || []).find(x => x.id === noaiQueue[noaiAt]);
  if (!g) { closeDlg('#dlgNoAiFill'); noaiUpdateMenu(); toast(aiGapCount() ? `${aiGapCount()} spot${aiGapCount() === 1 ? '' : 's'} left for later: Project › Fill the removed spots.` : 'Every removed spot is filled.'); return; }
  const pic = g.kind === 'pic' || g.kind === 'coverpic';
  const was = noaiWas[g.id];
  $('#noaiFillTitle').textContent = `${pic ? 'A picture' : 'Words'} removed from ${g.where === 'Cover' ? 'the cover' : g.kind === 'meta' ? 'the ' + g.where.toLowerCase() : g.where.toLowerCase()}`;
  $('#noaiFillStep').textContent = `${noaiAt + 1} of ${noaiQueue.length}`;
  $('#noaiFillWas').innerHTML = was ? `<details><summary>What was there (the AI-made version, for reference)</summary>${was.src ? `<img class="noai-thumb big" src="${esc(was.src)}" alt="">` : `<p>${esc(was.text)}</p>`}</details>` : '<p class="hint">What was there is in the original book.</p>';
  $('#noaiFillLabel').textContent = pic ? 'Words to put there instead (or choose your own picture)' : 'Your own words for this spot';
  $('#noaiFillText').value = '';
  $('#noaiFillPic').hidden = !pic;
  $('#noaiFillBack').disabled = noaiAt === 0;
  setTimeout(() => $('#noaiFillText').focus(), 30);
}
const noaiNext = () => { noaiAt++; noaiShowGap(); };
function noaiDone(id) { S.aiGaps = (S.aiGaps || []).filter(g => g.id !== id); delete noaiWas[id]; noaiQueue.splice(noaiAt, 1); }

// Puts words or a picture into a removed spot, or (content = null) takes the spot away.
async function noaiFill(content) {
  const g = (S.aiGaps || []).find(x => x.id === noaiQueue[noaiAt]); if (!g) return;
  const text = content?.text ?? '';
  if (content && !content.src && !text.trim()) { toast('Write something first, or press Leave it out.'); return; }
  snapshot('fill a removed spot');
  if (g.kind === 'meta') {
    S.meta[g.field] = content ? text.trim() : '';
    fillMetaForm();
  } else if (g.kind === 'pic' || g.kind === 'text') {
    const i = S.pages.findIndex(p => p.id === g.pageId);
    const ph = $(`#pages .ai-gap[data-gap="${g.id}"]`);
    if (ph) {
      if (!content) ph.remove();
      else if (content.src) { const im = document.createElement('img'); im.src = content.src; im.alt = ''; ph.replaceWith(im); }
      else {
        const tag = /^(h1|h2|h3|h4|blockquote)$/.test(g.tag) ? g.tag : 'p';
        const parts = text.trim().split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
        ph.replaceWith(...parts.map((t, k) => { const el = document.createElement(k === 0 ? tag : 'p'); el.textContent = t; return el; }));
      }
      syncPagesFromDom();
      if (i >= 0 && typeof reflow === 'function') setTimeout(() => reflow(i, true), 60);
    }
  } else if (typeof cv !== 'undefined' && cv) {
    await ensureCover();
    const box = cv.getObjects().find(o => o.role === 'aigap:' + g.id);
    if (box) cv.remove(box);
    const b = g.box || {};
    if (content?.src) {
      await new Promise(res => fabric.Image.fromURL(content.src, img => {
        if (img && img.width) { const s = Math.min(b.w / img.width, b.h / img.height) || 1; img.set({ left: b.left, top: b.top, originX: b.originX, originY: b.originY, angle: b.angle, scaleX: s, scaleY: s }); img.role = 'user'; cv.add(img); }
        res();
      }));
    } else if (content) {
      const st = { ...(g.style || {}) }; const role = st.role || 'user'; delete st.role;
      const t = new fabric.Textbox(text.trim(), { left: b.left, top: b.top, originX: b.originX, originY: b.originY, angle: b.angle, width: b.w, fontSize: 32, fontFamily: 'Nunito', fill: '#ffffff', ...st });
      t.role = role; cv.add(t);
    }
    cv.requestRenderAll(); syncCoverToState();
  }
  noaiDone(g.id);
  markDirty(); noaiUpdateMenu();
  noaiShowGap();
}

function wireNoAi() {
  $('#noaiBtn').onclick = noaiOpenReview;
  $('#noaiFillBtn').onclick = noaiOpenFill;
  $('#noaiList').addEventListener('change', noaiCount);
  $('#noaiList').addEventListener('click', e => {
    const b = e.target.closest('[data-noai-all]'); if (!b) return;
    const boxes = $$('input', b.closest('fieldset')); const all = boxes.every(c => c.checked);
    boxes.forEach(c => { c.checked = !all; }); b.textContent = all ? 'Tick all' : 'Untick all'; noaiCount();
  });
  $('#noaiMake').onclick = noaiMakeCopy;
  $('#noaiFillPut').onclick = () => noaiFill({ text: $('#noaiFillText').value });
  $('#noaiFillPic').onclick = () => pickImage(src => noaiFill({ src }));
  $('#noaiFillOut').onclick = () => noaiFill(null);
  $('#noaiFillLater').onclick = noaiNext;
  $('#noaiFillBack').onclick = () => { if (noaiAt > 0) { noaiAt--; noaiShowGap(); } };
  $('#noaiFillText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#noaiFillPut').click(); } });
  $('#projMenuBtn').addEventListener('click', noaiUpdateMenu);
}
