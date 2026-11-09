/* ---------- Writing tools: QuillBot and Scribbr ----------
   Neither QuillBot nor Scribbr has a public API, so Book Studio hands text to
   their own web tools: a button copies the text and opens the tool in a new
   tab (the writer's own account, the normal browser in the desktop app), and
   the fixed text is pasted back here and put back where it came from: the
   selected passage or paragraph in the manuscript, a Book details field, or a
   text box on the cover. Nothing is sent anywhere by Book Studio itself. */
const WRITING_TOOLS = [
  { site: 'QuillBot', name: 'Paraphraser', url: 'https://quillbot.com/paraphrasing-tool' },
  { site: 'QuillBot', name: 'Grammar Checker', url: 'https://quillbot.com/grammar-check' },
  { site: 'QuillBot', name: 'Summarizer', url: 'https://quillbot.com/summarize' },
  { site: 'QuillBot', name: 'AI Detector', url: 'https://quillbot.com/ai-content-detector' },
  { site: 'QuillBot', name: 'Plagiarism Checker', url: 'https://quillbot.com/plagiarism-checker' },
  { site: 'Scribbr', name: 'Grammar Checker', url: 'https://www.scribbr.com/grammar-checker/' },
  { site: 'Scribbr', name: 'Paraphraser', url: 'https://www.scribbr.com/paraphrasing-tool/' },
  { site: 'Scribbr', name: 'AI Detector', url: 'https://www.scribbr.com/ai-detector/' },
  { site: 'Scribbr', name: 'Plagiarism Checker', url: 'https://www.scribbr.com/plagiarism-checker/' },
  { site: 'Scribbr', name: 'Citation Generator', url: 'https://www.scribbr.com/citation/generator/', noText: true },
];
const WT_META = ['title', 'subtitle', 'description', 'blurb'];
let wtTarget = null, wtLastMeta = 'description';

const wtWords = t => (t.trim().match(/\S+/g) || []).length;

// The manuscript passage: the selection, or the whole paragraph the cursor is in.
function wtPageTarget() {
  const r = savedRange; if (!r) return null;
  const c = r.commonAncestorContainer; const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
  if (!host || !document.contains(host)) return null;
  if (!r.collapsed) {
    const text = window.getSelection().toString() || r.toString();
    return text.trim() ? { kind: 'page', range: r.cloneRange(), text, what: 'the selected text' } : null;
  }
  let block = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  while (block && block.parentElement !== host) block = block.parentElement;
  if (!block || block === host || block.closest('.puzzle, .grid-room, .grid-block') || block.querySelector('.puzzle, .grid-room, img, table')) return null;
  const text = block.innerText.trim(); if (!text) return null;
  const range = document.createRange(); range.selectNodeContents(block);
  return { kind: 'page', range, text, what: 'this paragraph' };
}

function openWriting(target) {
  wtTarget = target;
  const t = $('#wtText'); t.value = target ? target.text : '';
  $('#wtResult').value = '';
  $('#wtFrom').textContent = target
    ? `Working on ${target.what}. Pick a tool, then paste the fixed text below and press Put it back.`
    : 'Nothing was selected, so type or paste text here. To fix text in the book, select it (or click in a paragraph) first.';
  $('#wtApply').disabled = !target;
  wtCount(); openDlg('#dlgWrite'); t.focus();
}
function wtCount() {
  const n = wtWords($('#wtText').value);
  $('#wtCount').textContent = `${n} word${n === 1 ? '' : 's'}${n > 125 ? ' · QuillBot\'s free Paraphraser takes 125 words at a time' : ''}`;
}

