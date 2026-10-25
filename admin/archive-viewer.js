// The archive viewer (archive.html): opens weekly archive zips in the
// browser and shows totals, charts and groups, with filters and CSV export.
// Files never leave the browser and nothing is sent to the Worker.
import { readArchive } from './archive-zip.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, p = 0) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString([], { maximumFractionDigits: p }));
const DATE_GUESS = ['day', 'created_at', 'at', 'ran_at', 'joined_at', 'reviewed', 'ends_at', 'submitted'];
const SHOW_ROWS = 200;
const TOP_GROUPS = 25;

const archives = []; // { name, manifest, tables, rows }
let merged = {}; // table -> { columns, rows, dateColumn, numeric:Set, label }
let current = null; // { table, rows (filtered) }
let lastGroups = [];

function announce(text) { $('#live').textContent = ''; setTimeout(() => { $('#live').textContent = text; }, 30); }

// Day numbers (ms at UTC midnight) from ISO days, ISO times or epoch ms.
function toMs(v) {
  if (v == null || v === '') return null;
  if (/^\d{11,}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function bucket(ms, period) {
  const d = new Date(ms);
  if (period === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (period === 'week') return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return isoDay(ms);
}

function rebuild() {
  merged = {};
  for (const a of archives) {
    for (const [name, t] of Object.entries(a.tables)) {
      const m = (merged[name] ||= { columns: [], rows: [], seen: new Set(), dateColumn: null, label: name });
      for (const c of t.columns) if (!m.columns.includes(c)) m.columns.push(c);
      const info = a.manifest?.tables?.[name];
      if (info?.dateColumn) m.dateColumn = info.dateColumn;
      if (info?.label) m.label = info.label;
          // The same row can be in two archives (while removal is off), so count it once.
      for (const r of t.rows) {
        const key = JSON.stringify(m.columns.map((c) => r[c] ?? ''));
        if (!m.seen.has(key)) { m.seen.add(key); m.rows.push(r); }
      }
    }
  }
  for (const m of Object.values(merged)) {
    m.dateColumn ||= DATE_GUESS.find((c) => m.columns.includes(c)) || null;
    m.numeric = new Set(m.columns.filter((c) => {
      const vals = m.rows.slice(0, 500).map((r) => r[c]).filter((v) => v !== '' && v != null);
      return vals.length && vals.every((v) => /^-?\d+(\.\d+)?$/.test(v));
    }));
    for (const r of m.rows) r._ms = m.dateColumn ? toMs(r[m.dateColumn]) : null;
  }
}

function renderFiles() {
  $('#loaded').hidden = !archives.length;
  $('#file-rows').innerHTML = archives.map((a, i) => `<tr><td>${esc(a.name)}</td><td>${esc(a.manifest?.generatedAt ? new Date(a.manifest.generatedAt).toLocaleString() : '–')}</td>
    <td class="num">${fmt(a.rows)}</td><td><button class="btn small" type="button" data-remove="${i}">Close</button></td></tr>`).join('');
  const tables = Object.entries(merged).sort((a, b) => b[1].rows.length - a[1].rows.length);
  const was = $('#table').value;
  $('#table').innerHTML = tables.map(([n, m]) => `<option value="${esc(n)}">${esc(m.label)} (${fmt(m.rows.length)})</option>`).join('');
  if (merged[was]) $('#table').value = was;
  setupTable();
}

function setupTable() {
  const m = merged[$('#table').value];
  if (!m) return;
  const cols = m.columns;
  const opts = (list) => list.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#filter-col').innerHTML = `<option value="">Any</option>${opts(cols)}`;
  $('#filter-val').innerHTML = '';
  $('#filter-val').disabled = true;
  const groupable = cols.filter((c) => c !== m.dateColumn);
  const preferred = ['theme', 'tier', 'platform', 'outcome', 'kind', 'action', 'status', 'name', 'version'].find((c) => cols.includes(c));
  $('#group').innerHTML = `<option value="">Nothing</option>${opts(groupable)}`;
  $('#group').value = preferred || '';
  $('#measure').innerHTML = `<option value="count">Number of rows</option>${[...m.numeric].map((c) => `<option value="sum:${esc(c)}">Total of ${esc(c)}</option><option value="avg:${esc(c)}">Average of ${esc(c)}</option>`).join('')}`;
  const dated = m.dateColumn && m.rows.some((r) => r._ms != null);
  for (const id of ['#from', '#to', '#period']) $(id).disabled = !dated;
  $('#from').value = '';
  $('#to').value = '';
  $('#search').value = '';
  render();
}

function filterValues() {
  const m = merged[$('#table').value];
  const col = $('#filter-col').value;
  const sel = $('#filter-val');
  if (!col) { sel.innerHTML = ''; sel.disabled = true; render(); return; }
  const counts = new Map();
  for (const r of m.rows) counts.set(r[col] ?? '', (counts.get(r[col] ?? '') || 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 300);
  sel.innerHTML = list.map(([v, n]) => `<option value="${esc(v)}">${esc(v === '' ? '(empty)' : v.length > 60 ? `${v.slice(0, 60)}…` : v)} (${fmt(n)})</option>`).join('');
  sel.disabled = false;
  render();
}

function matching() {
  const m = merged[$('#table').value];
  if (!m) return [];
  const from = $('#from').value ? Date.parse($('#from').value) : null;
  const to = $('#to').value ? Date.parse($('#to').value) + 86_400_000 : null;
  const q = $('#search').value.trim().toLowerCase();
  const col = $('#filter-col').value;
  const val = $('#filter-val').disabled ? null : $('#filter-val').value;
  return m.rows.filter((r) => {
    if (from != null && (r._ms == null || r._ms < from)) return false;
    if (to != null && (r._ms == null || r._ms >= to)) return false;
    if (col && val != null && (r[col] ?? '') !== val) return false;
    if (q && !m.columns.some((c) => String(r[c] ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function measureOf(rows) {
  const [kind, col] = $('#measure').value.split(':');
  if (kind === 'count') return rows.length;
  const nums = rows.map((r) => Number(r[col])).filter(Number.isFinite);
  const total = nums.reduce((s, n) => s + n, 0);
  return kind === 'sum' ? total : nums.length ? total / nums.length : null;
}
const measureName = () => $('#measure').selectedOptions[0]?.textContent || 'Number of rows';

function groupRows(rows) {
  const col = $('#group').value;
  if (!col) return [];
  const groups = new Map();
  for (const r of rows) {
    const k = r[col] ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups].map(([k, list]) => ({ key: k, rows: list.length, value: measureOf(list) })).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}

function timeSeries(rows) {
  const period = $('#period').value;
  const buckets = new Map();
  for (const r of rows) {
    if (r._ms == null) continue;
    const k = bucket(r._ms, period);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  return [...buckets].sort((a, b) => a[0].localeCompare(b[0])).map(([k, list]) => ({ key: k, value: measureOf(list) || 0 }));
}

function barChart(title, points) {
  if (!points.length) return '';
  const w = 600;
  const h = 140;
  const max = Math.max(1, ...points.map((p) => p.value));
  const bw = w / points.length;
  const y = (v) => h - (v / max) * (h - 6);
  const rects = points.map((p, i) => `<rect class="b1" x="${(i * bw + bw * 0.12).toFixed(1)}" y="${y(p.value).toFixed(1)}" width="${Math.max(1, bw * 0.76).toFixed(1)}" height="${(h - y(p.value)).toFixed(1)}"><title>${esc(p.key)}: ${fmt(p.value, 2)}</title></rect>`).join('');
  const total = points.reduce((s, p) => s + p.value, 0);
  const label = `${title}: ${points.length} periods from ${points[0].key} to ${points.at(-1).key}, highest ${fmt(Math.max(...points.map((p) => p.value)), 2)}.`;
  return `<figure class="chart wide"><h3>${esc(title)}</h3><p class="muted">${esc(points[0].key)} to ${esc(points.at(-1).key)}${$('#measure').value.startsWith('avg') ? '' : `, ${fmt(total, 2)} in total`}</p>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><line class="axis" x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}"></line>${rects}</svg></figure>`;
}

function meterSvg(v, max) {
  const f = max > 0 && v > 0 ? Math.min(1, v / max) : 0;
  return `<div class="meter" aria-hidden="true"><svg viewBox="0 0 100 10" preserveAspectRatio="none"><rect class="fill" x="0" y="0" height="10" width="${(f * 100).toFixed(1)}"></rect></svg></div>`;
}

const tile = (label, value) => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div></div>`;

function render() {
  const name = $('#table').value;
  const m = merged[name];
  if (!m) return;
  const rows = matching();
  current = { table: name, rows };
  const dates = rows.map((r) => r._ms).filter((x) => x != null);
  const first = dates.length ? isoDay(Math.min(...dates)) : '–';
  const last = dates.length ? isoDay(Math.max(...dates)) : '–';
  const measure = $('#measure').value;
  $('#summary').innerHTML = tile('Matching rows', fmt(rows.length)) + tile('Of all rows', fmt(m.rows.length))
    + (m.dateColumn ? tile('First', esc(first)) + tile('Last', esc(last)) : '')
    + (measure !== 'count' ? tile(measureName(), fmt(measureOf(rows), 2)) : '');

  const series = m.dateColumn ? timeSeries(rows) : [];
  $('#charts').innerHTML = barChart(`${measureName()} by ${$('#period').value}`, series);

  const groups = groupRows(rows);
  lastGroups = groups;
  $('#groups-h').hidden = !$('#group').value;
  if (!$('#group').value) $('#groups').innerHTML = '<p class="muted">Choose a column under "Group by" to compare groups.</p>';
  else {
    const top = groups.slice(0, TOP_GROUPS);
    const max = Math.max(0, ...top.map((g) => g.value || 0));
    $('#groups').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">${esc($('#group').value)}</th><th scope="col" class="num">Rows</th><th scope="col" class="num">${esc(measureName())}</th><th scope="col"><span class="sr-only">Bar</span></th></tr></thead><tbody>
      ${top.map((g) => `<tr><td>${esc(g.key === '' ? '(empty)' : g.key)}</td><td class="num">${fmt(g.rows)}</td><td class="num">${fmt(g.value, 2)}</td><td class="bar-cell">${meterSvg(g.value || 0, max)}</td></tr>`).join('')}
      </tbody></table></div>${groups.length > TOP_GROUPS ? `<p class="muted">Showing the top ${TOP_GROUPS} of ${fmt(groups.length)} groups. The export has them all.</p>` : ''}`;
  }

  const shown = rows.slice(0, SHOW_ROWS);
  $('#rows-note').textContent = rows.length > SHOW_ROWS ? `The first ${SHOW_ROWS} of ${fmt(rows.length)} matching rows. Export them all as CSV.` : `${fmt(rows.length)} matching rows.`;
  const cell = (r, c) => {
    const v = r[c] ?? '';
    if (c === m.dateColumn && /^\d{11,}$/.test(v)) return esc(new Date(Number(v)).toISOString().replace('T', ' ').slice(0, 16));
    return esc(v.length > 120 ? `${v.slice(0, 120)}…` : v);
  };
  $('#rows').innerHTML = shown.length ? `<div class="table-wrap"><table class="table"><thead><tr>${m.columns.map((c) => `<th scope="col"${m.numeric.has(c) ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${shown.map((r) => `<tr>${m.columns.map((c) => `<td${m.numeric.has(c) ? ' class="num"' : ''}>${cell(r, c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">No rows match.</p>';
  announce(`${rows.length} matching rows.`);
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function download(name, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

$('#export-rows').onclick = () => {
  if (!current) return;
  const m = merged[current.table];
  download(`${current.table}-rows.csv`, m.columns, current.rows.map((r) => m.columns.map((c) => r[c] ?? '')));
};
$('#export-groups').onclick = () => {
  if (!current || !$('#group').value) { announce('Choose a column under Group by first.'); return; }
  download(`${current.table}-by-${$('#group').value}.csv`, [$('#group').value, 'rows', measureName()], lastGroups.map((g) => [g.key, g.rows, g.value ?? '']));
};

async function open(fileList) {
  const err = $('#load-error');
  err.hidden = true;
  const problems = [];
  for (const f of fileList) {
    if (archives.some((a) => a.name === f.name && a.size === f.size)) continue;
    try {
      const a = await readArchive(f);
      a.size = f.size;
      a.rows = Object.values(a.tables).reduce((s, t) => s + t.rows.length, 0);
      archives.push(a);
    } catch (e) { problems.push(`${f.name}: ${e.message}`); }
  }
  archives.sort((a, b) => String(a.manifest?.generatedAt || a.name).localeCompare(String(b.manifest?.generatedAt || b.name)));
  if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; }
  rebuild();
  renderFiles();
  announce(`${archives.length} archive${archives.length === 1 ? '' : 's'} open.`);
}

$('#files').onchange = (e) => { open([...e.target.files]); e.target.value = ''; };
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); open([...e.dataTransfer.files]); });
$('#file-rows').onclick = (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  archives.splice(Number(b.dataset.remove), 1);
  rebuild();
  renderFiles();
};
$('#table').onchange = setupTable;
$('#filter-col').onchange = filterValues;
for (const id of ['#filter-val', '#group', '#measure', '#period', '#from', '#to']) $(id).onchange = render;
$('#search').oninput = render;
$('#reset').onclick = setupTable;
$('#controls').onsubmit = (e) => e.preventDefault();
