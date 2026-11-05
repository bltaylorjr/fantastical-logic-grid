// Puzzle quality (admin > The Fantastical Logic Grid > Puzzle quality).
//
// Top: theme and level groups players give up on, rate low, find too hard or
// too easy, or play outside the normal limits (solve time against what the
// game expected, hints against the level's usual), worst first (report.js).
// Below: the problem puzzles themselves (server/src/quality-puzzles.js), each
// with its numbers, why it was flagged and suggested fixes, and:
//   Edit       change the title and story words, or rebuild it with other
//              settings (built by the website's own engine, in a hidden frame
//              of its Book maker page, web/js/book-maker.js)
//   Republish  the fixed version goes to players' Hand-picked puzzles
//   Delete     retires its story so no game builds it again; Undo puts it back
let h = null;           // helpers from admin.js
let data = null;        // the last list: { puzzles, counts, limits, siteUrl, levels }
let filter = { status: 'active', theme: '', tier: '' };
const open = new Set(); // puzzle cards left open across reloads
let lastDeleted = null;  // { id, title }: the notice with Undo after a Delete
const $ = (s, el = document) => el.querySelector(s);

const STATUS = {
  open: ['warn', 'Needs fixing'], fixed: ['', 'Fixed, not republished'], published: ['ok', 'Republished'], retired: ['bad', 'Deleted'],
};
const REASONS = {
  quit: 'given up', revealed: 'answer revealed', low_rating: 'rated low', too_hard: 'called too hard', too_easy: 'called too easy',
  slow: 'took too long', fast: 'too quick', hints: 'many hints', mistakes: 'many mistakes',
};
const levelName = (id) => data?.levels?.find((l) => l.id === id)?.name || id;
const themeLabel = (id) => String(id || '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
// A share with its 95% range underneath, so a small sample reads as uncertain.
const pctRange = (v, range) => (v == null ? '–' : `${pct(v)}${range ? `<br><span class="muted small">${pct(range[0])}–${pct(range[1])}</span>` : ''}`);

// ---------- the page ----------
export async function qualityView(helpers) {
  h = { ...h, ...helpers };
  const { esc, fmt, tile, table } = h;
  const [q, list] = await Promise.all([
    h.api(`quality?days=${$('#q-days').value}`),
    h.api(`quality-puzzles?${new URLSearchParams(Object.entries(filter).filter(([, v]) => v))}`),
  ]);
  data = list;
  h.setCount('#count-quality', q.flagged + (list.counts.open || 0));
  const groupName = (r) => `${themeLabel(r.theme)} · ${levelName(r.tier)}`;
  $('#quality-body').innerHTML = `
    <div class="tiles">${tile('Groups to look at', fmt(q.flagged), `of ${fmt(q.rows.length)} theme and level groups`)}${tile('Problem puzzles to fix', fmt(list.counts.open || 0), `${fmt(list.counts.fixed || 0)} fixed, ${fmt(list.counts.published || 0)} republished`)}${tile('Games', fmt(q.rows.reduce((s, r) => s + r.games, 0)), `since ${esc(q.since)}`)}</div>
    <h2 class="qp-h">Theme and level groups</h2>
    ${table([{ label: 'Theme' }, { label: 'Difficulty' }, { label: 'What players say' }, { label: 'Problem puzzles', num: 1 }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Gave up', num: 1 }, { label: 'Too hard', num: 1 }, { label: 'Too easy', num: 1 }, { label: 'Rating', num: 1 }, { label: 'Typical minutes', num: 1 }, { label: 'Time vs expected', num: 1 }, { label: 'Hints', num: 1 }],
      q.rows.map((r) => [esc(themeLabel(r.theme)), esc(levelName(r.tier)),
        r.issues.length ? r.issues.map((x) => `<span class="badge warn">${esc(x.text)}</span>`).join(' ') : (r.games < q.minGames ? '<span class="muted">Too few games yet</span>' : '<span class="badge ok">Fine</span>'),
        r.puzzles ? `<button class="btn small link" type="button" data-qp-group="${esc(r.theme)}|${esc(r.tier)}" aria-label="See the ${r.puzzles} problem puzzles in ${esc(groupName(r))}">${fmt(r.puzzles)}</button>` : '0',
        fmt(r.games), pct(r.solveRate), pctRange(r.quitRate, r.quitRange), pct(r.tooHard), pct(r.tooEasy),
        r.rating == null ? '–' : `${r.rating}<br><span class="muted small">${fmt(r.rated)} rated</span>`, r.minutes ?? '–', r.timeRatio == null ? (r.timed ? `<span class="muted small">${r.timed} timed</span>` : '–') : `${r.timeRatio}×`, r.hints ?? '–']), 'No games shared in this period.')}
    <details class="qp-method"><summary>How groups are judged</summary>
      <ul>
        <li>Gave up, too hard and too easy are flagged only when we are 95% sure the share is above ${pct(q.limits.quitLow)} (gave up) or ${pct(q.limits.feelLow)} (too hard or easy), using the Wilson interval shown under each share. A few games can't raise a flag on their own.</li>
        <li>Ratings are averaged toward the overall average${q.ratingAverage ? ` (${q.ratingAverage} stars)` : ''} until a group has enough of its own (Bayesian average, ${q.limits.ratingWeight} ratings' weight), and flagged when the whole 95% range is under ${q.limits.ratingBelow} stars. Only each player's first rating of a puzzle counts.</li>
        <li>Time: each solve's time over the time the game expected, clipped to ${q.limits.clip[0]}–${q.limits.clip[1]}× so a long pause can't skew it, then the median of at least ${q.limits.minTimed} solves. Out of the normal limits: over ${q.limits.slowRatio}× (with most solves over the expected time) or under ${q.limits.fastRatio}×.</li>
        <li>Hints: a group's average compared with the level's other groups by modified z-score (median and MAD); over ${q.limits.hintZ} is an outlier.</li>
      </ul>
    </details>
    <h2 class="qp-h" id="qp-h">Problem puzzles</h2>
    <p class="muted">Puzzles a player gave up on, rated ${list.limits.lowRating} or lower, called too hard or too easy, or played outside the normal limits (over ${list.limits.slowTimes}× the expected time, ${list.limits.hints}+ hints or ${list.limits.mistakes}+ mistakes). Most problems first. The game sends a puzzle only then, with nothing about the player. Untouched ones go after 90 days.</p>
    <div class="row qp-filters">
      <div class="field inline"><label for="qp-status">Show</label><select id="qp-status">${[['active', 'All but deleted'], ['open', 'Needs fixing'], ['fixed', 'Fixed, not republished'], ['published', 'Republished'], ['retired', 'Deleted'], ['all', 'All']].map(([v, l]) => `<option value="${v}"${filter.status === v ? ' selected' : ''}>${l}${list.counts[v] != null ? ` (${list.counts[v]})` : ''}</option>`).join('')}</select></div>
      ${filter.theme || filter.tier ? `<span class="badge">${esc(themeLabel(filter.theme))} · ${esc(levelName(filter.tier))}</span><button class="btn small link" type="button" id="qp-all">Show every group</button>` : ''}
    </div>
    ${lastDeleted ? `<p class="note qp-undo" role="status">Deleted “${esc(lastDeleted.title)}”. Its story is not built again. <button class="btn small" type="button" data-qp-act="restore" data-id="${esc(lastDeleted.id)}">Undo</button></p>` : ''}
    ${list.puzzles.length ? `<ul class="qp-list">${list.puzzles.map(card).join('')}</ul>` : `<p class="muted qp-empty">${filter.status === 'active' || filter.status === 'open' ? 'No problem puzzles waiting. They appear here as players finish puzzles.' : 'None here.'}</p>`}`;
}

function card(p) {
  const { esc, fmt, when } = h;
  const [cls, words] = STATUS[p.status] || ['', p.status];
  const s = p.stats;
  const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
  const can = h.can('admin');
  const num = (v, suffix = '') => (v == null ? '–' : `${v}${suffix}`);
  const time = s.minutes != null ? `typical ${s.minutes} min${s.expected ? ` (expected ${s.expected}${s.timeRatio != null ? `; ${s.timeRatio}×` : ''})` : ''}` : '–';
  const id = esc(p.id);
  return `<li><details class="qp-card" data-qp="${id}"${open.has(p.id) ? ' open' : ''}>
    <summary><span class="qp-title"><b>${esc(p.title || 'Untitled')}</b> <span class="badge ${cls}">${esc(words)}</span></span>
      <span class="qp-sub">${esc(levelName(p.tier))} · ${esc(themeLabel(p.theme))} · ${esc(String(p.size || '').replace('x', ' × '))} · ${fmt(s.games)} ${s.games === 1 ? 'game' : 'games'}${reasons.length ? ' · ' : ''}${reasons.slice(0, 3).map(([r, n]) => `<span class="badge warn">${esc(REASONS[r] || r)}${n > 1 ? ` ×${n}` : ''}</span>`).join(' ')}</span></summary>
    <div class="qp-body">
      <dl class="qp-facts">
        <div><dt>Gave up or revealed</dt><dd>${pct(s.quitRate)}${s.quitRange && s.games > 1 ? ` <span class="muted small">(95% range ${pct(s.quitRange[0])}–${pct(s.quitRange[1])})</span>` : ''}</dd></div>
        <div><dt>Rating</dt><dd>${s.rating == null ? 'Not rated' : `${s.rating} of 5 <span class="muted small">(${s.rated} rated, average ${s.ratingRaw}; adjusted toward the overall average)</span>`}</dd></div>
        <div><dt>Solve time</dt><dd>${esc(time)}</dd></div>
        <div><dt>Hints a game</dt><dd>${num(s.hints)}</dd></div>
        <div><dt>Mistakes a game</dt><dd>${num(s.mistakes)}</dd></div>
        <div><dt>Clues</dt><dd>${num(p.clues)}</dd></div>
        <div><dt>Difficulty score</dt><dd>${num(p.score)}</dd></div>
        <div><dt>What-if steps</dt><dd>${num(p.whatif)}</dd></div>
        <div><dt>Story</dt><dd>${esc(p.story || '–')}</dd></div>
        <div><dt>Seed</dt><dd><code>${esc(p.seed || '–')}</code></dd></div>
        <div><dt>Played</dt><dd>${esc(s.modes.map((m) => ({ free: 'free play', daily: 'daily', race: 'race' }[m] || m)).join(', ') || '–')}, app ${esc(s.versions.join(', ') || '–')}</dd></div>
        <div><dt>Seen</dt><dd>${when(p.firstSeen)}${p.lastSeen !== p.firstSeen ? ` to ${when(p.lastSeen)}` : ''}</dd></div>
        ${p.updatedBy ? `<div><dt>Last changed</dt><dd>${esc(p.updatedBy)}, ${when(p.updatedAt)}</dd></div>` : ''}
        ${p.note ? `<div><dt>Note</dt><dd>${esc(p.note)}</dd></div>` : ''}
      </dl>
      <h3>Suggested fixes</h3>
      <ol class="qp-fixes">${p.suggestions.map((x, i) => `<li>${esc(x.text)}${x.action && can && p.status !== 'retired' ? ` <button class="btn small" type="button" data-qp-edit="${id}" data-qp-fix="${i}">Rebuild this way</button>` : ''}</li>`).join('')}</ol>
      <div class="row qp-actions">
        ${can ? (p.status === 'retired'
    ? `<button class="btn" type="button" data-qp-act="restore" data-id="${id}">Undo delete</button>`
    : `<button class="btn primary" type="button" data-qp-edit="${id}">Edit</button>
           ${p.status === 'published' ? `<button class="btn" type="button" data-qp-act="unpublish" data-id="${id}">Unpublish</button>` : `<button class="btn" type="button" data-qp-act="publish" data-id="${id}"${p.hasFixed ? '' : ' disabled title="Edit and save a fix first"'}>Republish</button>`}
           ${p.hasFixed && p.status !== 'published' ? `<button class="btn" type="button" data-qp-act="reset" data-id="${id}">Back to the original</button>` : ''}
           <button class="btn danger" type="button" data-qp-act="retire" data-id="${id}">Delete</button>`)
    : '<p class="note">You can see the puzzles. Changing them needs the admin role.</p>'}
        ${p.status !== 'retired' && !p.hasFixed && can ? '<span class="muted small">Republish is ready once a fix is saved.</span>' : ''}
      </div>
    </div></details></li>`;
}

// ---------- the Book maker frame (for Rebuild) ----------
let frame = null, ready = null, req = 0;
const waiting = new Map();
addEventListener('message', (e) => {
  if (!data || e.origin !== new URL(data.siteUrl).origin || !e.data) return;
  if (e.data.type === 'flg-book-ready' && e.source === frame?.contentWindow) { ready?.resolve(); return; }
  const w = waiting.get(e.data.req);
  if (w) { waiting.delete(e.data.req); w(e.data); }
});
async function rebuild(options) {
  if (!frame) {
    ready = (() => { let resolve; const p = new Promise((r) => { resolve = r; }); p.resolve = resolve; return p; })();
    frame = document.createElement('iframe');
    frame.title = 'Puzzle builder';
    frame.className = 'qp-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.src = `${data.siteUrl}/book-maker/`;
    document.body.append(frame);
  }
  await Promise.race([ready, new Promise((_, no) => setTimeout(() => no(new Error('The website did not answer. Check that it is online, then try again.')), 30000))]);
  const id = `q${++req}`;
  const m = await Promise.race([
    new Promise((resolve) => { waiting.set(id, resolve); frame.contentWindow.postMessage({ type: 'flg-puzzle-make', req: id, options }, new URL(data.siteUrl).origin); }),
    new Promise((_, no) => setTimeout(() => no(new Error('Building took too long. Try a smaller size.')), 120000)),
  ]);
  if (m.type === 'flg-book-error') throw new Error(m.message);
  return m.puzzle;
}

// ---------- Edit ----------
let editing = null; // { id, base, rebuilt }
function dialog() {
  let dlg = $('#qp-dialog');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'qp-dialog';
  dlg.className = 'qp-dialog';
  dlg.setAttribute('aria-labelledby', 'qp-d-title');
  document.body.append(dlg);
  return dlg;
}

function preview(p) {
  const { esc } = h;
  return `<h4>${esc(p.title)}</h4>
    <p class="muted">${esc(p.difficulty?.name || '')} · ${esc(p.theme?.name || '')} · ${p.categories.length} × ${p.categories[0].items.length} · ${p.clues.length} clues${p.stats?.stepsByLevel?.whatIf != null ? ` · ${p.stats.stepsByLevel.whatIf} what-if steps` : ''}</p>
    <p class="qp-cats">${p.categories.map((c) => `<b>${esc(c.name)}:</b> ${c.items.map((it) => esc(it.label)).join(', ')}`).join('<br>')}</p>
    <ol class="qp-clues">${p.clues.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol>`;
}

function fillEdit(p, { note = '' } = {}) {
  const { esc } = h;
  const levels = data.levels.map((l) => `<option value="${esc(l.id)}"${l.id === p.difficulty.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
  const K = p.categories.length, N = p.categories[0].items.length;
  $('#qp-dialog').innerHTML = `<form method="dialog" id="qp-form" class="stack" novalidate>
    <div class="row qp-d-head"><h2 id="qp-d-title">Edit puzzle</h2><button class="btn small" type="button" id="qp-x" aria-label="Close without saving">Close</button></div>
    <p class="muted">Word changes keep the clues and answer as they are. Rebuild makes a new puzzle with the game's own engine, checked to have exactly one answer.</p>
    <div class="field"><label for="qp-title">Title</label><input id="qp-title" maxlength="120" value="${esc(p.title)}"></div>
    <div class="field"><label for="qp-story">Story</label><textarea id="qp-story" rows="7" aria-describedby="qp-story-h">${esc((p.story?.paragraphs || []).join('\n\n'))}</textarea><span class="muted" id="qp-story-h">Leave a blank line between paragraphs.</span></div>
    <div class="field"><label for="qp-ending">Ending (shown after the solve)</label><textarea id="qp-ending" rows="2">${esc(p.story?.ending || '')}</textarea></div>
    <fieldset class="qp-rebuild"><legend>Rebuild</legend>
      <div class="row">
        <div class="field"><label for="qp-level">Level</label><select id="qp-level">${levels}</select></div>
        <div class="field"><label for="qp-k">Categories</label><input id="qp-k" type="number" min="3" max="6" value="${K}"></div>
        <div class="field"><label for="qp-n">Items</label><input id="qp-n" type="number" min="3" max="8" value="${N}"></div>
      </div>
      <label class="check"><input type="checkbox" id="qp-newseed"> New story (a new seed)</label>
      <div class="row"><button class="btn" type="button" id="qp-rebuild">Rebuild puzzle</button><span class="muted" id="qp-rebuild-state" role="status" aria-live="polite"></span></div>
    </fieldset>
    <div class="field"><label for="qp-note">Note for the team (optional)</label><input id="qp-note" maxlength="500" value="${esc(note)}"></div>
    <details class="qp-preview" open><summary>Preview: clues and names</summary><div id="qp-preview">${preview(p)}</div></details>
    <p class="error-box" id="qp-err" role="alert" hidden></p>
    <div class="row"><button class="btn primary" type="submit" id="qp-save">Save fix</button><button class="btn" type="button" id="qp-cancel">Cancel</button></div>
  </form>`;
}

async function openEdit(id, fixIndex = null) {
  const one = await h.api(`quality-puzzles/${encodeURIComponent(id)}`);
  const base = one.fixed || one.puzzle;
  editing = { id, base, rebuilt: null };
  const dlg = dialog();
  fillEdit(base, { note: one.note || '' });
  const back = document.activeElement;
  const close = () => { dlg.close(); editing = null; back?.focus?.(); };
  const err = (msg) => { const b = $('#qp-err'); b.textContent = msg; b.hidden = !msg; };
  const p = data.puzzles.find((x) => x.id === id);
  const fix = fixIndex != null ? p?.suggestions[fixIndex]?.action : null;
  if (fix) {
    if (fix.difficulty) $('#qp-level').value = fix.difficulty;
    if (fix.categories) $('#qp-k').value = fix.categories;
    if (fix.items) $('#qp-n').value = fix.items;
    if (fix.difficulty && !fix.categories) { const l = data.levels.find((x) => x.id === fix.difficulty); if (l) { $('#qp-k').value = l.categories[0]; $('#qp-n').value = l.items[0]; } }
    $('#qp-newseed').checked = !!fix.newSeed;
  }
  $('#qp-x').onclick = close;
  $('#qp-cancel').onclick = close;
  dlg.oncancel = (e) => { e.preventDefault(); close(); };
  $('#qp-rebuild').onclick = async (e) => {
    const btn = e.currentTarget;
    err('');
    const k = Number($('#qp-k').value), n = Number($('#qp-n').value);
    if (!(k >= 3 && k <= 6 && n >= 3 && n <= 8)) { err('Use 3 to 6 categories and 3 to 8 items.'); return; }
    btn.disabled = true;
    $('#qp-rebuild-state').textContent = 'Building… a big hard puzzle can take a minute.';
    try {
      const o = editing.base.options || {};
      const puzzle = await rebuild({
        difficulty: $('#qp-level').value, theme: editing.base.theme.id, topic: $('#qp-newseed').checked ? undefined : o.topic,
        categories: k, items: n, seed: $('#qp-newseed').checked ? undefined : editing.base.seed,
        usedStories: $('#qp-newseed').checked && editing.base.story?.id ? [editing.base.story.id] : undefined,
      });
      editing.rebuilt = puzzle;
      $('#qp-title').value = puzzle.title;
      $('#qp-story').value = (puzzle.story?.paragraphs || []).join('\n\n');
      $('#qp-ending').value = puzzle.story?.ending || '';
      $('#qp-preview').innerHTML = preview(puzzle);
      $('#qp-rebuild-state').textContent = `Rebuilt: ${puzzle.difficulty.name}, ${puzzle.categories.length} × ${puzzle.categories[0].items.length}, ${puzzle.clues.length} clues. Save to keep it.`;
      h.announce('Puzzle rebuilt. Check the preview, then save.');
    } catch (x) {
      $('#qp-rebuild-state').textContent = '';
      err(x.message);
    } finally { btn.disabled = false; }
  };
  $('#qp-form').onsubmit = async (e) => {
    e.preventDefault();
    err('');
    const btn = $('#qp-save');
    const body = {
      title: $('#qp-title').value, paragraphs: $('#qp-story').value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean),
      ending: $('#qp-ending').value, note: $('#qp-note').value, ...(editing.rebuilt ? { puzzle: editing.rebuilt } : {}),
    };
    btn.disabled = true;
    try {
      await h.api(`quality-puzzles/${encodeURIComponent(id)}/save`, { method: 'POST', body });
      open.add(id);
      close();
      h.toast('Fix saved. Republish it to give it to players.');
      h.announce('Fix saved.');
      await h.show('quality', { keepFocus: true });
    } catch (x) { err(x.message); } finally { btn.disabled = false; }
  };
  dlg.showModal();
  $('#qp-title').focus();
}

// ---------- the other actions ----------
const CONFIRM = {
  retire: { title: 'Delete this puzzle?', text: 'Its story is retired: no game builds it again, and a republished fix is taken off the Hand-picked list. You can undo this.', ok: 'Delete', danger: true },
  reset: { title: 'Go back to the original?', text: 'The saved fix is dropped and the puzzle shows as players got it.', ok: 'Drop the fix', danger: true },
};
const DONE = {
  publish: 'Republished: players find it in Hand-picked puzzles.', unpublish: 'Taken off the Hand-picked list.', retire: 'Deleted. Its story is not built again.',
  restore: 'Delete undone.', reset: 'Back to the original.',
};

export function initQuality(helpers, show) {
  h = { ...helpers, show };
  $('#quality-body').addEventListener('change', (e) => {
    if (e.target.id === 'qp-status') { filter.status = e.target.value; show('quality', { keepFocus: true }); }
  });
  $('#quality-body').addEventListener('toggle', (e) => {
    const d = e.target.closest?.('[data-qp]');
    if (d) { if (d.open) open.add(d.dataset.qp); else open.delete(d.dataset.qp); }
  }, true);
  $('#quality-body').addEventListener('click', async (e) => {
    const g = e.target.closest('[data-qp-group]');
    if (g) {
      [filter.theme, filter.tier] = g.dataset.qpGroup.split('|');
      filter.status = 'all';
      await show('quality', { keepFocus: true });
      $('#qp-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#qp-status')?.focus();
      return;
    }
    if (e.target.id === 'qp-all') { filter.theme = ''; filter.tier = ''; show('quality', { keepFocus: true }); return; }
    const ed = e.target.closest('[data-qp-edit]');
    if (ed) {
      ed.disabled = true;
      try { await openEdit(ed.dataset.qpEdit, ed.dataset.qpFix != null ? Number(ed.dataset.qpFix) : null); } catch (x) { h.toast(x.message); } finally { ed.disabled = false; }
      return;
    }
    const b = e.target.closest('[data-qp-act]');
    if (!b) return;
    const what = b.dataset.qpAct;
    if (CONFIRM[what] && !(await h.ask(CONFIRM[what]))) return;
    const id = b.dataset.id;
    const ok = await h.act(b, () => h.api(`quality-puzzles/${encodeURIComponent(id)}/${what}`, { method: 'POST', body: {} }));
    if (!ok) return;
    open.add(id);
    // Delete can be undone straight away, from the notice above the list.
    lastDeleted = what === 'retire' ? { id, title: data.puzzles.find((x) => x.id === id)?.title || 'the puzzle' } : null;
    h.toast(DONE[what]);
    h.announce(DONE[what]);
    await show('quality', { keepFocus: true });
    if (what === 'retire') $('.qp-undo button')?.focus();
  });
}
