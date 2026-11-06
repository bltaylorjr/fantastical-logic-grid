// Status: a live page of everything worth watching (GET /admin/v1/status,
// server/src/status.js). Problems come first; every row says its state in
// words as well as colour and opens the page where it's handled.
//
// It refreshes every 30 seconds while it's open and the tab is visible, and
// straight away when you come back to it. The menu's count shows how many
// things are down or need a look.

const WORDS = { ok: 'OK', warn: 'Needs a look', down: 'Down', off: 'Not set up', unknown: 'Unknown' };
const ICON = { ok: '✓', warn: '!', down: '✕', off: '–', unknown: '?' };
const ONLY_KEY = 'status-only-problems';

let h = null;
let timer = null;
let ticker = null;
let last = null;          // the last report
let lastOverall = null;
let loading = false;

const $ = (s, r = document) => r.querySelector(s);
const onPage = () => location.hash === '#status';
const onlyProblems = () => { try { return localStorage.getItem(ONLY_KEY) === '1'; } catch (e) { return false; } };
const isProblem = (i) => i.state === 'down' || i.state === 'warn';

function since(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

function pill(state) {
  return `<span class="st-pill st-${state}"><span aria-hidden="true">${ICON[state]}</span> ${WORDS[state]}</span>`;
}

function row(i, groupTitle) {
  const open = i.url
    ? `<a class="btn small link" href="${h.esc(i.url)}" target="_blank" rel="noopener">Open on GitHub<span class="sr-only"> (${h.esc(i.label)})</span></a>`
    : i.link ? `<a class="btn small link" href="#${h.esc(i.link)}">Open<span class="sr-only"> ${h.esc(i.label)}</span><span aria-hidden="true"> ›</span></a>` : '';
  return `<li class="st-row st-${i.state}" data-state="${i.state}">
    ${pill(i.state)}
    <div class="st-what"><b>${h.esc(i.label)}</b>${groupTitle ? ` <span class="muted">· ${h.esc(groupTitle)}</span>` : ''}${i.detail ? `<div class="muted st-detail">${h.esc(i.detail)}</div>` : ''}</div>
    <div class="st-value">${h.esc(i.value)}</div>
    <div class="st-open">${open}</div>
  </li>`;
}

function summary(r) {
  const faults = r.groups.filter((g) => g.id !== 'waiting').flatMap((g) => g.items.filter(isProblem).map((i) => ({ ...i, group: g.title })));
  const down = faults.filter((i) => i.state === 'down').length;
  const warn = faults.length - down;
  const headline = r.overall === 'down' ? `${down} ${down === 1 ? 'thing is' : 'things are'} down${warn ? `, ${warn} more to look at` : ''}`
    : r.overall === 'warn' ? `${warn} ${warn === 1 ? 'thing needs' : 'things need'} a look`
      : 'Everything is working';
  const waiting = (r.groups.find((g) => g.id === 'waiting')?.items || []).filter((i) => i.state !== 'ok');
  return { faults, headline, waiting };
}

function render() {
  const el = $('#status-body');
  if (!el || !last) return;
  const r = last;
  const { faults, headline, waiting } = summary(r);
  const only = onlyProblems();
  const groups = r.groups.map((g) => {
    const items = only ? g.items.filter(isProblem) : g.items;
    const bad = g.items.filter(isProblem).length;
    if (only && !items.length) return '';
    return `<section class="card st-group" aria-labelledby="st-g-${g.id}">
      <h2 id="st-g-${g.id}">${h.esc(g.title)} ${bad ? `<span class="badge ${g.items.some((i) => i.state === 'down') ? 'bad' : 'warn'}">${bad} ${g.id === 'waiting' ? 'waiting' : 'to look at'}</span>` : '<span class="badge ok">All OK</span>'}</h2>
      <ul class="st-list">${items.map((i) => row(i)).join('')}</ul>
    </section>`;
  }).join('');
  el.innerHTML = `
    <div class="st-banner st-${r.overall}" role="status">
      <span class="st-big" aria-hidden="true">${ICON[r.overall]}</span>
      <div><div class="st-headline">${h.esc(headline)}</div>
      <div class="muted">${r.counts.ok} OK · ${r.counts.warn} to look at · ${r.counts.down} down · ${r.counts.off} not set up${r.counts.unknown ? ` · ${r.counts.unknown} unknown` : ''}${waiting.length ? ` · ${waiting.length} kinds of work waiting for you` : ''}</div></div>
    </div>
    ${faults.length ? `<section class="card st-group st-first" aria-labelledby="st-g-first"><h2 id="st-g-first">Look at these first</h2>
      <ul class="st-list">${faults.sort((a, b) => (a.state === 'down' ? 0 : 1) - (b.state === 'down' ? 0 : 1)).map((i) => row(i, i.group)).join('')}</ul></section>` : ''}
    ${groups || '<p class="muted">Nothing to look at. Untick “Show only problems” to see everything.</p>'}`;
  $('#status-only').checked = only;
}

function setStamp() {
  const s = $('#status-stamp');
  if (!s) return;
  if (loading) { s.textContent = 'Checking…'; return; }
  s.textContent = last ? `Live · checked ${since(last.checkedAt)}${document.hidden ? ' · paused while this tab is hidden' : ''}` : '';
}

function setMenuCount(r) {
  const el = document.getElementById('count-status');
  if (!el) return;
  const n = summary(r).faults.length;
  el.textContent = n;
  el.hidden = !n;
  el.setAttribute('aria-label', `${n} to look at`);
  el.classList.toggle('warn', r.overall === 'warn');
}

async function load({ quiet = false } = {}) {
  clearTimeout(timer);
  if (loading) return;
  loading = true;
  setStamp();
  try {
    last = await h.api('status');
    setMenuCount(last);
    if (onPage()) {
      render();
      // Say it out loud only when things change, not on every refresh.
      if (lastOverall && lastOverall !== last.overall) h.announce(`Status changed: ${summary(last).headline}.`);
    }
    lastOverall = last.overall;
    const err = $('#status-error'); if (err) err.hidden = true;
  } catch (e) {
    if (e.code === 'sign_in') return;
    const err = $('#status-error');
    if (err && onPage()) { err.textContent = `Couldn't check just now (${e.message}). Trying again shortly.`; err.hidden = false; }
    if (!quiet && !last) throw e;
  } finally {
    loading = false;
    setStamp();
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  if (!onPage() || document.hidden) return;
  timer = setTimeout(() => load({ quiet: true }), ((last && last.refreshSeconds) || 30) * 1000);
}

export async function statusView() {
  clearInterval(ticker);
  ticker = setInterval(() => { if (onPage()) setStamp(); else clearInterval(ticker); }, 5000);
  if (last) render();
  await load();
}

// Once after sign-in, for the menu's count.
export function statusCount() { load({ quiet: true }).catch(() => {}); }

export function initStatus(helpers) {
  h = helpers;
  $('#status-refresh').onclick = () => load({ quiet: true });
  $('#status-only').onchange = (e) => {
    try { localStorage.setItem(ONLY_KEY, e.target.checked ? '1' : '0'); } catch (err) { /* private mode */ }
    render();
  };
  document.addEventListener('visibilitychange', () => {
    if (!onPage()) return;
    if (document.hidden) { clearTimeout(timer); setStamp(); return; }
    // Back on the tab: check now if the last check is older than a refresh.
    if (!last || Date.now() - last.checkedAt > ((last.refreshSeconds || 30) * 1000)) load({ quiet: true });
    else schedule();
  });
  addEventListener('hashchange', () => { if (!onPage()) clearTimeout(timer); });
}
