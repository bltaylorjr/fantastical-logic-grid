// Races against other players in NINETIMESNINE, Cage Math, Sum Cross, Picture
// Grid, More or Less, Skyline, Star Field, Loop Line and Island Bridges: the same races as The Fantastical Logic Grid's (compete.js,
// server/src/compete.js), with the same rules. Everyone in a race gets the same
// puzzle, the fastest solve wins, each hint adds 1 minute and each check 15
// seconds, and revealing the answer counts as giving up.
//
// attach(gameId, mod, root) adds a "Race other players" card to the game's
// setup screen (Start a race, Find a race, Join with a code), a race bar above
// the board while a race puzzle is open (code, Share, Standings), and opens a
// race link (<game>/?race=CODE). It works on the game's own page and on its
// screen inside the app. Racing needs a free account and a screen name;
// playing alone never does. Shown only when accounts are switched on.
//
// The module (modules/number-place/ui.js, modules/grid-kit/kit.js) provides
// racePuzzle() (a puzzle with the setup screen's choices), startShared(p) and
// state() (the game in progress). A finished race puzzle (solved, or revealed
// and not undone within 10 seconds) is sent with every cell's value; the server
// checks the answers. The line games (Loop Line, Island Bridges) keep a value
// for each edge instead of each cell, and send those the same way.
// A race puzzle is always the game's standard kind, with the setup screen's
// level and size (the kit's racePuzzle), and the kit offers no level change
// when a race puzzle is finished (races stay at the level they were started at).
import * as account from './account.js';
import * as compete from './compete.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const NAMES = { np: 'NINETIMESNINE', cm: 'Cage Math', sc: 'Sum Cross', pg: 'Picture Grid', ml: 'More or Less', sk: 'Skyline', sf: 'Star Field', ll: 'Loop Line', ib: 'Island Bridges' };
const TIERS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };
const STATUS = { solved: 'Solved', solving: 'Still solving', gave_up: 'Revealed the answer', invited: 'Challenged, not joined yet', declined: 'Said no thanks' };
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const fmt = (ms) => { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), p = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`; };

const attached = new Set();

export function attach(game, mod, root) {
  if (!compete.enabled() || attached.has(game) || !NAMES[game]) return;
  const setup = root.querySelector(`#${game}-setup-view`);
  const play = root.querySelector(`#${game}-play-view`);
  if (!setup || !play) return;
  attached.add(game);
  const R = new Race(game, mod, setup, play);
  R.init();
}

class Race {
  constructor(game, mod, setup, play) {
    Object.assign(this, { game, mod, setup, play, name: compete.cachedName(), sending: false });
    this.KEY = `flg.races.${game}`; // { [puzzle fingerprint]: { code, sent } }
  }

