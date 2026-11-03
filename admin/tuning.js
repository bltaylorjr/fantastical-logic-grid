// Self-tuning on the Analysis page (server/src/tuning.js). The game suggests
// small, bounded changes from its own numbers; nothing changes until an admin
// approves (or the owner has pre-approved that kind of change). Each applied
// change is measured after a set time and can be undone at any time.

const $ = (s, el = document) => el.querySelector(s);

let H = null;
let data = null;

const LEVELS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };
const VERDICT = { helped: ['Helped', 'ok'], no_change: ['No clear change', ''], worse: ['Made it worse', 'bad'], not_enough: ['Too few games to tell', ''] };
const STATUS = { declined: 'Declined', expired: 'Not answered in time', undone: 'Undone', replaced: 'Changed by hand first', applied: 'Applied' };

// A value in plain words, for the target it belongs to.
function show(target, v) {
  if (v == null) return '–';
  if (target.startsWith('nudge:effort:')) return v === 0 ? 'as players taught it' : `${v > 0 ? 'tougher' : 'gentler'} by ${Math.abs(v).toFixed(1)}`;
  if (target.startsWith('nudge:theme:')) return v === 1 ? 'normal' : `${v > 1 ? 'more' : 'less'} often (x${Number(v).toFixed(2)})`;
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  return LEVELS[v] || String(v);
}

function card(p) {
  const k = data.kinds[p.kind];
  return `<li class="tn-card${p.kind === 'undo' ? ' tn-undo' : ''}">
    <h4>${H.esc(p.label)}</h4>
    <p><b>Why:</b> ${H.esc(p.reason)}</p>
    <p><b>Change:</b> ${H.esc(show(p.target, p.from))} <span aria-hidden="true">→</span><span class="sr-only">to</span> <b>${H.esc(show(p.target, p.to))}</b>${k ? ` <span class="muted">(limits: ${H.esc(k.limits)})</span>` : ''}</p>
    <p><b>Then we check:</b> ${H.esc(p.watch)} <span class="muted">Result after ${H.fmt(data.measureDays)} days; you can undo it any time.</span></p>
    <p class="muted small">Suggested ${H.esc(H.when(p.createdAt))}</p>
    ${H.can('admin') ? `<div class="row"><button class="btn primary" type="button" data-tn="approve" data-id="${p.id}">Approve</button><button class="btn" type="button" data-tn="decline" data-id="${p.id}">Decline</button></div>` : '<p class="muted">An admin can approve or decline this.</p>'}
  </li>`;
}

function measuring(p) {
  const r = p.result;
  const [w, cls] = r ? VERDICT[r.verdict] || [r.verdict, ''] : [];
  return `<li class="tn-card">
    <h4>${H.esc(p.label)} ${p.auto ? '<span class="badge">Pre-approved</span>' : ''}</h4>
    <p>${H.esc(show(p.target, p.from))} <span aria-hidden="true">→</span><span class="sr-only">to</span> <b>${H.esc(show(p.target, p.to))}</b>, applied ${H.esc(H.when(p.decidedAt))}${p.auto ? '' : ` by ${H.esc(p.decidedBy)}`}.</p>
    <p>${r ? `<span class="badge ${cls}">${w}</span> ${H.esc(r.text)}` : `<span class="badge">Measuring</span> Result on ${H.esc(H.day(p.checkAt))}. Watching: ${H.esc(p.watch)}`}</p>
    ${H.can('admin') ? `<div class="row"><button class="btn" type="button" data-tn="undo" data-id="${p.id}">Undo</button></div>` : ''}
  </li>`;
}

function rulesHtml() {
  const owner = H.can('owner');
  const rows = Object.entries(data.kinds).map(([k, v]) => {
    const mode = data.rules[k];
    const ctl = owner
      ? `<select data-tn-rule="${k}" aria-label="${H.esc(v.label)}"><option value="ask"${mode === 'ask' ? ' selected' : ''}>Ask me first</option><option value="auto"${mode === 'auto' ? ' selected' : ''}>Pre-approved</option></select>`
      : (mode === 'auto' ? 'Pre-approved' : 'Ask me first');
    return [H.esc(v.label), H.esc(v.limits), ctl];
  });
  return `<p class="muted">Pre-approved changes apply by themselves at the nightly check, still within their limits, still measured and still undoable, and you get an alert. ${owner ? '' : 'Only the owner can change these.'} Taking back a change that made things worse always asks first.</p>
    ${H.table([{ label: 'Kind of change' }, { label: 'Limits' }, { label: 'Approval' }], rows, '', { csv: false })}`;
}

