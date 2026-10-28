// App keys: the keys the Windows and Android apps ask for the first time they
// open (server/src/licenses.js). Each key installs on one computer or phone,
// or two when you allow it, and can be used for two downloads from the
// website; after that the player needs a new key. Every key's installs and
// downloads are listed here, so you can see where each one is used.
const $ = (s, el = document) => el.querySelector(s);

let h = null; // helpers from admin.js
let status = 'all';
let q = '';
let made = []; // keys made in this visit, shown in full until you leave

const PLATFORM = { desktop: 'Windows', android: 'Android', ios: 'iPhone' };
const SOURCE = { admin: 'Made here', self: 'Asked for it on the website' };

function row(k) {
  const e = h.esc;
  const state = k.revokedAt ? `<span class="badge bad">${k.source === 'self' && !k.approvedAt ? 'Declined' : 'Cancelled'}</span>` : k.waiting ? '<span class="badge warn">Waiting for your approval</span>' : k.works ? '<span class="badge ok">Works</span>' : '<span class="badge">Ended</span>';
  const who = [k.label && `<b>${e(k.label)}</b>`, k.name && `<bdi>${e(k.name)}</bdi>`, k.email && `<span class="muted">${e(k.email)}</span>`].filter(Boolean).join('<br>');
  return `<tr>
    <td><code class="lic-key">${e(k.key)}</code> <button class="btn small" type="button" data-lic-copy="${e(k.key)}">Copy</button><br>${state}</td>
    <td>${who || '<span class="muted">No name</span>'}<br><small class="muted">${e(SOURCE[k.source] || k.source)}${k.createdBy && k.source === 'admin' ? `, ${e(k.createdBy)}` : ''}, ${h.when(k.createdAt)}${k.approvedBy ? `<br>approved by ${e(k.approvedBy)}, ${h.when(k.approvedAt)}` : ''}</small></td>
    <td>${h.fmt(k.devices)} of ${h.fmt(k.maxDevices)}${k.lastSeen ? `<br><small class="muted">last seen ${h.when(k.lastSeen)}</small>` : ''}</td>
    <td>${h.fmt(k.downloads)} of ${h.fmt(k.maxDownloads)}${k.lastDownloadAt ? `<br><small class="muted">last ${h.when(k.lastDownloadAt)}</small>` : ''}</td>
    <td>${k.expiresAt ? h.when(k.expiresAt) : 'Never'}</td>
    <td class="row">
      ${k.waiting ? `<button class="btn small primary" type="button" data-lic-approve="${k.id}">Approve</button><button class="btn small danger" type="button" data-lic-decline="${k.id}">Decline</button>` : ''}
      <button class="btn small" type="button" data-lic-devices="${k.id}" aria-expanded="false">Installs</button>
      ${k.maxDevices < 2 && !k.revokedAt ? `<button class="btn small" type="button" data-lic-two="${k.id}">Allow a 2nd install</button>` : ''}
      ${k.maxDevices > 1 && !k.revokedAt ? `<button class="btn small" type="button" data-lic-one="${k.id}">Back to 1 install</button>` : ''}
      ${k.waiting ? '' : k.revokedAt ? `<button class="btn small" type="button" data-lic-restore="${k.id}">Turn back on</button>` : `<button class="btn small danger" type="button" data-lic-revoke="${k.id}">Cancel key</button>`}
    </td>
  </tr><tr class="lic-devices" id="lic-dev-${k.id}" hidden><td colspan="6"></td></tr>`;
}

function banner(d) {
  if (!d.ready) {
    return '<p class="badge warn">Not switched on yet: the LICENSE_SIGNING_KEY Cloudflare secret is not set, so the apps open without a key. Steps: <a href="#connections">Connections and setup</a> &gt; App keys. You can make keys now; they work as soon as the secret is set.</p>';
  }
  if (!d.required) return '<p class="badge warn">The apps open without a key, because <b>The apps need a key</b> is off under <a href="#settings">Settings and switches</a> &gt; App keys.</p>';
  const wait = d.approval ? ' Each one waits here until you approve it.' : ' It works straight away (Free keys wait for your approval is off).';
  const own = { signed_in: `Any signed-in player with a confirmed email can also ask for one free key on the website.${wait}`, supporters: `Supporters can also ask for one key on the website.${wait}`, off: 'Players get keys only from you.' }[d.own] || '';
  return `<p class="badge ok">On: the Windows and Android apps ask for a key the first time they open. ${own}</p>`;
}

export async function licensesView(helpers) {
  h = helpers;
  const d = await h.api(`licenses?status=${status}&q=${encodeURIComponent(q)}`);
  $('#lic-banner').innerHTML = banner(d);
  $('#lic-tiles').innerHTML = h.tile('Waiting for approval', h.fmt(d.totals.waiting)) + h.tile('Keys', h.fmt(d.totals.keys)) + h.tile('Working', h.fmt(d.totals.working)) + h.tile('Installs', h.fmt(d.totals.devices));
  h.setCount('#count-licenses', d.totals.waiting);
  $('#lic-made').hidden = !made.length;
  $('#lic-made-list').textContent = made.join('\n');
  $('#lic-rows').innerHTML = d.keys.length ? d.keys.map(row).join('') : '<tr><td colspan="6" class="muted">No keys here yet. Make one above.</td></tr>';
}

