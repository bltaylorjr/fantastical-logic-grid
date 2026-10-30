// Picture clues: one written clue starts locked. In its place the player finds
// a piece of evidence, a small picture puzzle (engine/src/picture.js). Filling
// in the picture reveals the object and unlocks the clue.
//
// On for everyone; Settings > "Picture clues" turns it off (settings.pictureClues).
// ?pictures=0 or ?pictures=1 in the address switches it for testing.
// Silent mode does not hide it: it is part of the puzzle, not decoration.
//
// Progress is kept in the puzzle's save (save.picture), so it travels with
// saved games and the player's account. The first locked clue a player meets
// opens with a short explanation (settings.pictureIntroSeen); after that the
// evidence stays folded until they open it.
import { pictureClue } from '../engine/index.js';
import * as store from './store.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ?pictures=0/1 overrides the setting on this device (for testing).
let override = null;
try {
  const flag = new URLSearchParams(location.search).get('pictures');
  if (flag === '1' || flag === '0') store.setLocal('pictureClues', flag === '1');
  const v = store.getLocal('pictureClues');
  if (v === true || v === false) override = v;
} catch (e) { /* no address or storage */ }

export const enabled = (settings) => (override !== null ? override : !settings || settings.pictureClues !== false);

let cur = null; // the open puzzle's picture clue, or null

// The number of the clue that is still locked, or null.
export const lockedClue = () => (cur && !cur.solved ? cur.pc.locked : null);
// The picture's name once uncovered (for the answer key), and the clue itself.
export const current = () => (cur ? { ...cur.pc, solved: cur.solved } : null);

export function stop() {
  if (!cur) return;
  cur.panel.remove();
  cur.li.classList.remove('pic-locked');
  cur = null;
}