function wtOpenTool(tool) {
  const t = $('#wtText'); const text = t.value;
  if (!tool.noText) {
    if (!text.trim()) { toast('Type or select some text first'); t.focus(); return; }
    // Copy straight away (inside the click), before the new tab takes focus.
    t.focus(); t.select(); let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { }
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { });
    t.setSelectionRange(text.length, text.length);
  }
  const w = window.open(tool.url, '_blank', 'noopener');
  if (w === null && !window.__FLG_BOOK_STUDIO_DESKTOP__) toast(`Your browser blocked the new tab. Allow pop-ups for Book Studio, or open ${tool.url}`, 7000);
  else toast(tool.noText ? `Opened Scribbr's ${tool.name}` : `Copied. Paste it into ${tool.site}'s ${tool.name} with Ctrl+V (⌘V on a Mac), then copy the result and come back.`, 6000);
}

async function wtPaste() {
  const r = $('#wtResult');
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) { r.value = text.trim(); toast('Pasted'); return; }
    toast('The clipboard is empty. Copy the result in QuillBot or Scribbr first.');
  } catch (e) { toast('Click in the box and press Ctrl+V (⌘V on a Mac) to paste'); }
  r.focus();
}

function wtApply() {
  const v = $('#wtResult').value.trim(); const tg = wtTarget;
  if (!v) { toast('Paste the fixed text into the second box first'); $('#wtResult').focus(); return; }
  if (!tg) return;
  if (tg.kind === 'page') {
    const c = tg.range.commonAncestorContainer; const host = (c.nodeType === 1 ? c : c.parentElement)?.closest?.('.content');
    if (!host || !document.contains(host)) { toast('That page changed. Select the text again, then use Writing tools.'); return; }
    closeDlg('#dlgWrite');
    host.focus({ preventScroll: true });
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(tg.range);
    const paras = v.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paras.length > 1) document.execCommand('insertHTML', false, paras.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
    else if (v.includes('\n')) document.execCommand('insertHTML', false, esc(v).replace(/\n/g, '<br>'));
    else document.execCommand('insertText', false, v);
    afterEdit();
  } else if (tg.kind === 'meta') {
    tg.el.value = v; tg.el.dispatchEvent(new Event('input', { bubbles: true }));
    closeDlg('#dlgWrite');
  } else if (tg.kind === 'cover') {
    if (!cv || !cv.getObjects().includes(tg.obj)) { toast('That text box is gone. Select one and try again.'); return; }
    if (tg.obj.isEditing) tg.obj.exitEditing();
    tg.obj.set('text', v); tg.obj.setCoords(); cv.requestRenderAll(); markDirty();
    closeDlg('#dlgWrite');
  }
  wtTarget = null; toast('Put back in your book');
}

function wireWriting() {
  const row = site => WRITING_TOOLS.filter(t => t.site === site).map(t => `<button class="btn" type="button" data-wt="${WRITING_TOOLS.indexOf(t)}">${esc(t.name)}</button>`).join('');
  $('#wtQuill').innerHTML = row('QuillBot'); $('#wtScribbr').innerHTML = row('Scribbr');
  $$('#dlgWrite [data-wt]').forEach(b => b.onclick = () => wtOpenTool(WRITING_TOOLS[+b.dataset.wt]));
  $('#wtText').addEventListener('input', wtCount);
  $('#wtPaste').onclick = wtPaste; $('#wtApply').onclick = wtApply;
  // Manuscript: the selection, or the paragraph with the cursor.
  $('#writeBtn').onclick = () => openWriting(wtPageTarget());
  // Book details: the last of title, subtitle, description or blurb you were in.
  WT_META.forEach(k => $(`[data-meta="${k}"]`)?.addEventListener('focus', () => { wtLastMeta = k; }));
  $('#writeMeta').onclick = () => {
    const el = $(`[data-meta="${wtLastMeta}"]`);
    const label = { title: 'the title', subtitle: 'the subtitle', description: 'the description', blurb: 'the back cover blurb' }[wtLastMeta];
    openWriting({ kind: 'meta', el, text: el.value, what: label });
  };
  // Cover: the selected text box.
  $('#cvWrite').onclick = () => {
    const o = cv?.getActiveObject();
    if (!o || typeof o.text !== 'string') { toast('Click a text box on the cover first'); return; }
    openWriting({ kind: 'cover', obj: o, text: o.text, what: 'the selected cover text' });
  };
}