async function showDevices(b) {
  const id = b.dataset.licDevices;
  const tr = $(`#lic-dev-${id}`);
  if (!tr.hidden) { tr.hidden = true; b.setAttribute('aria-expanded', 'false'); return; }
  const d = await h.api(`licenses/${id}`);
  const e = h.esc;
  tr.firstElementChild.innerHTML = d.devices.length ? `<ul class="lic-dev-list">${d.devices.map((x) => `<li>${e(PLATFORM[x.platform] || x.platform)} <small class="muted">install ${e(x.device.slice(-8))}</small>, installed ${h.when(x.activatedAt)}, last seen ${h.when(x.lastSeen)}
      ${x.removedAt ? `<span class="badge">Removed ${h.when(x.removedAt)}</span>` : `<button class="btn small" type="button" data-lic-remove="${id}" data-device="${e(x.device)}">Remove this install</button>`}</li>`).join('')}</ul>`
    : '<p class="muted">Not installed anywhere yet.</p>';
  tr.hidden = false;
  b.setAttribute('aria-expanded', 'true');
}

export function initLicenses(helpers, show) {
  h = helpers;
  const again = () => show('licenses', { keepFocus: true });
  $('#lic-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#lic-error');
    err.hidden = true;
    const day = $('#lic-until').value;
    const body = {
      count: Number($('#lic-count').value) || 1, label: $('#lic-label').value.trim(), email: $('#lic-email').value.trim(),
      maxDevices: Number($('#lic-max').value), until: day ? new Date(`${day}T23:59:59`).getTime() : null,
    };
    try {
      const r = await h.api('licenses', { method: 'POST', body });
      made = [...r.keys, ...made].slice(0, 200);
      $('#lic-form').reset();
      h.toast(r.keys.length === 1 ? 'Key made. Copy it and send it to the player.' : `${r.keys.length} keys made.`);
      again();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
  $('#lic-filter').onsubmit = (e) => { e.preventDefault(); q = $('#lic-q').value.trim(); status = $('#lic-status').value; again(); };
  $('#lic-status').onchange = () => { status = $('#lic-status').value; again(); };
  $('#lic-copy-made').onclick = () => navigator.clipboard?.writeText(made.join('\n')).then(() => h.toast('Copied.'), () => h.toast('Select the keys and copy them.'));
  $('#lic-rows').onclick = async (e) => {
    const t = (k) => e.target.closest(`[data-lic-${k}]`);
    let b;
    if ((b = t('copy'))) {
      navigator.clipboard?.writeText(b.dataset.licCopy).then(() => h.toast('Key copied.'), () => h.toast('Select the key and copy it.'));
    } else if ((b = t('devices'))) {
      await showDevices(b);
    } else if ((b = t('two')) || (b = t('one'))) {
      const two = !!b.dataset.licTwo;
      if (await h.act(b, () => h.api(`licenses/${b.dataset.licTwo || b.dataset.licOne}/devices`, { method: 'POST', body: { maxDevices: two ? 2 : 1 } }), two ? 'This key can now install on a second computer or phone.' : 'Back to one install. A second install already made keeps working until you remove it.')) again();
    } else if ((b = t('approve'))) {
      if (await h.act(b, () => h.api(`licenses/${b.dataset.licApprove}/approve`, { method: 'POST' }), 'Approved. The player now sees the key under Menu > Install the app on the website.')) again();
    } else if ((b = t('decline'))) {
      if (!(await h.ask({ title: 'Decline this free key?', text: 'The player sees that it was not approved, and cannot ask again on their own. You can still make them a key here.', ok: 'Decline', danger: true }))) return;
      if (await h.act(b, () => h.api(`licenses/${b.dataset.licDecline}/decline`, { method: 'POST' }), 'Declined.')) again();
    } else if ((b = t('revoke'))) {
      if (!(await h.ask({ title: 'Cancel this key?', text: 'Every app using it stops the next time it goes online (within about a day), and it cannot be used for downloads. You can turn it back on later.', ok: 'Cancel key', danger: true }))) return;
      if (await h.act(b, () => h.api(`licenses/${b.dataset.licRevoke}/revoke`, { method: 'POST' }), 'Key cancelled.')) again();
    } else if ((b = t('restore'))) {
      if (await h.act(b, () => h.api(`licenses/${b.dataset.licRestore}/restore`, { method: 'POST' }), 'Key turned back on.')) again();
    } else if ((b = t('remove'))) {
      if (!(await h.ask({ title: 'Remove this install?', text: 'That computer or phone asks for a key again the next time it goes online, and the seat is free for another install.', ok: 'Remove', danger: true }))) return;
      if (await h.act(b, () => h.api(`licenses/${b.dataset.licRemove}/devices/${b.dataset.device}/remove`, { method: 'POST' }), 'Install removed.')) again();
    }
  };
}
