// Badges: special badges given by hand (Tester, Contributor and any you make)
// and badges earned automatically at a milestone you set
// (server/src/special-badges.js). Also the Badges block on a player's page.
const $ = (s, el = document) => el.querySelector(s);

let h = null; // helpers from admin.js
let reload = () => {};
let data = null; // the last GET badges
let editing = null; // the badge being changed, or null for a new one

const PICKS = ['🧪', '🤝', '🐞', '💡', '✍️', '🌍', '🏆', '⭐', '🔥', '🧠', '⚛️', '👑', '🎖️', '🎉', '🦉', '🔍'];
const SOURCE = { admin: 'Given by hand', auto: 'Earned automatically' };

const badgeLabel = (b) => `<span class="badge-icon" aria-hidden="true">${h.esc(b.icon)}</span><b>${h.esc(b.name)}</b>`;
const kindOf = (id) => data.kinds.find((k) => k.id === id);

export async function badgesView(helpers) {
  h = helpers;
  data = await h.api('badges');
  $('#badges-off').hidden = data.enabled;
  const live = data.badges.filter((b) => b.active);
  $('#award-badge').innerHTML = live.length
    ? live.map((b) => `<option value="${b.id}">${h.esc(b.icon)} ${h.esc(b.name)}${b.rule ? ' (automatic)' : ''}</option>`).join('')
    : '<option value="">No badges are turned on</option>';
  $('#badge-rows').innerHTML = data.badges.length ? data.badges.map((b) => `<li data-badge="${b.id}">
      <p class="badge-title">${badgeLabel(b)} ${b.active ? '<span class="badge ok">On</span>' : '<span class="badge">Paused</span>'}</p>
      ${b.description ? `<p class="muted">${h.esc(b.description)}</p>` : ''}
      <p>${b.rule ? `<b>Automatic:</b> ${h.esc(b.how)}` : '<b>By hand</b>'} · ${b.holders === 1 ? '1 holder' : `${h.fmt(b.holders)} holders`}</p>
      <div class="row">
        <button class="btn small" type="button" data-badge-holders="${b.id}">Holders</button>
        ${h.can('admin') ? `<button class="btn small" type="button" data-badge-edit="${b.id}">Edit</button>
        <button class="btn small" type="button" data-badge-toggle="${b.id}">${b.active ? 'Pause' : 'Turn on'}</button>
        <button class="btn small danger" type="button" data-badge-delete="${b.id}">Delete</button>` : ''}
      </div>
    </li>`).join('') : '<li class="muted">No badges yet. Make one below.</li>';
  if (!$('#badge-kind').options.length) fillEditor();
  if (openHolders && data.badges.some((b) => b.id === openHolders)) showHolders(openHolders, { keepFocus: true });
  else { openHolders = null; $('#badge-holders').innerHTML = ''; }
}

// ---- The editor: a new badge, or changes to one.
function fillEditor() {
  $('#badge-kind').innerHTML = `<option value="manual">By hand only</option>${data.kinds.map((k) => `<option value="${k.id}">Automatic: ${h.esc(k.label)}</option>`).join('')}`;
  $('#badge-tier').innerHTML = data.tiers.map((t) => `<option value="${t.id}">${h.esc(t.name)}</option>`).join('');
  $('#badge-picks').innerHTML = PICKS.map((e) => `<button class="btn small" type="button" data-pick="${e}" aria-label="Use ${e} as the icon">${e}</button>`).join('');
  showRuleFields();
}

function showRuleFields() {
  const k = kindOf($('#badge-kind').value);
  $('#badge-count-field').hidden = !k;
  $('#badge-tier-field').hidden = !(k && k.needsTier);
  preview();
}

function formRule() {
  const kind = $('#badge-kind').value;
  if (kind === 'manual') return null;
  return { kind, count: Number($('#badge-count').value), ...(kindOf(kind)?.needsTier ? { tier: $('#badge-tier').value } : {}) };
}

