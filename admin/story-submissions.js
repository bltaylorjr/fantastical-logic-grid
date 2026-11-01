// Storyline submissions: the Storyline Submission Database
// (server/src/story-submissions.js). Every theme idea, category idea and
// storyline players sent, from the game's Suggest a storyline page and from
// Share an idea, in the words they used. Search it, open an entry to see the
// original form, fix its spelling and grammar for the puzzle, approve or
// decline it, print it (or save it as a PDF) and email a copy. Pictures a
// player added can be copied into the Story beat pictures (beat-images.js).
import { readStoryline, readSubmission } from './storyline-parse.js';

const $ = (s, el = document) => el.querySelector(s);

let h = null; // helpers from admin.js
let query = { q: '', kind: '', status: 'new', source: '', scan: '', page: 0 };
let open = null; // the entry being looked at

const KIND = { theme: 'Theme idea', category: 'Category idea', storyline: 'Storyline' };
const STATUS = { new: ['New', 'warn'], approved: ['Approved', 'ok'], declined: ['Declined', ''], closed: ['Closed', ''] };
const SOURCE = { form: 'Suggest a storyline page', 'idea box': 'Share an idea' };
const EMAIL_KIND = {
  story_received: 'Confirmation with a copy of the form (noreply@)', story_approved: 'Approval with the puzzle (noreply@)',
  submission_approved: 'Approval (noreply@)', story_declined: 'Thank-you after declining (noreply@)', submission_copy: 'Copy emailed by the team (support@)',
  story_build: 'Puzzle built for the database (no email)', story_puzzle: 'Puzzle ready, with the PDF (noreply@)', idea_update: 'Waiting to tell the player (Share an idea)', idea: 'Thank-you (support@)',
};
const MAIL_STATUS = { waiting: 'waiting to go', sending: 'sending', sent: 'sent', failed: 'could not be sent', dropped: 'not sent', held: 'held until a decision' };
const FIELD_LABEL = { title: 'Title', pitch: 'Single-line pitch', setting: 'Storyline setting', goal: 'Central mystery or goal', clues: 'Clues', beat: 'Story beat',
  branch: 'Story beat branch', alt: 'Story beat alternate ending', idea: 'Their idea', traits: 'Character traits (one per line)' };
// The trademark and copyright scan (server/src/ip-scan.js).
const VERDICT = { clear: ['Scan: clear', 'ok'], check: ['Scan: check', 'warn'], problem: ['Scan: problem', 'bad'] };
const FINDING = { trademark: 'Trademark', character: 'Protected character or setting', copyright: 'May be copied', duplicate: 'Same words as another entry' };
const TIER = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'Quantum Physicist', theorist: 'Theoretical Physicist' };