  // ---------------------------------------------------------------- markup
  init() {
    const g = this.game, side = this.setup.querySelector('section.card');
    this.card = Object.assign(document.createElement('section'), { className: 'card race-card', id: `${g}-race-card` });
    this.card.setAttribute('aria-labelledby', `${g}-race-h`);
    this.card.innerHTML = `<h3 id="${g}-race-h">Race other players</h3>
      <p class="help" data-r="intro"></p>
      <div class="compete-actions" data-r="actions"></div>
      <p class="gen-status" data-r="status" role="status" aria-live="polite"></p>
      <div class="error-box" data-r="error" role="alert" hidden></div>`;
    if (side) side.before(this.card); else this.setup.append(this.card);

    this.bar = Object.assign(document.createElement('div'), { className: 'race-bar', hidden: true });
    this.bar.innerHTML = `<p data-r="bar"></p><button class="btn small" type="button" data-r="share">Share the race</button><button class="btn small" type="button" data-r="standings">Standings</button>`;
    this.play.prepend(this.bar);

    this.dlg = document.createElement('dialog');
    this.dlg.setAttribute('aria-labelledby', `${g}-race-dlg-h`);
    this.dlg.innerHTML = `<h2 id="${g}-race-dlg-h"></h2>
      <form class="race-view" data-view="start" novalidate>
        <p class="help">You and everyone who joins get the same puzzle. The fastest solve wins; each hint adds 1 minute and each check 15 seconds to your race time, and revealing the answer counts as giving up. Others can join for 7 days.</p>
        <p data-r="choice"></p>
        <label class="check"><input type="checkbox" data-r="public" checked> Let anyone join with Find a race, not only people I give the code to</label>
        <div class="error-box" role="alert" hidden></div>
        <div class="dlg-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Start the race</button></div>
      </form>
      <form class="race-view" data-view="join" novalidate hidden>
        <p class="help">Enter the 6-character race code a friend gave you.</p>
        <div class="field"><label for="${g}-race-code">Race code</label><input type="text" id="${g}-race-code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" class="code-input"></div>
        <div class="error-box" role="alert" hidden></div>
        <div class="dlg-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Join the race</button></div>
      </form>
      <form class="race-view" data-view="name" novalidate hidden>
        <p class="help">Other players see only this name, in races and on the scoreboard. Never your email.</p>
        <div class="field"><label for="${g}-race-name">Screen name</label><input type="text" id="${g}-race-name" maxlength="20" autocomplete="off" spellcheck="false"></div>
        <p><button class="btn small" type="button" data-r="suggest">Suggest a name</button></p>
        <div class="error-box" role="alert" hidden></div>
        <div class="dlg-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </form>
      <div class="race-view" data-view="share" hidden>
        <p class="help">Give this code or link to the people you want to race. Your clock is already running, so start whenever you are ready.</p>
        <p class="race-code-big" data-r="code"></p>
        <p class="race-link"><a data-r="link" href="#" target="_blank" rel="noopener"></a></p>
        <p class="acct-done" data-r="copied" role="status"></p>
        <form class="invite-row" data-r="invite" novalidate>
          <div class="field"><label for="${g}-race-invite">Challenge a player by screen name</label><input type="text" id="${g}-race-invite" maxlength="20" autocomplete="off" spellcheck="false"></div>
          <button class="btn" type="submit">Send challenge</button>
        </form>
        <p class="acct-done" data-r="invited" role="status"></p>
        <div class="dlg-actions"><button class="btn" type="button" data-r="copy">Copy the link</button><button class="btn primary" type="button" data-close>Start solving</button></div>
      </div>
      <div class="race-view" data-view="standings" hidden>
        <p class="help" data-r="head"></p>
        <div data-r="body"></div>
        <div class="dlg-actions"><button class="btn" type="button" data-r="refresh">Refresh</button><button class="btn primary" type="button" data-close>Close</button></div>
      </div>`;
    document.body.append(this.dlg);
    this.wire();
    this.render();
    account.onChange?.(() => { this.name = compete.cachedName(); this.render(); if (account.current()) this.loadName(); });
    if (account.current()) this.loadName();
    setInterval(() => this.watch(), 1000);
    this.openLink();
  }

  $(sel, el = this.dlg) { return el.querySelector(`[data-r="${sel}"]`); }
  view(name) { return this.dlg.querySelector(`.race-view[data-view="${name}"]`); }

  show(name, title) {
    for (const v of this.dlg.querySelectorAll('.race-view')) v.hidden = v.dataset.view !== name;
    for (const b of this.dlg.querySelectorAll('.error-box')) b.hidden = true;
    this.dlg.querySelector('h2').textContent = title;
    if (!this.dlg.open) this.dlg.showModal();
    const v = this.view(name);
    (v.querySelector('input:not([type=checkbox])') || v.querySelector('button[type=submit], .dlg-actions .primary'))?.focus();
  }
  fail(name, text) { const b = this.view(name).querySelector('.error-box'); b.textContent = text; b.hidden = false; }
  cardError(text) { const b = this.$('error', this.card); b.textContent = text || ''; b.hidden = !text; }
  status(text) { this.$('status', this.card).textContent = text || ''; }