function historyHtml() {
  const rows = data.history.map((p) => [H.esc(H.day(p.decidedAt || p.createdAt)), H.esc(p.label),
    H.esc(p.status === 'applied' ? 'Applied' : STATUS[p.status] || p.status) + (p.result ? ` · ${H.esc((VERDICT[p.result.verdict] || [p.result.verdict])[0])}` : ''),
    H.esc(p.note || (p.result ? p.result.text : '') || '–')]);
  return H.table([{ label: 'Date' }, { label: 'Change' }, { label: 'What happened' }, { label: 'Note' }], rows, 'Nothing yet.');
}

function render() {
  const box = $('#an-tuning');
  if (!box) return;
  if (!data) { box.innerHTML = '<h2>Self-tuning</h2><p class="muted">Self-tuning could not be read right now.</p>'; return; }
  const n = data.waiting.length;
  H.setCount('#count-analysis', n);
  box.innerHTML = `<div class="tn-head"><h2 tabindex="-1">Self-tuning ${n ? `<span class="badge warn">${n} waiting</span>` : ''}</h2>
      ${H.can('admin') ? '<button class="btn" type="button" data-tn="check">Check now</button>' : ''}</div>
    <p>The game suggests small changes from these numbers. <b>Nothing changes until you approve it.</b> Each change is measured after ${H.fmt(data.measureDays)} days, and you can undo it at any time. It checks every night at 2 am.</p>
    <h3>Waiting for your OK</h3>
    ${n ? `<ul class="tn-list">${data.waiting.map(card).join('')}</ul>`
      : `<p class="muted">Nothing waiting. A level or theme needs at least ${H.fmt(data.minGames)} games in the last ${H.fmt(data.windowDays)} days before the game suggests a change, so with few players there may be nothing to tune yet.${data.lastSuggestion ? ` Last suggestion ${H.esc(H.when(data.lastSuggestion))}.` : ''}</p>`}
    ${data.applied.length ? `<h3>Applied</h3><ul class="tn-list">${data.applied.map(measuring).join('')}</ul>` : ''}
    <details class="an-more"><summary>History (${H.fmt(data.history.length)})</summary>${historyHtml()}</details>
    <details class="an-more"><summary>Pre-approval</summary>${rulesHtml()}</details>`;
}

export async function loadTuning(helpers) {
  H = helpers;
  try { data = await H.api('tuning'); } catch (e) { data = null; }
  render();
}

export function initTuning(helpers) {
  H = helpers;
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('#an-tuning button[data-tn]');
    if (!b) return;
    const id = b.dataset.id;
    const kind = b.dataset.tn;
    let ok = false;
    if (kind === 'check') {
      let r = null;
      ok = await H.act(b, async () => { r = await H.api('tuning/check', { method: 'POST' }); });
      if (ok) { const msg = r.added || r.applied || r.undos ? `${r.added + r.undos} new suggestion${r.added + r.undos === 1 ? '' : 's'}${r.applied ? `, ${r.applied} applied by pre-approval` : ''}.` : 'Checked: nothing new to suggest.'; H.toast(msg); H.announce(msg); }
    } else if (kind === 'approve') {
      ok = await H.act(b, () => H.api(`tuning/${id}/approve`, { method: 'POST' }), 'Approved and applied. You can undo it any time.');
    } else if (kind === 'decline') {
      const v = await H.ask({ title: 'Decline this change', text: 'It will not be suggested again for 30 days.', fields: [{ name: 'note', label: 'Why not? (optional, for the history)', type: 'textarea' }], ok: 'Decline' });
      if (!v) return;
      ok = await H.act(b, () => H.api(`tuning/${id}/decline`, { method: 'POST', body: { note: v.note } }), 'Declined.');
    } else if (kind === 'undo') {
      const v = await H.ask({ title: 'Undo this change', text: 'The value goes back to what it was before. It will not be suggested again for 30 days.', ok: 'Undo' });
      if (!v) return;
      ok = await H.act(b, () => H.api(`tuning/${id}/undo`, { method: 'POST' }), 'Undone.');
    }
    if (ok) { await loadTuning(H); $('#an-tuning h2')?.focus?.(); }
  });
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('#an-tuning select[data-tn-rule]');
    if (!sel) return;
    const words = sel.value === 'auto' ? 'Pre-approved.' : 'Set to ask first.';
    const ok = await H.act(sel, () => H.api('tuning/rules', { method: 'POST', body: { kind: sel.dataset.tnRule, mode: sel.value } }), words);
    if (!ok) await loadTuning(H);
  });
}
