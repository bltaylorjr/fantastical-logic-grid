// Educator requests: free printable puzzle packages asked for on the
// website's Educators page (server/src/educators.js). The educator has
// confirmed their school email with a code before a request shows as waiting.
// Approve and the package is made and emailed as PDFs within about 10
// minutes; decline and they get a polite email with your note.
const $ = (s, el = document) => el.querySelector(s);

let h = null; // helpers from admin.js
let status = 'pending';

const TABS = [
  ['pending', 'Waiting for review'],
  ['open', 'Approved, being made'],
  ['sent', 'Sent'],
  ['unverified', 'Email not confirmed yet'],
  ['declined', 'Declined'],
  ['all', 'All'],
];
const STATUS_WORDS = {
  unverified: ['Email not confirmed', ''], pending: ['Waiting for review', 'warn'], approved: ['Approved, waiting to be made', 'ok'], building: ['Being made', 'ok'],
  sent: ['Sent', 'ok'], declined: ['Declined', ''], failed: ['Could not be made', 'bad'], expired: ['Expired (never confirmed)', ''],
};
const DOMAIN = {
  school: ['School address', 'ok', 'The address is on a school, district or college domain.'],
  unknown: ['Check the school', 'warn', 'The address is not on a known school domain. Look the school up before approving.'],
  personal: ['Personal email', 'bad', 'A personal mailbox (allowed under Settings and switches > Educators). Check before approving.'],
};
const TIER = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'Quantum Physicist', theorist: 'Theoretical Physicist' };
const GRADE = (g) => (g === 'k' ? 'Kindergarten' : g === 'college' ? 'College and adult' : `Grade ${g}`);
const KEYS = { separate: 'Answer keys in a separate file', after: 'Answer key after each puzzle', none: 'No answer keys' };

function details(r) {
  const q = r.request;
  const e = h.esc;
  const diff = q.difficulty === 'grade' ? 'Suited to the grade' : q.difficulty === 'progressive' ? 'Builds up from easier to harder' : TIER[q.difficulty] || q.difficulty;
  const size = q.size === 'grade' ? 'Suited to the grade' : q.size.replace('x', ' categories × ') + ' items';
  const extras = [KEYS[q.keys], q.solutions && 'worked solutions', q.largePrint && 'large print', q.paper === 'a4' ? 'A4 paper' : 'US Letter', `${q.questions} question${q.questions === 1 ? '' : 's'} each`,
    q.clueTypes?.length && `clue types: ${q.clueTypes.join(', ')}`].filter(Boolean).join(' · ');
  let theme;
  if (q.source === 'custom' && q.custom) {
    const c = q.custom;
    theme = `<p><b>Own theme:</b> ${e(c.theme)}${c.title ? ` (title "${e(c.title)}")` : ''}</p>
      ${c.story ? `<blockquote>${e(c.story)}</blockquote>` : ''}
      <p><b>Cast:</b> ${e(c.cast.many)}${c.names.length ? `: ${e(c.names.join(', '))}` : ' (names chosen for them)'}</p>
      <ul>${c.categories.map((x) => `<li><b>${e(x.name)}</b>${x.order ? ' (in order)' : ''}: ${e(x.items.join(', '))}${x.pos ? ` <span class="muted">"${e(x.pos)} …" / "${e(x.neg)} …"</span>` : ''}</li>`).join('')}</ul>`;
  } else {
    theme = `<p><b>Themes:</b> ${q.themes.length ? e(q.themes.map((t) => t.replace('/any', '').replace('/', ': ')).join(', ')) : 'A mix of all themes'}${q.names?.length ? ` · <b>Character names:</b> ${e(q.names.join(', '))}` : ''}</p>`;
  }
  return `${theme}<p><b>Difficulty:</b> ${e(diff)} · <b>Grid:</b> ${e(size)}</p><p class="muted">${e(extras)}</p>
    ${q.title ? `<p><b>Package title:</b> ${e(q.title)}</p>` : ''}${q.note ? `<p><b>Their note:</b></p><blockquote>${e(q.note)}</blockquote>` : ''}`;
}

