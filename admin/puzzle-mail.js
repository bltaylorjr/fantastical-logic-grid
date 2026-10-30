// Puzzle emails: the weekly puzzle and special edition puzzles by email
// (server/src/puzzle-mail.js, server/src/editions.js). How many are on each
// list, each send so far, the special edition planner, and finding, adding
// or removing an address. Addresses are only shown when an admin searches.
const $ = (s, el = document) => el.querySelector(s);

let h = null; // helpers from admin.js
let mail = null; // the last GET /admin/v1/mail
let eds = null; // the last GET /admin/v1/specials
const SIZES = ['3x3', '3x4', '3x5', '4x4', '4x5', '5x5', '5x6', '6x6', '6x7', '6x8'];
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const sendName = (s) => {
  if (s.startsWith('weekly-')) return `Puzzle of the week, ${longDay(s.slice(7))}`;
  const e = eds && eds.specials.find((x) => `special-${x.id}` === s);
  return e ? `Special edition: ${e.title}` : 'Special edition';
};
const onOff = (v) => `<span class="badge ${v ? 'ok' : 'warn'}">${v ? 'On' : 'Off'}</span>`;

export async function puzzleMailView() {
  [mail, eds] = await Promise.all([h.api('mail'), h.api('specials')]);
  const c = mail.counts;
  const sw = mail.switches;
  const theme = (id) => (eds.themes.find((t) => t.id === id) || {}).name || 'Automatic';
  const tier = (id) => (eds.tiers.find((t) => t.id === id) || {}).name || 'Hard (automatic)';
  const rows = eds.specials.slice().reverse().map((e) => [
    `<b>${h.esc(longDay(e.date))}</b>`,
    `<b>${h.esc(e.title)}</b><br><span class="muted">${h.esc(e.note)}</span>${e.puzzle ? `<br>Puzzle: ${h.esc(e.puzzle.title)} <span class="muted">(${h.esc(e.puzzle.opening)})</span>` : ''}`,
    `${h.esc(theme(e.theme))}<br>${h.esc(tier(e.difficulty))}${e.categories ? `<br>${e.categories} × ${e.items}` : ''}`,
    e.status === 'cancelled' ? '<span class="badge">Cancelled</span>' : e.locked ? `<span class="badge ok">Out</span> ${h.fmt(e.sent)} sent` : '<span class="badge warn">Planned</span>',
    h.can('admin') && !e.locked && e.status === 'planned' ? `<div class="row"><button class="btn small" type="button" data-se-edit="${h.esc(e.id)}">Change</button><button class="btn small" type="button" data-se-cancel="${h.esc(e.id)}">Cancel</button></div>` : '',
  ]);
  $('#mail-body').innerHTML = `
    <div class="tiles">${h.tile('Puzzle of the week list', h.fmt(c.weekly))}${h.tile('Special edition list', h.fmt(c.special))}${h.tile('People on a list', h.fmt(c.people), `${h.fmt(c.players)} with an account`)}${h.tile('Waiting to confirm', h.fmt(c.waiting), 'removed after 7 days')}${h.tile('Sent today', h.fmt(mail.today), `of ${h.fmt(mail.cap)} a day`)}</div>
    <p>Sign-ups ${onOff(sw.puzzle_mail_enabled)} · Puzzle of the week ${onOff(sw.weekly_mail_enabled)} · Special editions ${onOff(sw.special_mail_enabled)} <a href="#settings">Change in Settings and switches</a></p>
    <h2>Special editions</h2>
    <p class="muted">A one-off puzzle with a brand-new story, emailed on its day from about 7 am Eastern to everyone on the special edition list, and shown in the game under Special editions. Its puzzle is made in the nightly site build before its day; you can change or cancel it until then.</p>
    ${h.can('admin') ? '<div class="row"><button class="btn primary" type="button" id="se-new">Plan a special edition</button></div>' : ''}
    ${h.table([{ label: 'Day (UTC)' }, { label: 'Edition' }, { label: 'Puzzle' }, { label: 'Status' }, { label: 'Actions' }], rows, 'No special editions yet.', { csv: false })}
    <h2>Sends so far</h2>
    ${h.table([{ label: 'Send' }, { label: 'Emails', num: 1 }, { label: 'Started' }, { label: 'Last' }], mail.sends.map((s) => [h.esc(sendName(s.send)), h.fmt(s.n), h.when(s.first), h.when(s.last)]), 'Nothing sent yet. The first puzzle of the week goes out on Monday 2 November 2026.')}
    ${h.can('admin') ? `<h2>Find an address</h2>
    <form id="mail-find" class="row card" novalidate><div class="field grow"><label for="mail-q">Part of the email address</label><input id="mail-q" type="search" autocomplete="off" spellcheck="false" minlength="3"></div><button class="btn" type="submit">Find</button></form>
    <div id="mail-found"></div>
    <h2>Add someone who asked</h2>
    <p class="muted">For someone who asked you by email or in person. They still get a confirm link, so nobody is added without saying yes themselves.</p>
    <form id="mail-add" class="row card" novalidate><div class="field grow"><label for="mail-add-email">Email address</label><input id="mail-add-email" type="email" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label for="mail-add-lists">Emails</label><select id="mail-add-lists"><option value="both">Both</option><option value="weekly">Puzzle of the week</option><option value="special">Special editions</option></select></div>
      <button class="btn" type="submit">Send a confirm link</button></form>` : ''}
    ${h.can('owner') ? '<p><button class="btn small" type="button" data-export="mail">Download the list (CSV)</button> <span class="muted">Confirmed addresses only. Keep the file private.</span></p>' : ''}`;
}

