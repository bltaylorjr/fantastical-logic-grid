// The game screen shared by The Logic Grid's newer games (Cage Math, Sum
// Cross, Picture Grid). Each game passes its own definition (modules/<game>/game.js):
// its levels, how its board looks and how a cell is marked. The kit brings
// everything else, the same way NINETIMESNINE does: a setup view with daily
// puzzle, suggested level and saved puzzles; play with timer, pause, undo and
// redo, notes, hints that teach (a nudge, then where, then why), checking,
// mistakes, answer, solution replay, printing, files, sharing, stats and
// badges; and learning from play so every puzzle is tuned to the player and
// never repeats in free play (daily puzzles are shared on purpose).
//
//   const game = createGame(def);
//   game.mount(container, { engine, storagePrefix, onPlay, shared, celebrate, setWorld, config, canPrint, canDownload });
//   game.suspend(); game.reopen(); game.setShared(s); game.unmount();
//
// engine: { generate(options), hint(puzzle, entries) } returning promises.
// config(): the admin's choices for this game (all optional): daily, coachTips,
// stories (bools), maxLevel, adaptStrength, practiceChance, sharedWeight.
import { markup } from './markup.js';
import { createLearning, summary, ORDER } from './learning.js';
import { sounds } from './sound.js';
import { printableHtml, printHtml } from './print.js';
import { resultPicture } from './picture.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };
const todayUtc = () => new Date().toISOString().slice(0, 10);
export const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const bit = (d) => 1 << (d - 1);