const tierName = (t) => TIER[typeof t === 'object' && t ? t.id : t] || (t && t.name) || '';
const copyTable = (pairs) => `<table class="table ss-form"><tbody>${pairs.map(([k, v]) => `<tr><th scope="row">${h.esc(k)}</th><td>${h.esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</tbody></table>`;

function row(r) {
  const e = h.esc;
  const [sw, scls] = STATUS[r.status] || [r.status, ''];
  const who = [r.credit && `credit: ${r.credit}`, r.player && `player: ${r.player}`, !r.player && r.uid && 'signed-in player', r.email && r.email].filter(Boolean).join(' · ');
  return `<li class="ss-row${open && open.id === r.id ? ' ss-open' : ''}">
    <div class="row ss-row-head"><span class="badge">${e(KIND[r.kind] || r.kind)}</span><span class="badge ${scls}">${e(sw)}</span>${r.hasPuzzle ? '<span class="badge ok">Puzzle saved</span>' : ''}${r.ipVerdict ? `<span class="badge ${VERDICT[r.ipVerdict][1]}">${VERDICT[r.ipVerdict][0]}</span>` : '<span class="badge">Not scanned</span>'}${r.images ? `<span class="badge">${r.images} ${r.images === 1 ? 'picture' : 'pictures'}</span>` : ''}
      <span class="muted">#${r.id} · ${h.when(r.createdAt)} · ${e(SOURCE[r.source] || r.source)}${r.themeName ? ` · ${e(r.themeName)}` : ''}</span></div>
    <p class="ss-title"><b>${e(r.title || r.text.split('\n')[0].replace(/^Their idea: /, '') || '(no title)')}</b>${r.pitch ? ` <span class="muted">· ${e(r.pitch)}</span>` : ''}</p>
    ${who ? `<p class="muted">${e(who)}</p>` : ''}
    <div class="row"><button class="btn small" type="button" data-ss-open="${r.id}" aria-expanded="${open && open.id === r.id}">Open</button></div>
  </li>`;
}

// What the engine can build from the entry, using the corrected words.
function puzzlePreview(s, polished) {
  if (s.kind !== 'storyline') return '';
  const again = s.status === 'approved' && !s.puzzle && h.can('moderator');
  if (s.puzzle) return `<p><b>First puzzle:</b> “${h.esc(s.puzzle.title)}”${s.puzzle.tier ? `, ${h.esc(tierName(s.puzzle.tier))}` : ''}, saved ${h.when(s.puzzle.at)}.</p>`;
  const read = s.form.idea ? readStoryline(polished?.idea || s.form.idea, s.themeName || '') : readSubmission(s.form, polished, s.themeName || '');
  const build = again ? `<div class="row"><button class="btn small primary" type="button" data-ss-build${read.def ? '' : ' aria-describedby="ss-no-puzzle"'}>Build the puzzle</button></div>
    <p class="muted">Builds the first puzzle from the corrected words below, saves it here${s.uid ? ' and in the player\'s Saved puzzles' : ''}${s.email ? ', and emails it to the author as a PDF from noreply@thelogicgrid.com' : ''}.</p>` : '';
  return read.def
    ? `<p><b>${again ? 'Approved, but no puzzle yet. It can be built from' : 'The puzzle will be built from'}:</b> ${h.esc(read.summary)}. Title “${h.esc(read.def.title)}”.</p>${build}`
    : `<p class="note" id="ss-no-puzzle"><b>No puzzle can be built from it yet:</b> ${h.esc(read.reason)} Add the lists to the corrected clues below, like "Genre: Rock, Jazz, Disco", then press ${again ? '<b>Save corrections</b> and <b>Build the puzzle</b>' : '<b>Save corrections</b>'}.${again ? '' : ' Approving still sends the author the approval email.'}</p>${build}`;
}

function scanPanel(s) {
  const e = h.esc;
  const r = s.ipScan;
  const button = h.can('moderator') ? `<button class="btn small${r ? '' : ' primary'}" type="button" data-ss-scan>${r ? 'Scan again' : 'Scan for trademarks and copyright'}</button>` : '';
  if (!r) return `<section class="ss-scan" aria-labelledby="ss-scan-h"><h3 id="ss-scan-h">Trademark and copyright</h3><p class="muted">Not scanned yet. The scan checks for brand names, protected characters and settings, wording that looks copied from a published work, and the same words as another entry.</p><div class="row">${button}</div></section>`;
  const [vw, vcls] = VERDICT[r.verdict];
  const items = r.findings.map((f) => `<li class="ss-finding${f.serious ? ' serious' : ''}">
      <p><span class="badge ${f.serious ? 'bad' : 'warn'}">${e(FINDING[f.type] || f.type)}</span> <b>${e(f.term)}</b> <span class="muted">in ${e(f.field)} · found by the ${e(f.source)}${f.serious ? '' : ' (possible)'}</span></p>
      <p>${e(f.why)}</p>
      ${f.otherId ? `<p><button class="btn small link" type="button" data-ss-open-other="${f.otherId}">Open entry #${f.otherId}</button></p>` : ''}
      ${f.link ? `<p><a href="${e(f.link)}" target="_blank" rel="noopener noreferrer">${f.type === 'copyright' ? 'Search the web for these words' : `Look up “${e(f.term)}” in the USPTO trademark search`}</a></p>` : ''}
    </li>`).join('');
  return `<section class="ss-scan" aria-labelledby="ss-scan-h"><h3 id="ss-scan-h">Trademark and copyright <span class="badge ${vcls}">${e(vw)}</span></h3>
    <p>${e(r.summary)} <span class="muted">Scanned ${h.when(r.at)}${r.by ? ` by ${e(r.by)}` : ''}${r.ai ? ', with the AI review' : ''}.</span></p>
    ${items ? `<ul class="ss-findings">${items}</ul>` : ''}
    ${(r.notes || []).map((n) => `<p class="note">${e(n)}</p>`).join('')}
    <p class="muted">A screening aid, not legal advice: a clear scan does not prove an entry is free to use. When in doubt, ask the author or leave it out.</p>
    <div class="row">${button}</div></section>`;
}

function correctedEditor(s) {
  const fields = Object.keys(s.polishable || {});
  if (!fields.length) return '';
  const p = s.polished || {};
  const boxes = fields.map((k) => {
    const value = k === 'traits' ? (p.traits || s.polishable.traits).join('\n') : (p[k] ?? s.polishable[k]);
    return `<div class="field"><label for="ss-fix-${k}">${h.esc(FIELD_LABEL[k] || k)}</label><textarea id="ss-fix-${k}" data-fix="${k}" rows="${k === 'clues' || k === 'beat' || k === 'idea' ? 4 : 2}">${h.esc(value)}</textarea></div>`;
  }).join('');
  return `<details class="ss-fix"${s.polished ? '' : ' open'}><summary><b>Corrected wording for the puzzle</b> <span class="muted">${s.polished ? '(corrected)' : '(not corrected yet: these are the author\'s words)'}</span></summary>
    <p class="muted">The puzzle and the PDF use these words, with spelling, grammar and punctuation fixed. The author's original stays exactly as they sent it. <b>Fix spelling and grammar</b> asks the AI editor (Gemini); you can then change anything by hand and press <b>Save corrections</b>.</p>
    <div class="stack">${boxes}</div>
    ${h.can('moderator') ? `<div class="row"><button class="btn small" type="button" data-ss-polish>Fix spelling and grammar</button><button class="btn small" type="button" data-ss-save>Save corrections</button></div>` : ''}
  </details>`;
}

// Pictures the player added to the form. Each can be copied into the story
// beat pictures, so the game can show it beside a story beat.
function pictures(s) {
  if (!s.images || !s.images.length) return '';
  const e = h.esc;
  const canUse = h.can('moderator');
  return `<h3>Pictures</h3>
    <ul class="bi-grid">${s.images.map((i, n) => `<li class="bi-card">
      <a href="${e(i.src)}" download="${e(i.name || `picture-${n + 1}`)}"><img src="${e(i.src)}" alt="Picture ${n + 1} the player sent${i.name ? `: ${e(i.name)}` : ''}" loading="lazy"></a>
      <p class="muted">${i.width && i.height ? `${i.width} × ${i.height} · ` : ''}${Math.round((i.bytes || 0) / 1024)} KB</p>
      ${i.beatImage ? '<p><span class="badge ok">In story beats</span></p>' : canUse ? `<button class="btn small" type="button" data-ss-use-img="${i.id}">Use in story beats</button>` : ''}
    </li>`).join('')}</ul>`;
}

let beatThemes = null;
async function useImage(b, s, imageId) {
  if (!beatThemes) beatThemes = (await h.api('beat-images')).themes;
  const theme = beatThemes.some((t) => t.id === s.theme) ? s.theme : 'default';
  const v = await h.ask({
    title: 'Use this picture in story beats?',
    text: 'The game can show it beside a story beat for the theme and stage you pick. The player gave permission to use their entry when they sent it.',
    fields: [
      { name: 'theme', label: 'Theme', type: 'select', value: theme, options: beatThemes.map((t) => [t.id, t.name]) },
      { name: 'stage', label: 'When it shows', type: 'select', value: 'any', options: [['any', 'Any story beat'], ['early', 'Early (after the first section)'], ['middle', 'Middle (about halfway)'], ['late', 'Late (before the last section)']] },
      { name: 'alt', label: 'What the picture shows (read out by screen readers)', value: s.title || '' },
    ],
    ok: 'Add to story beats',
    check: (x) => (x.alt.trim() ? '' : 'Say in a few words what the picture shows.'),
  });
  if (v && (await h.act(b, () => h.api(`story-submissions/${s.id}/images/${imageId}/use`, { method: 'POST', body: v }), 'Added to Story beat pictures.'))) await openEntry(s.id, { focus: false });
}

// True when the team changed a corrected-wording box, or the words were already corrected.
function fixesTouched(s) {
  if (s.polished) return true;
  return [...document.querySelectorAll('[data-fix]')].some((el) => el.value !== el.defaultValue);
}

function readFixes(s) {
  const out = {};
  for (const el of document.querySelectorAll('[data-fix]')) {
    const k = el.dataset.fix;
    out[k] = k === 'traits' ? el.value.split('\n').slice(0, (s.polishable.traits || []).length) : el.value;
  }
  return out;
}

function detail(s) {
  const e = h.esc;
  const [sw, scls] = STATUS[s.status] || [s.status, ''];
  const canReview = h.can('moderator');
  const actions = [
    canReview && s.status !== 'approved' && `<button class="btn small primary" type="button" data-ss-approve>${s.kind === 'storyline' ? 'Approve and build puzzle' : 'Approve'}</button>`,
    canReview && s.status === 'new' && '<button class="btn small" type="button" data-ss-decline>Decline</button>',
    '<button class="btn small" type="button" data-ss-print>Print or save as PDF</button>',
    canReview && '<button class="btn small" type="button" data-ss-email>Email a copy</button>',
    h.can('admin') && '<button class="btn small danger" type="button" data-ss-delete>Delete</button>',
    '<button class="btn small link" type="button" data-ss-close>Close</button>',
  ].filter(Boolean).join('');
  const mails = s.emails.length
    ? `<ul class="ss-mails">${s.emails.map((m) => `<li>${e(EMAIL_KIND[m.kind] || m.kind)}: ${e(MAIL_STATUS[m.status] || m.status)} ${h.when(m.sentAt || m.at)}</li>`).join('')}</ul>`
    : '<p class="muted">No emails about this entry yet.</p>';
  return `<article class="card stack ss-detail" id="ss-detail" tabindex="-1" aria-labelledby="ss-detail-h">
    <div class="row"><h2 id="ss-detail-h" class="grow">#${s.id} ${e(s.title || KIND[s.kind])}</h2><span class="badge">${e(KIND[s.kind])}</span><span class="badge ${scls}">${e(sw)}</span></div>
    <p class="muted">Sent ${h.when(s.createdAt)} from the ${e(SOURCE[s.source] || s.source)}${s.platform ? ` (${e(s.platform)}${s.version ? ` ${e(s.version)}` : ''})` : ''}.
      ${s.decidedAt ? `${s.status === 'approved' ? 'Approved' : s.status === 'declined' ? 'Declined' : 'Closed'}${s.decidedBy ? ` by ${e(s.decidedBy)}` : ''} ${h.when(s.decidedAt)}.` : ''}</p>
    <p><b>Player:</b> ${s.player ? e(s.player) : s.uid ? 'a signed-in player (no screen name)' : 'a guest'}${s.uid ? ` <code>${e(s.uid)}</code>` : ''}
      · <b>Email:</b> ${s.email ? `<bdi>${e(s.email)}</bdi>` : 'none given'} · <b>Author credit:</b> ${e(s.credit || (s.source === 'form' ? 'Anonymous' : 'not asked'))}
      · <b>Consent:</b> ${s.consent ? 'given' : s.source === 'form' ? 'not given' : 'not asked (Share an idea)'}</p>
    <h3>Original submission</h3>
    ${copyTable(s.copy)}
    ${pictures(s)}
    ${scanPanel(s)}
    ${puzzlePreview(s, s.polished)}
    ${correctedEditor(s)}
    <h3>Emails</h3>${mails}
    <div class="row ss-actions">${actions}</div>
  </article>`;
}

// A clean page with just the entry, for the browser's Print (choose "Save as PDF" to keep a file).
function printEntry(s) {
  const e = h.esc;
  const box = $('#ss-print');
  box.innerHTML = `<h1>The Fantastical Logic Grid: ${e(KIND[s.kind])} #${s.id}</h1>
    <p>Sent ${e(new Date(s.createdAt).toLocaleString())} from the ${e(SOURCE[s.source] || s.source)} · Status: ${e((STATUS[s.status] || [s.status])[0])}</p>
    <p>Player: ${e(s.player || (s.uid ? 'signed-in player' : 'guest'))}${s.email ? ` · Email: ${e(s.email)}` : ''} · Author credit: ${e(s.credit || 'Anonymous')} · Consent: ${s.consent ? 'given' : 'not given'}</p>
    <h2>Original submission</h2>${copyTable(s.copy)}
    ${s.polished ? `<h2>Corrected wording</h2>${copyTable(Object.entries(s.polished).map(([k, v]) => [FIELD_LABEL[k] || k, Array.isArray(v) ? v.join(', ') : v]))}` : ''}
    ${s.ipScan ? `<h2>Trademark and copyright scan: ${e(VERDICT[s.ipScan.verdict][0].replace('Scan: ', ''))}</h2><p>${e(s.ipScan.summary)} (scanned ${e(new Date(s.ipScan.at).toLocaleString())})</p>${s.ipScan.findings.length ? copyTable(s.ipScan.findings.map((f) => [`${FINDING[f.type] || f.type}: ${f.term}`, `${f.field}. ${f.why}`])) : ''}` : '<p>Not scanned for trademarks and copyright.</p>'}
    ${s.puzzle ? `<h2>First puzzle</h2><p>“${e(s.puzzle.title)}”${s.puzzle.tier ? `, ${e(tierName(s.puzzle.tier))}` : ''}</p>` : ''}`;
  document.body.classList.add('ss-printing');
  const done = () => { document.body.classList.remove('ss-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}

async function openEntry(id, { focus = true } = {}) {
  open = await h.api(`story-submissions/${id}`);
  $('#ss-detail-wrap').innerHTML = detail(open);
  for (const b of document.querySelectorAll('[data-ss-open]')) b.setAttribute('aria-expanded', String(Number(b.dataset.ssOpen) === open.id));
  if (focus) $('#ss-detail').focus();
}

export async function storySubmissionsView(helpers) {
  h = helpers;
  const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v !== 0));
  const d = await h.api(`story-submissions?${p}`);
  const c = d.counts || {};
  h.setCount('#count-story-submissions', c.new || 0);
  const all = Object.values(c).reduce((a, b) => a + b, 0);
  $('#ss-tabs').innerHTML = [['new', 'New'], ['approved', 'Approved'], ['declined', 'Declined'], ['closed', 'Closed'], ['', 'All']]
    .map(([k, label]) => `<button type="button" class="btn small" data-ss-tab="${k}" aria-pressed="${k === query.status}">${label} <span class="n">${h.fmt(k ? c[k] || 0 : all)}</span></button>`).join('');
  const from = d.page * d.perPage;
  $('#ss-total').textContent = d.total ? `Showing ${h.fmt(from + 1)} to ${h.fmt(Math.min(d.total, from + d.items.length))} of ${h.fmt(d.total)}${query.q ? ` matching “${query.q}”` : ''}.` : (query.q ? `Nothing matches “${query.q}”.` : 'No entries here.');
  $('#ss-list').innerHTML = d.items.map(row).join('');
  const scanBtn = $('#ss-scan-new');
  scanBtn.hidden = !h.can('moderator') || !d.unscannedNew;
  scanBtn.textContent = `Scan new entries (${h.fmt(d.unscannedNew || 0)} not scanned)`;
  $('#ss-prev').hidden = d.page === 0;
  $('#ss-next').hidden = from + d.items.length >= d.total;
  if (open && !d.items.some((r) => r.id === open.id)) { open = null; $('#ss-detail-wrap').innerHTML = ''; }
  else if (open) await openEntry(open.id, { focus: false });
}

export function initStorySubmissions(helpers, show) {
  h = helpers;
  const refresh = () => show('story-submissions', { keepFocus: true });
  $('#ss-search').onsubmit = (e) => {
    e.preventDefault();
    query = { ...query, q: $('#ss-q').value.trim(), kind: $('#ss-kind').value, source: $('#ss-source').value, scan: $('#ss-scan').value, page: 0 };
    refresh();
  };
  $('#ss-tabs').onclick = (e) => {
    const b = e.target.closest('[data-ss-tab]');
    if (!b) return;
    query = { ...query, status: b.dataset.ssTab, page: 0 };
    refresh();
  };
  $('#ss-scan-new').onclick = async (e) => {
    const b = e.currentTarget;
    let r;
    if (await h.act(b, async () => { r = await h.api('story-submissions/scan-new', { method: 'POST', body: {} }); })) {
      const v = r.verdicts;
      h.toast(`Scanned ${r.scanned}: ${v.clear} clear, ${v.check} to check, ${v.problem} with a problem.${r.left ? ` ${r.left} left: press again.` : ''}`);
      refresh();
    }
  };
  $('#ss-prev').onclick = () => { query.page = Math.max(0, query.page - 1); refresh(); };
  $('#ss-next').onclick = () => { query.page += 1; refresh(); };
  $('#ss-list').onclick = async (e) => {
    const b = e.target.closest('[data-ss-open]');
    if (b) await h.act(b, () => openEntry(Number(b.dataset.ssOpen)));
  };
  $('#ss-detail-wrap').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !open) return;
    const id = open.id;
    if (b.matches('[data-ss-close]')) { open = null; $('#ss-detail-wrap').innerHTML = ''; $('#ss-q').focus(); return; }
    if (b.matches('[data-ss-print]')) { printEntry(open); return; }
    if (b.matches('[data-ss-use-img]')) { await useImage(b, open, Number(b.dataset.ssUseImg)); return; }
    if (b.matches('[data-ss-open-other]')) { await h.act(b, () => openEntry(Number(b.dataset.ssOpenOther))); return; }
    if (b.matches('[data-ss-scan]')) {
      b.textContent = 'Scanning…';
      if (await h.act(b, () => h.api(`story-submissions/${id}/scan`, { method: 'POST', body: {} }), 'Scan finished.')) { await openEntry(id); refresh(); }
      return;
    }
    if (b.matches('[data-ss-build]')) {
      const body = fixesTouched(open) ? { polished: readFixes(open) } : {};
      if (await h.act(b, () => h.api(`story-submissions/${id}/build`, { method: 'POST', body }), 'The puzzle is being built. It goes out within about 15 minutes.')) await openEntry(id);
      return;
    }
    if (b.matches('[data-ss-polish]')) {
      if (await h.act(b, async () => { await h.api(`story-submissions/${id}/polish`, { method: 'POST', body: {} }); }, 'Spelling and grammar fixed. Check the words, then save or approve.')) await openEntry(id);
    } else if (b.matches('[data-ss-save]')) {
      if (await h.act(b, () => h.api(`story-submissions/${id}/polish`, { method: 'POST', body: { polished: readFixes(open) } }), 'Corrections saved.')) await openEntry(id);
    } else if (b.matches('[data-ss-approve]')) {
      const story = open.kind === 'storyline';
      const text = story
        ? (open.email ? 'The first puzzle is built from the corrected words, saved here' + (open.uid ? ', put in the player\'s Saved puzzles' : '') + ' and emailed to the author as a PDF from noreply@thelogicgrid.com within about 15 minutes.' : 'The first puzzle is built from the corrected words and saved here. There is no address to email the author.')
        : (open.email ? 'The author gets an approval email from noreply@thelogicgrid.com.' : 'There is no address to email the author.');
      const scan = open.ipScan;
      const warn = !scan ? 'It has not been scanned for trademarks and copyright yet.' : scan.verdict === 'problem' ? 'The trademark and copyright scan found a likely problem.' : scan.verdict === 'check' ? 'The trademark and copyright scan found something worth a look.' : '';
      if (!(await h.ask({ title: `Approve this ${KIND[open.kind].toLowerCase()}?`, text: `${warn ? `<b>${h.esc(warn)}</b> ` : ''}${h.esc(text)}`, ok: 'Approve', danger: scan?.verdict === 'problem' }))) return;
      // Untouched boxes are the author's own words: leave them, so the server fixes the wording itself.
      const body = document.querySelector('[data-fix]') && fixesTouched(open) ? { polished: readFixes(open) } : {};
      if (await h.act(b, () => h.api(`story-submissions/${id}/approve`, { method: 'POST', body }), 'Approved.')) refresh();
    } else if (b.matches('[data-ss-decline]')) {
      if (!(await h.ask({ title: 'Decline this entry?', text: open.email ? 'The author gets a thank-you for their input from noreply@thelogicgrid.com.' : 'There is no address to email the author.', ok: 'Decline', danger: true }))) return;
      if (await h.act(b, () => h.api(`story-submissions/${id}/decline`, { method: 'POST' }), 'Declined.')) refresh();
    } else if (b.matches('[data-ss-email]')) {
      const v = await h.ask({ title: 'Email a copy of this entry', text: 'It goes from support@thelogicgrid.com with the original form, and the puzzle as a PDF when one is saved.', fields: [{ name: 'to', label: 'Email address', type: 'email', value: open.email || '' }], ok: 'Send' });
      if (v && (await h.act(b, () => h.api(`story-submissions/${id}/email`, { method: 'POST', body: { to: v.to } }), 'The copy goes out within about 15 minutes.'))) await openEntry(id);
    } else if (b.matches('[data-ss-delete]')) {
      if (!(await h.ask({ title: 'Delete this entry?', text: 'It is removed from the database for good, and emails about it that have not gone are stopped.', ok: 'Delete', danger: true }))) return;
      if (await h.act(b, () => h.api(`story-submissions/${id}/delete`, { method: 'POST' }), 'Deleted.')) { open = null; $('#ss-detail-wrap').innerHTML = ''; refresh(); }
    }
  });
}