  render() {
    const btn = (id, text, primary) => `<button class="btn${primary ? ' primary' : ''}" type="button" data-race="${id}">${text}</button>`;
    const user = account.current();
    const intro = this.$('intro', this.card), actions = this.$('actions', this.card);
    if (!user) {
      intro.textContent = `Race other players on the very same ${NAMES[this.game]} puzzle: the fastest solve wins. Sign in with a free account to take part. Guests can play a few new puzzles a day without an account.`;
      actions.innerHTML = btn('signin', 'Sign in to race', true);
    } else if (!this.name) {
      intro.textContent = 'Choose a screen name to race. Other players see only that name.';
      actions.innerHTML = btn('name', 'Choose a screen name', true);
    } else {
      intro.innerHTML = `Racing as <b>${esc(this.name)}</b>. Everyone gets the same puzzle, with your setup choices above; the fastest solve wins.`;
      actions.innerHTML = btn('start', 'Start a race', true) + btn('find', 'Find a race') + btn('join', 'Join with a code');
    }
  }

  async loadName() {
    try { this.name = await compete.loadName(); } catch (e) { /* offline: keep the cached name */ }
    this.render();
  }

  // Racing needs a sign-in and a screen name; ask for whichever is missing.
  need(then) {
    if (!account.current()) { this.signIn(); return; }
    if (!this.name) { this.after = then; this.openName(); return; }
    then();
  }
  signIn() {
    // Inside the app, its own account window; on a game's page, the Account page.
    const item = document.querySelector('#app-menu [data-cmd="account"]');
    if (item && !item.hidden) { item.click(); return; }
    location.href = new URL(`../account/?game=${this.game}${this.pending ? `&race=${this.pending}` : ''}`, location.href).href;
  }
  openName() { document.getElementById(`${this.game}-race-name`).value = this.name || ''; this.show('name', 'Choose a screen name'); }

