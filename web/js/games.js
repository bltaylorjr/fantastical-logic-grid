// The Logic Grid's games: the cards on the first screen (#screen-games).
// Each game opens its own screen. A new game adds one entry here (with
// soon: true until it is ready) and an opener in app.js.
const MARK_GRID = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor"/><path d="M11 2v28M21 2v28M2 11h28M2 21h28" stroke="var(--hero-ink)" stroke-width="1.6"/><circle cx="16" cy="16" r="3.4" fill="var(--hero-ink)"/><path d="M4.8 4.8l3.4 3.4M8.2 4.8l-3.4 3.4M23.8 23.8l3.4 3.4M27.2 23.8l-3.4 3.4" stroke="var(--hero-ink)" stroke-width="1.6" stroke-linecap="round"/></svg>';
const MARK_NINE = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor"/><path d="M11 2v28M21 2v28M2 11h28M2 21h28" stroke="var(--hero-ink)" stroke-width="1.6"/><g fill="var(--hero-ink)" font-family="inherit" font-weight="700" font-size="7" text-anchor="middle"><text x="6.5" y="9">9</text><text x="16" y="18.5">9</text><text x="25.5" y="28">9</text></g></svg>';
const MARK_SOON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/><path d="M16 11v10M11 16h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export const GAMES = [
  { id: 'logic-grid', name: 'The Fantastical Logic Grid', kind: 'Story logic puzzles', blurb: 'Every case is a brand new story. Read the clues, fill the grid, close the case.', mark: MARK_GRID },
  { id: 'ninetimesnine', name: 'NINETIMESNINE', kind: 'Number puzzles', blurb: 'Place 1 to 9 once in every row, column and box. Hints teach the next step.', mark: MARK_NINE, tag: 'New' },
  { id: 'cage-math', name: 'Cage Math', kind: 'Coming soon', blurb: 'Fill each cage so its numbers make the target.', mark: MARK_SOON, soon: true },
  { id: 'sum-cross', name: 'Sum Cross', kind: 'Coming soon', blurb: 'A crossword of numbers: every run adds up to its clue.', mark: MARK_SOON, soon: true },
  { id: 'picture-grid', name: 'Picture Grid', kind: 'Coming soon', blurb: 'Shade the cells the row and column counts call for, and a picture appears.', mark: MARK_SOON, soon: true },
];

// The game the player last opened, so the app opens there next time.
const KEY = 'flg.game';
export function lastGame() {
  try { const id = localStorage.getItem(KEY); return GAMES.some((g) => g.id === id && !g.soon) ? id : null; } catch (e) { return null; }
}
export function rememberGame(id) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
}

// The cards. Games that are ready are buttons; the rest show what is coming.
// `available(id)` lets the dashboard switch a game off.
export function renderCards(list, { available = () => true, onOpen }) {
  list.replaceChildren(...GAMES.filter((g) => g.soon || available(g.id)).map((g) => {
    const li = document.createElement('li');
    const card = document.createElement(g.soon ? 'div' : 'button');
    card.className = `game-card${g.soon ? ' soon' : ''}`;
    card.dataset.game = g.id;
    if (!g.soon) { card.type = 'button'; card.onclick = () => onOpen(g.id); }
    card.innerHTML = `<span class="game-art">${g.mark}</span><span class="game-text"><span class="game-kind"></span><span class="game-name" translate="no"></span><span class="game-blurb"></span></span>`;
    card.querySelector('.game-kind').textContent = g.kind;
    card.querySelector('.game-name').textContent = g.name;
    card.querySelector('.game-blurb').textContent = g.blurb;
    if (!g.soon) {
      const play = document.createElement('span');
      play.className = 'game-play';
      play.setAttribute('aria-hidden', 'true');
      play.textContent = 'Play →';
      card.querySelector('.game-text').append(play);
    }
    if (g.tag) {
      const t = document.createElement('span');
      t.className = 'menu-tag';
      t.textContent = g.tag;
      card.querySelector('.game-name').append(' ', t);
    }
    li.append(card);
    return li;
  }));
}