function card(r) {
  const e = h.esc;
  const [sw, scls] = STATUS_WORDS[r.status] || [r.status, ''];
  const [dw, dcls, dwhy] = DOMAIN[r.domainKind] || DOMAIN.unknown;
  const canReview = h.can('moderator');
  const actions = [
    ['pending', 'failed', 'declined'].includes(r.status) && canReview && `<button class="btn small primary" type="button" data-edu-approve="${r.id}">${r.status === 'pending' ? 'Approve and send' : 'Approve again'}</button>`,
    ['pending', 'failed', 'approved'].includes(r.status) && canReview && `<button class="btn small" type="button" data-edu-decline="${r.id}">Decline</button>`,
    h.can('admin') && `<button class="btn small danger" type="button" data-edu-delete="${r.id}">Delete</button>`,
  ].filter(Boolean).join('');
  return `<article class="card stack edu-card" aria-labelledby="edu-${r.id}">
    <div class="row"><h2 id="edu-${r.id}" class="grow">${e(r.name)}, ${e(r.school)}</h2><span class="badge ${scls}">${e(sw)}</span></div>
    <p><bdi>${e(r.email)}</bdi> <span class="badge ${dcls}" title="${e(dwhy)}">${e(dw)}</span> · ${e(r.role)}${r.request.district ? ` · ${e(r.request.district)}` : ''}</p>
    ${r.campaign ? `<p class="muted">Came from: ${e(r.campaign.s)}${r.campaign.c && !r.campaign.c.startsWith('(') ? ` · campaign <code>${e(r.campaign.c)}</code>${r.campaign.k ? `, ad <code>${e(r.campaign.k)}</code>` : ''}` : ''}</p>` : ''}
    <p><b>${e(GRADE(r.grade))}</b> · <b>${h.fmt(r.count)} ${r.count === 1 ? 'puzzle' : 'puzzles'}</b> · request ${e(r.ref)} · asked ${h.when(r.createdAt)}${r.verifiedAt ? ` · email confirmed ${h.when(r.verifiedAt)}` : ''}</p>
    ${details(r)}
    ${r.reviewedBy ? `<p class="muted">${r.status === 'declined' ? 'Declined' : 'Approved'} by ${e(r.reviewedBy)} ${h.when(r.reviewedAt)}${r.note ? `: ${e(r.note)}` : ''}</p>` : ''}
    ${r.sentAt ? `<p class="muted">Emailed ${h.when(r.sentAt)} (${h.fmt(r.puzzles)} puzzles).</p>` : ''}
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </article>`;
}

export async function educatorsView(helpers) {
  h = helpers;
  const d = await h.api(`educators?status=${status}`);
  const c = d.counts || {};
  const n = (k) => (k === 'open' ? (c.approved || 0) + (c.building || 0) + (c.failed || 0) : k === 'all' ? Object.values(c).reduce((a, b) => a + b, 0) : c[k] || 0);
  h.setCount('#count-educators', c.pending || 0);
  $('#edu-tabs').innerHTML = TABS.map(([k, label]) => `<button type="button" class="btn small" data-edu-tab="${k}" aria-pressed="${k === status}">${label} <span class="n">${h.fmt(n(k))}</span></button>`).join('');
  $('#edu-speed').textContent = d.dispatch ? 'Packages and code emails go out within about 2 minutes.' : 'Packages and code emails go out within about 10 minutes (every 5 minutes). For faster emails, see Connections and setup > Educator emails straight away.';
  $('#edu-list').innerHTML = d.requests.length ? d.requests.map(card).join('') : '<p class="muted">No requests here.</p>';
}

