// Review page for story parts players shared. Open /admin/learn and paste the
// ADMIN_TOKEN you set as a secret; it is kept only in this browser tab.
export const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Story review</title>
<style>
:root { color-scheme: light dark; --bg: #fff; --text: #121626; --muted: #4a5168; --line: #d5d9e6; --accent: #5b3cc4; }
@media (prefers-color-scheme: dark) { :root { --bg: #121729; --text: #eef0f8; --muted: #aeb5cb; --line: #2c3450; --accent: #f5c451; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.5rem; } .muted { color: var(--muted); }
button, input, select { font: inherit; min-height: 40px; }
button { border: 2px solid var(--accent); background: transparent; color: var(--text); border-radius: 8px; padding: 0 12px; cursor: pointer; }
button.ok { background: var(--accent); color: var(--bg); }
input { width: 100%; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); }
li { list-style: none; border-bottom: 1px solid var(--line); padding: 12px 0; } ul { padding: 0; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
</style></head><body><main>
<h1>Story review</h1>
<p class="muted">Story parts players shared. Approved parts are sent to every player within about 15 minutes. Rejected parts are never shown.</p>
<form id="login" class="row"><label for="token" style="width:100%">Admin token</label><input id="token" type="password" autocomplete="off"><button class="ok">Open</button></form>
<div id="app" hidden>
  <p id="stats" class="muted"></p>
  <div class="row"><label for="status">Show</label><select id="status"><option value="pending">Waiting for review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
  <ul id="list"></ul>
</div>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = sessionStorage.getItem('flg-admin') || '';
const api = (path, opts = {}) => fetch(path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); });
const text = (p) => p.kind === 'incidents' ? p.value.name + ': ' + p.value.text + ' (at stake: ' + p.value.prize + ')' : p.value;
async function load() {
  try {
    const d = await api('/admin/learn/parts?status=' + $('#status').value);
    $('#login').hidden = true; $('#app').hidden = false;
    $('#stats').textContent = d.stats.games + ' games shared, ' + d.stats.rated + ' rated. Voice clips made today: ' + d.stats.voicesToday + ' of ' + d.stats.voiceCap + '.';
    $('#list').innerHTML = d.parts.length ? d.parts.map((p) => '<li><b>' + esc(p.theme) + ' · ' + esc(p.kind) + '</b>' + (p.source === 'ai' ? ' <span class="muted">(drafted with AI)</span>' : '') + '<p>' + esc(text(p)) + '</p><div class="row">' +
      (p.status !== 'approved' ? '<button class="ok" data-k="' + esc(p.key) + '" data-s="approved">Approve</button>' : '') +
      (p.status !== 'rejected' ? '<button data-k="' + esc(p.key) + '" data-s="rejected">Reject</button>' : '') + '</div></li>').join('') : '<li class="muted">Nothing here.</li>';
  } catch (e) { $('#login').hidden = false; $('#app').hidden = true; alert('Could not open: ' + e.message); }
}
$('#login').onsubmit = (e) => { e.preventDefault(); token = $('#token').value.trim(); sessionStorage.setItem('flg-admin', token); load(); };
$('#status').onchange = load;
$('#list').onclick = async (e) => { const b = e.target.closest('button[data-k]'); if (!b) return; b.disabled = true; await api('/admin/learn/review', { method: 'POST', body: JSON.stringify({ key: b.dataset.k, status: b.dataset.s }) }); load(); };
if (token) load();
</script></main></body></html>`;
