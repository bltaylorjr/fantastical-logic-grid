// Play against others: the screen name window, races (start, join, find,
// standings) and the scoreboard. Shown only when accounts are switched on.
// Playing alone never needs any of this.
import * as account from './account.js';
import * as compete from './compete.js';
import { esc } from './grid.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const RACE_TITLES = { start: 'Start a race', join: 'Join a race', share: 'Race started', standings: 'Race standings' };
let ui = null;
let name = null; // the player's screen name, once known
let afterName = null; // what to do once a name is chosen
let pendingCode = null; // a race link opened before signing in

export function initCompete(hooks) {
  ui = hooks;
  if (!compete.enabled()) return;
  $('#compete-section').hidden = false;
  $('[data-cmd=board]').hidden = false;
  $('#help-compete').hidden = false;
  name = compete.cachedName();
  wireName();
  wireRace();
  wireBoard();
  $('#race-share').onclick = () => { const g = ui.game(); if (g && g.save.race) showShare(g.save.race.code); };
  $('#race-standings').onclick = () => { const g = ui.game(); if (g && g.save.race) showStandings(g.save.race.code); };
  account.onChange((user) => {
    if (!user) { name = null; compete.forget(); renderCard(); return; }
    refreshName();
  });
  renderCard();
  if (account.current()) refreshName();
}

async function refreshName() {
  try { name = await compete.loadName(); } catch (e) { /* offline: keep the cached name */ }
  renderCard();
  if (pendingCode) { const code = pendingCode; pendingCode = null; needName(() => openJoin(code)); }
}

// ------------------------------------------------------------ home card
function renderCard() {
  if (!compete.enabled()) return;
  const user = account.current();
  const btn = (id, text, primary) => `<button class="btn${primary ? ' primary' : ''}" type="button" data-compete="${id}">${text}</button>`;
  let actions;
  const me = $('#compete-me');
  me.hidden = !(user && name);
  if (!user) {
    actions = btn('signin', 'Sign in to race', true) + btn('board', 'Scoreboard');
  } else if (!name) {
    actions = btn('name', 'Choose a screen name', true) + btn('board', 'Scoreboard');
  } else {
    me.innerHTML = `Playing as <b>${esc(name)}</b> <button class="btn quiet small" type="button" data-compete="name">Change<span class="sr-only"> screen name</span></button>`;
    actions = btn('start', 'Start a race', true) + btn('find', 'Find a race') + btn('join', 'Join with a code') + btn('board', 'Scoreboard');
  }
  $('#compete-intro').textContent = user && name
    ? 'Race on the very same puzzle: the fastest solve wins. Every solved puzzle also earns points on the scoreboard.'
    : 'Race other detectives on the very same puzzle and climb the scoreboard. Sign in and choose a screen name to take part. You never need an account to play on your own.';
  $('#compete-actions').innerHTML = actions;
}

function cardError(text) {
  const box = $('#compete-error');
  box.textContent = text || '';
  box.hidden = !text;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-compete]');
  if (!b) return;
  cardError('');
  const act = b.dataset.compete;
  if (act === 'signin') ui.openAccount();
  else if (act === 'name') openName();
  else if (act === 'board') openBoard();
  else if (act === 'start') needName(openStart);
  else if (act === 'join') needName(() => openJoin(''));
  else if (act === 'find') needName(findRace);
});

// Races need a sign-in and a screen name; ask for whichever is missing.
function needName(then) {
  if (!account.current()) { ui.openAccount(); return; }
  if (!name) { afterName = then; openName(); return; }
  then();
}

export function onHome() { if (compete.enabled() && account.current() && !name) refreshName(); }

// ------------------------------------------------------------ screen name
function openName() {
  const d = $('#dlg-name');
  const form = $('#name-form');
  $('#name-input').value = name || '';
  $('#name-input').removeAttribute('aria-invalid');
  $('#name-post').checked = ui.getSetting('postScores') !== false;
  $('.error-box', form).hidden = true;
  $('#name-leave').hidden = !name;
  $('#name-leave').open = false;
  $('#name-h').textContent = name ? 'Change your screen name' : 'Choose a screen name';
  ui.openDialog(d, $('#name-input'));
}