export function initEducators(helpers, show) {
  h = helpers;
  $('#edu-tabs').onclick = (e) => {
    const b = e.target.closest('[data-edu-tab]');
    if (!b) return;
    status = b.dataset.eduTab;
    show('educators', { keepFocus: true });
  };
  $('#edu-list').onclick = async (e) => {
    const ap = e.target.closest('[data-edu-approve]');
    const de = e.target.closest('[data-edu-decline]');
    const del = e.target.closest('[data-edu-delete]');
    if (ap) {
      const v = await h.ask({ title: 'Approve this package?', text: 'The puzzles are made and emailed to the educator\'s confirmed address as PDFs.', fields: [{ name: 'note', label: 'Note for your records (optional, not emailed)' }], ok: 'Approve and send' });
      if (v && (await h.act(ap, () => h.api(`educators/${ap.dataset.eduApprove}/approve`, { method: 'POST', body: { note: v.note } }), 'Approved. The package is on its way.'))) show('educators', { keepFocus: true });
    } else if (de) {
      const v = await h.ask({
        title: 'Decline this request?', text: 'The educator gets a polite email saying it could not be approved, with your note.',
        fields: [{ name: 'note', label: 'Note to the educator (emailed, keep it kind and plain)', type: 'textarea' }, { name: 'email', label: 'Email them', type: 'select', value: 'yes', options: [['yes', 'Yes, email the note'], ['no', 'No email']] }],
        ok: 'Decline', danger: true,
      });
      if (v && (await h.act(de, () => h.api(`educators/${de.dataset.eduDecline}/decline`, { method: 'POST', body: { note: v.note, email: v.email === 'yes' } }), 'Declined.'))) show('educators', { keepFocus: true });
    } else if (del) {
      if (!(await h.ask({ title: 'Delete this request?', text: 'It is removed for good. A sent package\'s stories may then be used again in a later package.', ok: 'Delete', danger: true }))) return;
      if (await h.act(del, () => h.api(`educators/${del.dataset.eduDelete}/delete`, { method: 'POST' }), 'Deleted.')) show('educators', { keepFocus: true });
    }
  };
}

// ---------------------------------------------------------------- Educator feedback
// Ideas, problems and feedback from educators, sent from the private section
// that opens with the link in their package email, plus the survey results.
// Answering emails the educator your answer (plain, kind words).
let fbStatus = 'new';
const FB_TABS = [['new', 'New'], ['addressed', 'Answered'], ['all', 'All'], ['survey', 'Survey results']];
const KIND = { idea: ['Idea', 'ok'], problem: ['Problem', 'bad'], feedback: ['Feedback', 'warn'] };

function feedbackCard(f) {
  const e = h.esc;
  const [kw, kcls] = KIND[f.kind] || [f.kind, ''];
  const actions = [
    f.status === 'new' && h.can('moderator') && `<button class="btn small primary" type="button" data-efb-answer="${f.id}">Answer</button>`,
    f.status === 'addressed' && h.can('moderator') && `<button class="btn small" type="button" data-efb-answer="${f.id}">Change answer</button>`,
    h.can('admin') && `<button class="btn small danger" type="button" data-efb-delete="${f.id}">Delete</button>`,
  ].filter(Boolean).join('');
  return `<article class="card stack" aria-labelledby="efb-${f.id}">
    <div class="row"><h2 id="efb-${f.id}" class="grow">${e(f.name)}, ${e(f.school)}</h2><span class="badge ${kcls}">${e(kw)}</span>${f.status === 'addressed' ? '<span class="badge ok">Answered</span>' : ''}</div>
    <p><bdi>${e(f.email)}</bdi> · ${e(GRADE(f.grade))} · package ${e(f.ref)} (${h.fmt(f.puzzles || 0)} puzzles) · sent ${h.when(f.createdAt)}</p>
    <blockquote>${e(f.text).replace(/\n/g, '<br>')}</blockquote>
    ${f.status === 'addressed' ? `<p class="muted">Answered by ${e(f.addressedBy || '')} ${h.when(f.addressedAt)}${f.replyMail ? ' (email waiting to go)' : ''}:</p><blockquote>${e(f.note || '')}</blockquote>` : ''}
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </article>`;
}

