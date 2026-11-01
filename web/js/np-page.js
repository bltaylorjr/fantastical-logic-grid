// NINETIMESNINE on its own page of the website (ninetimesnine/, written by
// scripts/hub.mjs). The same module, saves (flg.np.*), settings and shared
// play data as the screen inside the game, so a player's progress is the same
// in both. ?style=rival (or chain, tide, glyph) picks a game style on the setup screen.
import * as store from './store.js';
import * as remote from './remote-config.js';
import * as numberPlace from './number-place.js';
import { celebrate } from './effects.js';

const settings = store.loadSettings();
remote.init();
const setWorld = (id) => { document.documentElement.dataset.world = id || 'random'; };
const style = new URLSearchParams(location.search).get('style');

if (!numberPlace.enabled()) {
  document.getElementById('np-root').innerHTML = '<p class="muted">NINETIMESNINE is taking a short break. Please try again soon, or play <a href="../fantastical/">The Fantastical Logic Grid</a>.</p>';
} else {
  numberPlace.open({
    celebrate: () => celebrate(settings.celebrations, { random: settings.celebrateRandom }),
    setWorld,
    style: /^[a-z]{2,12}$/.test(style || '') ? style : null,
  });
  // The module itself saves and pauses its clock when the page is hidden or left.
}