function wireName() {
  const d = $('#dlg-name');
  const form = $('#name-form');
  const fail = (text) => { const box = $('.error-box', form); box.textContent = text; box.hidden = false; $('#name-input').setAttribute('aria-invalid', 'true'); $('#name-input').focus(); };
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => { afterName = null; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const value = $('#name-input').value;
    const problem = compete.nameProblem(value);
    if (problem) { fail(problem); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      name = await compete.setName(value);
      ui.setSetting('postScores', $('#name-post').checked);
      const next = afterName;
      afterName = null;
      d.close();
      renderCard();
      ui.toast(`You are now ${name} on the scoreboard and in races.`);
      if (next) next();
    } catch (err) { fail(err.message); } finally { btn.disabled = false; }
  };
  $('#name-post').onchange = () => { if (name) ui.setSetting('postScores', $('#name-post').checked); };
  $('#name-leave-btn').onclick = async () => {
    const ok = await ui.confirmDialog({ title: 'Leave the scoreboard?', text: 'Your screen name, points and race results will be removed. This cannot be undone. Your account and puzzles stay.', yes: 'Remove my name and scores', no: 'Keep them' });
    if (!ok) return;
    try {
      await compete.leave();
      name = null;
      d.close();
      renderCard();
      ui.toast('Your screen name and scores are removed.');
    } catch (err) { fail(err.message); }
  };
}

// ------------------------------------------------------------ races
function showRace(view) {
  const d = $('#dlg-race');
  $$('.race-view', d).forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('.error-box', d).forEach((b) => { b.hidden = true; });
  $('#race-h').textContent = RACE_TITLES[view];
  if (!d.open) ui.openDialog(d, null);
  const v = $(`.race-view[data-view=${view}]`, d);
  ($('input:not([type=checkbox])', v) || $('button[type=submit], .dlg-actions .primary', v)).focus();
}
const raceFail = (view, text) => { const box = $(`.race-view[data-view=${view}] .error-box`); box.textContent = text; box.hidden = false; };

function openStart() {
  $('#race-choice').innerHTML = `The race uses your New puzzle choices: <b>${esc(ui.setupSummary())}</b>. Change them on the home screen first if you like.`;
  showRace('start');
}
function openJoin(code) {
  $('#race-code').value = code || '';
  showRace('join');
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

function wireRace() {
  const d = $('#dlg-race');
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
  const start = $('.race-view[data-view=start]', d);
  start.onsubmit = (e) => {
    e.preventDefault();
    busy($('button[type=submit]', start), 'Writing the puzzle…', async () => {
      try {
        const puzzle = await ui.makePuzzle();
        const race = await compete.createRace(puzzle, $('#race-public').checked);
        await ui.openRace(puzzle, race);
        showShare(race.code);
      } catch (err) { raceFail('start', err.message || String(err)); }
    });
  };
  const join = $('.race-view[data-view=join]', d);
  $('#race-code').oninput = () => { $('#race-code').value = compete.cleanCode($('#race-code').value); };
  join.onsubmit = (e) => {
    e.preventDefault();
    const code = compete.cleanCode($('#race-code').value);
    if (!compete.CODE.test(code)) { raceFail('join', 'A race code has 6 letters and numbers, like K7QF2M.'); $('#race-code').focus(); return; }
    busy($('button[type=submit]', join), 'Joining…', async () => {
      try { await joinAndOpen(code); d.close(); } catch (err) { raceFail('join', err.message); }
    });
  };
  $('#race-copy').onclick = async () => {
    const link = $('#race-link').href;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Race me on The Fantastical Logic Grid', text: `Race me! Code ${$('#race-code-big').textContent}`, url: link });
      else { await navigator.clipboard.writeText(link); $('#race-copied').textContent = 'Link copied.'; }
    } catch (e) { $('#race-copied').textContent = 'Copy the code above instead.'; }
  };
  $('#race-refresh').onclick = () => showStandings($('#race-refresh').dataset.code);
}

// Open the race on this device: the saved copy if there is one, else the
// race puzzle from the server.
async function joinAndOpen(code) {
  const saved = await ui.findRaceSave(code);
  if (saved) { ui.openSave(saved); return; }
  const { puzzle, race } = await compete.joinRace(code);
  await ui.openRace(puzzle, race);
  ui.toast(`Joined the race “${race.title}”. ${race.players.length} player${race.players.length === 1 ? '' : 's'} so far. Good luck!`);
}

