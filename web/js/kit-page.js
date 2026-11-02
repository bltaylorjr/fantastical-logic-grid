// Cage Math, Sum Cross or Picture Grid on its own page of the website
// (cage-math/, sum-cross/, picture-grid/, written by scripts/hub.mjs). The
// page says which game it is with <main data-kit-game="...">. The same
// module, saves (flg.cm.*, flg.sc.*, flg.pg.*), settings and shared play data
// as the game's screen inside the app, so a player's progress is the same in both.
import * as store from './store.js';
import * as remote from './remote-config.js';
import * as kitGames from './kit-games.js';
import { celebrate } from './effects.js';

const settings = store.loadSettings();
remote.init();
const setWorld = (id) => { document.documentElement.dataset.world = id || 'random'; };
const card = document.querySelector('[data-kit-game]')?.dataset.kitGame;
const game = kitGames.KIT_GAMES[card];

if (game) {
  if (!kitGames.enabled(card)) {
    document.getElementById(`${game.id}-root`).innerHTML = `<p class="muted">${game.name} is taking a short break. Please try again soon, or play <a href="../fantastical/">The Fantastical Logic Grid</a>.</p>`;
  } else {
    try { localStorage.setItem('flg.game', card); } catch (e) { /* private mode */ }
    kitGames.open(card, { celebrate: () => celebrate(settings.celebrations, { random: settings.celebrateRandom }), setWorld });
    // The module saves and pauses its clock when the page is hidden or left.
  }
}
