// "Site accounts" at the top of Connections and setup: the game's accounts on
// outside sites, with the profile address, the sign-in email, the handle,
// where the keys are kept and notes (server/src/site-accounts.js). Passwords,
// keys and tokens are never kept here: the server refuses anything that looks
// like one, and the form says to keep them in a password manager.
const STATUS = {
  'not-started': ['', 'Not started'],
  waiting: ['warn', 'Waiting'],
  'set-up': ['ok', 'Set up'],
  paused: ['', 'Paused'],
};

export function renderSiteAccounts(root, { api, esc, when, toast, announce, ask, can }) {
  if (!root) return;
  if (!can('admin')) { root.hidden = true; return; }
  root.hidden = false;
  let rows = [];
  const list = root.querySelector('#acct-list');

  const link = (u, label) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label || u.replace(/^https:\/\/(www\.)?/, ''))}</a>` : '<span class="muted">—</span>');
  function draw() {
    const done = rows.filter((r) => r.status === 'set-up').length;
    root.querySelector('#acct-count').textContent = `${done} of ${rows.length} set up`;
    const line = (label, value) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '');
    list.innerHTML = rows.length ? `<ul class="acct-list" aria-label="The game's accounts on outside sites">${rows.map((r) => `<li class="acct">
        <div class="acct-head"><h3>${esc(r.site)}</h3> <span class="badge ${STATUS[r.status]?.[0] || ''}">${esc(STATUS[r.status]?.[1] || r.status)}</span>
          <span class="acct-actions"><button class="btn small" type="button" data-acct-edit="${r.id}" aria-label="Edit ${esc(r.site)}">Edit</button>
          <button class="btn small danger" type="button" data-acct-del="${r.id}" aria-label="Remove ${esc(r.site)}">Remove</button></span></div>
        <dl>${line('Profile', r.url ? link(r.url) : '')}${line('Sign-in email', esc(r.loginEmail))}${line('Handle', esc(r.handle))}${line('Keys kept in', esc(r.keysIn))}${line('Notes', esc(r.notes))}</dl>
      </li>`).join('')}</ul>` : '<p class="muted">No accounts yet. Add the first one.</p>';
  }

  async function load() {
    try {
      rows = (await api('site-accounts')).accounts;
      draw();
    } catch (e) {
      list.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  }

  async function edit(row = {}) {
    let values = row;
    for (;;) {
      const v = await ask({
        title: row.id ? `Edit ${row.site}` : 'Add a site account',
        text: 'Only details that are safe to read. Keep passwords, keys and tokens in your password manager or in GitHub secrets, and write here only where they are kept.',
        fields: [
          { name: 'site', label: 'Site', value: values.site },
          { name: 'status', label: 'Status', type: 'select', value: values.status || 'set-up', options: Object.entries(STATUS).map(([k, [, l]]) => [k, l]) },
          { name: 'url', label: 'Profile address', type: 'url', value: values.url, help: 'For example https://www.youtube.com/@thelogicgridpuzzles' },
          { name: 'loginEmail', label: 'Sign-in email', type: 'email', value: values.loginEmail },
          { name: 'handle', label: 'Handle or account name', value: values.handle },
          { name: 'keysIn', label: 'Keys kept in', value: values.keysIn, help: 'Names only, for example GitHub secrets YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET' },
          { name: 'notes', label: 'Notes', type: 'textarea', value: values.notes },
        ],
        ok: row.id ? 'Save' : 'Add',
        check: (x) => (x.site.trim() ? '' : 'Give the site a name.'),
      });
      if (!v) return;
      try {
        await api('site-accounts', { method: 'POST', body: { ...v, id: row.id } });
        const said = row.id ? `${v.site} saved.` : `${v.site} added.`;
        toast(said); announce(said);
        return load();
      } catch (e) {
        if (e.code === 'sign_in') return;
        toast(e.message); announce(e.message);
        values = v; // open the form again with what was typed
      }
    }
  }

  root.querySelector('#acct-add').onclick = () => edit();
  list.onclick = async (e) => {
    const ed = e.target.closest('[data-acct-edit]');
    const del = e.target.closest('[data-acct-del]');
    if (ed) return edit(rows.find((r) => r.id === Number(ed.dataset.acctEdit)));
    if (del) {
      const r = rows.find((x) => x.id === Number(del.dataset.acctDel));
      if (!r || !(await ask({ title: `Remove ${r.site}?`, text: 'It is removed from this list only. The account on the site is not touched.', ok: 'Remove', danger: true }))) return;
      try {
        await api(`site-accounts/${r.id}/delete`, { method: 'POST', body: {} });
        toast(`${r.site} removed.`); announce(`${r.site} removed.`);
        load();
      } catch (err) { if (err.code !== 'sign_in') { toast(err.message); announce(err.message); } }
    }
  };
  load();
}
