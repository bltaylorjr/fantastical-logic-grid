// Picture clues (EXPERIMENTAL, off unless switched on on this device).
//
// One written clue starts locked. In its place the player finds a piece of
// evidence: a small picture puzzle (engine/src/picture.js). Filling in the
// picture reveals the object and unlocks the clue.
//
// Switch on for this device: open the game with ?pictures=1 in the address.
// Switch off again: ?pictures=0. Players never see it unless they do this.
// Silent mode does not hide it: it is part of the puzzle, not decoration.
//
// Progress is kept on this device only (not in the save or the account), so
// saved games stay exactly as they are.
//
// Known gaps while testing: hints, "Read the clues aloud", the character
// bubbles and printing still show the locked clue.
import { pictureClue } from '../engine/index.js';
import * as store from './store.js';

const KEY = 'pictureClues';

try {
  const flag = new URLSearchParams(location.search).get('pictures');
  if (flag === '1') store.setLocal(KEY, true);
  else if (flag === '0') store.setLocal(KEY, undefined);
} catch (e) { /* no address or storage: stays off */ }

export const enabled = () => { try { return store.getLocal(KEY) === true; } catch (e) { return false; } };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Called after the clue list is drawn. `onSolved()` runs once, when the
// picture is finished (for a sound or a message).
export function start(puzzle, { onSolved = null } = {}) {
  if (!enabled()) return;
  let pc;
  try { pc = pictureClue(puzzle); } catch (e) { console.warn('Picture clue not made:', e.message); return; }
  if (!pc) return;
  const li = document.querySelector(`#clue-list li[data-n="${pc.locked}"]`);
  if (!li) return;

  const H = pc.picture.rows.length, W = pc.picture.rows[0].length;
  const saveKey = `picture:${puzzle.id}`;
  const saved = (() => { try { return store.getLocal(saveKey); } catch (e) { return null; } })();
  // cells: '' empty, 'F' filled, 'X' marked empty
  let cells = saved && Array.isArray(saved.cells) && saved.cells.length === H * W ? saved.cells : new Array(H * W).fill('');
  let solved = !!(saved && saved.solved);

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

  const keep = () => { try { store.setLocal(saveKey, { cells, solved }); } catch (e) { /* optional */ } };
  const isDone = () => pc.picture.rows.every((row, y) => [...row].every((ch, x) => (ch === '#') === (cells[y * W + x] === 'F')));

  function lock() {
    li.classList.toggle('pic-locked', !solved);
    toggle.textContent = solved ? `Evidence: ${pc.picture.name}` : `Locked evidence: solve the picture to reveal clue ${pc.locked}`;
  }

  function draw() {
    const head = pc.clues.cols.map((c) => `<th scope="col"><span>${(c.length ? c : [0]).join('<br>')}</span></th>`).join('');
    const rows = pc.clues.rows.map((r, y) => `<tr><th scope="row">${(r.length ? r : [0]).join(' ')}</th>${
      Array.from({ length: W }, (_, x) => {
        const v = cells[y * W + x];
        const word = v === 'F' ? 'filled' : v === 'X' ? 'empty' : 'blank';
        return `<td><button type="button" class="pic-cell ${v === 'F' ? 'f' : v === 'X' ? 'x' : ''}" data-i="${y * W + x}" aria-label="Row ${y + 1}, column ${x + 1}, ${word}"${solved ? ' disabled' : ''} tabindex="${y === 0 && x === 0 ? 0 : -1}"></button></td>`;
      }).join('')}</tr>`).join('');
    body.innerHTML = `
      <p class="pic-help">${solved
        ? `You uncovered ${esc(pc.picture.name)}. Clue ${pc.locked} is now unlocked.`
        : 'Fill in squares to uncover the evidence. The numbers tell you how many filled squares sit together in each row and column. Tap once to fill, twice to mark empty.'}</p>
      <table class="pic-grid${solved ? ' done' : ''}"><thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table>
      <p class="pic-status${solved ? ' sr-only' : ''}" role="status" aria-live="polite"></p>
      ${solved ? '' : '<button type="button" class="btn small pic-reset">Start the picture again</button>'}`;
  }

  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    if (!body.hidden) draw();
  });

  body.addEventListener('click', (e) => {
    if (e.target.closest('.pic-reset')) {
      cells = new Array(H * W).fill('');
      keep();
      draw();
      body.querySelector('.pic-status').textContent = 'The picture is cleared.';
      return;
    }
    const b = e.target.closest('.pic-cell');
    if (!b || solved) return;
    const i = Number(b.dataset.i);
    cells[i] = cells[i] === '' ? 'F' : cells[i] === 'F' ? 'X' : '';
    if (isDone()) {
      solved = true;
      keep();
      lock();
      draw();
      body.querySelector('.pic-status').textContent = `It's ${pc.picture.name}! Clue ${pc.locked} is unlocked.`;
      li.querySelector('label')?.focus?.();
      if (onSolved) try { onSolved(pc); } catch (err) { /* optional */ }
      return;
    }
    keep();
    draw();
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

  lock();
}