async function findRace() {
  const st = $('#compete-status');
  const btns = $$('#compete-actions button');
  btns.forEach((b) => { b.disabled = true; });
  st.textContent = 'Looking for an open race…';
  try {
    const used = new Set(await ui.usedStories());
    const skip = [];
    let tier = ui.currentTier();
    for (let i = 0; i < 6; i++) {
      let found;
      try { found = await compete.findRace(tier, skip); } catch (err) {
        // Nothing at this difficulty: try any difficulty once.
        if (err.code === 'no_open_races' && tier) { tier = null; i--; continue; }
        throw err;
      }
      if (used.has(found.storyId)) { skip.push(found.code); continue; } // a story you have already read
      await joinAndOpen(found.code);
      return;
    }
    throw new compete.CompeteError('no_open_races', 'No open races right now. Start one and others can join it.');
  } catch (err) {
    cardError(err.message);
  } finally {
    st.textContent = '';
    btns.forEach((b) => { b.disabled = false; });
  }
}

function showShare(code) {
  $('#race-code-big').textContent = code;
  const link = compete.shareLink(code);
  $('#race-link').href = link;
  $('#race-link').textContent = link;
  $('#race-copied').textContent = '';
  showRace('share');
}

export async function showStandings(code) {
  $('#race-refresh').dataset.code = code;
  $('#race-standings-body').innerHTML = '<p class="muted">Loading…</p>';
  showRace('standings');
  try {
    const race = await compete.raceStandings(code);
    renderStandingsInto($('#race-standings-body'), race);
    $('#race-standings-head').textContent = `“${race.title}”, race code ${race.code}. ${race.open ? 'Others can still join.' : 'Closed to new players.'}`;
  } catch (err) { $('#race-standings-body').innerHTML = `<p class="error-box">${esc(err.message)}</p>`; }
}

