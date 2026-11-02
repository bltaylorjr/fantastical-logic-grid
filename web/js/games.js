// The Logic Grid's games: the cards on the first screen (#screen-games).
// Each game opens its own screen. A new game adds one entry here (with
// soon: true until it is ready) and an opener in app.js. `video` names its
// intro (web/media/games/<video>.mp4, .vtt and .jpg); coming-soon games
// have a video explaining the idea.
const MARK_GRID = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor"/><path d="M11 2v28M21 2v28M2 11h28M2 21h28" stroke="var(--hero-ink)" stroke-width="1.6"/><circle cx="16" cy="16" r="3.4" fill="var(--hero-ink)"/><path d="M4.8 4.8l3.4 3.4M8.2 4.8l-3.4 3.4M23.8 23.8l3.4 3.4M27.2 23.8l-3.4 3.4" stroke="var(--hero-ink)" stroke-width="1.6" stroke-linecap="round"/></svg>';
const MARK_NINE = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor"/><path d="M11 2v28M21 2v28M2 11h28M2 21h28" stroke="var(--hero-ink)" stroke-width="1.6"/><g fill="var(--hero-ink)" font-family="inherit" font-weight="700" font-size="7" text-anchor="middle"><text x="6.5" y="9">9</text><text x="16" y="18.5">9</text><text x="25.5" y="28">9</text></g></svg>';
const MARK_CAGE = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor"/><path d="M16 2v14H2M16 16h14M23 16v14" stroke="var(--hero-ink)" stroke-width="2.2"/><g fill="var(--hero-ink)" font-family="inherit" font-weight="700" font-size="6.5"><text x="4.5" y="9.5">6+</text><text x="18.5" y="9.5">2÷</text><text x="4.5" y="23.5">12×</text></g></svg>';
const MARK_CROSS = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor"/><path d="M2 12h28M12 2v28M21 12v18M12 21h18" stroke="var(--hero-ink)" stroke-width="1.6"/><path d="M3 3l9 9" stroke="var(--hero-ink)" stroke-width="1.2"/><g fill="var(--hero-ink)" font-family="inherit" font-weight="700" font-size="5.5"><text x="7.5" y="7">9</text><text x="3" y="11">4</text><text x="15" y="18.5">3</text><text x="24" y="18.5">1</text></g></svg>';
const MARK_PICTURE = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor"/><g fill="var(--hero-ink)"><rect x="12" y="8" width="4" height="4"/><rect x="16" y="8" width="4" height="4"/><rect x="8" y="12" width="16" height="4"/><rect x="8" y="16" width="16" height="4"/><rect x="12" y="20" width="8" height="4"/><rect x="14" y="24" width="4" height="3"/></g></svg>';
const MARK_SOON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/><path d="M16 11v10M11 16h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export const GAMES = [
  { id: 'logic-grid', name: 'The Fantastical Logic Grid', kind: 'Story logic puzzles', blurb: 'Every case is a brand new story. Read the clues, fill the grid, close the case.', mark: MARK_GRID, video: 'fantastical-logic-grid' },
  {
    id: 'ninetimesnine', name: 'NINETIMESNINE', kind: 'Number puzzles', blurb: 'Place 1 to 9 once in every row, column and box. Hints teach the next step.', mark: MARK_NINE, tag: 'New', video: 'ninetimesnine',
    // Its games (modules/number-place/styles.js), each with its own link under the card.
    modes: [
      { id: 'classic', name: 'Classic' }, { id: 'rival', name: 'Rival Grid' }, { id: 'chain', name: 'Chain Reaction' },
      { id: 'tide', name: 'Tidewater' }, { id: 'glyph', name: 'Glyph Quest' },
    ],
  },
  { id: 'cage-math', name: 'Cage Math', kind: 'Number puzzles', blurb: 'Fill each cage so its numbers make the target, with every number once in each row and column.', mark: MARK_CAGE, tag: 'New', video: 'cage-math' },
  { id: 'sum-cross', name: 'Sum Cross', kind: 'Number puzzles', blurb: 'A crossword of numbers: every run adds up to its clue, with no number twice.', mark: MARK_CROSS, tag: 'New', video: 'sum-cross' },
  { id: 'picture-grid', name: 'Picture Grid', kind: 'Picture puzzles', blurb: 'Shade the cells the row and column counts call for, and a picture appears for your gallery.', mark: MARK_PICTURE, tag: 'New', video: 'picture-grid' },
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
// A game with several ways to play lists them under its card, each opening
// the game with that one picked: onOpen(id, mode).
// `available(id)` lets the dashboard switch a game off. A game with a video
// gets a Watch button under its card: onWatch(video, title).
export function renderCards(list, { available = () => true, onOpen, onWatch = null }) {
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
    if (g.modes && !g.soon) {
      const modes = document.createElement('ul');
      modes.className = 'game-modes';
      modes.setAttribute('aria-label', `${g.name} games`);
      for (const m of g.modes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small';
        b.dataset.mode = m.id;
        b.textContent = m.name;
        b.setAttribute('aria-label', m.id === 'classic' ? g.name : `${g.name}-${m.name}`);
        b.onclick = () => onOpen(g.id, m.id);
        const item = document.createElement('li');
        item.append(b);
        modes.append(item);
      }
      li.append(modes);
    }
    if (g.video && onWatch) {
      const w = document.createElement('button');
      w.type = 'button';
      w.className = 'btn small game-watch';
      w.dataset.video = g.video;
      w.textContent = g.soon ? 'See how it works' : 'Watch the intro';
      const title = g.soon ? `${g.name}: coming soon` : `Introducing ${g.name}`;
      w.setAttribute('aria-label', `${w.textContent}: ${g.name}`);
      w.onclick = () => onWatch(g.video, title);
      li.append(w);
    }
    return li;
  }));
}
