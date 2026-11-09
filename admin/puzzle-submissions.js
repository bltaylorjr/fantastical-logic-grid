// Puzzle submissions: every puzzle players sent in (Puzzle Wizard puzzles and
// storylines, from the Storyline Submission Database in
// server/src/story-submissions.js), sorted into four sections: Awaiting
// approval, Awaiting edits, Approved and Published, plus Not used. Every entry
// ever sent is here, old and new. For each one the team can edit it, delete it
// (after a confirmation), email the player who sent it, put its puzzle in the
// player's Saved puzzles in the game, and move it between sections. The full
// review (trademark scan, corrected wording, building a storyline's puzzle) is
// on the Storyline submissions page, one click away.
import { editor, readEditor, editorButton, STATUS } from './story-submissions.js';

const $ = (s, el = document) => el.querySelector(s);

let h = null; // helpers from admin.js
let query = { q: '', kind: 'puzzles', status: 'new', page: 0 };
let open = null; // the entry being looked at

const SECTIONS = [
  ['new', 'Awaiting approval', 'Sent in and waiting for the team to decide.'],
  ['edits', 'Awaiting edits', 'The team asked the author for changes; it comes back to Awaiting approval when they resubmit.'],
  ['approved', 'Approved', 'Approved by the team, not published yet.'],
  ['published', 'Published', 'Out for players: in the game, a special edition or a book.'],
  ['unused', 'Not used', 'Declined or closed.'],
];
const KIND = { puzzle: 'Wizard puzzle', storyline: 'Storyline', theme: 'Theme idea', category: 'Category idea' };
const SECTION_OF = (status) => (status === 'declined' || status === 'closed' ? 'unused' : status);
const sectionName = (status) => (SECTIONS.find(([k]) => k === SECTION_OF(status)) || [null, status])[1];

// Where an entry can move from its section, by hand (nobody is emailed).
function moves(s) {
  const out = [];
  const st = s.status;
  if (st !== 'new') out.push(['new', 'Back to Awaiting approval']);
  if (st !== 'edits') out.push(['edits', 'Move to Awaiting edits']);
  if (st !== 'approved') out.push(['approved', st === 'published' ? 'Unpublish (back to Approved)' : 'Mark as approved (no email)']);
  if (st !== 'published') out.push(['published', 'Mark as published']);
  if (st !== 'declined' && st !== 'closed') out.push(['declined', 'Move to Not used (no email)']);
  return out;
}

function row(r) {
  const e = h.esc;
  const [sw, scls] = STATUS[r.status] || [r.status, ''];
  const who = [r.credit && `credit: ${r.credit}`, r.player && `player: ${r.player}`, !r.player && r.uid && 'signed-in player', !r.uid && 'guest', r.email].filter(Boolean).join(' · ');
  return `<li class="ss-row${open && open.id === r.id ? ' ss-open' : ''}">
    <div class="row ss-row-head"><span class="badge">${e(KIND[r.kind] || r.kind)}</span><span class="badge ${scls}">${e(sw)}</span>${r.hasPuzzle ? '<span class="badge ok">Puzzle saved</span>' : ''}${r.pushCount ? `<span class="badge ok">In Saved puzzles${r.pushCount > 1 ? ` ×${r.pushCount}` : ''}</span>` : ''}
      <span class="muted">#${r.id} · ${h.when(r.createdAt)}${r.themeName ? ` · ${e(r.themeName)}` : ''}</span></div>
    <p class="ss-title"><b>${e(r.title || r.text.split('\n')[0].replace(/^Their idea: /, '') || '(no title)')}</b>${r.pitch ? ` <span class="muted">· ${e(r.pitch)}</span>` : ''}</p>
    ${who ? `<p class="muted">${e(who)}</p>` : ''}
    ${r.status === 'published' && r.publishedAt ? `<p class="muted">Published ${h.when(r.publishedAt)}${r.publishedNote ? `: ${e(r.publishedNote)}` : ''}</p>` : ''}
    <div class="row"><button class="btn small" type="button" data-ps-open="${r.id}" aria-expanded="${open && open.id === r.id}">Open</button></div>
  </li>`;
}