// Opens the evidence panel and moves focus into it (from a hint, say).
export function open() {
  if (!cur) return;
  cur.setOpen(true);
  cur.body.querySelector('.pic-cell:not([disabled])')?.focus() || cur.toggle.focus();
  cur.panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// The whole puzzle was solved or revealed: the evidence is no longer needed.
export function unlock() {
  if (!cur || cur.solved) return;
  cur.solved = true;
  cur.reveal = true;
  cur.persist();
  cur.lock();
  if (!cur.body.hidden) cur.draw();
}

// Called after the clue list is drawn.
//   save      the puzzle's save (picture progress lives in save.picture)
//   settings  the player's settings (pictureClues, pictureIntroSeen)
//   onSolved  runs once when the picture is finished (sound, message)
//   onChange  runs when progress changes, so the save can be written
export function start(puzzle, { save, settings, onSolved = null, onChange = null } = {}) {
  stop();
  if (!enabled(settings)) return;
  let pc;
  try { pc = pictureClue(puzzle); } catch (e) { console.warn('Picture clue not made:', e.message); return; }
  if (!pc) return;
  const li = document.querySelector(`#clue-list li[data-n="${pc.locked}"]`);
  if (!li) return;

  const H = pc.picture.rows.length, W = pc.picture.rows[0].length;
  // Saved as a short string: '.' blank, 'F' filled, 'X' marked empty.
  let state = save && save.picture;
  if (!state) {
    // Progress kept on the device by the test version moves into the save.
    try {
      const old = store.getLocal(`picture:${puzzle.id}`);
      if (old && Array.isArray(old.cells)) state = { c: old.cells.map((v) => v || '.').join(''), s: !!old.solved };
    } catch (e) { /* none */ }
  }
  let cells = state && typeof state.c === 'string' && state.c.length === H * W ? state.c.split('') : new Array(H * W).fill('.');
  const self = { pc, li, solved: !!(state && state.s) || !!(save && (save.solved || save.revealed)), reveal: false };
  cur = self;

  const panel = document.createElement('div');
  panel.className = 'pic-clue';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn small pic-open';
  toggle.setAttribute('aria-expanded', 'false');
  const body = document.createElement('div');
  body.className = 'pic-body';
  body.hidden = true;
  panel.append(toggle, body);
  li.append(panel);
  Object.assign(self, { panel, toggle, body });

  self.persist = () => {
    if (save) save.picture = { c: cells.join(''), s: self.solved };
    if (onChange) try { onChange(); } catch (e) { /* optional */ }
  };
  const isDone = () => pc.picture.rows.every((row, y) => [...row].every((ch, x) => (ch === '#') === (cells[y * W + x] === 'F')));

  self.lock = () => {
    li.classList.toggle('pic-locked', !self.solved);
    toggle.textContent = self.solved ? `Evidence: ${pc.picture.name}` : `Locked evidence: solve the picture to reveal clue ${pc.locked}`;
  };

  let intro = false;
  self.draw = () => {
    const shown = self.reveal ? pc.picture.rows.map((r) => [...r].map((ch) => (ch === '#' ? 'F' : '.'))).flat() : cells;
    const head = pc.clues.cols.map((c) => `<th scope="col"><span>${(c.length ? c : [0]).join('<br>')}</span></th>`).join('');
    const rows = pc.clues.rows.map((r, y) => `<tr><th scope="row">${(r.length ? r : [0]).join(' ')}</th>${
      Array.from({ length: W }, (_, x) => {
        const v = shown[y * W + x];
        const word = v === 'F' ? 'filled' : v === 'X' ? 'empty' : 'blank';
        return `<td><button type="button" class="pic-cell ${v === 'F' ? 'f' : v === 'X' ? 'x' : ''}" data-i="${y * W + x}" aria-label="Row ${y + 1}, column ${x + 1}, ${word}"${self.solved ? ' disabled' : ''} tabindex="${y === 0 && x === 0 ? 0 : -1}"></button></td>`;
      }).join('')}</tr>`).join('');
    const help = self.solved
      ? `You uncovered ${esc(pc.picture.name)}. Clue ${pc.locked} is now unlocked.`
      : `${intro ? '<b>New: picture clues.</b> One clue in this puzzle is locked evidence. ' : ''}Fill in squares to uncover it. The numbers tell you how many filled squares sit together in each row and column, in order. Tap once to fill, twice to mark empty, three times to clear. You can solve the rest of the puzzle first and come back to it.`;
    body.innerHTML = `
      <p class="pic-help">${help}</p>
      <table class="pic-grid${self.solved ? ' done' : ''}" style="--pic-w:${W}"><thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table>
      <p class="pic-status${self.solved ? ' sr-only' : ''}" role="status" aria-live="polite"></p>
      ${self.solved ? '' : '<button type="button" class="btn small pic-reset">Start the picture again</button>'}`;
  };

  self.setOpen = (on) => {
    body.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (on) self.draw();
  };

  toggle.addEventListener('click', () => self.setOpen(body.hidden));

  body.addEventListener('click', (e) => {
    if (e.target.closest('.pic-reset')) {
      cells = new Array(H * W).fill('.');
      self.persist();
      self.draw();
      body.querySelector('.pic-status').textContent = 'The picture is cleared.';
      return;
    }
    const b = e.target.closest('.pic-cell');
    if (!b || self.solved) return;
    const i = Number(b.dataset.i);
    cells[i] = cells[i] === '.' ? 'F' : cells[i] === 'F' ? 'X' : '.';
    if (isDone()) {
      self.solved = true;
      self.persist();
      self.lock();
      self.draw();
      body.querySelector('.pic-status').textContent = `It's ${pc.picture.name}! Clue ${pc.locked} is unlocked.`;
      li.querySelector('label input')?.focus?.();
      if (onSolved) try { onSolved(pc); } catch (err) { /* optional */ }
      return;
    }
    self.persist();
    self.draw();
    body.querySelector(`.pic-cell[data-i="${i}"]`)?.focus();
  });

  // Arrow keys move between squares.
  body.addEventListener('keydown', (e) => {
    const b = e.target.closest('.pic-cell');
    if (!b) return;
    const i = Number(b.dataset.i);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: W, ArrowUp: -W }[e.key];
    if (step === undefined) return;
    const j = i + step;
    if (j < 0 || j >= H * W || (Math.abs(step) === 1 && Math.floor(j / W) !== Math.floor(i / W))) return;
    e.preventDefault();
    b.tabIndex = -1;
    const next = body.querySelector(`.pic-cell[data-i="${j}"]`);
    if (next) { next.tabIndex = 0; next.focus(); }
  });

  self.lock();
  // The first locked clue a player ever meets opens with a short explanation.
  if (!self.solved && settings && !settings.pictureIntroSeen) {
    intro = true;
    settings.pictureIntroSeen = true;
    try { store.saveSettings(settings); } catch (e) { /* optional */ }
    self.setOpen(true);
  }
}
