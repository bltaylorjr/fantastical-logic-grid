// The dashboard's "Connections and setup" section: a searchable guide to every
// outside connection, built from admin/connections.js, with live status from
// GET /admin/v1/connections (server/src/connections.js). Ticked steps are kept
// only in this browser, as a reminder of where you got to.
import { CONNECTIONS, GROUPS, WHERE } from './connections.js';
import { startOAuth } from './oauth.js';

const TICKS_KEY = 'flg-admin-connection-steps';
const STATUS = {
  connected: ['ok', 'Connected'],
  missing: ['bad', 'Missing'],
  unknown: ['warn', 'Not checked yet'],
  optional: ['', 'Optional, not set up'],
  manual: ['', 'Check by hand'],
  paused: ['', 'Paused'],
};
const REPO = 'https://github.com/bltaylorjr/fantastical-logic-grid';

const loadTicks = () => { try { return JSON.parse(localStorage.getItem(TICKS_KEY) || '{}'); } catch (e) { return {}; } };
const saveTicks = (t) => { try { localStorage.setItem(TICKS_KEY, JSON.stringify(t)); } catch (e) { /* private window */ } };

// Each name's and check's state: true (set / passes), false, or null (unknown).
function parts(c, live) {
  const names = (c.names || []).filter((n) => n.where !== 'private-file').map((n) => ({ optional: !!n.optional, ok: live ? live.names[`${n.where}:${n.name}`] ?? null : null }));
  const checks = (c.checks || []).map((k, i) => ({ optional: !!k.optional, ok: live ? live.checks[`${c.id}#${i}`]?.ok ?? null : null }));
  return [...names, ...checks];
}

export function connectionState(c, live) {
  if (c.paused) return 'paused';
  const all = parts(c, live);
  const req = all.filter((p) => !p.optional);
  if (req.some((p) => p.ok === false)) return 'missing';
  if (req.some((p) => p.ok === null)) return 'unknown';
  if (req.length) return 'connected';
  if (all.some((p) => p.ok === true)) return 'connected';
  if (all.length && all.every((p) => p.ok === false)) return 'optional';
  return all.length ? 'unknown' : 'manual';
}

