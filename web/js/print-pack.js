// Printable puzzle packs (server/src/print-packs.js): a signed-in player can
// print a few brand-new puzzles at once, each with its answer key. The
// puzzles are written here on the device, like every puzzle, with stories the
// player has never had; the server counts packs so the admin's limits (how
// many puzzles in a pack, how many packs per period) hold on every device.
// Opened from Menu > Printable puzzle pack.
import { CLOUD_URL } from './cloud-config.js';
import * as remote from './remote-config.js';
import * as account from './account.js';
import { esc } from './grid.js';
import { buildPack, printPages } from './print.js';

const $ = (s) => document.querySelector(s);
const DAY = 86400_000;
let deps = null;
let busy = false;

export const available = () => !!CLOUD_URL && account.enabled() && remote.feature('printPacks');

async function call(method, body) {
  const token = await account.getIdToken();
  const res = await fetch(`${CLOUD_URL}/v1/print-packs`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error) throw new Error('That did not work right now. Please try again later.');
  return data;
}

// "in 3 days", "tomorrow", "in 5 hours"
function whenText(at) {
  const ms = at - Date.now();
  if (ms < 3600_000) return 'within the hour';
  if (ms < DAY) return `in ${Math.ceil(ms / 3600_000)} hours`;
  const days = Math.ceil(ms / DAY);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

function allowanceText(a) {
  const per = a.periodDays === 7 ? 'week' : a.periodDays === 1 ? 'day' : `${a.periodDays} days`;
  const rule = `You can print ${a.perPeriod} pack${a.perPeriod === 1 ? '' : 's'} every ${per}, with up to ${a.size} puzzle${a.size === 1 ? '' : 's'} in each.`;
  if (!a.perPeriod) return 'New packs are paused for now. Please check back later.';
  if (a.left) return `${rule} You have ${a.left} left right now.`;
  return `${rule} You have used them all for now. Your next pack is ready ${a.nextAt ? whenText(a.nextAt) : 'soon'}.`;
}

// deps: { openDialog, openAccount, signedIn, makePuzzle, newSave, putSave, tiers, themes, refreshSaved, toast }
export function initPrintPack(d) {
  deps = d;
  $('#pack-signin').onclick = () => { $('#dlg-pack').close(); deps.openAccount(); };
  $('#pack-cancel').onclick = () => $('#dlg-pack').close();
  $('#pack-go').onclick = () => make();
  $('#pack-pdf').onclick = () => make({ pdf: true });
}

export async function open() {
  if (!deps) return;
  const dlg = $('#dlg-pack');
  const out = !deps.signedIn();
  $('#pack-out').hidden = !out;
  $('#pack-form').hidden = out;
  $('#pack-status').textContent = '';
  $('#pack-intro').textContent = out ? '' : 'Checking how many packs you can print…';
  if (!out) {
    $('#pack-tier').innerHTML = deps.tiers().map((t) => `<option value="${esc(t.id)}"${t.id === (deps.lastTier?.() || 'easy') ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    $('#pack-theme').innerHTML = `<option value="random">Surprise me (a mix)</option>${deps.themes().map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}`;
    const paper = /^en-(US|CA)|es-(MX|US)|fil|-PH$/.test(navigator.language || '') ? 'letter' : 'A4';
    document.querySelectorAll('input[name=pkpaper]').forEach((r) => { r.checked = r.value === paper; });
    $('#pack-pdf').hidden = !(window.desktop && window.desktop.savePdf);
    setButtons(false);
  }
  deps.openDialog(dlg, out ? $('#pack-signin') : $('#pack-count'));
  if (!out) refresh();
}

function setButtons(off) {
  for (const id of ['#pack-go', '#pack-pdf', '#pack-count', '#pack-tier', '#pack-theme']) $(id).disabled = off;
}

async function refresh() {
  let a;
  try { a = await call('GET'); } catch (e) {
    $('#pack-intro').textContent = navigator.onLine === false ? 'You seem to be offline. Packs need a connection to check your allowance.' : e.message;
    setButtons(true);
    return null;
  }
  if (a.error) { $('#pack-intro').textContent = a.error === 'sign_in' ? 'Please sign in again.' : 'That did not work right now. Please try again later.'; setButtons(true); return null; }
  if (!a.on) { $('#pack-intro').textContent = 'Printable puzzle packs are switched off for now.'; setButtons(true); return a; }
  $('#pack-intro').textContent = allowanceText(a);
  const sel = $('#pack-count');
  const keep = Number(sel.value) || Math.min(3, a.size);
  sel.innerHTML = Array.from({ length: a.size }, (_, i) => `<option value="${i + 1}"${i + 1 === Math.min(keep, a.size) ? ' selected' : ''}>${i + 1}</option>`).join('');
  setButtons(!a.left);
  return a;
}

async function make({ pdf = false } = {}) {
  if (busy) return;
  busy = true;
  setButtons(true);
  const st = $('#pack-status');
  try {
    const a = await refresh();
    if (!a || !a.on || !a.left) return;
    const count = Math.min(a.size, Number($('#pack-count').value) || 1);
    const opts = { difficulty: $('#pack-tier').value, theme: $('#pack-theme').value };
    const puzzles = [];
    const write = async () => {
      st.textContent = `Writing puzzle ${puzzles.length + 1} of ${count}…`;
      puzzles.push(await deps.makePuzzle({ ...opts }));
    };
    while (puzzles.length < count) await write();
    // The server refuses a story already in one of this player's packs (from
    // another device): swap those for new ones and ask again.
    let r;
    for (let tries = 0; tries < 3; tries++) {
      st.textContent = 'Almost ready…';
      r = await call('POST', { stories: puzzles.map((p) => String(p.story.id)) });
      if (r.error !== 'used') break;
      const seen = new Set(r.stories || []);
      for (let i = puzzles.length - 1; i >= 0; i--) if (seen.has(String(puzzles[i].story.id))) puzzles.splice(i, 1);
      while (puzzles.length < count) await write();
    }
    if (!r || r.error) {
      st.textContent = r?.message || 'That did not work right now. Please try again later.';
      if (r && r.on !== undefined) $('#pack-intro').textContent = allowanceText(r);
      return;
    }
    if ($('#pack-save').checked) {
      for (const p of puzzles) { const s = deps.newSave(p); s.pack = true; await deps.putSave(s); }
      deps.refreshSaved?.();
    }
    const paper = document.querySelector('input[name=pkpaper]:checked').value;
    const keys = document.querySelector('input[name=pkkeys]:checked').value;
    const day = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const title = `Puzzle pack, ${day}`;
    const html = buildPack(puzzles, { paper, keys, title, note: `${count} brand-new puzzle${count === 1 ? '' : 's'}, made for you.`, supportLine: deps.supportLine?.() });
    st.textContent = '';
    $('#pack-intro').textContent = allowanceText(r);
    $('#dlg-pack').close();
    deps.toast(r.left ? `Your pack is ready. ${r.left} more left for now.` : 'Your pack is ready. That was your last one for now.');
    setTimeout(() => printPages(html, { title, paper, pdf: pdf ? () => window.desktop.savePdf(title, paper) : null }), 50);
  } catch (e) {
    st.textContent = navigator.onLine === false ? 'You seem to be offline.' : (e.message || 'That did not work right now. Please try again later.');
  } finally {
    busy = false;
    if ($('#dlg-pack').open) refresh();
  }
}