const copyTable = (pairs) => `<table class="table ss-form"><tbody>${pairs.map(([k, v]) => `<tr><th scope="row">${h.esc(k)}</th><td>${h.esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</tbody></table>`;

function detail(s) {
  const e = h.esc;
  const [sw, scls] = STATUS[s.status] || [s.status, ''];
  const mod = h.can('moderator');
  const canPush = mod && !!s.uid;
  const actions = [
    mod && '<button class="btn small" type="button" data-ps-edit>Edit</button>',
    mod && `<button class="btn small" type="button" data-ps-email${s.email ? '' : ' disabled aria-describedby="ps-no-email"'}>Email the player</button>`,
    mod && `<button class="btn small" type="button" data-ps-push${canPush ? '' : ' disabled aria-describedby="ps-no-push"'}>Push to Saved puzzles</button>`,
    mod && s.status !== 'approved' && s.status !== 'published' && `<button class="btn small primary" type="button" data-ps-approve>${s.kind === 'storyline' ? 'Approve and build puzzle' : 'Approve'}</button>`,
    mod && s.email && s.kind !== 'puzzle' && s.status !== 'published' && '<button class="btn small" type="button" data-ps-invite>Ask the author to edit</button>',
    h.can('admin') && '<button class="btn small danger" type="button" data-ps-delete>Delete</button>',
    `<a class="btn small link" href="#story-submissions/${s.id}">Full review</a>`,
    '<button class="btn small link" type="button" data-ps-close>Close</button>',
  ].filter(Boolean).join('');
  const move = mod ? `<div class="row"><div class="field"><label for="ps-move">Move to another section</label><select id="ps-move">${moves(s).map(([v, l]) => `<option value="${v}">${e(l)}</option>`).join('')}</select></div>
    <button class="btn small" type="button" data-ps-move>Move</button></div>` : '';
  const mails = s.emails.length ? `<ul class="ss-mails">${s.emails.map((m) => `<li>${e(m.kind.replace(/_/g, ' '))}: ${e(m.status)} ${h.when(m.sentAt || m.at)}</li>`).join('')}</ul>` : '<p class="muted">No emails about this entry yet.</p>';
  return `<article class="card stack ss-detail" id="ps-detail" tabindex="-1" aria-labelledby="ps-detail-h">
    <div class="row"><h2 id="ps-detail-h" class="grow">#${s.id} ${e(s.title || KIND[s.kind])}</h2><span class="badge">${e(KIND[s.kind] || s.kind)}</span><span class="badge ${scls}">${e(sw)}</span></div>
    <p class="muted">Section: <b>${e(sectionName(s.status))}</b>. Sent ${h.when(s.createdAt)}${s.platform ? ` from ${e(s.platform)}` : ''}.
      ${s.status === 'published' && s.publishedAt ? `Published ${h.when(s.publishedAt)}${s.publishedBy ? ` by ${e(s.publishedBy)}` : ''}${s.publishedNote ? ` (${e(s.publishedNote)})` : ''}.` : ''}</p>
    <p><b>Player:</b> ${s.player ? e(s.player) : s.uid ? 'a signed-in player (no screen name)' : 'a guest'} · <b>Email:</b> ${s.email ? `<bdi>${e(s.email)}</bdi>` : 'none given'} · <b>Credit:</b> ${e(s.credit || 'Anonymous')}</p>
    ${s.email ? '' : '<p class="muted" id="ps-no-email">There is no email address for this player, so they cannot be emailed.</p>'}
    ${s.uid ? '' : '<p class="muted" id="ps-no-push">Sent by a guest, so there is no Saved puzzles in the game to put it in.</p>'}
    <p><b>Puzzle:</b> ${s.puzzle ? `“${e(s.puzzle.title)}”, saved ${h.when(s.puzzle.at)}` : 'none saved yet'}${s.pushCount ? ` · put in their Saved puzzles ${s.pushCount === 1 ? 'once' : `${s.pushCount} times`}, last ${h.when(s.pushedAt)}${s.pushedBy ? ` by ${e(s.pushedBy)}` : ''}` : ''}</p>
    ${s.editInvite ? `<p class="note">The author was asked to edit and resubmit it. Their edit link works until ${e(new Date(s.editInvite).toLocaleDateString())}.</p>` : ''}
    <h3>${s.edited ? 'Latest version' : 'As sent'}</h3>
    ${copyTable(s.copy)}
    <div id="ps-editor-wrap"></div>
    <h3>Emails</h3>${mails}
    ${move}
    <div class="row ss-actions">${actions}</div>
  </article>`;
}

async function openEntry(id, { focus = true } = {}) {
  open = await h.api(`story-submissions/${id}`);
  $('#ps-detail-wrap').innerHTML = detail(open);
  for (const b of document.querySelectorAll('[data-ps-open]')) b.setAttribute('aria-expanded', String(Number(b.dataset.psOpen) === open.id));
  if (focus) $('#ps-detail').focus();
}

export async function puzzleSubmissionsView(helpers) {
  h = helpers;
  const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '' && v !== 0)), counts: 'kind' });
  const d = await h.api(`story-submissions?${p}`);
  const c = d.counts || {};
  const n = (k) => (k === 'unused' ? (c.declined || 0) + (c.closed || 0) : c[k] || 0);
  h.setCount('#count-puzzle-submissions', n('new'));
  $('#ps-tabs').innerHTML = SECTIONS.map(([k, label]) => `<button type="button" class="btn small" data-ps-tab="${k}" aria-pressed="${k === query.status}">${label} <span class="n">${h.fmt(n(k))}</span></button>`).join('')
    + `<button type="button" class="btn small" data-ps-tab="" aria-pressed="${query.status === ''}">All <span class="n">${h.fmt(Object.values(c).reduce((a, b) => a + b, 0))}</span></button>`;
  const sec = SECTIONS.find(([k]) => k === query.status);
  $('#ps-section-help').textContent = sec ? sec[2] : 'Every entry, in every section.';
  const from = d.page * d.perPage;
  $('#ps-total').textContent = d.total ? `Showing ${h.fmt(from + 1)} to ${h.fmt(Math.min(d.total, from + d.items.length))} of ${h.fmt(d.total)}${query.q ? ` matching “${query.q}”` : ''}.` : (query.q ? `Nothing matches “${query.q}”.` : 'Nothing in this section.');
  $('#ps-list').innerHTML = d.items.map(row).join('');
  $('#ps-prev').hidden = d.page === 0;
  $('#ps-next').hidden = from + d.items.length >= d.total;
  if (open && !d.items.some((r) => r.id === open.id)) { open = null; $('#ps-detail-wrap').innerHTML = ''; }
  else if (open) await openEntry(open.id, { focus: false });
}

// Reads a puzzle file saved from the game (Saved puzzles > Save to a file).
async function pickPuzzleFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  const file = await new Promise((resolve) => { input.onchange = () => resolve(input.files[0] || null); input.oncancel = () => resolve(null); input.click(); });
  if (!file) return null;
  try { return JSON.parse(await file.text()); } catch (e) { throw new Error('That file is not a puzzle file saved from the game.'); }
}

export function initPuzzleSubmissions(helpers, show) {
  h = helpers;
  const refresh = () => show('puzzle-submissions', { keepFocus: true });
  $('#ps-search').onsubmit = (e) => {
    e.preventDefault();
    query = { ...query, q: $('#ps-q').value.trim(), kind: $('#ps-kind').value, page: 0 };
    refresh();
  };
  $('#ps-tabs').onclick = (e) => {
    const b = e.target.closest('[data-ps-tab]');
    if (!b) return;
    query = { ...query, status: b.dataset.psTab, page: 0 };
    refresh();
  };
  $('#ps-prev').onclick = () => { query.page = Math.max(0, query.page - 1); refresh(); };
  $('#ps-next').onclick = () => { query.page += 1; refresh(); };
  $('#ps-list').onclick = async (e) => {
    const b = e.target.closest('[data-ps-open]');
    if (b) await h.act(b, () => openEntry(Number(b.dataset.psOpen)));
  };
  const wrap = $('#ps-detail-wrap');
  wrap.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ss-editor' || !open) return;
    e.preventDefault();
    const err = $('#ss-ed-error', e.target);
    err.hidden = true;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await h.api(`story-submissions/${open.id}/edit`, { method: 'POST', body: { form: readEditor(open, e.target) } });
      h.toast('Edit saved. The author\'s original is kept.');
      await refresh();
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !open) return;
    const s = open;
    const id = s.id;
    if (editorButton(b, s)) return;
    if (b.matches('[data-ps-close]')) { open = null; wrap.innerHTML = ''; $('#ps-q').focus(); return; }
    if (b.matches('[data-ed-cancel]')) { $('#ps-editor-wrap').innerHTML = ''; $('[data-ps-edit]', wrap)?.focus(); return; }
    if (b.matches('[data-ps-edit]')) {
      // One editor at a time: the Storyline submissions page uses the same fields.
      for (const other of document.querySelectorAll('#ss-editor-wrap')) other.innerHTML = '';
      $('#ps-editor-wrap').innerHTML = editor(s);
      $('#ss-editor', wrap).querySelector('input, select, textarea')?.focus();
      return;
    }
    if (b.matches('[data-ps-email]')) {
      const v = await h.ask({
        title: 'Email the player',
        text: `It goes to <bdi>${h.esc(s.email)}</bdi> from support@thelogicgrid.com, within about 15 minutes, with the title of their ${h.esc((KIND[s.kind] || 'entry').toLowerCase())}. Their reply comes back to the team's inbox.`,
        fields: [{ name: 'text', label: 'Your message (plain, kind words)', type: 'textarea' }],
        ok: 'Send',
        check: (x) => (x.text.trim().length < 2 ? 'Write the message.' : ''),
      });
      if (v && (await h.act(b, () => h.api(`story-submissions/${id}/message`, { method: 'POST', body: { text: v.text } }), 'The email goes out within about 15 minutes.'))) await openEntry(id, { focus: false });
      return;
    }
    if (b.matches('[data-ps-push]')) {
      const days = s.puzzleKeepDays || 30;
      let body = {};
      if (s.puzzle) {
        const ok = await h.ask({ title: 'Push to their Saved puzzles?', text: `“${h.esc(s.puzzle.title)}” goes into ${h.esc(s.player || 'the player')}'s Saved puzzles in the Logic Grid app, for ${days} days. They see it next time they open the game, signed in. Nobody is emailed (use Email the player to tell them).`, ok: 'Push' });
        if (!ok) return;
      } else {
        const ok = await h.ask({ title: 'Choose the puzzle file', text: `This entry has no saved puzzle yet${s.kind === 'puzzle' ? ' (a wizard puzzle is built on the author\'s device)' : ''}. Choose a puzzle file saved from the game (Saved puzzles > Save to a file). It goes into the player's Saved puzzles for ${days} days and is kept with this entry.`, ok: 'Choose a file' });
        if (!ok) return;
        let file;
        try { file = await pickPuzzleFile(); } catch (x) { h.toast(x.message); return; }
        if (!file) return;
        body = { puzzle: file };
      }
      if (await h.act(b, () => h.api(`story-submissions/${id}/push`, { method: 'POST', body }), 'Pushed to their Saved puzzles.')) await refresh();
      return;
    }
    if (b.matches('[data-ps-move]')) {
      const stage = $('#ps-move', wrap).value;
      const label = moves(s).find(([v]) => v === stage)?.[1] || stage;
      const fields = stage === 'published' ? [{ name: 'note', label: 'Where it was published (optional, for the team)', value: '' }] : [];
      const v = await h.ask({ title: `${label}?`, text: 'Moving an entry does not email anyone. Use Approve, Ask the author to edit or Email the player to write to them.', fields, ok: 'Move' });
      if (v && (await h.act(b, () => h.api(`story-submissions/${id}/stage`, { method: 'POST', body: { stage, note: v.note || '' } }), `Moved to ${sectionName(stage)}.`))) refresh();
      return;
    }
    if (b.matches('[data-ps-approve]')) {
      const text = s.kind === 'storyline'
        ? (s.email ? 'The first puzzle is built from the corrected words, saved here' + (s.uid ? ', put in the player\'s Saved puzzles' : '') + ' and emailed to the author as a PDF within about 15 minutes.' : 'The first puzzle is built and saved here. There is no address to email the author.')
        : (s.email ? 'The author gets an approval email from noreply@thelogicgrid.com.' : 'There is no address to email the author.');
      if (!(await h.ask({ title: `Approve this ${(KIND[s.kind] || 'entry').toLowerCase()}?`, text: `${h.esc(text)} To check its trademark scan or correct the wording first, use Full review.`, ok: 'Approve' }))) return;
      if (await h.act(b, () => h.api(`story-submissions/${id}/approve`, { method: 'POST', body: {} }), 'Approved.')) refresh();
      return;
    }
    if (b.matches('[data-ps-invite]')) {
      const v = await h.ask({
        title: 'Ask the author to edit and resubmit',
        text: 'They get an email from support@thelogicgrid.com with your note, a copy of their entry and a link to change it (good for 30 days). It moves to Awaiting edits, and back to Awaiting approval when they resubmit.',
        fields: [{ name: 'note', label: 'What would you like them to change?', type: 'textarea' }], ok: 'Send',
      });
      if (v && (await h.act(b, () => h.api(`story-submissions/${id}/invite`, { method: 'POST', body: { note: v.note } }), 'The email goes out within about 15 minutes.'))) refresh();
      return;
    }
    if (b.matches('[data-ps-delete]')) {
      // Deleting cannot be undone, so it always asks first.
      if (!(await h.ask({ title: `Delete #${id} for good?`, text: `<b>This cannot be undone.</b> “${h.esc(s.title || KIND[s.kind])}” is removed from the database with its pictures and sounds, and emails about it that have not gone are stopped. A puzzle already in the player's Saved puzzles stays there until it expires.`, ok: 'Delete for good', danger: true }))) return;
      if (await h.act(b, () => h.api(`story-submissions/${id}/delete`, { method: 'POST' }), 'Deleted.')) { open = null; wrap.innerHTML = ''; refresh(); }
    }
  });
}