export function renderConnections(root, { api, esc, when, toast, announce, ask }) {
  const text = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/https:\/\/[^\s<]+[^\s<.,)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const badge = (state) => `<span class="badge ${STATUS[state][0]}">${STATUS[state][1]}</span>`;
  const okBadge = (ok, optional) => (ok === true ? '<span class="badge ok">Set</span>' : ok === false ? `<span class="badge ${optional ? '' : 'bad'}">Not set</span>` : '<span class="badge">Unknown</span>');
  const checkBadge = (r, optional) => (r?.ok === true ? '<span class="badge ok">OK</span>' : r?.ok === false ? `<span class="badge ${optional ? '' : 'bad'}">No</span>` : '<span class="badge">Unknown</span>');
  let live = null;
  let ticks = loadTicks();

  const plain = (c) => [c.title, c.why, c.cost, ...(c.names || []).flatMap((n) => [n.name, n.note, n.value, WHERE[n.where].label]),
    ...(c.settings || []).flatMap((s) => [s.label, s.value]), ...c.steps, ...(c.links || []).map((l) => l.label)].filter(Boolean).join(' ').toLowerCase();

  function card(c) {
    const state = connectionState(c, live);
    const names = (c.names || []).length ? `<h3>Names and where they go</h3><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Name</th><th scope="col">Where</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead><tbody>
      ${c.names.map((n) => {
        const w = WHERE[n.where];
        const ok = n.where === 'private-file' ? null : live ? live.names[`${n.where}:${n.name}`] : null;
        const where = w.url ? `<a href="${w.url}" target="_blank" rel="noopener">${esc(w.label)}</a>` : esc(w.label);
        const note = [n.value ? `Value: <code>${esc(n.value)}</code>` : '', n.note ? text(n.note) : '', n.optional ? '<span class="muted">Optional.</span>' : ''].filter(Boolean).join(' ');
        return `<tr><td><code>${esc(n.name)}</code></td><td>${where}</td><td>${n.where === 'private-file' ? '<span class="badge">Keep safe</span>' : okBadge(ok, n.optional)}</td><td>${note}</td></tr>`;
      }).join('')}</tbody></table></div>` : '';
    const settings = (c.settings || []).length ? `<h3>Settings</h3><dl class="conn-settings">${c.settings.map((s) => `<dt>${text(s.label)}</dt><dd>${text(s.value)}</dd>`).join('')}</dl>` : '';
    const checks = (c.checks || []).length ? `<h3>Live checks</h3><ul class="conn-checks">${c.checks.map((k, i) => {
      const r = live?.checks[`${c.id}#${i}`];
      return `<li>${checkBadge(r, k.optional)} ${esc(k.label)}${k.optional ? ' <span class="muted">(optional)</span>' : ''}${r?.detail ? ` <span class="muted">${esc(r.detail)}</span>` : ''}</li>`;
    }).join('')}</ul>` : '';
    const steps = `<h3>Steps</h3><ol class="conn-steps">${c.steps.map((s, i) => {
      const id = `${c.id}-${i}`;
      return `<li><label class="check"><input type="checkbox" data-tick="${id}"${ticks[id] ? ' checked' : ''}> <span>${text(s)}</span></label></li>`;
    }).join('')}</ol>`;
    const links = [...(c.links || []), ...(c.docs ? [{ label: `Full guide in the repository (${c.docs})`, url: `${REPO}/blob/main/${c.docs}` }] : [])];
    return `<details class="card conn" data-id="${c.id}" data-state="${state}">
      <summary><span class="conn-title">${badge(state)} <b>${esc(c.title)}</b></span></summary>
      <p>${text(c.why)}</p>
      <p class="muted"><b>Cost:</b> ${text(c.cost)}</p>
      ${names}${settings}${checks}${steps}
      ${links.length ? `<h3>Links</h3><ul>${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join('')}</ul>` : ''}
      <div class="row">${c.oauth ? `<button class="btn small primary" type="button" data-key-site="${c.oauth}">Get the key</button>` : ''}<button class="btn small" type="button" data-copy="${c.id}">Copy these steps</button></div>
    </details>`;
  }

  function counts() {
    const n = { connected: 0, missing: 0, unknown: 0, optional: 0, manual: 0, paused: 0 };
    CONNECTIONS.forEach((c) => { n[connectionState(c, live)] += 1; });
    return n;
  }

  function draw() {
    const open = new Set([...root.querySelectorAll('details.conn[open]')].map((d) => d.dataset.id));
    const n = counts();
    const gh = live?.github;
    const ghLine = gh
      ? `<p class="muted">GitHub secret and variable names last reported ${when(gh.reportedAt)} by the <a href="${REPO}/actions/workflows/connections-status.yml" target="_blank" rel="noopener">Connections status</a> Action (daily, and after each change to main).</p>`
      : `<p class="note">GitHub has not reported its secret and variable names yet, so those show as unknown. Run <a href="${REPO}/actions/workflows/connections-status.yml" target="_blank" rel="noopener">Connections status</a> on GitHub (Run workflow). It needs the <code>FLG_ADMIN_TOKEN</code> repository secret.</p>`;
    const unlisted = gh?.unlisted?.length ? `<p class="note">Set in GitHub but not in this guide: ${gh.unlisted.map((x) => `<code>${esc(x)}</code>`).join(', ')}. If one is no longer used, delete it in GitHub; if it is new, add it to <code>admin/connections.js</code>.</p>` : '';
    root.querySelector('#conn-summary').innerHTML = `<div class="tiles">
      <div class="tile"><div class="label">Connected</div><div class="value">${n.connected}</div></div>
      <div class="tile"><div class="label">Missing</div><div class="value">${n.missing}</div></div>
      <div class="tile"><div class="label">Not checked yet</div><div class="value">${n.unknown}</div></div>
      <div class="tile"><div class="label">Optional or by hand</div><div class="value">${n.optional + n.manual + n.paused}</div></div></div>
      ${ghLine}${unlisted}${live ? `<p class="muted">Website and DNS checked ${when(live.checkedAt)}.</p>` : ''}`;
    root.querySelector('#conn-list').innerHTML = GROUPS.map((g) => {
      const list = CONNECTIONS.filter((c) => c.group === g.id);
      return list.length ? `<section class="conn-group" data-group="${g.id}"><h2>${esc(g.title)}</h2>${list.map(card).join('')}</section>` : '';
    }).join('');
    open.forEach((id) => { const d = root.querySelector(`details.conn[data-id="${id}"]`); if (d) d.open = true; });
    filter();
  }

  function filter() {
    const q = root.querySelector('#conn-q').value.trim().toLowerCase();
    const show = root.querySelector('#conn-show').value;
    let shown = 0;
    root.querySelectorAll('details.conn').forEach((d) => {
      const c = CONNECTIONS.find((x) => x.id === d.dataset.id);
      const st = d.dataset.state;
      const okShow = show === 'all' || (show === 'attention' ? ['missing', 'unknown'].includes(st) : show === 'connected' ? st === 'connected' : ['optional', 'manual', 'paused'].includes(st));
      const okQ = !q || q.split(/\s+/).every((w) => plain(c).includes(w));
      d.hidden = !(okShow && okQ);
      if (q && !d.hidden) d.open = true;
      if (!d.hidden) shown += 1;
    });
    root.querySelectorAll('.conn-group').forEach((s) => { s.hidden = ![...s.querySelectorAll('details.conn')].some((d) => !d.hidden); });
    const none = root.querySelector('#conn-none');
    none.hidden = shown > 0;
  }

  async function load(force) {
    try {
      live = await api(`connections${force ? '?refresh=1' : ''}`);
    } catch (e) {
      if (e.code === 'sign_in') throw e;
      live = null;
      toast(e.message);
    }
    draw();
  }

  if (!root.dataset.ready) {
    root.dataset.ready = '1';
    root.querySelector('#conn-q').oninput = filter;
    root.querySelector('#conn-show').onchange = filter;
    root.querySelector('#conn-refresh').onclick = async (e) => {
      e.target.disabled = true;
      await load(true).finally(() => { e.target.disabled = false; });
      announce('Checked again.');
    };
    root.querySelector('#conn-expand').onclick = () => root.querySelectorAll('details.conn:not([hidden])').forEach((d) => { d.open = true; });
    root.querySelector('#conn-collapse').onclick = () => root.querySelectorAll('details.conn').forEach((d) => { d.open = false; });
    root.querySelector('#conn-list').onchange = (e) => {
      const id = e.target.dataset?.tick;
      if (!id) return;
      ticks = loadTicks();
      if (e.target.checked) ticks[id] = 1; else delete ticks[id];
      saveTicks(ticks);
    };
    root.querySelector('#conn-list').onclick = async (e) => {
      if (e.target.dataset?.keySite) return startOAuth(e.target.dataset.keySite, { ask, esc, toast });
      const id = e.target.dataset?.copy;
      if (!id) return;
      const c = CONNECTIONS.find((x) => x.id === id);
      const plainText = `${c.title}\n\nWhy: ${c.why}\n\n${c.steps.map((s, i) => `${i + 1}. ${s.replace(/\*\*|`/g, '')}`).join('\n')}`;
      try { await navigator.clipboard.writeText(plainText); toast('Steps copied.'); } catch (err) { toast('Could not copy here. Select the text instead.'); }
    };
  }
  draw();
  return load(false);
}