// Plain words for the rule being typed, matching what players will read.
function ruleWords(rule) {
  if (!rule) return 'Given by hand only.';
  const n = rule.count;
  if (!Number.isInteger(n) || n < 1) return 'Type the number a player has to reach.';
  const tier = data.tiers.find((t) => t.id === rule.tier)?.name || '';
  const s = (one, many) => `${n} ${n === 1 ? one : many}`;
  return {
    solved: `Solve ${s('puzzle', 'puzzles')}.`, tier: `Solve ${s(`${tier} puzzle`, `${tier} puzzles`)}.`, nohints: `Solve ${s('puzzle', 'puzzles')} without any hints.`,
    themes: `Solve puzzles in ${s('theme', 'different themes')}.`, daily: `Solve ${s('daily puzzle', 'daily puzzles')}.`,
    streak: `Solve the daily puzzle ${s('day', 'days in a row')}.`, races: `Finish ${s('race', 'races')}.`,
  }[rule.kind] || '';
}

function preview() {
  const icon = $('#badge-icon').value.trim() || '?';
  const name = $('#badge-name').value.trim() || 'Badge name';
  const rule = formRule();
  const desc = $('#badge-desc').value.trim();
  $('#badge-preview').innerHTML = `Preview: <span class="badge-icon" aria-hidden="true">${h.esc(icon)}</span><b>${h.esc(name)}</b>: ${h.esc(desc || ruleWords(rule))}${rule && desc ? ` <span class="muted">(${h.esc(ruleWords(rule))})</span>` : ''}`;
}

function resetEditor() {
  editing = null;
  $('#badge-form').reset();
  $('#badge-active').checked = true;
  $('#badge-editor-h').textContent = 'Make a new badge';
  $('#badge-save').textContent = 'Add badge';
  $('#badge-cancel').hidden = true;
  $('#badge-error').hidden = true;
  showRuleFields();
}

function editBadge(id) {
  const b = data.badges.find((x) => x.id === id);
  if (!b) return;
  editing = b;
  $('#badge-name').value = b.name;
  $('#badge-icon').value = b.icon;
  $('#badge-desc').value = b.description || '';
  $('#badge-kind').value = b.rule ? b.rule.kind : 'manual';
  $('#badge-count').value = b.rule ? b.rule.count : '';
  if (b.rule?.tier) $('#badge-tier').value = b.rule.tier;
  $('#badge-active').checked = b.active;
  $('#badge-editor-h').textContent = `Change ${b.name}`;
  $('#badge-save').textContent = 'Save changes';
  $('#badge-cancel').hidden = false;
  $('#badge-error').hidden = true;
  showRuleFields();
  $('#badge-editor').open = true;
  $('#badge-editor').scrollIntoView({ block: 'start' });
  $('#badge-name').focus();
}

const bodyOf = (b, over = {}) => ({ name: b.name, icon: b.icon, description: b.description, rule: b.rule, active: b.active, sort: b.sort, ...over });

// ---- Holders of one badge.
let openHolders = null;
async function showHolders(id, { keepFocus = false } = {}) {
  openHolders = id;
  const box = $('#badge-holders');
  let d;
  try { d = await h.api(`badges/${id}/holders`); } catch (e) { box.innerHTML = `<p class="error">${h.esc(e.message)}</p>`; return; }
  const now = d.holders.filter((x) => !x.removedAt);
  const gone = d.holders.filter((x) => x.removedAt);
  const who = (x) => `${x.name ? `<bdi>${h.esc(x.name)}</bdi><br>` : ''}<span class="muted">${x.uid ? `<a href="#players/${encodeURIComponent(x.uid)}">${h.esc(x.uid)}</a>` : h.esc(x.email || '')}</span>${x.note ? `<br><small>${h.esc(x.note)}</small>` : ''}`;
  box.innerHTML = `<div class="card">
    <div class="head"><h2 id="holders-h" tabindex="-1">${badgeLabel(d.badge)} holders</h2><button class="btn small" type="button" data-holders-close>Close</button></div>
    ${now.length ? `<ul class="cards">${now.map((x) => `<li>
      <p>${who(x)}</p>
      <p class="muted">${SOURCE[x.source] || h.esc(x.source)} · ${h.when(x.at)}${x.by ? ` · ${h.esc(x.by)}` : ''}</p>
      ${h.can('moderator') ? `<div class="row"><button class="btn small" type="button" data-award-remove="${x.id}" data-who="${h.esc(x.name || x.email || x.uid || '')}">Take away</button></div>` : ''}
    </li>`).join('')}</ul>` : '<p class="muted">Nobody has this badge yet.</p>'}
    ${gone.length ? `<details><summary>Taken away (${gone.length})</summary>${h.table([{ label: 'Player' }, { label: 'Taken away' }],
      gone.map((x) => [who(x), `${h.when(x.removedAt)}${x.removedBy ? `<br><small class="muted">${h.esc(x.removedBy)}</small>` : ''}`]), '')}
      <p class="muted">An automatic badge you take away is not given back by itself. You can still give it again by hand.</p></details>` : ''}
  </div>`;
  if (!keepFocus) $('#holders-h').focus();
}