  // ---------------------------------------------------------------- actions
  wire() {
    this.dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) this.dlg.close(); });
    this.card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-race]');
      if (!b) return;
      this.cardError('');
      const act = b.dataset.race;
      if (act === 'signin') this.signIn();
      else if (act === 'name') this.openName();
      else if (act === 'start') this.need(() => this.openStart());
      else if (act === 'find') this.need(() => this.find(b));
      else if (act === 'join') this.need(() => { document.getElementById(`${this.game}-race-code`).value = ''; this.show('join', 'Join a race'); });
    });
    this.view('start').onsubmit = (e) => { e.preventDefault(); this.busy(e.submitter, 'Building the puzzle…', () => this.start()); };
    this.view('join').onsubmit = (e) => {
      e.preventDefault();
      const code = compete.cleanCode(document.getElementById(`${this.game}-race-code`).value);
      if (!compete.CODE.test(code)) { this.fail('join', 'Race codes have 6 letters and numbers.'); return; }
      this.busy(e.submitter, 'Joining…', () => this.join(code, 'join'));
    };
    this.view('name').onsubmit = (e) => {
      e.preventDefault();
      const raw = document.getElementById(`${this.game}-race-name`).value;
      const problem = compete.nameProblem(raw);
      if (problem) { this.fail('name', problem); return; }
      this.busy(e.submitter, 'Saving…', async () => {
        try {
          this.name = await compete.setName(raw.trim());
          this.render();
          this.dlg.close();
          const then = this.after; this.after = null;
          if (then) then();
        } catch (err) { this.fail('name', err.message); }
      });
    };
    this.$('suggest').onclick = () => { document.getElementById(`${this.game}-race-name`).value = compete.suggestName(); };
    this.$('copy').onclick = async () => {
      try { await navigator.clipboard.writeText(this.$('link').href); this.$('copied').textContent = 'Link copied.'; } catch (e) { this.$('copied').textContent = 'Copy the link above by hand.'; }
    };
    this.$('invite').onsubmit = async (e) => {
      e.preventDefault();
      const who = document.getElementById(`${this.game}-race-invite`).value.trim();
      if (!who) return;
      try {
        const r = await compete.invitePlayer(this.shareCode, who);
        this.$('invited').textContent = r.already ? `${r.invited} was already challenged.` : `Challenge sent to ${r.invited}. They see it the next time they open the game.`;
        document.getElementById(`${this.game}-race-invite`).value = '';
      } catch (err) { this.$('invited').textContent = err.message; }
    };
    this.$('refresh').onclick = () => this.standings(this.$('refresh').dataset.code);
    this.$('share', this.bar).onclick = () => { const c = this.current()?.code; if (c) this.share(c); };
    this.$('standings', this.bar).onclick = () => { const c = this.current()?.code; if (c) this.standings(c); };
  }

  async busy(btn, label, fn) {
    const old = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = label; }
    try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
  }

  openStart() {
    const lvl = this.setup.querySelector('input[name$="level"]:checked, [id$="-levels"] input:checked');
    const size = this.setup.querySelector('input[name$="size"]:checked, [id$="-sizes"] input:checked');
    const words = [lvl && (TIERS[lvl.value] || lvl.value), size && `${size.value}×${size.value}`].filter(Boolean).join(' · ');
    this.$('choice').innerHTML = `The race uses your setup choices${words ? `: <b>${esc(words)}</b>` : ''}. Change them on the setup screen first if you like.`;
    this.show('start', 'Start a race');
  }

  remember(fp, code) { const all = store.get(this.KEY, {}); all[fp] = { ...(all[fp] || {}), code }; store.set(this.KEY, all); }

  async start() {
    try {
      const puzzle = await this.mod.racePuzzle();
      const race = await compete.createRace(puzzle, this.$('public').checked, this.game);
      this.remember(puzzle.fingerprint, race.code);
      this.mod.startShared(puzzle, { mode: 'race' });
      this.share(race.code);
    } catch (err) { this.fail('start', err.message || String(err)); }
  }

  async join(code, from) {
    try {
      const r = await compete.joinRace(code);
      if (r.game && r.game !== this.game) {
        // A race in another game: open it on that game's page.
        location.href = new URL(`../${compete.GAME_PAGES[r.game]}?race=${code}`, location.href).href;
        return;
      }
      this.remember(r.puzzle.fingerprint, code);
      const g = this.mod.state?.();
      if (!(g && g.mode === 'race' && g.p?.fingerprint === r.puzzle.fingerprint)) this.mod.startShared(r.puzzle, { mode: 'race' });
      if (this.dlg.open) this.dlg.close();
      this.status(`Joined race ${code}. Good luck!`);
    } catch (err) {
      if (from === 'join') this.fail('join', err.message); else this.cardError(err.message);
    }
  }

  async find(btn) {
    const skip = [];
    await this.busy(btn, 'Looking…', async () => {
      try {
        const lvl = this.setup.querySelector('[id$="-levels"] input:checked, input[name$="level"]:checked')?.value;
        let found;
        try { found = await compete.findRace(lvl, skip, this.game); } catch (err) {
          if (err.code !== 'no_open_races') throw err;
          found = await compete.findRace(null, skip, this.game);
        }
        await this.join(found.code, 'find');
      } catch (err) { this.cardError(err.message); }
    });
  }

  share(code) {
    this.shareCode = code;
    this.$('code').textContent = code;
    const link = compete.shareLink(code, this.game);
    Object.assign(this.$('link'), { href: link, textContent: link });
    this.$('copied').textContent = this.$('invited').textContent = '';
    this.show('share', 'Race started');
  }

  async standings(code, result = null) {
    this.$('refresh').dataset.code = code;
    this.$('body').innerHTML = '<p class="muted">Loading…</p>';
    if (!this.dlg.open || this.view('standings').hidden) this.show('standings', 'Race standings');
    try {
      const race = result || await compete.raceStandings(code);
      const rows = race.players.map((p) => `<tr${p.me ? ' class="me"' : ''}><td>${p.place ? `<b>${p.place}</b>` : '–'}</td>
        <th scope="row"><bdi translate="no">${esc(p.name)}</bdi>${p.me ? ' <span class="pill">You</span>' : ''}${p.host ? ' <span class="pill">Host</span>' : ''}</th>
        <td>${STATUS[p.status] || ''}</td><td>${p.raceMs != null ? fmt(p.raceMs) : ''}</td>
        <td>${p.elapsedMs != null ? `${fmt(p.elapsedMs)}, ${p.hints} hint${p.hints === 1 ? '' : 's'}, ${p.checks} check${p.checks === 1 ? '' : 's'}` : ''}</td></tr>`).join('');
      this.$('body').innerHTML = `<div class="table-wrap"><table class="board"><caption class="sr-only">Race standings</caption>
        <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Status</th><th scope="col">Race time</th><th scope="col">Solve time and help</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      this.$('head').textContent = `“${race.title}”, race code ${race.code}. ${race.open ? 'Others can still join.' : 'Closed to new players.'}`;
    } catch (err) { this.$('body').innerHTML = `<p class="error-box">${esc(err.message)}</p>`; }
  }

  // ---------------------------------------------------------------- during play
  current() {
    const g = this.mod.state?.();
    if (!g || g.mode !== 'race' || !g.p?.fingerprint) return null;
    const r = store.get(this.KEY, {})[g.p.fingerprint];
    return r ? { g, ...r } : null;
  }

  watch() {
    const cur = this.current();
    this.bar.hidden = !cur || this.play.hidden;
    if (!cur) return;
    const { g, code, sent } = cur;
    this.$('bar', this.bar).innerHTML = sent
      ? `<b>Race ${esc(code)}</b>: finished. Press Standings to see where you placed.`
      : `<b>Race ${esc(code)}</b>. Everyone in this race has the same puzzle. Each hint adds 1 minute and each check 15 seconds.`;
    if (sent || this.sending || !(g.solved || g.revealed)) { this.revealSeen = null; return; }
    // A reveal waits 10 seconds, so an undone reveal is not sent as giving up.
    if (g.revealed && !g.solved) return;
    if (g.revealed) { this.revealSeen ||= Date.now(); if (Date.now() - this.revealSeen < 11_000) return; }
    this.finish(g, code);
  }

  async finish(g, code) {
    this.sending = true;
    try {
      const answers = g.p.solution.map((_, i) => Number(g.p.givens[i]) || Number(g.v[i]) || 0);
      const res = await compete.finishGameRace(code, { elapsedMs: g.ms, hints: g.hints, checks: g.checks, revealed: g.revealed, answers });
      const all = store.get(this.KEY, {});
      all[g.p.fingerprint] = { code, sent: true, points: res.points };
      store.set(this.KEY, all);
      const me = res.race.players.find((p) => p.me);
      this.status(g.revealed ? `Race ${code}: you revealed the answer.` : `Race ${code}: you finished${me?.place ? ` in place ${me.place}` : ''}${res.points ? `, +${res.points} points on the scoreboard` : ''}.`);
      this.standings(code, res.race);
    } catch (err) {
      // Offline or a server problem: try again on the next tick a little later.
      this.status(err.code === 'OFFLINE' ? 'You are offline. Your race result will be sent when you are back online.' : err.message);
      if (err.code !== 'OFFLINE' && err.status && err.status < 500) {
        const all = store.get(this.KEY, {});
        all[g.p.fingerprint] = { code, sent: true };
        store.set(this.KEY, all);
      }
      await new Promise((r) => setTimeout(r, 30_000));
    } finally {
      this.sending = false;
    }
  }

  // A race link: <game>/?race=CODE.
  openLink() {
    const code = compete.cleanCode(new URLSearchParams(location.search).get('race'));
    if (!compete.CODE.test(code)) return;
    try { const u = new URL(location.href); u.searchParams.delete('race'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* framed */ }
    if (account.current()) { this.need(() => this.join(code, 'link')); return; }
    // Signed out: the Sign in button brings the player back to this race.
    this.pending = code;
    this.status(`Sign in to join race ${code}. You come straight back here afterwards.`);
    this.card.scrollIntoView({ block: 'center' });
  }
}