const STATUS = { solved: 'Solved', solving: 'Still solving', gave_up: 'Revealed the answer' };
function renderStandingsInto(el, race) {
  const rows = race.players.map((p) => `<tr${p.me ? ' class="me"' : ''}>
      <td>${p.place ? `<b>${p.place}</b>` : '–'}</td>
      <th scope="row">${esc(p.name)}${p.me ? ' <span class="pill">You</span>' : ''}${p.host ? ' <span class="pill">Host</span>' : ''}</th>
      <td>${STATUS[p.status]}</td>
      <td>${p.raceMs != null ? ui.fmtTime(p.raceMs) : ''}</td>
      <td>${p.elapsedMs != null ? `${ui.fmtTime(p.elapsedMs)}, ${p.hints} hint${p.hints === 1 ? '' : 's'}, ${p.checks} check${p.checks === 1 ? '' : 's'}` : ''}</td></tr>`).join('');
  el.innerHTML = `<div class="table-wrap"><table class="board"><caption class="sr-only">Race standings</caption>
    <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Status</th><th scope="col">Race time</th><th scope="col">Solve time and help</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// While a race is open on the play screen.
export function onGameOpen(save) {
  const bar = $('#race-bar');
  bar.hidden = !(compete.enabled() && save.race);
  if (bar.hidden) return;
  $('#race-bar-text').innerHTML = `<b>Race ${esc(save.race.code)}</b>. Everyone in this race has the same puzzle. Each hint adds 1 minute and each check 15 seconds.`;
}

// ------------------------------------------------------------ results
// Called whenever the solved panel shows. Sends a result that has not reached
// the server yet (a new solve, or one made offline) and shows the outcome.
export async function onSolved(save, pairs) {
  const box = $('#compete-result');
  box.hidden = true;
  box.innerHTML = '';
  if (!compete.enabled() || !account.current()) return;
  if (save.race) {
    box.hidden = false;
    if (!save.race.finished) {
      box.innerHTML = '<p class="muted">Sending your race result…</p>';
      try {
        const res = await compete.finishRace(save, pairs);
        save.race.finished = true;
        save.race.points = res.points;
        ui.saveGame();
        renderRaceResult(box, save, res.race);
      } catch (err) {
        box.innerHTML = `<p>${esc(err.code === 'OFFLINE' ? 'You are offline. Your race result will be sent when you open this puzzle again online.' : err.message)}</p>`;
      }
      return;
    }
    try { renderRaceResult(box, save, await compete.raceStandings(save.race.code)); } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    return;
  }
  if (!save.scorePending) return;
  if (!name || ui.getSetting('postScores') === false || save.revealed) { delete save.scorePending; ui.saveGame(); return; }
  box.hidden = false;
  try {
    const res = await compete.postScore(save);
    delete save.scorePending;
    save.points = res.points;
    ui.saveGame();
    box.innerHTML = `<p><b>+${res.points} points</b> on the scoreboard as ${esc(name)}. <button class="btn small" type="button" data-compete="board">See the scoreboard</button></p>`;
  } catch (err) {
    if (err.code === 'OFFLINE') { box.innerHTML = '<p class="muted">You are offline. Your points will be added when you open this puzzle again online.</p>'; return; }
    delete save.scorePending;
    ui.saveGame();
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function renderRaceResult(box, save, race) {
  const me = race.players.find((p) => p.me);
  const head = save.revealed
    ? 'You revealed the solution, so this race does not count for you.'
    : me && me.place === 1 && race.players.filter((p) => p.status === 'solved').length > 1 ? `You are in first place! ${save.race.points ? `+${save.race.points} points.` : ''}`
      : me && me.place ? `You are in place ${me.place} of ${race.players.length} so far. ${save.race.points ? `+${save.race.points} points.` : ''}` : '';
  box.innerHTML = `<h3>Race ${esc(race.code)}</h3><p>${esc(head)}</p><div class="race-standings"></div>
    <p class="row"><button class="btn small" type="button" id="race-result-refresh">Refresh</button> <button class="btn small" type="button" id="race-result-share">Invite more players</button></p>`;
  renderStandingsInto($('.race-standings', box), race);
  $('#race-result-refresh').onclick = async () => { try { renderRaceResult(box, save, await compete.raceStandings(race.code)); } catch (err) { ui.toast(err.message); } };
  $('#race-result-share').onclick = () => showShare(race.code);
}

// ------------------------------------------------------------ scoreboard
// The rules window opens from the scoreboard, the race window and Help.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-rules]')) return;
  const d = $('#dlg-rules');
  ui.openDialog(d, $('#rules-h'));
});

export function openBoard() {
  ui.openDialog($('#dlg-board'), $('#dlg-board input[name=board-period]:checked'));
  loadBoard();
}

function wireBoard() {
  $('#dlg-rules').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) $('#dlg-rules').close(); });
  const d = $('#dlg-board');
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
  $$('input[name=board-period]', d).forEach((r) => { r.onchange = loadBoard; });
  $('#board-name').onclick = () => { d.close(); needName(() => {}); };
}

async function loadBoard() {
  const period = $('#dlg-board input[name=board-period]:checked').value;
  const body = $('#board-body');
  body.innerHTML = '<p class="muted">Loading the scoreboard…</p>';
  $('#board-me').textContent = '';
  const user = account.current();
  $('#board-name').hidden = !!(user && name);
  $('#board-name').textContent = user ? 'Choose a screen name' : 'Sign in to take part';
  try {
    const b = await compete.scoreboard(period);
    if (b.me && b.me.rank) $('#board-me').innerHTML = `You (${esc(b.me.name)}) are <b>number ${b.me.rank}</b> with ${b.me.points} points from ${b.me.solved} solved puzzle${b.me.solved === 1 ? '' : 's'}.`;
    else if (b.me) $('#board-me').textContent = `You (${b.me.name}) have no points ${period === 'week' ? 'this week' : 'yet'}. Solve a puzzle to get on the board.`;
    if (!b.rows.length) { body.innerHTML = `<p class="muted">No one is on the scoreboard ${period === 'week' ? 'this week' : ''} yet. Solve a puzzle to be the first!</p>`; return; }
    body.innerHTML = `<div class="table-wrap"><table class="board"><caption class="sr-only">Scoreboard, ${period === 'week' ? 'this week' : 'all time'}</caption>
      <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Solved</th><th scope="col">Race wins</th></tr></thead>
      <tbody>${b.rows.map((r) => `<tr${r.me ? ' class="me"' : ''}><td><b>${r.rank}</b></td><th scope="row">${esc(r.name)}${r.me ? ' <span class="pill">You</span>' : ''}</th><td>${r.points}</td><td>${r.solved}</td><td>${r.wins}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (err) { body.innerHTML = `<p class="error-box">${esc(err.message)}</p>`; }
}

// ------------------------------------------------------------ links
// thelogicgrid.com/?race=CODE opens the join window with the code filled in.
export function handleRaceLink() {
  if (!compete.enabled()) return;
  const url = new URL(location.href);
  const code = compete.cleanCode(url.searchParams.get('race'));
  if (!code) return;
  url.searchParams.delete('race');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (!compete.CODE.test(code)) return;
  if (!account.current()) {
    pendingCode = code;
    ui.toast(`Sign in to join race ${code}. You can always play on your own without an account.`, null, { ms: 10000 });
  }
  needName(() => openJoin(code));
}