function surveyHtml(d) {
  const e = h.esc;
  if (!d.responses) return '<p class="muted">No survey answers yet. Educators get the survey link with their package.</p>';
  const qs = d.questions.map((q) => {
    const max = Math.max(1, ...q.counts);
    const base = q.type === 'many' ? d.responses : Math.max(1, q.answered);
    return `<article class="card stack"><h2>${e(q.q)}</h2><p class="muted">${h.fmt(q.answered)} of ${h.fmt(d.responses)} answered${q.type === 'many' ? ' (more than one allowed)' : ''}</p>
      <table class="efb-table"><tbody>${q.options.map((o, i) => `<tr><td>${e(o)}</td><td class="num">${h.fmt(q.counts[i])}</td><td class="num">${Math.round((100 * q.counts[i]) / base)}%</td>
      <td class="bar-cell"><span class="efb-bar" style="width:${Math.round((100 * q.counts[i]) / max)}%"></span></td></tr>`).join('')}</tbody></table></article>`;
  }).join('');
  const comments = d.comments.length ? `<article class="card stack"><h2>Comments</h2>${d.comments.map((c) => `<blockquote>${e(c.text).replace(/\n/g, '<br>')}</blockquote><p class="muted">${e(c.name)}, ${e(c.school)} · ${e(GRADE(c.grade))} · ${h.when(c.at)}</p>`).join('')}</article>` : '';
  return `<p><b>${h.fmt(d.responses)}</b> ${d.responses === 1 ? 'educator has' : 'educators have'} answered the survey.</p>${qs}${comments}`;
}

export async function educatorFeedbackView(helpers) {
  h = helpers;
  const d = await h.api(`educators/feedback?status=${fbStatus === 'survey' ? 'new' : fbStatus}`);
  const c = d.counts || {};
  const n = { new: c.new || 0, addressed: c.addressed || 0, all: (c.new || 0) + (c.addressed || 0), survey: d.surveys || 0 };
  h.setCount('#count-edu-feedback', c.new || 0);
  $('#efb-tabs').innerHTML = FB_TABS.map(([k, label]) => `<button type="button" class="btn small" data-efb-tab="${k}" aria-pressed="${k === fbStatus}">${label} <span class="n">${h.fmt(n[k])}</span></button>`).join('');
  if (fbStatus === 'survey') { $('#efb-list').innerHTML = surveyHtml(await h.api('educators/survey')); return; }
  $('#efb-list').innerHTML = d.items.length ? d.items.map(feedbackCard).join('') : '<p class="muted">Nothing here.</p>';
}

export function initEducatorFeedback(helpers, show) {
  h = helpers;
  $('#efb-tabs').onclick = (e) => {
    const b = e.target.closest('[data-efb-tab]');
    if (!b) return;
    fbStatus = b.dataset.efbTab;
    show('edu-feedback', { keepFocus: true });
  };
  $('#efb-list').onclick = async (e) => {
    const an = e.target.closest('[data-efb-answer]');
    const del = e.target.closest('[data-efb-delete]');
    if (an) {
      const v = await h.ask({
        title: 'Answer this educator',
        text: 'Write in plain, everyday words: what you did about it, and the version if something changed. The educator sees it in their section.',
        fields: [{ name: 'note', label: 'Your answer', type: 'textarea' }, { name: 'email', label: 'Email them the answer', type: 'select', value: 'yes', options: [['yes', 'Yes, email it'], ['no', 'No email']] }],
        ok: 'Save answer',
      });
      if (v && (await h.act(an, () => h.api(`educators/feedback/${an.dataset.efbAnswer}/address`, { method: 'POST', body: { note: v.note, email: v.email === 'yes' } }), 'Answered.'))) show('edu-feedback', { keepFocus: true });
    } else if (del) {
      if (!(await h.ask({ title: 'Delete this note?', text: 'It is removed for good.', ok: 'Delete', danger: true }))) return;
      if (await h.act(del, () => h.api(`educators/feedback/${del.dataset.efbDelete}/delete`, { method: 'POST' }), 'Deleted.')) show('edu-feedback', { keepFocus: true });
    }
  };
}