async function takeAway(button, onDone) {
  const ok = await h.ask({ title: 'Take this badge away?', text: `${h.esc(button.dataset.who || 'The player')} stops seeing it. An automatic badge is not given back by itself; you can give it again by hand.`, ok: 'Take away', danger: true });
  if (ok && await h.act(button, () => h.api(`badges/awards/${button.dataset.awardRemove}/remove`, { method: 'POST' }), 'Badge taken away.')) onDone();
}

// ---- A player's page: their badges, give one, take one away.
export function playerBadgesHtml(helpers, p) {
  h = helpers;
  const list = p.specialBadges || [];
  return `<h3>Special badges</h3>
    ${list.length ? `<ul class="player-badges">${list.map((b) => `<li><span class="badge-icon" aria-hidden="true">${h.esc(b.icon)}</span><span><b>${h.esc(b.name)}</b>${b.active ? '' : ' <span class="badge">Paused</span>'}<br><small class="muted">${SOURCE[b.source] || ''} · ${h.day(b.at)}</small></span>
      ${h.can('moderator') ? `<button class="btn small" type="button" data-award-remove="${b.awardId}" data-who="${h.esc(p.screenName || 'This player')}">Take away</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}
    ${h.can('moderator') && !p.deletedAt ? '<div class="row"><button class="btn" type="button" data-badge-give>Give a badge</button></div>' : ''}`;
}

export async function playerBadgeClick(helpers, e, p, onDone) {
  h = helpers;
  const rm = e.target.closest('button[data-award-remove]');
  if (rm) { await takeAway(rm, onDone); return true; }
  const give = e.target.closest('button[data-badge-give]');
  if (!give) return false;
  let d;
  try { d = await h.api('badges'); } catch (ex) { h.toast(ex.message); return true; }
  const held = new Set((p.specialBadges || []).map((b) => b.badgeId));
  const options = d.badges.filter((b) => b.active && !held.has(b.id)).map((b) => [String(b.id), `${b.icon} ${b.name}`]);
  if (!options.length) { h.toast('This player already has every badge that is turned on.'); return true; }
  const v = await h.ask({
    title: `Give ${p.screenName || 'this player'} a badge`,
    fields: [{ name: 'badge', label: 'Badge', type: 'select', options, value: options[0][0] }, { name: 'note', label: 'Note (optional, for you)' }],
    ok: 'Give badge',
  });
  if (!v) return true;
  const name = options.find(([id]) => id === v.badge)?.[1] || 'Badge';
  if (await h.act(give, () => h.api(`badges/${v.badge}/award`, { method: 'POST', body: { uid: p.uid, note: v.note.trim() } }), `${name} given. They see it the next time the game checks, within a few minutes.`)) onDone();
  return true;
}

// ---- Wiring, once.
export function initBadges(helpers, show) {
  h = helpers;
  reload = () => show('badges', { keepFocus: true });
  $('#badge-kind').onchange = showRuleFields;
  for (const id of ['#badge-name', '#badge-icon', '#badge-desc', '#badge-count', '#badge-tier']) $(id).addEventListener('input', preview);
  $('#badge-picks').onclick = (e) => {
    const b = e.target.closest('button[data-pick]');
    if (!b) return;
    $('#badge-icon').value = b.dataset.pick;
    preview();
  };
  $('#badge-cancel').onclick = () => { resetEditor(); $('#badge-editor').open = false; };

  $('#award-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#award-error');
    err.hidden = true;
    const id = $('#award-badge').value;
    const who = $('#award-who').value.trim();
    if (!id) { err.textContent = 'Turn a badge on first.'; err.hidden = false; return; }
    if (!who) { err.textContent = 'Type the player\'s email, screen name or player id.'; err.hidden = false; $('#award-who').focus(); return; }
    const button = $('#award-form button[type=submit]');
    button.disabled = true;
    try {
      const r = await h.api(`badges/${id}/award`, { method: 'POST', body: { who, note: $('#award-note').value.trim() } });
      const b = data.badges.find((x) => String(x.id) === id);
      $('#award-who').value = '';
      $('#award-note').value = '';
      h.toast(`${b ? b.name : 'Badge'} given to ${r.who}. They see it the next time the game checks, within a few minutes.`);
      h.announce?.(`${b ? b.name : 'Badge'} given.`);
      reload();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { button.disabled = false; }
  };

  $('#badge-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#badge-error');
    err.hidden = true;
    const body = { name: $('#badge-name').value.trim(), icon: $('#badge-icon').value.trim(), description: $('#badge-desc').value.trim(), rule: formRule(), active: $('#badge-active').checked };
    const fail = (text, el) => { err.textContent = text; err.hidden = false; el?.focus(); };
    if (!body.name) return fail('Give the badge a name.', $('#badge-name'));
    if (!body.icon) return fail('Choose an icon: type an emoji or pick one.', $('#badge-icon'));
    if (body.rule && !(Number.isInteger(body.rule.count) && body.rule.count >= 1)) return fail('Type the number a player has to reach.', $('#badge-count'));
    const button = $('#badge-save');
    button.disabled = true;
    try {
      if (editing) await h.api(`badges/${editing.id}`, { method: 'POST', body: { ...body, sort: editing.sort } });
      else await h.api('badges', { method: 'POST', body });
      h.toast(editing ? `${body.name} saved.` : `${body.name} added.${body.rule ? ' Players who already qualify get it the next time the game checks.' : ''}`);
      resetEditor();
      $('#badge-editor').open = false;
      reload();
    } catch (ex) { fail(ex.message); } finally { button.disabled = false; }
  };

  $('#badge-rows').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = Number(b.dataset.badgeHolders || b.dataset.badgeEdit || b.dataset.badgeToggle || b.dataset.badgeDelete);
    const badge = data.badges.find((x) => x.id === id);
    if (!badge) return;
    if (b.dataset.badgeHolders) { showHolders(id); return; }
    if (b.dataset.badgeEdit) { editBadge(id); return; }
    if (b.dataset.badgeToggle) {
      const on = !badge.active;
      if (await h.act(b, () => h.api(`badges/${id}`, { method: 'POST', body: bodyOf(badge, { active: on }) }), on ? `${badge.name} is on.` : `${badge.name} is paused. Players don't see it; nobody loses it.`)) reload();
      return;
    }
    if (b.dataset.badgeDelete) {
      const ok = await h.ask({
        title: `Delete ${badge.name}?`,
        text: `It goes away for good, from ${badge.holders === 1 ? 'the 1 player' : `all ${h.fmt(badge.holders)} players`} who have it. To hide it for now instead, use Pause.`,
        fields: [{ name: 'confirm', label: `Type ${badge.name} to confirm` }],
        ok: 'Delete badge', danger: true,
        check: (v) => (v.confirm.trim().toLowerCase() === badge.name.toLowerCase() ? null : `Type ${badge.name} to confirm.`),
      });
      if (ok && await h.act(b, () => h.api(`badges/${id}/delete`, { method: 'POST' }), `${badge.name} deleted.`)) {
        if (editing?.id === id) resetEditor();
        reload();
      }
    }
  };

  $('#badge-holders').onclick = async (e) => {
    if (e.target.closest('button[data-holders-close]')) { openHolders = null; $('#badge-holders').innerHTML = ''; return; }
    const rm = e.target.closest('button[data-award-remove]');
    if (rm) await takeAway(rm, reload);
  };
}