async function editEdition(id) {
  const e = id ? eds.specials.find((x) => x.id === id) : {};
  const v = await h.ask({
    title: id ? `Change ${e.title}` : 'Plan a special edition',
    text: 'Leave theme, difficulty and size on Automatic for the usual picks.',
    fields: [
      { name: 'date', label: 'Day it comes out (from tomorrow)', type: 'date', value: e.date || '' },
      { name: 'title', label: 'Title, like "Thanksgiving special"', value: e.title || '' },
      { name: 'note', label: 'A few words to players (in the email and the game)', type: 'textarea', value: e.note || '' },
      { name: 'theme', label: 'Theme', type: 'select', value: e.theme || '', options: [['', 'Automatic'], ...eds.themes.map((t) => [t.id, t.name])] },
      { name: 'difficulty', label: 'Difficulty', type: 'select', value: e.difficulty || '', options: [['', 'Automatic (Hard)'], ...eds.tiers.map((t) => [t.id, t.name])] },
      { name: 'size', label: 'Size (categories × items)', type: 'select', value: e.categories ? `${e.categories}x${e.items}` : 'auto', options: [['auto', 'Automatic (the level\'s usual size)'], ...SIZES.map((x) => [x, x.replace('x', ' × ')])] },
    ],
    ok: id ? 'Save' : 'Plan it',
    check: (x) => (!x.date ? 'Pick the day it comes out.' : x.title.trim().length < 3 ? 'Give it a title.' : x.note.trim().length < 5 ? 'Write a few words to players.' : null),
  });
  if (!v) return;
  await h.act(null, () => h.api(id ? `specials/${id}` : 'specials', { method: 'POST', body: v }), id ? 'Saved. The puzzle is made in the site build before its day.' : 'Planned. The puzzle is made in the site build before its day.');
  h.show('mail', { keepFocus: true });
}

// helpers: api, esc, fmt, when, tile, table, can, act, ask, toast and show from admin.js.
export function initPuzzleMail(helpers) {
  h = helpers;
  const show = helpers.show;
  const body = $('#mail-body');
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !eds) return;
    if (b.id === 'se-new') return editEdition(null);
    if (b.dataset.seEdit) return editEdition(b.dataset.seEdit);
    if (b.dataset.seCancel) {
      const ed = eds.specials.find((x) => x.id === b.dataset.seCancel);
      const ok = await h.ask({ title: `Cancel ${ed.title}?`, text: 'It will not be made or sent. You can plan another one any time.', ok: 'Cancel it', danger: true });
      if (ok && await h.act(b, () => h.api(`specials/${ed.id}/cancel`, { method: 'POST', body: {} }), 'Cancelled.')) show('mail', { keepFocus: true });
      return;
    }
    if (b.dataset.mailRemove) {
      const ok = await h.ask({ title: 'Remove this address?', text: `${h.esc(b.dataset.email)} gets no more puzzle emails. They can sign up again in the game.`, ok: 'Remove', danger: true });
      if (ok && await h.act(b, () => h.api(`mail/${b.dataset.mailRemove}/remove`, { method: 'POST', body: {} }), 'Removed.')) b.closest('tr').remove();
    }
  });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button');
    if (f.id === 'mail-find') {
      const q = $('#mail-q').value.trim();
      if (q.length < 3) { h.toast('Type at least 3 letters of the address.'); return; }
      await h.act(btn, async () => {
        const r = await h.api(`mail/find?q=${encodeURIComponent(q)}`);
        const lists = (x) => [x.weekly && 'Puzzle of the week', x.special && 'Special editions'].filter(Boolean).join(', ') || '–';
        $('#mail-found').innerHTML = h.table([{ label: 'Email' }, { label: 'Gets' }, { label: 'Waiting to confirm' }, { label: 'Account' }, { label: 'Signed up' }, { label: 'Actions' }],
          r.rows.map((x) => [h.esc(x.email), h.esc(lists(x)), h.esc(x.waiting.map((l) => (l === 'weekly' ? 'Puzzle of the week' : 'Special editions')).join(', ') || '–'), x.player ? 'Yes' : 'No', h.when(x.createdAt),
            `<button class="btn small" type="button" data-mail-remove="${x.id}" data-email="${h.esc(x.email)}">Remove</button>`]), 'No address matches.', { csv: false });
      });
    } else if (f.id === 'mail-add') {
      const which = $('#mail-add-lists').value;
      await h.act(btn, async () => {
        const r = await h.api('mail/add', { method: 'POST', body: { email: $('#mail-add-email').value, weekly: which !== 'special', special: which !== 'weekly' } });
        h.toast(r.message);
        if (r.ok) $('#mail-add-email').value = '';
      });
    }
  });
}