export function createGame(def) {
  const P = def.id;
  const DIGITS = def.kind === 'digits';
  let root = null, deps = {}, engine = null, learn = null, K = {}, prefs = {};
  let G = null, lastRecord = null, deleted = null, timer = null, lastTick = 0, stroke = null;
  const $ = (id) => root.querySelector(`#${P}-${id}`);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const cfg = () => (deps.config ? deps.config() || {} : {});
  const quiet = () => !!prefs.silent;
  const showStory = () => !quiet() && cfg().stories !== false;
  const play = (name) => { if (prefs.sound && !quiet()) { try { sounds[name](); } catch (e) { /* no audio */ } } };
  const levelName = (id) => def.levels.find((l) => l.id === id)?.name || id;
  const levels = () => {
    const max = ORDER.indexOf(cfg().maxLevel);
    return def.levels.filter((l) => max < 0 || ORDER.indexOf(l.id) <= max);
  };
  const games = () => load(K.games, {});
  const putGame = (g) => { const all = games(); all[g.id] = g; keep(K.games, trimGames(all)); };
  const trimGames = (all) => Object.fromEntries(Object.entries(all).sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0)).slice(0, 40));
  const savePrefs = () => keep(K.prefs, prefs);
  const playing = () => !!G && !$('play-view').hidden;
  const N = () => G.p.size * G.p.cols;
  const isGiven = (i) => !!G.p.givens[i];
  const valueAt = (i) => G.p.givens[i] || G.v[i];
  const playable = (i) => def.playable(G.p, i);
  const wrongAt = (i) => {
    const v = G.v[i];
    if (!v || isGiven(i)) return false;
    return DIGITS ? v !== G.p.solution[i] : (v === 1) !== (G.p.solution[i] === 1);
  };
  const isSolved = () => (DIGITS
    ? G.p.solution.every((d, i) => !playable(i) || valueAt(i) === d)
    : G.p.solution.every((d, i) => (d === 1) === (valueAt(i) === 1)));

  function dailyOptions(date = todayUtc()) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const lv = levels();
    let d = def.daily[day];
    if (!lv.some((l) => l.id === d)) d = lv[lv.length - 1].id;
    const level = def.levels.find((l) => l.id === d);
    return { difficulty: d, size: level.dailySize || level.sizes[0], seed: `daily-${P}-${date}` };
  }

  // ---------- mount ----------

  function mount(container, host) {
    if (root) unmount();
    root = container;
    deps = host || {};
    engine = deps.engine;
    const pre = deps.storagePrefix || `flg.${P}`;
    K = { games: `${pre}.games`, cur: `${pre}.cur`, prefs: `${pre}.prefs`, learn: `${pre}.learn` };
    prefs = { notes: false, showMistakes: false, autoClean: true, autoCross: true, highlight: true, silent: false, sound: true, adapt: true, level: null, size: null, coachDone: false, pen: 1, ...load(K.prefs, {}) };
    learn = createLearning({ load, keep, key: K.learn, par: def.par, simple: def.simpleTechniques || [], config: cfg });
    if (deps.shared) learn.setShared(deps.shared);
    root.classList.add('gk-app', `gk-app-${P}`);
    root.innerHTML = markup(def);
    buildSetup();
    wire();
    showView('setup');
  }

  function unmount() {
    close();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onLeave);
    window.removeEventListener('pointerup', endStroke);
    if (root) root.innerHTML = '';
    root = null; G = null;
  }

  function showView(name) {
    $('setup-view').hidden = name !== 'setup';
    $('play-view').hidden = name !== 'play';
    root.classList.toggle('gk-silent', quiet());
    if (name === 'setup') { close(); G = null; renderSetup(); }
  }

  // ---------- setup ----------

  function buildSetup() {
    const lv = levels();
    if (!prefs.level || !lv.some((l) => l.id === prefs.level)) prefs.level = learn.suggestLevel();
    if (!lv.some((l) => l.id === prefs.level)) prefs.level = lv[0].id;
    $('levels').innerHTML = lv.map((l) => `<label class="choice"><input type="radio" name="${P}-level" value="${l.id}"${l.id === prefs.level ? ' checked' : ''}><span><b>${esc(l.name)}</b><small>${esc(l.note)}</small></span></label>`).join('');
    renderSizes();
    for (const [id, key] of [['silent', 'silent'], ['sound', 'sound'], ['adapt', 'adapt'], ['highlight', 'highlight'], [DIGITS ? 'autoclean' : 'autocross', DIGITS ? 'autoClean' : 'autoCross']]) {
      const el = $(id);
      el.checked = !!prefs[key];
      el.onchange = () => { prefs[key] = el.checked; savePrefs(); root.classList.toggle('gk-silent', quiet()); renderSetup(); };
    }
  }

  function renderSizes() {
    const level = def.levels.find((l) => l.id === ($(`levels`).querySelector('input:checked')?.value || prefs.level));
    const sizes = level.sizes;
    if (!sizes.includes(prefs.size)) prefs.size = sizes[0];
    $('size-field').hidden = sizes.length < 2;
    $('sizes').innerHTML = sizes.map((n) => `<label class="choice"><input type="radio" name="${P}-size" value="${n}"${n === prefs.size ? ' checked' : ''}><span><b>${esc(def.sizeLabel(n))}</b></span></label>`).join('');
  }

  function renderSetup() {
    const all = Object.values(games()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const curId = load(K.cur, null);
    const cur = all.find((g) => g.id === curId && !g.solved) || all.find((g) => !g.solved);
    $('continue').hidden = !cur;
    if (cur) { $('continue').dataset.id = cur.id; $('continue-name').textContent = `${cur.name}, ${fmtTime(cur.ms)}`; }

    const d = dailyOptions();
    const sum = summary(learn.plays(), { name: def.name, extra: def.badges || [] });
    const doneToday = learn.plays().some((r) => r.daily === todayUtc() && r.outcome === 'solved');
    $('daily-btn').hidden = $('daily-note').hidden = cfg().daily === false;
    $('daily-note').textContent = `${doneToday ? 'You solved today\'s puzzle. ' : ''}Today's puzzle is ${levelName(d.difficulty)}.${sum.streak ? ` Streak: ${sum.streak} day${sum.streak === 1 ? '' : 's'}.` : ''}`;

    const suggested = learn.suggestLevel();
    const chosen = $('levels').querySelector('input:checked')?.value;
    const sBtn = $('suggest');
    sBtn.hidden = !prefs.adapt || !learn.plays().length || suggested === chosen || !levels().some((l) => l.id === suggested);
    sBtn.textContent = `Suggested for you: ${levelName(suggested)}`;
    sBtn.dataset.level = suggested;
    const t = learn.toughness(chosen);
    const weak = learn.weakTechnique();
    $('tuning-note').textContent = prefs.adapt && learn.plays().some((r) => r.d === chosen)
      ? `Tuned to you: ${t > 0.62 ? 'a little tougher' : t < 0.38 ? 'a little gentler' : 'right in the middle'} inside ${levelName(chosen)}.${weak ? ' Some puzzles will practice a step you have asked for help with.' : ''}`
      : '';

    $('saved-empty').hidden = all.length > 0;
    $('saved').innerHTML = all.slice(0, 30).map((g) => {
      const status = g.revealed ? 'Answer shown' : g.solved ? `Solved in ${fmtTime(g.ms)}` : `${fmtTime(g.ms)} so far`;
      return `<li data-id="${esc(g.id)}"><button class="gk-saved-open" type="button"><b>${esc(g.name)}</b><small>${esc(levelName(g.p.difficulty.id))} · ${esc(def.sizeLabel(g.p.size))}${g.mode === 'daily' ? ` · Daily ${esc(g.daily)}` : ''} · ${status}</small></button>
        <span class="gk-saved-tools"><button class="btn quiet small" type="button" data-act="rename" aria-label="Rename ${esc(g.name)}">Rename</button><button class="btn quiet small" type="button" data-act="delete" aria-label="Delete ${esc(g.name)}">Delete</button></span></li>`;
    }).join('');

    if (def.gallery) {
      const pics = learn.gallery().slice().reverse();
      $('gallery-empty').hidden = pics.length > 0;
      $('gallery').innerHTML = pics.slice(0, 60).map((g) => `<li><figure><span class="gk-pic" style="--c:${Number(g.cols)}" aria-hidden="true">${[...g.cells].map((ch) => `<i${ch === '1' ? ' class="on"' : ''}></i>`).join('')}</span><figcaption>${esc(g.name.replace(/^an? /, ''))}</figcaption></figure></li>`).join('');
    }

    const rows = sum.byLevel.filter((l) => l.solved);
    $('stats').innerHTML = rows.length
      ? `<div class="gk-table-wrap"><table><thead><tr><th scope="col">Level</th><th scope="col">Solved</th><th scope="col">Best, no hints</th><th scope="col">Average</th></tr></thead><tbody>${rows.map((l) => `<tr><th scope="row">${esc(levelName(l.id))}</th><td>${l.solved}</td><td>${l.best ? fmtTime(l.best) : '–'}</td><td>${fmtTime(l.average)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="gk-muted">Solve a puzzle to see your times here.</p>';
    const got = sum.badges.filter((b) => b.earned), todo = sum.badges.filter((b) => !b.earned);
    const badge = (b) => `<li class="gk-badge${b.earned ? ' earned' : ''}"><b>${esc(b.name)}</b><small>${esc(b.note)}</small></li>`;
    $('badges').innerHTML = `<li class="gk-badge-count">${got.length} of ${sum.badges.length} badges</li>${got.map(badge).join('')}${todo.length ? `<li class="gk-badge-more"><details><summary>${got.length ? 'Badges still to earn' : 'Badges to earn'}</summary><ul class="gk-badges">${todo.map(badge).join('')}</ul></details></li>` : ''}`;
  }

  // ---------- start, resume, save ----------

  async function startNew(opts, { mode = 'free' } = {}) {
    const status = $('status');
    status.textContent = 'Building a puzzle just for you, with exactly one answer…';
    $('gen').disabled = true;
    try {
      const tuned = mode === 'free' ? learn.optionsFor(opts.difficulty) : {};
      if (mode === 'free' && !prefs.adapt) { tuned.toughness = 0.5; tuned.practice = null; }
      const p = await engine.generate({ seed: Math.random().toString(36).slice(2), story: cfg().stories !== false, ...tuned, ...opts });
      status.textContent = '';
      begin(p, { mode, daily: opts.daily || null, practice: tuned.practice || null, tuned: tuned.toughness ?? null });
    } catch (e) {
      status.textContent = `Could not build that puzzle: ${e.message}`;
    } finally {
      $('gen').disabled = false;
    }
  }

  function begin(p, { mode = 'free', daily = null, practice = null, tuned = null } = {}) {
    close();
    const cells = p.size * p.cols;
    G = {
      id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, p, mode, daily, practice, tuned,
      name: uniqueName(def.titleOf(p)),
      v: Array(cells).fill(0), n: Array(cells).fill(0), undo: [], redo: [],
      ms: 0, hints: 0, mistakes: 0, checks: 0, stuck: [], solved: false, revealed: false,
      created: Date.now(), updated: Date.now(), sel: -1,
    };
    G.sel = [...Array(cells).keys()].find((i) => def.playable(p, i) && !p.givens[i]) ?? 0;
    learn.started(p);
    open();
  }

  function uniqueName(base) {
    const names = new Set(Object.values(games()).map((g) => g.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  async function startDaily() {
    if (cfg().daily === false) return;
    const date = todayUtc();
    const existing = Object.values(games()).find((g) => g.mode === 'daily' && g.daily === date);
    if (existing) { resume(existing.id); return; }
    await startNew({ ...dailyOptions(date), daily: date, usedStories: [], usedPictures: [], avoid: [] }, { mode: 'daily' });
  }

  function resume(id) {
    const saved = games()[id];
    const g = saved && cleanGame(saved);
    if (!g) return;
    G = { ...g, id: saved.id };
    open();
  }

  function save() {
    if (!G) return;
    G.updated = Date.now();
    const { hint, checked, paused, ...rest } = G;
    putGame({ ...rest, undo: G.undo.slice(-400), redo: G.redo.slice(-400) });
    keep(K.cur, G.id);
  }

  // ---------- play ----------

  function startTimer() {
    stopTimer();
    if (G.solved) return;
    lastTick = performance.now();
    timer = setInterval(tick, 500);
  }
  function tick() {
    const now = performance.now();
    if (!G || !root) return;
    if (G.paused || document.hidden || G.solved) { lastTick = now; return; }
    G.ms += now - lastTick; lastTick = now;
    $('time').textContent = fmtTime(G.ms);
  }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; }

  function open() {
    showView('play');
    G.paused = false;
    G.hint = null;
    const p = G.p;
    $('kicker').textContent = `${def.name} · ${p.difficulty.name} · ${def.sizeLabel(p.size)}${G.daily ? ` · Daily ${G.daily}` : ''}${G.practice ? ' · Practice' : ''}`;
    const story = showStory() && p.story;
    $('title').textContent = story ? p.story.title : `${p.difficulty.name} puzzle`;
    $('story').textContent = story ? p.story.intro : '';
    $('story').hidden = !story;
    $('rules').innerHTML = p.rules.map((r) => `<li>${esc(r)}</li>`).join('');
    $('solved').hidden = true;
    $('share-box').hidden = true;
    $('reveal-confirm').hidden = true;
    $('mistakes').checked = !!prefs.showMistakes;
    buildBoard();
    if (DIGITS) buildPad();
    else setPen(prefs.pen || 1);
    render();
    if (G.solved) showSolved({ fresh: false });
    startTimer();
    save();
    coach();
    setTimeout(() => focusCell(G.sel), 0);
  }

  function close() { if (G && root) { tick(); save(); } stopTimer(); }

  function coach(step) {
    const box = $('coach');
    if (prefs.coachDone || quiet() || G.solved || cfg().coachTips === false) { box.hidden = true; return; }
    const i = step ?? 0, list = def.coach;
    box.hidden = false;
    box.dataset.i = i;
    $('coach-n').textContent = `${i + 1} of ${list.length}`;
    $('coach-text').textContent = list[i];
    $('coach-next').hidden = i >= list.length - 1;
  }

  function buildBoard() {
    const el = $('board');
    def.buildBoard(el, G.p);
    for (const c of el.querySelectorAll('[data-i]')) {
      c.setAttribute('role', 'gridcell');
      c.tabIndex = -1;
    }
  }

  function buildPad() {
    const ds = def.digits(G.p);
    const pad = $('digits');
    pad.dataset.cols = ds.length > 6 ? 5 : ds.length;
    pad.style.setProperty('--cols', ds.length);
    pad.innerHTML = ds.map((d) => `<button class="gk-digit" type="button" data-d="${d}" aria-label="${d}">${d}<span class="left"></span></button>`).join('');
  }

  // Which cells clash: the same number twice where the rules forbid it.
  const clashes = () => (DIGITS ? def.clashes(G.p, G.p.solution.map((_, i) => valueAt(i))) : new Set());

  function render() {
    if (!G || !root) return;
    const board = $('board');
    const p = G.p;
    const clash = clashes();
    const sel = G.sel;
    const selVal = sel >= 0 ? valueAt(sel) : 0;
    const peers = prefs.highlight && sel >= 0 ? new Set(def.peers(p, sel)) : new Set();
    const hinted = G.hint && G.hint.level >= 1 ? new Set(G.hint.cells || []) : new Set();
    for (const el of board.querySelectorAll('[data-i]')) {
      const i = Number(el.dataset.i);
      const v = valueAt(i);
      const cls = el.classList;
      cls.toggle('sel', i === sel);
      cls.toggle('peer', peers.has(i) && i !== sel);
      cls.toggle('given', isGiven(i));
      cls.toggle('hinted', hinted.has(i));
      cls.toggle('wrong', !!(prefs.showMistakes || G.checked?.has(i)) && wrongAt(i));
      if (DIGITS) {
        cls.toggle('same', !!prefs.highlight && !!selVal && v === selVal && i !== sel);
        cls.toggle('clash', clash.has(i));
        const span = el.querySelector('.v');
        if (v) {
          if (span.textContent !== String(v)) span.textContent = v;
          el.querySelector('.gk-notes').innerHTML = '';
        } else {
          span.textContent = '';
          const m = G.n[i];
          el.querySelector('.gk-notes').innerHTML = m ? def.digits(p).map((d) => `<i>${m & bit(d) ? d : ''}</i>`).join('') : '';
        }
        el.setAttribute('aria-label', `${def.cellLabel(p, i)}${v ? `, ${v}${isGiven(i) ? ', given' : ''}` : ', empty'}${!v && G.n[i] ? `, notes ${def.digits(p).filter((d) => G.n[i] & bit(d)).join(' ')}` : ''}`);
      } else {
        cls.toggle('on', v === 1);
        cls.toggle('x', v === 2);
        el.setAttribute('aria-label', `${def.cellLabel(p, i)}, ${v === 1 ? 'shaded' : v === 2 ? 'crossed' : 'empty'}${isGiven(i) ? ', given' : ''}`);
      }
    }
    def.paint?.(board, { p, value: valueAt, wrong: wrongAt });
    board.classList.toggle('paused', !!G.paused);
    board.classList.toggle('won', !!G.solved && !quiet());
    $('pause').textContent = G.paused ? 'Resume' : 'Pause';
    $('pause').hidden = G.solved;
    $('undo').disabled = !G.undo.length || G.solved;
    $('redo').disabled = !G.redo.length || G.solved;
    if (DIGITS) {
      const counts = {};
      p.solution.forEach((_, i) => { const v = valueAt(i); if (v) counts[v] = (counts[v] || 0) + 1; });
      for (const b of $('digits').querySelectorAll('[data-d]')) {
        const d = Number(b.dataset.d);
        const left = def.countOf ? def.countOf(p, d) - (counts[d] || 0) : null;
        b.querySelector('.left').textContent = left == null || left < 0 ? '' : left;
        b.classList.toggle('done', left === 0);
      }
      $('notes-btn').setAttribute('aria-pressed', String(!!prefs.notes));
      $('notes-btn').querySelector('.state').textContent = prefs.notes ? 'On' : 'Off';
    }
    const open = p.solution.filter((_, i) => playable(i) && !isGiven(i)).length;
    const done = p.solution.filter((_, i) => playable(i) && !isGiven(i) && (DIGITS ? G.v[i] : G.v[i] === 1 || (p.solution[i] === 2 && G.v[i] === 2))).length;
    $('progress').textContent = `${Math.round((done / Math.max(1, open)) * 100)}%`;
    $('time').textContent = fmtTime(G.ms);
    renderHint();
  }

  // ---------- changing cells ----------

  function apply(changes, { record = true } = {}) {
    if (!changes.length) return;
    for (const ch of changes) { G.v[ch.i] = ch.to; if (DIGITS) G.n[ch.i] = ch.nt; }
    if (record) { G.undo.push(changes); G.redo = []; }
    G.checked = null;
    G.hint = G.hint && G.hint.kind === 'step' ? null : G.hint;
  }

  function afterChange(changed = []) {
    for (const ch of changed) {
      if (ch.to && wrongAt(ch.i)) { G.mistakes++; if (prefs.showMistakes) play('wrong'); }
    }
    if (isSolved()) { solved(); return; }
    render();
    save();
  }

  function place(d) {
    const i = G.sel;
    if (!G || G.solved || G.paused || i < 0 || !playable(i) || isGiven(i)) return;
    if (prefs.notes) { toggleNote(i, d); return; }
    const was = G.v[i];
    const to = was === d ? 0 : d;
    const changes = [{ i, from: was, to, nf: G.n[i], nt: 0 }];
    if (to && prefs.autoClean) {
      for (const x of def.peers(G.p, i)) if (G.n[x] & bit(d)) changes.push({ i: x, from: G.v[x], to: G.v[x], nf: G.n[x], nt: G.n[x] & ~bit(d) });
    }
    apply(changes);
    play(to ? 'place' : 'note');
    if (to && def.units) for (const u of def.units(G.p, i)) if (u.every((x) => valueAt(x) && !wrongAt(x)) && u.includes(i)) { play('unit'); break; }
    announce(to ? `${to} in ${def.cellLabel(G.p, i)}` : `Cleared ${def.cellLabel(G.p, i)}`, true);
    afterChange(changes.slice(0, 1));
  }

  function toggleNote(i, d) {
    if (G.v[i]) return;
    apply([{ i, from: 0, to: 0, nf: G.n[i], nt: G.n[i] ^ bit(d) }]);
    play('note');
    render(); save();
  }

  // Picture Grid: one mark, or a stroke of marks along a row or column.
  function mark(i, value) {
    if (!G || G.solved || G.paused || isGiven(i)) return [];
    if (G.v[i] === value) return [];
    return [{ i, from: G.v[i], to: value, nf: 0, nt: 0 }];
  }
  function autoCross(changes) {
    if (!prefs.autoCross || DIGITS) return changes;
    const extra = [];
    const lines = new Set();
    for (const ch of changes) { lines.add(`r${Math.floor(ch.i / G.p.cols)}`); lines.add(`c${ch.i % G.p.cols}`); }
    for (const key of lines) {
      const cells = def.lineCells(G.p, key);
      const vals = cells.map((x) => valueAt(x) === 1 ? 1 : 0);
      if (def.lineDone(G.p, key, vals)) for (const x of cells) if (!valueAt(x) && !extra.some((e) => e.i === x)) extra.push({ i: x, from: 0, to: 2, nf: 0, nt: 0 });
    }
    return changes.concat(extra);
  }
  function startStroke(i) {
    if (!G || G.solved || G.paused) return;
    const value = G.v[i] === (prefs.pen || 1) ? 0 : (prefs.pen || 1);
    stroke = { start: i, value, cells: [i], changes: mark(i, value) };
    for (const ch of stroke.changes) G.v[ch.i] = ch.to;
    G.sel = i;
    render();
  }
  function moveStroke(i) {
    if (!stroke || stroke.cells.includes(i)) return;
    const C = G.p.cols, s = stroke.start;
    const sameRow = Math.floor(i / C) === Math.floor(s / C), sameCol = i % C === s % C;
    if (!sameRow && !sameCol) return;
    // Fill the straight line from the start to here, so fast drags miss nothing.
    const step = sameRow ? (i > s ? 1 : -1) : (i > s ? C : -C);
    for (let x = s; ; x += step) {
      if (!stroke.cells.includes(x)) {
        stroke.cells.push(x);
        const ch = mark(x, stroke.value);
        for (const c of ch) { G.v[c.i] = c.to; stroke.changes.push(c); }
      }
      if (x === i) break;
    }
    G.sel = i;
    render();
  }
  function endStroke() {
    if (!stroke) return;
    const changes = stroke.changes;
    stroke = null;
    for (const ch of changes) G.v[ch.i] = ch.from;
    const all = autoCross(changes);
    apply(all);
    if (all.length) play(changes[0]?.to === 1 ? 'place' : 'note');
    afterChange(changes);
  }
  function keyMark(value) {
    const i = G.sel;
    if (i < 0) return;
    const to = G.v[i] === value ? 0 : value;
    const ch = mark(i, to);
    if (!ch.length) return;
    const all = autoCross(ch);
    apply(all);
    play(to === 1 ? 'place' : 'note');
    announce(`${def.cellLabel(G.p, i)} ${to === 1 ? 'shaded' : to === 2 ? 'crossed' : 'cleared'}`, true);
    afterChange(ch);
  }
  function setPen(v) {
    prefs.pen = v;
    savePrefs();
    $('pen-fill').setAttribute('aria-pressed', String(v === 1));
    $('pen-cross').setAttribute('aria-pressed', String(v === 2));
  }

  function erase() {
    const i = G.sel;
    if (G.solved || i < 0 || isGiven(i) || (!G.v[i] && !G.n[i])) return;
    const changes = [{ i, from: G.v[i], to: 0, nf: G.n[i], nt: 0 }];
    apply(changes);
    afterChange([]);
  }
  function undo() {
    if (G.solved || !G.undo.length) return;
    const changes = G.undo.pop();
    for (const ch of changes) { G.v[ch.i] = ch.from; if (DIGITS) G.n[ch.i] = ch.nf; }
    G.redo.push(changes);
    render(); save();
  }
  function redo() {
    if (G.solved || !G.redo.length) return;
    const changes = G.redo.pop();
    for (const ch of changes) { G.v[ch.i] = ch.to; if (DIGITS) G.n[ch.i] = ch.nt; }
    G.undo.push(changes);
    if (isSolved()) { solved(); return; }
    render(); save();
  }

  // Notes for every empty cell: the numbers its rules still allow.
  function autoNotes() {
    const changes = [];
    for (let i = 0; i < N(); i++) {
      if (!playable(i) || valueAt(i)) continue;
      const nt = def.allowed(G.p, i, valueAt);
      if (nt !== G.n[i]) changes.push({ i, from: 0, to: 0, nf: G.n[i], nt });
    }
    apply(changes);
    announce('Notes filled in for every empty cell.', true);
    render(); save();
  }

  function check() {
    if (G.solved) return;
    G.checks++;
    const wrong = new Set([...Array(N()).keys()].filter(wrongAt));
    G.checked = wrong;
    render(); save();
    const left = G.p.solution.filter((d, i) => playable(i) && !valueAt(i) && (DIGITS || d === 1)).length;
    announce(wrong.size ? `${wrong.size} ${DIGITS ? 'number' : 'mark'}${wrong.size === 1 ? ' is' : 's are'} wrong. They are marked in red.` : `Everything so far is right. ${left} ${DIGITS ? 'cell' : 'shaded cell'}${left === 1 ? '' : 's'} to go.`, true);
  }

  // ---------- hints: a nudge, then where, then why ----------

  async function hint() {
    if (G.solved) return;
    if (G.hint && G.hint.level < G.hint.levels.length - 1) { G.hint.level++; render(); return; }
    if (G.hint) return;
    const h = await engine.hint(G.p, G.v);
    if (!G) return;
    G.hints++;
    if (h.kind === 'step' && h.technique) G.stuck.push(h.technique);
    G.hint = { ...h, level: 0 };
    if (h.kind === 'mistake') G.checked = new Set(h.cells);
    play('hint');
    save();
    render();
  }

  function renderHint() {
    const box = $('hint');
    const h = G.hint;
    if (!h) { box.hidden = true; return; }
    box.hidden = false;
    const lines = h.levels.slice(0, h.level + 1).map((l) => `<li>${esc(l)}</li>`).join('');
    const more = h.level < h.levels.length - 1;
    box.innerHTML = `<p class="gk-hint-h">${h.kind === 'step' ? `Hint: ${esc(h.techniqueName)}` : 'Hint'}</p><ol>${lines}</ol>
      <div class="gk-hint-actions">${more ? `<button type="button" class="btn small" id="${P}-hint-more">Tell me more</button>` : ''}
      ${h.kind === 'step' && !more ? `<button type="button" class="btn small primary" id="${P}-hint-fill">Fill it in</button>` : ''}
      <button type="button" class="btn quiet small" id="${P}-hint-close">Close</button></div>`;
    $('hint-more')?.addEventListener('click', hint);
    $('hint-fill')?.addEventListener('click', fillHint);
    $('hint-close').addEventListener('click', () => { G.hint = null; render(); focusCell(G.sel); });
  }

  function fillHint() {
    const h = G.hint;
    G.hint = null;
    if (DIGITS) {
      G.sel = h.cell;
      const was = prefs.notes;
      prefs.notes = false;
      if (G.v[h.cell] !== h.digit) place(h.digit);
      prefs.notes = was;
    } else {
      const changes = h.marks.flatMap(([i, v]) => mark(i, v));
      apply(autoCross(changes));
      G.sel = h.marks[0][0];
      afterChange(changes);
    }
    if (G && !G.solved) { render(); focusCell(G.sel); }
  }

  // ---------- solved, revealed ----------

  function record(outcome) {
    const rec = learn.finished(G, outcome);
    lastRecord = rec;
    deps.onPlay?.({ ...rec, game: P });
    return rec;
  }

  function solved() {
    const before = summary(learn.plays(), { name: def.name, extra: def.badges || [] }).badges.filter((b) => b.earned).map((b) => b.id);
    G.solved = true;
    G.hint = null;
    stopTimer();
    tick();
    record('solved');
    const after = summary(learn.plays(), { name: def.name, extra: def.badges || [] }).badges.filter((b) => b.earned);
    const fresh = after.filter((b) => !before.includes(b.id));
    save();
    render();
    play('solved');
    if (!quiet()) deps.celebrate?.();
    showSolved({ fresh: true, newBadges: fresh });
  }

  function showSolved({ fresh, newBadges = [] }) {
    const box = $('solved');
    box.hidden = false;
    $('solved-h').textContent = G.revealed ? 'Here is the answer' : def.solvedTitle ? def.solvedTitle(G.p) : 'Solved!';
    $('ending').textContent = showStory() && G.p.story?.ending ? G.p.story.ending : '';
    $('ending').hidden = !$('ending').textContent;
    $('solved-text').textContent = G.revealed ? 'This one does not count as solved. The next one will.' : `${G.p.difficulty.name} in ${fmtTime(G.ms)}${G.hints ? ` with ${G.hints} hint${G.hints === 1 ? '' : 's'}` : ' with no hints'}${G.mistakes ? `, ${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}` : ''}.`;
    $$(`#${P}-solved [data-feel]`).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $('feel-done').textContent = '';
    root.querySelector(`#${P}-solved .gk-feel`).hidden = G.revealed;
    $('share').hidden = G.revealed;
    $('new-badges').hidden = !newBadges.length;
    $('new-badges').textContent = newBadges.length ? `New badge${newBadges.length === 1 ? '' : 's'}: ${newBadges.map((b) => b.name).join(', ')}` : '';
    if (fresh) { box.focus(); announce(`${$('solved-h').textContent} ${$('solved-text').textContent}`); }
  }

  function reveal() {
    $('reveal-confirm').hidden = true;
    const changes = [];
    G.p.solution.forEach((d, i) => { if (playable(i) && !isGiven(i) && G.v[i] !== d) changes.push({ i, from: G.v[i], to: d, nf: G.n[i], nt: 0 }); });
    apply(changes);
    G.revealed = true;
    G.solved = true;
    G.hint = null;
    stopTimer();
    record('revealed');
    save();
    render();
    showSolved({ fresh: true });
  }

  function rate(feel) {
    const rec = learn.rate(G.p.fingerprint, feel);
    if (rec) deps.onPlay?.({ ...rec, game: P });
    $$(`#${P}-solved [data-feel]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.feel === feel)));
    $('feel-done').textContent = 'Thanks. The next puzzle will take it into account.';
  }

  function shareText() {
    return `${def.name} · ${G.p.difficulty.name}${G.daily ? ` · Daily ${G.daily}` : ''}\nSolved in ${fmtTime(G.ms)}${G.hints ? ` with ${G.hints} hint${G.hints === 1 ? '' : 's'}` : ', no hints'}.\nThe Logic Grid`;
  }
  async function share() {
    const text = shareText();
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    const accent = getComputedStyle(root).getPropertyValue('--gk-accent').trim() || '#5B3CC4';
    const canvas = resultPicture(G, def, { accent: accent.startsWith('#') ? accent : '#5B3CC4', dark });
    try {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], `${P}-result.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); } catch (e) { /* no clipboard */ }
    const img = new Image();
    img.alt = 'Your result, ready to save or share';
    img.src = canvas.toDataURL('image/png');
    $('share-pic').replaceChildren(img);
    $('share-box').hidden = false;
    announce('Result copied. The picture is below.', true);
  }

  // ---------- the solution, step by step ----------

  let stepAt = 0;
  function openSteps() {
    stepAt = 0;
    def.buildBoard($('steps-board'), G.p);
    drawStep();
    $('steps-dlg').showModal();
  }
  function drawStep() {
    const path = G.p.solvePath;
    const vals = G.p.givens.slice();
    for (const s of path.slice(0, stepAt)) {
      if (s.place) vals[s.place[0]] = s.place[1];
      if (s.marks) for (const [i, v] of s.marks) vals[i] = v;
    }
    const cur = path[stepAt - 1];
    const focus = new Set(cur ? cur.cells || [] : []);
    for (const el of $('steps-board').querySelectorAll('[data-i]')) {
      const i = Number(el.dataset.i);
      const v = vals[i];
      el.classList.toggle('given', !!G.p.givens[i]);
      el.classList.toggle('hinted', focus.has(i));
      if (DIGITS) { el.querySelector('.v').textContent = v || ''; el.querySelector('.gk-notes').innerHTML = ''; } else { el.classList.toggle('on', v === 1); el.classList.toggle('x', v === 2); }
    }
    $('step-n').textContent = stepAt ? `Step ${stepAt} of ${path.length}` : `${path.length} steps`;
    $('step-tech').textContent = cur ? cur.techniqueName : 'The start';
    $('step-why').textContent = cur ? cur.why : 'Every step below follows from the clues. Press Next step to watch the puzzle solve itself.';
    $('step-prev').disabled = stepAt === 0;
    $('step-next').disabled = $('step-end').disabled = stepAt >= path.length;
  }

  // ---------- files and printing ----------

  function saveFile() {
    const data = JSON.stringify({ format: `the-logic-grid/${P}`, version: 1, game: { name: G.name, p: G.p, v: G.v, n: G.n, ms: Math.round(G.ms), hints: G.hints, mistakes: G.mistakes, solved: G.solved, revealed: G.revealed, daily: G.daily } });
    if (deps.canDownload === false) { announce('Saving files is not available here.', true); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `${G.name.replace(/[^\w -]+/g, '').trim() || def.name}.json`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    announce('Saved to a file.', true);
  }

  const NAME_ID = /^[a-z0-9-]{1,60}$/i;
  // A saved or opened game, checked field by field so nothing unexpected reaches the page.
  function cleanGame(g) {
    if (!g || typeof g !== 'object') return null;
    const p = def.cleanPuzzle(g.p);
    if (!p) return null;
    const cells = p.size * p.cols;
    const nums = (a, max) => (Array.isArray(a) && a.length === cells ? a.map((x) => (Number.isInteger(x) && x >= 0 && x <= max ? x : 0)) : Array(cells).fill(0));
    const hist = (a) => (Array.isArray(a) ? a.filter(Array.isArray).slice(-400).map((chs) => chs.filter((c) => c && Number.isInteger(c.i) && c.i >= 0 && c.i < cells).map((c) => ({ i: c.i, from: Number(c.from) || 0, to: Number(c.to) || 0, nf: Number(c.nf) || 0, nt: Number(c.nt) || 0 }))) : []);
    const num = (x) => (Number.isFinite(+x) && +x >= 0 ? +x : 0);
    return {
      p, v: nums(g.v, DIGITS ? 9 : 2), n: nums(g.n, 1023), undo: hist(g.undo), redo: hist(g.redo),
      name: String(g.name || def.titleOf(p)).slice(0, 80), mode: ['free', 'daily', 'file'].includes(g.mode) ? g.mode : 'file',
      daily: /^\d{4}-\d{2}-\d{2}$/.test(g.daily || '') ? g.daily : null, practice: NAME_ID.test(g.practice || '') ? g.practice : null, tuned: g.tuned == null ? null : num(g.tuned),
      ms: num(g.ms), hints: num(g.hints), mistakes: num(g.mistakes), checks: num(g.checks), stuck: Array.isArray(g.stuck) ? g.stuck.filter((t) => NAME_ID.test(t)).slice(-50) : [],
      solved: !!g.solved, revealed: !!g.revealed, created: num(g.created) || Date.now(), updated: num(g.updated) || Date.now(),
      sel: Number.isInteger(g.sel) && g.sel >= 0 && g.sel < cells ? g.sel : 0,
    };
  }

  async function openFile(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== `the-logic-grid/${P}`) throw new Error('not this game');
      const g = cleanGame({ ...data.game, mode: 'file' });
      if (!g) throw new Error('bad');
      G = { ...g, id: `g${Date.now().toString(36)}` };
      open();
    } catch (e) {
      $('status').textContent = `That file is not a ${def.name} puzzle.`;
    }
  }

  function doPrint(form) {
    const marks = form.querySelector(`[name=${P}-pmarks]:checked`).value === 'marks';
    const paper = form.querySelector(`[name=${P}-paper]:checked`).value;
    printHtml(printableHtml(G, def, { marks, paper, answers: $('p-key').checked, steps: $('p-steps').checked }));
  }

  function deleteGame(id) {
    const all = games();
    const g = all[id];
    if (!g) return;
    delete all[id];
    keep(K.games, all);
    if (deleted) clearTimeout(deleted.timer);
    deleted = { game: g, timer: setTimeout(() => { deleted = null; if (root) $('undo-bar').hidden = true; }, 8000) };
    $('undo-text').textContent = `Deleted "${g.name}".`;
    $('undo-bar').hidden = false;
    renderSetup();
    $('undo-delete').focus();
  }

  function renameGame(li) {
    const id = li.dataset.id, g = games()[id];
    if (!g) return;
    const input = document.createElement('input');
    input.className = 'gk-rename';
    input.value = g.name;
    input.setAttribute('aria-label', 'New name');
    const btn = li.querySelector('.gk-saved-open');
    btn.replaceWith(input);
    input.focus();
    input.select();
    const done = (ok) => {
      if (ok && input.value.trim()) { const all = games(); all[id].name = input.value.trim().slice(0, 80); keep(K.games, all); }
      renderSetup();
      root.querySelector(`#${P}-saved li[data-id="${CSS.escape(id)}"] .gk-saved-open`)?.focus();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    input.onblur = () => done(true);
  }

  // ---------- focus, keys, wiring ----------

  function announce(msg, polite = false) {
    const el = $(polite ? 'status-live' : 'live');
    el.textContent = '';
    setTimeout(() => { if (root) el.textContent = msg; }, 30);
  }
  function focusCell(i) {
    const el = $('board').querySelector(`[data-i="${i}"]`);
    if (!el) return;
    for (const c of $('board').querySelectorAll('[tabindex="0"]')) c.tabIndex = -1;
    el.tabIndex = 0;
    el.focus({ preventScroll: true });
  }
  function select(i) {
    if (i < 0 || !playable(i)) return;
    G.sel = i;
    render();
    focusCell(i);
  }
  function move(dr, dc) {
    const next = def.move(G.p, G.sel, dr, dc);
    if (next >= 0) select(next);
  }

  function wire() {
    $('setup').addEventListener('submit', (e) => {
      e.preventDefault();
      const level = $('levels').querySelector('input:checked').value;
      const size = Number($('sizes').querySelector('input:checked')?.value) || prefs.size;
      prefs.level = level; prefs.size = size; savePrefs();
      startNew({ difficulty: level, size });
    });
    $('levels').addEventListener('change', () => { prefs.level = $('levels').querySelector('input:checked').value; renderSizes(); savePrefs(); renderSetup(); });
    $('sizes').addEventListener('change', () => { prefs.size = Number($('sizes').querySelector('input:checked').value); savePrefs(); });
    $('continue').onclick = () => resume($('continue').dataset.id);
    $('daily-btn').onclick = startDaily;
    $('suggest').onclick = () => { const r = $('levels').querySelector(`input[value="${$('suggest').dataset.level}"]`); if (r) { r.checked = true; prefs.level = r.value; renderSizes(); savePrefs(); renderSetup(); } };
    $('howto-btn').onclick = $('howto-play').onclick = () => { $('howto-body').innerHTML = def.howto; $('howto-dlg').showModal(); };
    $('saved').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'delete') deleteGame(li.dataset.id);
      else if (act === 'rename') renameGame(li);
      else if (e.target.closest('.gk-saved-open')) resume(li.dataset.id);
    });
    $('undo-delete').onclick = () => { if (!deleted) return; putGame(deleted.game); clearTimeout(deleted.timer); deleted = null; $('undo-bar').hidden = true; renderSetup(); };
    $('open-file').onclick = () => $('file').click();
    $('file').onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };

    const board = $('board');
    if (DIGITS) {
      board.addEventListener('click', (e) => { const c = e.target.closest('[data-i]'); if (c) select(Number(c.dataset.i)); });
      $('digits').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) { place(Number(b.dataset.d)); focusCell(G.sel); } });
      $('notes-btn').onclick = () => { prefs.notes = !prefs.notes; savePrefs(); render(); };
      $('auto').onclick = autoNotes;
    } else {
      board.addEventListener('pointerdown', (e) => {
        const c = e.target.closest('[data-i]');
        if (!c || e.button > 0) return;
        e.preventDefault();
        try { board.releasePointerCapture?.(e.pointerId); } catch (err) { /* not captured */ }
        startStroke(Number(c.dataset.i));
        focusCell(Number(c.dataset.i));
      });
      board.addEventListener('pointermove', (e) => {
        if (!stroke) return;
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(`#${P}-board [data-i]`);
        if (el) moveStroke(Number(el.dataset.i));
      });
      window.addEventListener('pointerup', endStroke);
      board.addEventListener('pointercancel', endStroke);
      $('pen-fill').onclick = () => setPen(1);
      $('pen-cross').onclick = () => setPen(2);
    }
    $('undo').onclick = undo;
    $('redo').onclick = redo;
    $('erase').onclick = () => { erase(); focusCell(G.sel); };
    $('hint-btn').onclick = hint;
    $('check').onclick = check;
    $('mistakes').onchange = (e) => { prefs.showMistakes = e.target.checked; savePrefs(); render(); };
    $('pause').onclick = () => { G.paused = !G.paused; render(); announce(G.paused ? 'Paused.' : 'Resumed.', true); };
    $('coach-next').onclick = () => coach(Number($('coach').dataset.i) + 1);
    $('coach-close').onclick = () => { prefs.coachDone = true; savePrefs(); $('coach').hidden = true; };
    $('print').hidden = deps.canPrint === false;
    $('save-file').hidden = deps.canDownload === false;
    $('print').onclick = () => $('print-dlg').showModal();
    $('print-dlg').addEventListener('close', () => { if ($('print-dlg').returnValue === 'print') doPrint($('print-dlg').querySelector('form')); });
    $('save-file').onclick = saveFile;
    $('reveal').onclick = () => { $('reveal-confirm').hidden = false; $('reveal-yes').focus(); };
    $('reveal-no').onclick = () => { $('reveal-confirm').hidden = true; };
    $('reveal-yes').onclick = reveal;
    $('new').onclick = () => { if (G && !G.solved && G.ms > 5000) record('abandoned'); showView('setup'); };
    $('again').onclick = () => { const lv = G.p.difficulty.id, size = G.p.size; showView('setup'); startNew({ difficulty: lv, size }); };
    $('home').onclick = () => showView('setup');
    $('share').onclick = share;
    $('steps-btn').onclick = openSteps;
    $('step-prev').onclick = () => { stepAt = Math.max(0, stepAt - 1); drawStep(); };
    $('step-next').onclick = () => { stepAt = Math.min(G.p.solvePath.length, stepAt + 1); drawStep(); };
    $('step-end').onclick = () => { stepAt = G.p.solvePath.length; drawStep(); };
    root.querySelector(`#${P}-solved .gk-feel`).addEventListener('click', (e) => { const b = e.target.closest('[data-feel]'); if (b) rate(b.dataset.feel); });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onLeave);
  }

  function onHide() { if (document.hidden && playing()) { tick(); save(); } }
  function onLeave() { if (G && root) { tick(); save(); } }

  function onKey(e) {
    if (!root || !playing() || !G || root.closest('[hidden]')) return;
    if (e.target.closest?.('input, select, textarea, dialog')) return;
    if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'p' || k === 'P') { $('pause').click(); return; }
    if (G.solved || G.paused) return;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) { e.preventDefault(); move(...arrows[k]); return; }
    if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); erase(); return; }
    if (k === 'h' || k === 'H') { hint(); return; }
    if (k === 'c' || k === 'C') { check(); return; }
    if (DIGITS) {
      const code = /^Digit([1-9])$/.exec(e.code || '');
      const d = code ? Number(code[1]) : /^[1-9]$/.test(k) ? Number(k) : 0;
      if (d && def.digits(G.p).includes(d)) {
        e.preventDefault();
        if (e.shiftKey) { if (G.sel >= 0 && playable(G.sel) && !isGiven(G.sel)) toggleNote(G.sel, d); } else place(d);
        return;
      }
      if (k === 'n' || k === 'N') { prefs.notes = !prefs.notes; savePrefs(); render(); return; }
      if (k === 'a' || k === 'A') { autoNotes(); return; }
    } else {
      if (k === ' ' || k === 'Enter' || k === 'f' || k === 'F') { e.preventDefault(); keyMark(1); return; }
      if (k === 'x' || k === 'X' || k === '.') { e.preventDefault(); keyMark(2); return; }
    }
  }

  return {
    mount, unmount,
    setShared: (s) => learn?.setShared(s),
    suspend: () => close(),
    reopen: () => { if (playing() && !G.solved && !G.paused) startTimer(); },
    state: () => G,
    learning: () => learn,
    dailyOptions,
  };
}
